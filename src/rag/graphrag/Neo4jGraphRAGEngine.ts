/**
 * @fileoverview Neo4j-backed GraphRAG engine for AgentOS.
 *
 * Implements `IGraphRAGEngine` using Neo4j for persistent entity/relationship/community
 * storage, native HNSW vector indexes for entity/community semantic search, and
 * GDS Louvain for community detection (with client-side graphology fallback).
 *
 * The entity extraction pipeline (LLM or pattern-based) is delegated to the caller
 * or reused from the existing GraphRAGEngine's extraction utilities.
 *
 * Features:
 * - Persistent graph storage in Neo4j
 * - Native vector indexes on entity/community embeddings
 * - GDS Louvain community detection (falls back to graphology if GDS unavailable)
 * - Document contribution tracking for safe re-ingestion
 * - Global search (community summaries) and local search (entity + 1-hop expansion)
 * - Shared Neo4jConnectionManager for connection pooling
 *
 * @module @framers/agentos/rag/graphrag/Neo4jGraphRAGEngine
 * @see ./IGraphRAG.ts for the interface definition.
 */

import type {
  IGraphRAGEngine,
  GraphRAGConfig,
  GraphEntity,
  GraphRelationship,
  GraphCommunity,
  GraphRAGSearchOptions,
  GlobalSearchResult,
  LocalSearchResult,
} from './IGraphRAG.js';
import type { MetadataValue } from '../IVectorStore.js';
import type { Neo4jConnectionManager } from '../../neo4j/Neo4jConnectionManager.js';
import { Neo4jCypherRunner } from '../../neo4j/Neo4jCypherRunner.js';

// ============================================================================
// Constants
// ============================================================================

const ENTITY_LABEL = 'GraphRAGEntity';
const COMMUNITY_LABEL = 'GraphRAGCommunity';
const DOC_LABEL = 'GraphRAGDocument';
const REL_TYPE = 'GRAPHRAG_REL';
const MEMBER_OF = 'MEMBER_OF';
const ENTITY_VEC_INDEX = 'graphrag_entity_embeddings';
const COMMUNITY_VEC_INDEX = 'graphrag_community_embeddings';
const DEFAULT_EMBEDDING_DIM = 1536;

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

// ============================================================================
// Internal Types
// ============================================================================

interface LLMProvider {
  generateText(prompt: string, options?: { maxTokens?: number; temperature?: number }): Promise<string>;
}

export interface Neo4jGraphRAGEngineDeps {
  connectionManager: Neo4jConnectionManager;
  embeddingManager?: {
    generateEmbeddings(input: { texts: string | string[] }): Promise<{ embeddings: number[][] }>;
  };
  llmProvider?: LLMProvider;
}

// ============================================================================
// Implementation
// ============================================================================

export class Neo4jGraphRAGEngine implements IGraphRAGEngine {
  private config!: GraphRAGConfig;
  private cypher!: Neo4jCypherRunner;
  private embeddingDimension!: number;
  private _isInitialized = false;

  constructor(private deps: Neo4jGraphRAGEngineDeps) {}

  async initialize(config: GraphRAGConfig): Promise<void> {
    this.config = config;
    this.cypher = new Neo4jCypherRunner(this.deps.connectionManager);
    this.embeddingDimension = config.embeddingDimension ?? DEFAULT_EMBEDDING_DIM;

    // Create constraints
    await this.cypher.writeVoid(
      `CREATE CONSTRAINT graphrag_entity_unique IF NOT EXISTS
       FOR (n:${ENTITY_LABEL}) REQUIRE n.entityId IS UNIQUE`,
    );
    await this.cypher.writeVoid(
      `CREATE CONSTRAINT graphrag_community_unique IF NOT EXISTS
       FOR (n:${COMMUNITY_LABEL}) REQUIRE n.communityId IS UNIQUE`,
    );
    await this.cypher.writeVoid(
      `CREATE CONSTRAINT graphrag_doc_unique IF NOT EXISTS
       FOR (n:${DOC_LABEL}) REQUIRE n.documentId IS UNIQUE`,
    );

    // Create vector indexes
    await this.cypher.writeVoid(
      `CREATE VECTOR INDEX ${ENTITY_VEC_INDEX} IF NOT EXISTS
       FOR (n:${ENTITY_LABEL}) ON (n.embedding)
       OPTIONS { indexConfig: {
         \`vector.dimensions\`: toInteger($dim),
         \`vector.similarity_function\`: 'cosine'
       }}`,
      { dim: this.embeddingDimension },
    );
    await this.cypher.writeVoid(
      `CREATE VECTOR INDEX ${COMMUNITY_VEC_INDEX} IF NOT EXISTS
       FOR (n:${COMMUNITY_LABEL}) ON (n.summaryEmbedding)
       OPTIONS { indexConfig: {
         \`vector.dimensions\`: toInteger($dim),
         \`vector.similarity_function\`: 'cosine'
       }}`,
      { dim: this.embeddingDimension },
    );

    this._isInitialized = true;
  }

