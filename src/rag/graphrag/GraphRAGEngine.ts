/**
 * @file GraphRAGEngine.ts
 * @description TypeScript-native GraphRAG engine for AgentOS.
 * Implements entity extraction, graph construction, Louvain community detection,
 * community summarization, and global/local search -- all without Python.
 *
 * Uses:
 * - graphology for graph data structure
 * - graphology-communities-louvain for community detection
 * - IVectorStore (hnswlib or sql) for embedding search
 * - IEmbeddingManager for embeddings
 * - sql-storage-adapter for persistence
 *
 * @module AgentOS/RAG/GraphRAG
 * @version 1.0.0
 */

import { v4 as uuidv4 } from 'uuid';
import Graph from 'graphology';
import louvain from 'graphology-communities-louvain';

import type {
  IGraphRAGEngine,
  GraphRAGConfig,
  GraphEntity,
  GraphRelationship,
  GraphCommunity,
  GraphRAGSearchOptions,
  GlobalSearchResult,
  LocalSearchResult,
  ExtractionResult,
} from './IGraphRAG.js';
import type { IVectorStore, VectorDocument, MetadataValue } from '../IVectorStore.js';
import type { IEmbeddingManager } from '../IEmbeddingManager.js';
import { GMIError, GMIErrorCode } from '../../utils/errors.js';

// =============================================================================
// Internal Types
// =============================================================================

interface LLMProvider {
  generateText(prompt: string, options?: { maxTokens?: number; temperature?: number }): Promise<string>;
}

interface PersistenceAdapter {
  exec(script: string): Promise<void>;
  run(statement: string, parameters?: any[]): Promise<{ changes: number }>;
  all<T = unknown>(statement: string, parameters?: any[]): Promise<T[]>;
  get<T = unknown>(statement: string, parameters?: any[]): Promise<T | null>;
}

// =============================================================================
// GraphRAGEngine
// =============================================================================

export class GraphRAGEngine implements IGraphRAGEngine {
  private config!: GraphRAGConfig;
  private isInitialized: boolean = false;

  // Core data stores
  private entities: Map<string, GraphEntity> = new Map();
  private relationships: Map<string, GraphRelationship> = new Map();
  private communities: Map<string, GraphCommunity> = new Map();
  private ingestedDocumentIds: Set<string> = new Set();

  // Graph structure (graphology)
  private graph!: Graph;

  // External dependencies (injected)
  private vectorStore?: IVectorStore;
  private embeddingManager?: IEmbeddingManager;
  private llmProvider?: LLMProvider;
  private persistenceAdapter?: PersistenceAdapter;

  private tablePrefix: string = 'graphrag_';

  constructor(deps?: {
    vectorStore?: IVectorStore;
    embeddingManager?: IEmbeddingManager;
    llmProvider?: LLMProvider;
    persistenceAdapter?: PersistenceAdapter;
  }) {
    if (deps) {
      this.vectorStore = deps.vectorStore;
      this.embeddingManager = deps.embeddingManager;
      this.llmProvider = deps.llmProvider;
      this.persistenceAdapter = deps.persistenceAdapter;
    }
  }

  private async resolveEmbeddingDimension(): Promise<number> {
    const configured = this.config.embeddingDimension;
    if (typeof configured === 'number' && Number.isFinite(configured) && configured > 0) {
      return configured;
    }

    if (!this.embeddingManager) {
      return 1536;
    }

    try {
      const resp = await this.embeddingManager.generateEmbeddings({
        texts: 'dimension probe',
        modelId: this.config.embeddingModelId,
      });
      const embedding = resp?.embeddings?.[0];
      if (Array.isArray(embedding) && embedding.length > 0) {
        return embedding.length;
      }
    } catch {
      // Fall back to a sensible default.
    }

    return 1536;
  }

  async initialize(config: GraphRAGConfig): Promise<void> {
    if (this.isInitialized) {
      console.warn(`[GraphRAGEngine:${config.engineId}] Re-initializing.`);
      await this.clear();
    }

    this.config = {
      entityTypes: ['person', 'organization', 'location', 'event', 'concept', 'technology'],
      maxCommunityLevels: 3,
      minCommunitySize: 2,
      communityResolution: 1.0,
      generateEntityEmbeddings: true,
      entityCollectionName: 'graphrag_entities',
      communityCollectionName: 'graphrag_communities',
      tablePrefix: 'graphrag_',
      ...config,
    };

    this.tablePrefix = this.config.tablePrefix ?? 'graphrag_';
    this.graph = new Graph({ multi: false, type: 'undirected' });

    // Initialize persistence schema if adapter available
    if (this.persistenceAdapter) {
      await this.createPersistenceSchema();
      await this.loadFromPersistence();
    }

    // Initialize vector store collections
    if (this.vectorStore && (this.embeddingManager || typeof this.config.embeddingDimension === 'number')) {
      const dim = await this.resolveEmbeddingDimension();
      this.config.embeddingDimension = dim;
      try {
        if (this.vectorStore.createCollection) {
          const entityColExists = await this.vectorStore.collectionExists?.(this.config.entityCollectionName!);
          if (!entityColExists) {
            await this.vectorStore.createCollection(this.config.entityCollectionName!, dim);
          }
          const communityColExists = await this.vectorStore.collectionExists?.(this.config.communityCollectionName!);
          if (!communityColExists) {
            await this.vectorStore.createCollection(this.config.communityCollectionName!, dim);
          }
        }
      } catch {
        // Collections may already exist
      }
    }

    this.isInitialized = true;
  }