  async ingestDocuments(
    documents: Array<{ id: string; content: string; metadata?: Record<string, MetadataValue> }>,
  ): Promise<{
    entitiesExtracted: number;
    relationshipsExtracted: number;
    communitiesDetected: number;
    documentsProcessed: number;
  }> {
    let totalEntities = 0;
    let totalRelationships = 0;

    for (const doc of documents) {
      // Track document
      await this.cypher.writeVoid(
        `MERGE (d:${DOC_LABEL} { documentId: $docId })
         SET d.ingestedAt = $now, d.contentHash = $hash`,
        { docId: doc.id, now: nowIso(), hash: this.simpleHash(doc.content) },
      );

      // Extract entities and relationships (LLM-based or pattern-based)
      const extraction = await this.extractEntitiesAndRelationships(doc.content, doc.id);

      // Merge entities into graph
      for (const entity of extraction.entities) {
        await this.cypher.writeVoid(
          `MERGE (e:${ENTITY_LABEL} { normalizedName: toLower(trim($name)) })
           ON CREATE SET
             e.entityId = $id,
             e.name = $name,
             e.type = $type,
             e.description = $description,
             e.properties_json = $props_json,
             e.frequency = $frequency,
             e.sourceDocumentIds = [$docId],
             e.createdAt = $now,
             e.updatedAt = $now
           ON MATCH SET
             e.frequency = e.frequency + $frequency,
             e.updatedAt = $now,
             e.sourceDocumentIds = CASE
               WHEN NOT $docId IN e.sourceDocumentIds
               THEN e.sourceDocumentIds + $docId
               ELSE e.sourceDocumentIds
             END,
             e.type = CASE WHEN e.type = 'concept' AND $type <> 'concept' THEN $type ELSE e.type END,
             e.description = CASE WHEN size($description) > size(e.description) THEN $description ELSE e.description END`,
          {
            id: entity.id,
            name: entity.name,
            type: entity.type,
            description: entity.description,
            props_json: JSON.stringify(entity.properties),
            frequency: entity.frequency,
            docId: doc.id,
            now: nowIso(),
          },
        );
        totalEntities++;
      }

      // Merge relationships
      for (const rel of extraction.relationships) {
        await this.cypher.writeVoid(
          `MATCH (src:${ENTITY_LABEL} { entityId: $sourceId })
           MATCH (tgt:${ENTITY_LABEL} { entityId: $targetId })
           MERGE (src)-[r:${REL_TYPE} { relType: $type }]->(tgt)
           ON CREATE SET
             r.relId = $id,
             r.description = $description,
             r.weight = $weight,
             r.sourceDocumentIds = [$docId],
             r.createdAt = $now
           ON MATCH SET
             r.weight = r.weight + $weight,
             r.sourceDocumentIds = CASE
               WHEN NOT $docId IN r.sourceDocumentIds
               THEN r.sourceDocumentIds + $docId
               ELSE r.sourceDocumentIds
             END`,
          {
            id: rel.id,
            sourceId: rel.sourceEntityId,
            targetId: rel.targetEntityId,
            type: rel.type,
            description: rel.description,
            weight: rel.weight,
            docId: doc.id,
            now: nowIso(),
          },
        );
        totalRelationships++;
      }

      // Generate entity embeddings if configured
      if (this.config.generateEntityEmbeddings !== false && this.deps.embeddingManager) {
        await this.generateEntityEmbeddings(extraction.entities);
      }
    }

    // Detect communities
    const communitiesDetected = await this.detectCommunities();

    return {
      entitiesExtracted: totalEntities,
      relationshipsExtracted: totalRelationships,
      communitiesDetected,
      documentsProcessed: documents.length,
    };
  }

  async removeDocuments(documentIds: string[]): Promise<{
    documentsRemoved: number;
    communitiesDetected: number;
  }> {
    let removed = 0;

    for (const docId of documentIds) {
      // Remove document contributions from entities
      await this.cypher.writeVoid(
        `MATCH (e:${ENTITY_LABEL})
         WHERE $docId IN e.sourceDocumentIds
         SET e.sourceDocumentIds = [x IN e.sourceDocumentIds WHERE x <> $docId]
         WITH e WHERE size(e.sourceDocumentIds) = 0
         DETACH DELETE e`,
        { docId },
      );

      // Remove document contributions from relationships
      await this.cypher.writeVoid(
        `MATCH ()-[r:${REL_TYPE}]->()
         WHERE $docId IN r.sourceDocumentIds
         SET r.sourceDocumentIds = [x IN r.sourceDocumentIds WHERE x <> $docId]
         WITH r WHERE size(r.sourceDocumentIds) = 0
         DELETE r`,
        { docId },
      );

      // Remove document node
      await this.cypher.writeVoid(
        `MATCH (d:${DOC_LABEL} { documentId: $docId }) DELETE d`,
        { docId },
      );

      removed++;
    }

    const communitiesDetected = await this.detectCommunities();
    return { documentsRemoved: removed, communitiesDetected };
  }

  async globalSearch(
    query: string,
    options?: GraphRAGSearchOptions,
  ): Promise<GlobalSearchResult> {
    const topK = options?.topK ?? 10;
    const startTime = Date.now();

    let communitySummaries: GlobalSearchResult['communitySummaries'] = [];

    // Try vector search on community summaries
    if (this.deps.embeddingManager) {
      const embStart = Date.now();
      const { embeddings } = await this.deps.embeddingManager.generateEmbeddings({ texts: query });
      const embTime = Date.now() - embStart;

      const searchStart = Date.now();
      const results = await this.cypher.read<{
        communityId: string;
        level: number;
        title: string;
        summary: string;
        score: number;
      }>(
        `CALL db.index.vector.queryNodes($idx, $topK, $queryVec)
         YIELD node, score
         RETURN node.communityId AS communityId,
                node.level AS level,
                node.title AS title,
                node.summary AS summary,
                score
         ORDER BY score DESC`,
        { idx: COMMUNITY_VEC_INDEX, topK, queryVec: embeddings[0] },
      );
      const searchTime = Date.now() - searchStart;

      communitySummaries = results.map((r) => ({
        communityId: r.communityId,
        level: Number(r.level),
        title: r.title,
        summary: r.summary,
        relevanceScore: r.score,
      }));

      // Synthesize answer from community summaries
      let answer = communitySummaries.map((c) => c.summary).join('\n\n');
      if (this.deps.llmProvider && communitySummaries.length > 0) {
        const prompt = `Based on the following community summaries from a knowledge graph, answer this question: "${query}"\n\n${communitySummaries.map((c) => `## ${c.title}\n${c.summary}`).join('\n\n')}`;
        try {
          answer = await this.deps.llmProvider.generateText(prompt, { maxTokens: this.config.maxSummaryTokens ?? 500 });
        } catch { /* Use concatenated summaries as fallback */ }
      }

      const totalCommunities = await this.cypher.read<{ count: number }>(
        `MATCH (c:${COMMUNITY_LABEL}) RETURN count(c) AS count`,
      );

      return {
        query,
        answer,
        communitySummaries,
        totalCommunitiesSearched: Number(totalCommunities[0]?.count ?? 0),
        diagnostics: {
          embeddingTimeMs: embTime,
          searchTimeMs: searchTime,
          synthesisTimeMs: Date.now() - startTime - embTime - searchTime,
        },
      };
    }

    // Fallback: text-based community search
    const results = await this.cypher.read<{
      communityId: string;
      level: number;
      title: string;
      summary: string;
    }>(
      `MATCH (c:${COMMUNITY_LABEL})
       WHERE c.summary CONTAINS $query OR c.title CONTAINS $query
       RETURN c.communityId AS communityId, c.level AS level,
              c.title AS title, c.summary AS summary
       LIMIT $topK`,
      { query, topK },
    );

    return {
      query,
      answer: results.map((r) => r.summary).join('\n\n'),
      communitySummaries: results.map((r) => ({
        communityId: r.communityId,
        level: Number(r.level),
        title: r.title,
        summary: r.summary,
        relevanceScore: 0.5,
      })),
      totalCommunitiesSearched: results.length,
      diagnostics: { searchTimeMs: Date.now() - startTime },
    };
  }