  private ensureInitialized(): void {
    if (!this.isInitialized) {
      throw new GMIError(
        'GraphRAGEngine is not initialized. Call initialize() first.',
        GMIErrorCode.NOT_INITIALIZED,
        undefined,
        'GraphRAGEngine',
      );
    }
  }

  // ===========================================================================
  // Document Ingestion Pipeline
  // ===========================================================================

  async ingestDocuments(
    documents: Array<{ id: string; content: string; metadata?: Record<string, MetadataValue> }>,
  ): Promise<{
    entitiesExtracted: number;
    relationshipsExtracted: number;
    communitiesDetected: number;
    documentsProcessed: number;
  }> {
    this.ensureInitialized();

    let totalEntities = 0;
    let totalRelationships = 0;

    // Step 1: Extract entities and relationships from each document
    for (const doc of documents) {
      if (this.ingestedDocumentIds.has(doc.id)) continue;

      const extraction = await this.extractEntitiesAndRelationships(doc.id, doc.content);
      totalEntities += extraction.entities.length;
      totalRelationships += extraction.relationships.length;

      // Merge into graph
      for (const entity of extraction.entities) {
        this.mergeEntity(entity);
      }
      for (const rel of extraction.relationships) {
        this.mergeRelationship(rel);
      }

      this.ingestedDocumentIds.add(doc.id);
    }

    // Step 2: Generate entity embeddings
    if (this.embeddingManager && this.vectorStore && this.config.generateEntityEmbeddings) {
      await this.generateEntityEmbeddings();
    }

    // Step 3: Detect communities using Louvain
    const communitiesDetected = await this.detectCommunities();

    // Step 4: Generate community summaries
    if (this.llmProvider) {
      await this.generateCommunitySummaries();
    }

    // Step 5: Persist to database
    if (this.persistenceAdapter) {
      await this.persistAll();
    }

    return {
      entitiesExtracted: totalEntities,
      relationshipsExtracted: totalRelationships,
      communitiesDetected,
      documentsProcessed: documents.length,
    };
  }

  // ===========================================================================
  // Entity & Relationship Extraction
  // ===========================================================================

  private async extractEntitiesAndRelationships(
    documentId: string,
    content: string,
  ): Promise<ExtractionResult> {
    // If LLM provider available, use LLM-driven extraction
    if (this.llmProvider) {
      return this.llmExtract(documentId, content);
    }

    // Fallback: pattern-based extraction
    return this.patternExtract(documentId, content);
  }