  async localSearch(
    query: string,
    options?: GraphRAGSearchOptions,
  ): Promise<LocalSearchResult> {
    const topK = options?.topK ?? 10;
    const startTime = Date.now();

    let matchedEntities: Array<GraphEntity & { relevanceScore: number }> = [];
    let relationships: GraphRelationship[] = [];
    let communityContext: LocalSearchResult['communityContext'] = [];

    if (this.deps.embeddingManager) {
      const embStart = Date.now();
      const { embeddings } = await this.deps.embeddingManager.generateEmbeddings({ texts: query });
      const embTime = Date.now() - embStart;

      // Entity vector search
      const searchStart = Date.now();
      const entityResults = await this.cypher.read<{
        entityId: string;
        name: string;
        type: string;
        description: string;
        properties_json: string;
        frequency: number;
        sourceDocumentIds: string[];
        createdAt: string;
        updatedAt: string;
        score: number;
      }>(
        `CALL db.index.vector.queryNodes($idx, $topK, $queryVec)
         YIELD node, score
         RETURN node.entityId AS entityId,
                node.name AS name,
                node.type AS type,
                node.description AS description,
                node.properties_json AS properties_json,
                node.frequency AS frequency,
                node.sourceDocumentIds AS sourceDocumentIds,
                node.createdAt AS createdAt,
                node.updatedAt AS updatedAt,
                score
         ORDER BY score DESC`,
        { idx: ENTITY_VEC_INDEX, topK, queryVec: embeddings[0] },
      );
      const searchTime = Date.now() - searchStart;

      matchedEntities = entityResults.map((r) => ({
        id: r.entityId,
        name: r.name,
        type: r.type,
        description: r.description,
        properties: this.safeParseJson(r.properties_json, {}),
        sourceDocumentIds: r.sourceDocumentIds ?? [],
        frequency: Number(r.frequency ?? 0),
        createdAt: r.createdAt ?? '',
        updatedAt: r.updatedAt ?? '',
        relevanceScore: r.score,
      }));

      // 1-hop expansion for matched entities
      const graphStart = Date.now();
      const entityIds = matchedEntities.map((e) => e.id);
      if (entityIds.length > 0) {
        const neighborResults = await this.cypher.read<{
          relId: string;
          sourceId: string;
          targetId: string;
          relType: string;
          description: string;
          weight: number;
          sourceDocumentIds: string[];
          createdAt: string;
        }>(
          `UNWIND $entityIds AS eid
           MATCH (e:${ENTITY_LABEL} { entityId: eid })-[r:${REL_TYPE}]-(neighbor:${ENTITY_LABEL})
           RETURN r.relId AS relId,
                  CASE WHEN startNode(r) = e THEN e.entityId ELSE neighbor.entityId END AS sourceId,
                  CASE WHEN endNode(r) = e THEN e.entityId ELSE neighbor.entityId END AS targetId,
                  r.relType AS relType,
                  r.description AS description,
                  r.weight AS weight,
                  r.sourceDocumentIds AS sourceDocumentIds,
                  r.createdAt AS createdAt`,
          { entityIds },
        );

        relationships = neighborResults.map((r) => ({
          id: r.relId ?? '',
          sourceEntityId: r.sourceId,
          targetEntityId: r.targetId,
          type: r.relType,
          description: r.description ?? '',
          weight: Number(r.weight ?? 0),
          properties: {},
          sourceDocumentIds: r.sourceDocumentIds ?? [],
          createdAt: r.createdAt ?? '',
        }));
      }
      const graphTime = Date.now() - graphStart;

      // Get community context for matched entities
      if (entityIds.length > 0) {
        const comResults = await this.cypher.read<{
          communityId: string;
          title: string;
          summary: string;
          level: number;
        }>(
          `UNWIND $entityIds AS eid
           MATCH (e:${ENTITY_LABEL} { entityId: eid })-[:${MEMBER_OF}]->(c:${COMMUNITY_LABEL})
           RETURN DISTINCT c.communityId AS communityId,
                  c.title AS title,
                  c.summary AS summary,
                  c.level AS level`,
          { entityIds },
        );

        communityContext = comResults.map((r) => ({
          communityId: r.communityId,
          title: r.title,
          summary: r.summary,
          level: Number(r.level),
        }));
      }

      // Assemble augmented context
      const contextParts: string[] = [];
      for (const e of matchedEntities.slice(0, 5)) {
        contextParts.push(`[${e.type}] ${e.name}: ${e.description}`);
      }
      for (const r of relationships.slice(0, 10)) {
        contextParts.push(`${r.sourceEntityId} --[${r.type}]--> ${r.targetEntityId}: ${r.description}`);
      }
      for (const c of communityContext.slice(0, 3)) {
        contextParts.push(`Community "${c.title}": ${c.summary}`);
      }

      return {
        query,
        entities: matchedEntities,
        relationships,
        communityContext,
        augmentedContext: contextParts.join('\n'),
        diagnostics: {
          embeddingTimeMs: embTime,
          searchTimeMs: searchTime,
          graphTraversalTimeMs: graphTime,
        },
      };
    }

    // Fallback: text-based search
    const textResults = await this.cypher.read<any>(
      `MATCH (e:${ENTITY_LABEL})
       WHERE e.name CONTAINS $query OR e.description CONTAINS $query
       RETURN e LIMIT $topK`,
      { query, topK },
    );

    matchedEntities = textResults.map((r: any) => {
      const props = r.e?.properties ?? r.e ?? {};
      return {
        id: props.entityId ?? '',
        name: props.name ?? '',
        type: props.type ?? '',
        description: props.description ?? '',
        properties: this.safeParseJson(props.properties_json, {}),
        sourceDocumentIds: props.sourceDocumentIds ?? [],
        frequency: Number(props.frequency ?? 0),
        createdAt: props.createdAt ?? '',
        updatedAt: props.updatedAt ?? '',
        relevanceScore: 0.5,
      };
    });

    return {
      query,
      entities: matchedEntities,
      relationships: [],
      communityContext: [],
      augmentedContext: matchedEntities.map((e) => `[${e.type}] ${e.name}: ${e.description}`).join('\n'),
    };
  }

  async getEntities(options?: { type?: string; limit?: number }): Promise<GraphEntity[]> {
    const conditions: string[] = [];
    const params: Record<string, unknown> = { limit: options?.limit ?? 100 };

    if (options?.type) {
      conditions.push('e.type = $type');
      params.type = options.type;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const results = await this.cypher.read<any>(
      `MATCH (e:${ENTITY_LABEL}) ${where} RETURN e LIMIT $limit`,
      params,
    );

    return results.map((r: any) => this.nodeToGraphEntity(r.e));
  }

  async getRelationships(entityId: string): Promise<GraphRelationship[]> {
    const results = await this.cypher.read<any>(
      `MATCH (e:${ENTITY_LABEL} { entityId: $entityId })-[r:${REL_TYPE}]-(other:${ENTITY_LABEL})
       RETURN r.relId AS relId, r.relType AS relType, r.description AS description,
              r.weight AS weight, r.sourceDocumentIds AS sourceDocumentIds, r.createdAt AS createdAt,
              CASE WHEN startNode(r) = e THEN e.entityId ELSE other.entityId END AS sourceId,
              CASE WHEN endNode(r) = e THEN e.entityId ELSE other.entityId END AS targetId`,
      { entityId },
    );

    return results.map((r: any) => ({
      id: r.relId ?? '',
      sourceEntityId: r.sourceId,
      targetEntityId: r.targetId,
      type: r.relType ?? '',
      description: r.description ?? '',
      weight: Number(r.weight ?? 0),
      properties: {},
      sourceDocumentIds: r.sourceDocumentIds ?? [],
      createdAt: r.createdAt ?? '',
    }));
  }

  async getCommunities(level?: number): Promise<GraphCommunity[]> {
    const conditions: string[] = [];
    const params: Record<string, unknown> = {};

    if (level !== undefined) {
      conditions.push('c.level = $level');
      params.level = level;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const results = await this.cypher.read<any>(
      `MATCH (c:${COMMUNITY_LABEL}) ${where}
       RETURN c ORDER BY c.importance DESC`,
      params,
    );

    return results.map((r: any) => this.nodeToCommunity(r.c));
  }

  async getStats(): Promise<{
    totalEntities: number;
    totalRelationships: number;
    totalCommunities: number;
    communityLevels: number;
    documentsIngested: number;
  }> {
    const results = await this.cypher.read<any>(
      `MATCH (e:${ENTITY_LABEL})
       WITH count(e) AS entities
       OPTIONAL MATCH ()-[r:${REL_TYPE}]->()
       WITH entities, count(r) AS rels
       OPTIONAL MATCH (c:${COMMUNITY_LABEL})
       WITH entities, rels, count(c) AS communities,
            CASE WHEN count(c) > 0 THEN max(c.level) + 1 ELSE 0 END AS levels
       OPTIONAL MATCH (d:${DOC_LABEL})
       RETURN entities, rels, communities, levels, count(d) AS docs`,
    );

    const row = results[0] ?? {};
    return {
      totalEntities: Number(row.entities ?? 0),
      totalRelationships: Number(row.rels ?? 0),
      totalCommunities: Number(row.communities ?? 0),
      communityLevels: Number(row.levels ?? 0),
      documentsIngested: Number(row.docs ?? 0),
    };
  }

  async clear(): Promise<void> {
    await this.cypher.writeVoid(`MATCH (n:${ENTITY_LABEL}) DETACH DELETE n`);
    await this.cypher.writeVoid(`MATCH (n:${COMMUNITY_LABEL}) DETACH DELETE n`);
    await this.cypher.writeVoid(`MATCH (n:${DOC_LABEL}) DETACH DELETE n`);
  }

  async shutdown(): Promise<void> {
    // Connection manager is shared — don't close it here
    this._isInitialized = false;
  }

  // ============ Private: Community Detection ============

  private async detectCommunities(): Promise<number> {
    // Clear existing communities
    await this.cypher.writeVoid(`MATCH (c:${COMMUNITY_LABEL}) DETACH DELETE c`);

    // Try GDS Louvain first
    try {
      return await this.detectCommunitiesGDS();
    } catch {
      // GDS not available — fall back to client-side
      return await this.detectCommunitiesClientSide();
    }
  }

  private async detectCommunitiesGDS(): Promise<number> {
    // Project the graph
    await this.cypher.writeVoid(
      `CALL gds.graph.project('graphrag_projection', $nodeLabel, {
         ${REL_TYPE}: { properties: 'weight' }
       })`,
      { nodeLabel: ENTITY_LABEL },
    );

    try {
      // Run Louvain
      const results = await this.cypher.read<{
        entityId: string;
        communityId: number;
      }>(
        `CALL gds.louvain.stream('graphrag_projection', {
           relationshipWeightProperty: 'weight'
         })
         YIELD nodeId, communityId
         WITH gds.util.asNode(nodeId) AS node, communityId
         RETURN node.entityId AS entityId, communityId`,
      );

      return await this.storeCommunities(results);
    } finally {
      // Clean up projection
      try {
        await this.cypher.writeVoid(`CALL gds.graph.drop('graphrag_projection')`);
      } catch { /* ignore if already dropped */ }
    }
  }

  private async detectCommunitiesClientSide(): Promise<number> {
    // Fetch all nodes and edges, run graphology Louvain client-side
    try {
      const Graph = (await import('graphology')).default;
      const louvain = (await import('graphology-communities-louvain')).default;

      const graph = new Graph({ multi: false, type: 'undirected' });

      // Fetch all entities
      const entities = await this.cypher.read<{ entityId: string }>(
        `MATCH (e:${ENTITY_LABEL}) RETURN e.entityId AS entityId`,
      );

      for (const e of entities) {
        graph.addNode(e.entityId);
      }

      // Fetch all relationships
      const rels = await this.cypher.read<{ src: string; tgt: string; weight: number }>(
        `MATCH (s:${ENTITY_LABEL})-[r:${REL_TYPE}]->(t:${ENTITY_LABEL})
         RETURN s.entityId AS src, t.entityId AS tgt, r.weight AS weight`,
      );

      for (const r of rels) {
        if (graph.hasNode(r.src) && graph.hasNode(r.tgt) && !graph.hasEdge(r.src, r.tgt)) {
          graph.addEdge(r.src, r.tgt, { weight: Number(r.weight ?? 1) });
        }
      }

      if (graph.order === 0) return 0;

      // Run Louvain
      const partition = louvain(graph, {
        resolution: this.config.communityResolution ?? 1.0,
        getEdgeWeight: 'weight',
      });

      // Convert to community assignment format
      const assignments = Object.entries(partition).map(([entityId, communityId]) => ({
        entityId,
        communityId: communityId as number,
      }));

      return await this.storeCommunities(assignments);
    } catch {
      // Neither GDS nor graphology available
      return 0;
    }
  }

  private async storeCommunities(
    assignments: Array<{ entityId: string; communityId: number }>,
  ): Promise<number> {
    // Group by community
    const communityMap = new Map<number, string[]>();
    for (const a of assignments) {
      if (!communityMap.has(a.communityId)) {
        communityMap.set(a.communityId, []);
      }
      communityMap.get(a.communityId)!.push(a.entityId);
    }

    const minSize = this.config.minCommunitySize ?? 2;
    let stored = 0;

    for (const [commId, entityIds] of communityMap) {
      if (entityIds.length < minSize) continue;

      const communityId = `community-${commId}`;

      // Get entity descriptions for summary
      const entityDescs = await this.cypher.read<{ name: string; description: string }>(
        `MATCH (e:${ENTITY_LABEL}) WHERE e.entityId IN $ids
         RETURN e.name AS name, e.description AS description`,
        { ids: entityIds },
      );

      // Generate summary
      let summary = entityDescs.map((e) => `${e.name}: ${e.description}`).join('; ');
      let title = entityDescs.slice(0, 3).map((e) => e.name).join(', ');

      if (this.deps.llmProvider && entityDescs.length > 2) {
        try {
          const prompt = `Summarize this group of related entities in 2-3 sentences:\n${entityDescs.map((e) => `- ${e.name}: ${e.description}`).join('\n')}`;
          summary = await this.deps.llmProvider.generateText(prompt, { maxTokens: 200 });
          title = `Community: ${entityDescs.slice(0, 3).map((e) => e.name).join(', ')}`;
        } catch { /* use concatenated descriptions */ }
      }

      // Store community node
      await this.cypher.writeVoid(
        `CREATE (c:${COMMUNITY_LABEL} {
           communityId: $communityId,
           level: 0,
           title: $title,
           summary: $summary,
           entityIds: $entityIds,
           importance: $importance,
           parentCommunityId: null,
           childCommunityIds: [],
           relationshipIds: [],
           findings: [],
           createdAt: $now
         })`,
        {
          communityId,
          title,
          summary,
          entityIds,
          importance: entityIds.length / assignments.length,
          now: nowIso(),
        },
      );

      // Create MEMBER_OF edges
      await this.cypher.writeVoid(
        `MATCH (c:${COMMUNITY_LABEL} { communityId: $communityId })
         UNWIND $entityIds AS eid
         MATCH (e:${ENTITY_LABEL} { entityId: eid })
         MERGE (e)-[:${MEMBER_OF}]->(c)`,
        { communityId, entityIds },
      );

      // Generate community embedding for global search
      if (this.deps.embeddingManager) {
        try {
          const { embeddings } = await this.deps.embeddingManager.generateEmbeddings({
            texts: `${title}: ${summary}`,
          });
          await this.cypher.writeVoid(
            `MATCH (c:${COMMUNITY_LABEL} { communityId: $communityId })
             SET c.summaryEmbedding = $embedding`,
            { communityId, embedding: embeddings[0] },
          );
        } catch { /* skip embedding if it fails */ }
      }

      stored++;
    }

    return stored;
  }

  // ============ Private: Entity Extraction ============

  private async extractEntitiesAndRelationships(
    content: string,
    documentId: string,
  ): Promise<{ entities: GraphEntity[]; relationships: GraphRelationship[] }> {
    if (this.deps.llmProvider) {
      return this.extractViaLLM(content, documentId);
    }
    return this.extractViaPatterns(content, documentId);
  }

  private async extractViaLLM(
    content: string,
    documentId: string,
  ): Promise<{ entities: GraphEntity[]; relationships: GraphRelationship[] }> {
    const entityTypes = this.config.entityTypes ?? ['person', 'organization', 'concept', 'location', 'event', 'technology'];

    const prompt = `Extract entities and relationships from the following text.
Return JSON with this exact structure:
{"entities": [{"name": "...", "type": "...", "description": "..."}], "relationships": [{"source": "...", "target": "...", "type": "...", "description": "..."}]}

Entity types: ${entityTypes.join(', ')}

Text:
${content.slice(0, 4000)}`;

    try {
      const response = await this.deps.llmProvider!.generateText(prompt, {
        maxTokens: 2000,
        temperature: 0,
      });

      const parsed = JSON.parse(response.replace(/```json?\n?/g, '').replace(/```/g, '').trim());
      const now = nowIso();

      const entities: GraphEntity[] = (parsed.entities ?? []).map((e: any) => ({
        id: generateId(),
        name: e.name,
        type: e.type ?? 'concept',
        description: e.description ?? '',
        properties: {},
        sourceDocumentIds: [documentId],
        frequency: 1,
        createdAt: now,
        updatedAt: now,
      }));

      const entityNameToId = new Map(entities.map((e) => [e.name.toLowerCase(), e.id]));

      const relationships: GraphRelationship[] = (parsed.relationships ?? [])
        .filter((r: any) => entityNameToId.has(r.source?.toLowerCase()) && entityNameToId.has(r.target?.toLowerCase()))
        .map((r: any) => ({
          id: generateId(),
          sourceEntityId: entityNameToId.get(r.source.toLowerCase())!,
          targetEntityId: entityNameToId.get(r.target.toLowerCase())!,
          type: r.type ?? 'related_to',
          description: r.description ?? '',
          weight: 1,
          properties: {},
          sourceDocumentIds: [documentId],
          createdAt: now,
        }));

      return { entities, relationships };
    } catch {
      return this.extractViaPatterns(content, documentId);
    }
  }

  private extractViaPatterns(
    content: string,
    documentId: string,
  ): { entities: GraphEntity[]; relationships: GraphRelationship[] } {
    // Simple NER-like extraction via capitalized phrases
    const now = nowIso();
    const entityMap = new Map<string, GraphEntity>();

    const capitalizedPattern = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/g;
    let match;
    while ((match = capitalizedPattern.exec(content)) !== null) {
      const name = match[1];
      const normalized = name.toLowerCase();
      if (!entityMap.has(normalized)) {
        entityMap.set(normalized, {
          id: generateId(),
          name,
          type: 'concept',
          description: `Entity "${name}" extracted from text`,
          properties: {},
          sourceDocumentIds: [documentId],
          frequency: 1,
          createdAt: now,
          updatedAt: now,
        });
      } else {
        entityMap.get(normalized)!.frequency++;
      }
    }

    return { entities: Array.from(entityMap.values()), relationships: [] };
  }

  // ============ Private: Embedding Generation ============

  private async generateEntityEmbeddings(entities: GraphEntity[]): Promise<void> {
    if (!this.deps.embeddingManager || entities.length === 0) return;

    const texts = entities.map((e) => `${e.name} (${e.type}): ${e.description}`);
    const batchSize = 32;

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const batchEntities = entities.slice(i, i + batchSize);

      try {
        const { embeddings } = await this.deps.embeddingManager.generateEmbeddings({ texts: batch });
        for (let j = 0; j < batchEntities.length; j++) {
          await this.cypher.writeVoid(
            `MATCH (e:${ENTITY_LABEL} { entityId: $entityId })
             SET e.embedding = $embedding`,
            { entityId: batchEntities[j].id, embedding: embeddings[j] },
          );
        }
      } catch { /* skip embedding batch on error */ }
    }
  }

  // ============ Private Helpers ============

  private nodeToGraphEntity(node: any): GraphEntity {
    const props = node?.properties ?? node ?? {};
    return {
      id: props.entityId ?? '',
      name: props.name ?? '',
      type: props.type ?? '',
      description: props.description ?? '',
      properties: this.safeParseJson(props.properties_json, {}),
      embedding: props.embedding ?? undefined,
      sourceDocumentIds: props.sourceDocumentIds ?? [],
      frequency: Number(props.frequency ?? 0),
      createdAt: props.createdAt ?? '',
      updatedAt: props.updatedAt ?? '',
    };
  }

  private nodeToCommunity(node: any): GraphCommunity {
    const props = node?.properties ?? node ?? {};
    return {
      id: props.communityId ?? '',
      level: Number(props.level ?? 0),
      parentCommunityId: props.parentCommunityId ?? null,
      childCommunityIds: props.childCommunityIds ?? [],
      entityIds: props.entityIds ?? [],
      relationshipIds: props.relationshipIds ?? [],
      summary: props.summary ?? '',
      findings: props.findings ?? [],
      importance: Number(props.importance ?? 0),
      title: props.title ?? '',
      createdAt: props.createdAt ?? '',
    };
  }

  private safeParseJson(json: string | null | undefined, fallback: any): any {
    if (!json) return fallback;
    try { return JSON.parse(json); } catch { return fallback; }
  }

  private simpleHash(text: string): string {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString(36);
  }
}