  private async llmExtract(documentId: string, content: string): Promise<ExtractionResult> {
    const entityTypesStr = (this.config.entityTypes ?? []).join(', ');
    const prompt = `Extract all entities and relationships from the following text.

Entity types to look for: ${entityTypesStr}

For each entity, provide:
- name: the entity name
- type: one of [${entityTypesStr}]
- description: brief description of the entity in context

For each relationship, provide:
- source: source entity name
- target: target entity name
- type: relationship type (e.g., "works_for", "located_in", "related_to", "uses", "creates")
- description: brief description of the relationship

Respond in JSON format:
{
  "entities": [{"name": "...", "type": "...", "description": "..."}],
  "relationships": [{"source": "...", "target": "...", "type": "...", "description": "..."}]
}

Text:
${content.slice(0, 8000)}`;

    try {
      const response = await this.llmProvider!.generateText(prompt, {
        maxTokens: 2000,
        temperature: 0,
      });

      // Parse JSON from response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return this.patternExtract(documentId, content);
      }

      const parsed = JSON.parse(jsonMatch[0]);
      const now = new Date().toISOString();

      const entities: GraphEntity[] = (parsed.entities ?? []).map((e: any) => ({
        id: `entity-${uuidv4().slice(0, 8)}`,
        name: String(e.name || '').trim(),
        type: String(e.type || 'concept').toLowerCase(),
        description: String(e.description || ''),
        properties: {},
        sourceDocumentIds: [documentId],
        frequency: 1,
        createdAt: now,
        updatedAt: now,
      }));

      // Build name→id map for relationship linking
      const nameToId = new Map<string, string>();
      for (const entity of entities) {
        nameToId.set(entity.name.toLowerCase(), entity.id);
      }

      const relationships: GraphRelationship[] = (parsed.relationships ?? [])
        .map((r: any) => {
          const sourceId = nameToId.get(String(r.source || '').toLowerCase().trim());
          const targetId = nameToId.get(String(r.target || '').toLowerCase().trim());
          if (!sourceId || !targetId || sourceId === targetId) return null;

          return {
            id: `rel-${uuidv4().slice(0, 8)}`,
            sourceEntityId: sourceId,
            targetEntityId: targetId,
            type: String(r.type || 'related_to'),
            description: String(r.description || ''),
            weight: 1.0,
            properties: {},
            sourceDocumentIds: [documentId],
            createdAt: now,
          } as GraphRelationship;
        })
        .filter(Boolean) as GraphRelationship[];

      return { entities, relationships, sourceDocumentId: documentId };
    } catch (error) {
      // Fallback to pattern extraction on any LLM error
      return this.patternExtract(documentId, content);
    }
  }

  private patternExtract(documentId: string, content: string): ExtractionResult {
    const now = new Date().toISOString();
    const entities: GraphEntity[] = [];
    const relationships: GraphRelationship[] = [];
    const seenNames = new Set<string>();

    // Extract capitalized multi-word entities (proper nouns)
    // Pattern: Capital letter + lowercase letters, optionally followed by more capitalized words
    const properNounPattern = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/g;
    let match;
    while ((match = properNounPattern.exec(content)) !== null) {
      const name = match[1].trim();
      if (name.length < 3 || seenNames.has(name.toLowerCase())) continue;
      seenNames.add(name.toLowerCase());

      entities.push({
        id: `entity-${uuidv4().slice(0, 8)}`,
        name,
        type: 'concept',
        description: this.extractSentenceContext(content, name),
        properties: {},
        sourceDocumentIds: [documentId],
        frequency: this.countOccurrences(content, name),
        createdAt: now,
        updatedAt: now,
      });
    }

    // Create relationships between entities that appear in the same sentence
    const sentences = content.split(/[.!?]+/);
    for (const sentence of sentences) {
      const sentenceEntities = entities.filter(e =>
        sentence.toLowerCase().includes(e.name.toLowerCase()),
      );
      for (let i = 0; i < sentenceEntities.length; i++) {
        for (let j = i + 1; j < sentenceEntities.length; j++) {
          relationships.push({
            id: `rel-${uuidv4().slice(0, 8)}`,
            sourceEntityId: sentenceEntities[i].id,
            targetEntityId: sentenceEntities[j].id,
            type: 'related_to',
            description: sentence.trim().slice(0, 200),
            weight: 1.0,
            properties: {},
            sourceDocumentIds: [documentId],
            createdAt: now,
          });
        }
      }
    }

    return { entities, relationships, sourceDocumentId: documentId };
  }

  private extractSentenceContext(text: string, term: string): string {
    const idx = text.toLowerCase().indexOf(term.toLowerCase());
    if (idx === -1) return '';
    const start = Math.max(0, text.lastIndexOf('.', idx) + 1);
    const end = text.indexOf('.', idx + term.length);
    return text.slice(start, end > 0 ? end + 1 : start + 300).trim();
  }

  private countOccurrences(text: string, term: string): number {
    const regex = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    return (text.match(regex) || []).length;
  }

  // ===========================================================================
  // Entity & Relationship Merging (deduplication)
  // ===========================================================================

  private mergeEntity(entity: GraphEntity): void {
    // Check if entity with same name already exists (case-insensitive)
    const normalizedName = entity.name.toLowerCase().trim();
    let existing: GraphEntity | undefined;

    for (const [, e] of this.entities) {
      if (e.name.toLowerCase().trim() === normalizedName) {
        existing = e;
        break;
      }
    }

    if (existing) {
      // Merge: update frequency, add source docs, merge descriptions
      existing.frequency += entity.frequency;
      existing.updatedAt = new Date().toISOString();
      for (const docId of entity.sourceDocumentIds) {
        if (!existing.sourceDocumentIds.includes(docId)) {
          existing.sourceDocumentIds.push(docId);
        }
      }
      if (entity.description && !existing.description.includes(entity.description)) {
        existing.description = `${existing.description} ${entity.description}`.trim();
      }

      // Update graph node
      if (!this.graph.hasNode(existing.id)) {
        this.graph.addNode(existing.id, { name: existing.name, type: existing.type });
      }
    } else {
      // Add new entity
      this.entities.set(entity.id, entity);
      this.graph.addNode(entity.id, { name: entity.name, type: entity.type });
    }
  }

  private mergeRelationship(rel: GraphRelationship): void {
    // Ensure both entities exist in graph
    if (!this.graph.hasNode(rel.sourceEntityId) || !this.graph.hasNode(rel.targetEntityId)) {
      return;
    }

    // Check for existing edge between same entities
    const edgeKey = `${rel.sourceEntityId}-${rel.targetEntityId}`;
    const reverseKey = `${rel.targetEntityId}-${rel.sourceEntityId}`;

    let existing: GraphRelationship | undefined;
    for (const [, r] of this.relationships) {
      const rKey = `${r.sourceEntityId}-${r.targetEntityId}`;
      const rRev = `${r.targetEntityId}-${r.sourceEntityId}`;
      if (rKey === edgeKey || rKey === reverseKey || rRev === edgeKey) {
        existing = r;
        break;
      }
    }

    if (existing) {
      // Increase weight for repeated relationships
      existing.weight += rel.weight;
      for (const docId of rel.sourceDocumentIds) {
        if (!existing.sourceDocumentIds.includes(docId)) {
          existing.sourceDocumentIds.push(docId);
        }
      }
    } else {
      this.relationships.set(rel.id, rel);
      try {
        this.graph.addEdge(rel.sourceEntityId, rel.targetEntityId, {
          id: rel.id,
          type: rel.type,
          weight: rel.weight,
        });
      } catch {
        // Edge may already exist in undirected graph
      }
    }
  }

  // ===========================================================================
  // Entity Embeddings
  // ===========================================================================

  private async generateEntityEmbeddings(): Promise<void> {
    if (!this.embeddingManager || !this.vectorStore) return;

    const entitiesToEmbed: GraphEntity[] = [];
    for (const entity of this.entities.values()) {
      if (!entity.embedding) {
        entitiesToEmbed.push(entity);
      }
    }

    if (entitiesToEmbed.length === 0) return;

    // Generate embeddings in batches
    const batchSize = 32;
    for (let i = 0; i < entitiesToEmbed.length; i += batchSize) {
      const batch = entitiesToEmbed.slice(i, i + batchSize);
      const texts = batch.map(e => `${e.name}: ${e.description}`);

      try {
        const result = await this.embeddingManager.generateEmbeddings({
          texts,
          modelId: this.config.embeddingModelId,
        });

        // Store embeddings on entities and in vector store
        const vectorDocs: VectorDocument[] = [];
        for (let j = 0; j < batch.length; j++) {
          const embedding = result.embeddings[j];
          if (embedding) {
            batch[j].embedding = embedding;
            vectorDocs.push({
              id: batch[j].id,
              embedding,
              textContent: `${batch[j].name}: ${batch[j].description}`,
              metadata: {
                entityName: batch[j].name,
                entityType: batch[j].type,
                frequency: batch[j].frequency,
              },
            });
          }
        }

        if (vectorDocs.length > 0) {
          await this.vectorStore.upsert(this.config.entityCollectionName!, vectorDocs);
        }
      } catch (error) {
        console.warn('[GraphRAGEngine] Failed to generate entity embeddings:', error);
      }
    }
  }

  // ===========================================================================
  // Community Detection (Louvain via graphology)
  // ===========================================================================

  private async detectCommunities(): Promise<number> {
    if (this.graph.order < 2) return 0;

    this.communities.clear();

    // Run Louvain community detection
    const communityAssignments = louvain(this.graph, {
      resolution: this.config.communityResolution ?? 1.0,
      getEdgeWeight: 'weight',
    });

    // Group entities by community
    const communityGroups = new Map<number, string[]>();
    for (const [nodeId, communityId] of Object.entries(communityAssignments)) {
      const cId = communityId as number;
      if (!communityGroups.has(cId)) {
        communityGroups.set(cId, []);
      }
      communityGroups.get(cId)!.push(nodeId);
    }

    const now = new Date().toISOString();

    // Create community objects (Level 0 = most granular)
    for (const [communityIdx, entityIds] of communityGroups) {
      if (entityIds.length < (this.config.minCommunitySize ?? 2)) continue;

      // Find internal relationships
      const internalRelIds: string[] = [];
      for (const [relId, rel] of this.relationships) {
        if (entityIds.includes(rel.sourceEntityId) && entityIds.includes(rel.targetEntityId)) {
          internalRelIds.push(relId);
        }
      }

      // Compute importance based on entity frequency and relationship count
      let importance = 0;
      for (const eId of entityIds) {
        const entity = this.entities.get(eId);
        if (entity) importance += entity.frequency;
      }
      importance += internalRelIds.length;

      // Generate title from most frequent entities
      const sortedEntities = entityIds
        .map(id => this.entities.get(id))
        .filter(Boolean)
        .sort((a, b) => b!.frequency - a!.frequency);

      const title = sortedEntities
        .slice(0, 3)
        .map(e => e!.name)
        .join(', ');

      const community: GraphCommunity = {
        id: `community-${uuidv4().slice(0, 8)}`,
        level: 0,
        parentCommunityId: null,
        childCommunityIds: [],
        entityIds,
        relationshipIds: internalRelIds,
        summary: '', // Will be filled by LLM summarization
        findings: [],
        importance,
        title: title || `Community ${communityIdx}`,
        createdAt: now,
      };

      this.communities.set(community.id, community);
    }

    // Build hierarchy: create higher-level communities by merging small ones
    await this.buildCommunityHierarchy();

    return this.communities.size;
  }

  private async buildCommunityHierarchy(): Promise<void> {
    const maxLevels = this.config.maxCommunityLevels ?? 3;
    const now = new Date().toISOString();

    for (let level = 1; level < maxLevels; level++) {
      const prevLevelCommunities = Array.from(this.communities.values())
        .filter(c => c.level === level - 1);

      if (prevLevelCommunities.length <= 1) break;

      // Build a meta-graph of communities
      const metaGraph = new Graph({ multi: false, type: 'undirected' });
      for (const comm of prevLevelCommunities) {
        metaGraph.addNode(comm.id);
      }

      // Add edges between communities that share relationships
      for (let i = 0; i < prevLevelCommunities.length; i++) {
        for (let j = i + 1; j < prevLevelCommunities.length; j++) {
          const ci = prevLevelCommunities[i];
          const cj = prevLevelCommunities[j];

          // Count cross-community relationships
          let crossWeight = 0;
          for (const [, rel] of this.relationships) {
            const srcInI = ci.entityIds.includes(rel.sourceEntityId);
            const tgtInJ = cj.entityIds.includes(rel.targetEntityId);
            const srcInJ = cj.entityIds.includes(rel.sourceEntityId);
            const tgtInI = ci.entityIds.includes(rel.targetEntityId);
            if ((srcInI && tgtInJ) || (srcInJ && tgtInI)) {
              crossWeight += rel.weight;
            }
          }

          if (crossWeight > 0) {
            try {
              metaGraph.addEdge(ci.id, cj.id, { weight: crossWeight });
            } catch {
              // Edge may already exist
            }
          }
        }
      }

      if (metaGraph.order < 2 || metaGraph.size === 0) break;

      // Run Louvain on meta-graph
      const metaCommunities = louvain(metaGraph, {
        resolution: (this.config.communityResolution ?? 1.0) * 0.5, // Coarser at higher levels
      });

      // Group previous-level communities
      const metaGroups = new Map<number, string[]>();
      for (const [commId, metaCommId] of Object.entries(metaCommunities)) {
        const mId = metaCommId as number;
        if (!metaGroups.has(mId)) {
          metaGroups.set(mId, []);
        }
        metaGroups.get(mId)!.push(commId);
      }

      for (const [, childCommIds] of metaGroups) {
        if (childCommIds.length <= 1) continue;

        // Merge entity IDs from child communities
        const allEntityIds: string[] = [];
        const allRelIds: string[] = [];
        let totalImportance = 0;

        for (const childId of childCommIds) {
          const child = this.communities.get(childId);
          if (child) {
            allEntityIds.push(...child.entityIds);
            allRelIds.push(...child.relationshipIds);
            totalImportance += child.importance;
            child.parentCommunityId = `parent-${uuidv4().slice(0, 8)}`;
          }
        }

        const parentTitle = childCommIds
          .map(id => this.communities.get(id)?.title ?? '')
          .filter(Boolean)
          .slice(0, 3)
          .join(' + ');

        const parentId = `community-${uuidv4().slice(0, 8)}`;

        // Set parent ID on children
        for (const childId of childCommIds) {
          const child = this.communities.get(childId);
          if (child) child.parentCommunityId = parentId;
        }

        const parent: GraphCommunity = {
          id: parentId,
          level,
          parentCommunityId: null,
          childCommunityIds: childCommIds,
          entityIds: [...new Set(allEntityIds)],
          relationshipIds: [...new Set(allRelIds)],
          summary: '',
          findings: [],
          importance: totalImportance,
          title: parentTitle,
          createdAt: now,
        };

        this.communities.set(parent.id, parent);
      }
    }
  }

  // ===========================================================================
  // Community Summarization
  // ===========================================================================

  private async generateCommunitySummaries(): Promise<void> {
    if (!this.llmProvider) return;

    // Summarize from leaf communities upward
    const levels = new Set(Array.from(this.communities.values()).map(c => c.level));
    const sortedLevels = Array.from(levels).sort((a, b) => a - b);

    for (const level of sortedLevels) {
      const levelCommunities = Array.from(this.communities.values())
        .filter(c => c.level === level && !c.summary);

      for (const community of levelCommunities) {
        try {
          community.summary = await this.summarizeCommunity(community);
          community.findings = this.extractFindings(community.summary);

          // Store community summary embedding in vector store
          if (this.embeddingManager && this.vectorStore && community.summary) {
            const embedResult = await this.embeddingManager.generateEmbeddings({
              texts: `${community.title}: ${community.summary}`,
              modelId: this.config.embeddingModelId,
            });
            if (embedResult.embeddings[0]) {
              await this.vectorStore.upsert(this.config.communityCollectionName!, [{
                id: community.id,
                embedding: embedResult.embeddings[0],
                textContent: `${community.title}: ${community.summary}`,
                metadata: {
                  communityLevel: community.level,
                  entityCount: community.entityIds.length,
                  importance: community.importance,
                },
              }]);
            }
          }
        } catch (error) {
          console.warn(`[GraphRAGEngine] Failed to summarize community ${community.id}:`, error);
        }
      }
    }
  }

  private async summarizeCommunity(community: GraphCommunity): Promise<string> {
    if (!this.llmProvider) return '';

    // Build context from community entities and relationships
    const entityDescriptions = community.entityIds
      .map(id => this.entities.get(id))
      .filter(Boolean)
      .map(e => `- ${e!.name} (${e!.type}): ${e!.description}`)
      .join('\n');

    const relationshipDescriptions = community.relationshipIds
      .map(id => this.relationships.get(id))
      .filter(Boolean)
      .map(r => {
        const src = this.entities.get(r!.sourceEntityId);
        const tgt = this.entities.get(r!.targetEntityId);
        return `- ${src?.name ?? '?'} --[${r!.type}]--> ${tgt?.name ?? '?'}: ${r!.description}`;
      })
      .join('\n');

    // Include child community summaries for higher-level communities
    let childContext = '';
    if (community.childCommunityIds.length > 0) {
      const childSummaries = community.childCommunityIds
        .map(id => this.communities.get(id))
        .filter(Boolean)
        .map(c => `- ${c!.title}: ${c!.summary}`)
        .join('\n');
      childContext = `\nSub-groups:\n${childSummaries}`;
    }

    const prompt = `Summarize the following group of related entities and their relationships.
Provide a concise summary (2-4 sentences) and list 2-3 key findings.

Entities:
${entityDescriptions}

Relationships:
${relationshipDescriptions}
${childContext}

Respond with a clear, informative summary of what this group represents and its significance.`;

    return this.llmProvider.generateText(prompt, {
      maxTokens: this.config.maxSummaryTokens ?? 300,
      temperature: 0,
    });
  }

  private extractFindings(summary: string): string[] {
    // Split summary into sentences as findings
    return summary
      .split(/[.!?]+/)
      .map(s => s.trim())
      .filter(s => s.length > 20)
      .slice(0, 5);
  }

  // ===========================================================================
  // Global Search (community summaries)
  // ===========================================================================

  async globalSearch(
    query: string,
    options?: GraphRAGSearchOptions,
  ): Promise<GlobalSearchResult> {
    this.ensureInitialized();

    const startTime = Date.now();
    const topK = options?.topK ?? 10;

    // Search community summaries via vector similarity
    let matchedCommunities: Array<{
      communityId: string;
      level: number;
      title: string;
      summary: string;
      relevanceScore: number;
    }> = [];

    if (this.embeddingManager && this.vectorStore) {
      const embeddingStart = Date.now();
      const queryEmbedResult = await this.embeddingManager.generateEmbeddings({
        texts: query,
        modelId: this.config.embeddingModelId,
      });
      const embeddingTimeMs = Date.now() - embeddingStart;

      const queryEmbedding = queryEmbedResult.embeddings[0];
      if (queryEmbedding) {
        const searchResult = await this.vectorStore.query(
          this.config.communityCollectionName!,
          queryEmbedding,
          {
            topK: topK * 2,
            includeTextContent: true,
            includeMetadata: true,
            minSimilarityScore: options?.minRelevance,
          },
        );

        for (const doc of searchResult.documents) {
          const community = this.communities.get(doc.id);
          if (!community) continue;

          // Filter by community level
          if (options?.communityLevels && !options.communityLevels.includes(community.level)) {
            continue;
          }

          matchedCommunities.push({
            communityId: community.id,
            level: community.level,
            title: community.title,
            summary: community.summary,
            relevanceScore: doc.similarityScore,
          });
        }
      }
    } else {
      // Fallback: text-based matching on community summaries
      const queryLower = query.toLowerCase();
      for (const community of this.communities.values()) {
        const text = `${community.title} ${community.summary}`.toLowerCase();
        if (text.includes(queryLower) || queryLower.split(' ').some(w => text.includes(w))) {
          matchedCommunities.push({
            communityId: community.id,
            level: community.level,
            title: community.title,
            summary: community.summary,
            relevanceScore: 0.5, // Default score for text matching
          });
        }
      }
    }

    // Sort by relevance and take topK
    matchedCommunities.sort((a, b) => b.relevanceScore - a.relevanceScore);
    matchedCommunities = matchedCommunities.slice(0, topK);

    // Synthesize answer from community summaries
    let answer = '';
    if (this.llmProvider && matchedCommunities.length > 0) {
      const summaryContext = matchedCommunities
        .map(c => `[${c.title}] (relevance: ${c.relevanceScore.toFixed(2)})\n${c.summary}`)
        .join('\n\n');

      const synthesisStart = Date.now();
      answer = await this.llmProvider.generateText(
        `Based on the following community summaries, answer the question: "${query}"

${summaryContext}

Provide a comprehensive answer based on the information above.`,
        { maxTokens: 500, temperature: 0 },
      );
      const synthesisTimeMs = Date.now() - synthesisStart;

      return {
        query,
        answer,
        communitySummaries: matchedCommunities,
        totalCommunitiesSearched: this.communities.size,
        diagnostics: {
          searchTimeMs: Date.now() - startTime,
          synthesisTimeMs,
        },
      };
    }

    // No LLM: return summaries as-is
    answer = matchedCommunities
      .map(c => `${c.title}: ${c.summary}`)
      .join('\n\n');

    return {
      query,
      answer,
      communitySummaries: matchedCommunities,
      totalCommunitiesSearched: this.communities.size,
      diagnostics: { searchTimeMs: Date.now() - startTime },
    };
  }

  // ===========================================================================
  // Local Search (entity + graph traversal)
  // ===========================================================================

  async localSearch(
    query: string,
    options?: GraphRAGSearchOptions,
  ): Promise<LocalSearchResult> {
    this.ensureInitialized();

    const startTime = Date.now();
    const topK = options?.topK ?? 10;

    // Step 1: Find relevant entities via vector similarity
    let matchedEntities: Array<GraphEntity & { relevanceScore: number }> = [];

    if (this.embeddingManager && this.vectorStore) {
      const embeddingStart = Date.now();
      const queryEmbedResult = await this.embeddingManager.generateEmbeddings({
        texts: query,
        modelId: this.config.embeddingModelId,
      });
      const embeddingTimeMs = Date.now() - embeddingStart;

      const queryEmbedding = queryEmbedResult.embeddings[0];
      if (queryEmbedding) {
        const searchResult = await this.vectorStore.query(
          this.config.entityCollectionName!,
          queryEmbedding,
          {
            topK: topK * 2,
            includeTextContent: true,
            includeMetadata: true,
            minSimilarityScore: options?.minRelevance,
          },
        );

        for (const doc of searchResult.documents) {
          const entity = this.entities.get(doc.id);
          if (entity) {
            matchedEntities.push({ ...entity, relevanceScore: doc.similarityScore });
          }
        }
      }
    } else {
      // Fallback: text-based matching
      const queryLower = query.toLowerCase();
      for (const entity of this.entities.values()) {
        const text = `${entity.name} ${entity.description}`.toLowerCase();
        if (text.includes(queryLower) || queryLower.split(' ').some(w => text.includes(w))) {
          matchedEntities.push({ ...entity, relevanceScore: 0.5 });
        }
      }
    }

    matchedEntities.sort((a, b) => b.relevanceScore - a.relevanceScore);
    matchedEntities = matchedEntities.slice(0, topK);

    // Step 2: Graph expansion - find connected entities and relationships
    const graphStart = Date.now();
    const expandedEntityIds = new Set(matchedEntities.map(e => e.id));
    const relatedRelationships: GraphRelationship[] = [];

    for (const entity of matchedEntities) {
      if (!this.graph.hasNode(entity.id)) continue;

      // Get 1-hop neighbors
      const neighbors = this.graph.neighbors(entity.id);
      for (const neighborId of neighbors) {
        expandedEntityIds.add(neighborId);
      }

      // Collect relationships
      for (const [, rel] of this.relationships) {
        if (rel.sourceEntityId === entity.id || rel.targetEntityId === entity.id) {
          relatedRelationships.push(rel);
        }
      }
    }
    const graphTraversalTimeMs = Date.now() - graphStart;

    // Step 3: Find community context for matched entities
    const communityContext: Array<{
      communityId: string;
      title: string;
      summary: string;
      level: number;
    }> = [];

    const seenCommunities = new Set<string>();
    for (const entity of matchedEntities) {
      for (const community of this.communities.values()) {
        if (community.entityIds.includes(entity.id) && !seenCommunities.has(community.id)) {
          seenCommunities.add(community.id);
          communityContext.push({
            communityId: community.id,
            title: community.title,
            summary: community.summary,
            level: community.level,
          });
        }
      }
    }

    // Step 4: Build augmented context string
    const entityContext = matchedEntities
      .map(e => `${e.name} (${e.type}): ${e.description}`)
      .join('\n');

    const relContext = relatedRelationships
      .slice(0, 20)
      .map(r => {
        const src = this.entities.get(r.sourceEntityId);
        const tgt = this.entities.get(r.targetEntityId);
        return `${src?.name ?? '?'} --[${r.type}]--> ${tgt?.name ?? '?'}`;
      })
      .join('\n');

    const commContext = communityContext
      .map(c => `[${c.title}]: ${c.summary}`)
      .join('\n');

    const augmentedContext = [
      '## Entities',
      entityContext,
      '',
      '## Relationships',
      relContext,
      '',
      '## Community Context',
      commContext,
    ].join('\n');

    return {
      query,
      entities: matchedEntities,
      relationships: relatedRelationships,
      communityContext,
      augmentedContext,
      diagnostics: {
        searchTimeMs: Date.now() - startTime,
        graphTraversalTimeMs,
      },
    };
  }

  // ===========================================================================
  // Query Methods
  // ===========================================================================

  async getEntities(options?: { type?: string; limit?: number }): Promise<GraphEntity[]> {
    this.ensureInitialized();
    let results = Array.from(this.entities.values());
    if (options?.type) {
      results = results.filter(e => e.type === options.type);
    }
    return results.slice(0, options?.limit ?? 100);
  }

  async getRelationships(entityId: string): Promise<GraphRelationship[]> {
    this.ensureInitialized();
    return Array.from(this.relationships.values()).filter(
      r => r.sourceEntityId === entityId || r.targetEntityId === entityId,
    );
  }

  async getCommunities(level?: number): Promise<GraphCommunity[]> {
    this.ensureInitialized();
    let results = Array.from(this.communities.values());
    if (level !== undefined) {
      results = results.filter(c => c.level === level);
    }
    return results.sort((a, b) => b.importance - a.importance);
  }

  async getStats(): Promise<{
    totalEntities: number;
    totalRelationships: number;
    totalCommunities: number;
    communityLevels: number;
    documentsIngested: number;
  }> {
    this.ensureInitialized();
    const levels = new Set(Array.from(this.communities.values()).map(c => c.level));
    return {
      totalEntities: this.entities.size,
      totalRelationships: this.relationships.size,
      totalCommunities: this.communities.size,
      communityLevels: levels.size,
      documentsIngested: this.ingestedDocumentIds.size,
    };
  }

  async clear(): Promise<void> {
    this.entities.clear();
    this.relationships.clear();
    this.communities.clear();
    this.ingestedDocumentIds.clear();
    this.graph = new Graph({ multi: false, type: 'undirected' });

    if (this.persistenceAdapter) {
      await this.persistenceAdapter.exec(`
        DELETE FROM ${this.tablePrefix}entities;
        DELETE FROM ${this.tablePrefix}relationships;
        DELETE FROM ${this.tablePrefix}communities;
        DELETE FROM ${this.tablePrefix}community_entities;
      `);
    }
  }

  async shutdown(): Promise<void> {
    if (this.persistenceAdapter) {
      await this.persistAll();
    }
    this.entities.clear();
    this.relationships.clear();
    this.communities.clear();
    this.isInitialized = false;
  }

  // ===========================================================================
  // Persistence (sql-storage-adapter)
  // ===========================================================================

  private async createPersistenceSchema(): Promise<void> {
    if (!this.persistenceAdapter) return;

    await this.persistenceAdapter.exec(`
      CREATE TABLE IF NOT EXISTS ${this.tablePrefix}entities (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        description TEXT,
        properties_json TEXT,
        embedding_json TEXT,
        source_document_ids_json TEXT,
        frequency INTEGER DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS ${this.tablePrefix}relationships (
        id TEXT PRIMARY KEY,
        source_entity_id TEXT NOT NULL,
        target_entity_id TEXT NOT NULL,
        type TEXT NOT NULL,
        description TEXT,
        weight REAL DEFAULT 1.0,
        properties_json TEXT,
        source_document_ids_json TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (source_entity_id) REFERENCES ${this.tablePrefix}entities(id),
        FOREIGN KEY (target_entity_id) REFERENCES ${this.tablePrefix}entities(id)
      );

      CREATE TABLE IF NOT EXISTS ${this.tablePrefix}communities (
        id TEXT PRIMARY KEY,
        level INTEGER NOT NULL,
        parent_community_id TEXT,
        child_community_ids_json TEXT,
        entity_ids_json TEXT,
        relationship_ids_json TEXT,
        summary TEXT,
        findings_json TEXT,
        importance REAL DEFAULT 0,
        title TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS ${this.tablePrefix}ingested_documents (
        document_id TEXT PRIMARY KEY,
        ingested_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_${this.tablePrefix}entities_type
        ON ${this.tablePrefix}entities(type);

      CREATE INDEX IF NOT EXISTS idx_${this.tablePrefix}entities_name
        ON ${this.tablePrefix}entities(name);

      CREATE INDEX IF NOT EXISTS idx_${this.tablePrefix}relationships_source
        ON ${this.tablePrefix}relationships(source_entity_id);

      CREATE INDEX IF NOT EXISTS idx_${this.tablePrefix}relationships_target
        ON ${this.tablePrefix}relationships(target_entity_id);

      CREATE INDEX IF NOT EXISTS idx_${this.tablePrefix}communities_level
        ON ${this.tablePrefix}communities(level);
    `);
  }

  private async loadFromPersistence(): Promise<void> {
    if (!this.persistenceAdapter) return;

    // Load entities
    const entityRows = await this.persistenceAdapter.all<any>(
      `SELECT * FROM ${this.tablePrefix}entities`,
    );
    for (const row of entityRows) {
      const entity: GraphEntity = {
        id: row.id,
        name: row.name,
        type: row.type,
        description: row.description ?? '',
        properties: row.properties_json ? JSON.parse(row.properties_json) : {},
        embedding: row.embedding_json ? JSON.parse(row.embedding_json) : undefined,
        sourceDocumentIds: row.source_document_ids_json ? JSON.parse(row.source_document_ids_json) : [],
        frequency: row.frequency ?? 1,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
      this.entities.set(entity.id, entity);
      this.graph.addNode(entity.id, { name: entity.name, type: entity.type });
    }

    // Load relationships
    const relRows = await this.persistenceAdapter.all<any>(
      `SELECT * FROM ${this.tablePrefix}relationships`,
    );
    for (const row of relRows) {
      const rel: GraphRelationship = {
        id: row.id,
        sourceEntityId: row.source_entity_id,
        targetEntityId: row.target_entity_id,
        type: row.type,
        description: row.description ?? '',
        weight: row.weight ?? 1.0,
        properties: row.properties_json ? JSON.parse(row.properties_json) : {},
        sourceDocumentIds: row.source_document_ids_json ? JSON.parse(row.source_document_ids_json) : [],
        createdAt: row.created_at,
      };
      this.relationships.set(rel.id, rel);
      if (this.graph.hasNode(rel.sourceEntityId) && this.graph.hasNode(rel.targetEntityId)) {
        try {
          this.graph.addEdge(rel.sourceEntityId, rel.targetEntityId, {
            id: rel.id,
            type: rel.type,
            weight: rel.weight,
          });
        } catch {
          // Edge may already exist
        }
      }
    }

    // Load communities
    const commRows = await this.persistenceAdapter.all<any>(
      `SELECT * FROM ${this.tablePrefix}communities`,
    );
    for (const row of commRows) {
      const community: GraphCommunity = {
        id: row.id,
        level: row.level,
        parentCommunityId: row.parent_community_id ?? null,
        childCommunityIds: row.child_community_ids_json ? JSON.parse(row.child_community_ids_json) : [],
        entityIds: row.entity_ids_json ? JSON.parse(row.entity_ids_json) : [],
        relationshipIds: row.relationship_ids_json ? JSON.parse(row.relationship_ids_json) : [],
        summary: row.summary ?? '',
        findings: row.findings_json ? JSON.parse(row.findings_json) : [],
        importance: row.importance ?? 0,
        title: row.title ?? '',
        createdAt: row.created_at,
      };
      this.communities.set(community.id, community);
    }

    // Load ingested document IDs
    const docRows = await this.persistenceAdapter.all<any>(
      `SELECT document_id FROM ${this.tablePrefix}ingested_documents`,
    );
    for (const row of docRows) {
      this.ingestedDocumentIds.add(row.document_id);
    }
  }

  private async persistAll(): Promise<void> {
    if (!this.persistenceAdapter) return;

    // Persist entities
    for (const entity of this.entities.values()) {
      await this.persistenceAdapter.run(
        `INSERT OR REPLACE INTO ${this.tablePrefix}entities
         (id, name, type, description, properties_json, embedding_json, source_document_ids_json, frequency, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          entity.id,
          entity.name,
          entity.type,
          entity.description,
          JSON.stringify(entity.properties),
          entity.embedding ? JSON.stringify(entity.embedding) : null,
          JSON.stringify(entity.sourceDocumentIds),
          entity.frequency,
          entity.createdAt,
          entity.updatedAt,
        ],
      );
    }

    // Persist relationships
    for (const rel of this.relationships.values()) {
      await this.persistenceAdapter.run(
        `INSERT OR REPLACE INTO ${this.tablePrefix}relationships
         (id, source_entity_id, target_entity_id, type, description, weight, properties_json, source_document_ids_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          rel.id,
          rel.sourceEntityId,
          rel.targetEntityId,
          rel.type,
          rel.description,
          rel.weight,
          JSON.stringify(rel.properties),
          JSON.stringify(rel.sourceDocumentIds),
          rel.createdAt,
        ],
      );
    }

    // Persist communities
    for (const community of this.communities.values()) {
      await this.persistenceAdapter.run(
        `INSERT OR REPLACE INTO ${this.tablePrefix}communities
         (id, level, parent_community_id, child_community_ids_json, entity_ids_json, relationship_ids_json, summary, findings_json, importance, title, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          community.id,
          community.level,
          community.parentCommunityId,
          JSON.stringify(community.childCommunityIds),
          JSON.stringify(community.entityIds),
          JSON.stringify(community.relationshipIds),
          community.summary,
          JSON.stringify(community.findings),
          community.importance,
          community.title,
          community.createdAt,
        ],
      );
    }

    // Persist ingested document IDs
    for (const docId of this.ingestedDocumentIds) {
      await this.persistenceAdapter.run(
        `INSERT OR IGNORE INTO ${this.tablePrefix}ingested_documents (document_id, ingested_at) VALUES (?, ?)`,
        [docId, new Date().toISOString()],
      );
    }
  }
}
