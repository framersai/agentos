/**
 * @fileoverview Neo4j-backed Vector Store Implementation
 *
 * Implements `IVectorStore` using Neo4j 5.x native vector indexes (HNSW via Lucene).
 * Supports dense vector search, optional fulltext hybrid search (RRF fusion),
 * and metadata filtering via client-side post-filter on JSON-serialized metadata.
 *
 * Features:
 * - Native HNSW vector indexes per collection (cosine/euclidean)
 * - Optional fulltext indexes for hybrid search
 * - Parameterized Cypher (no string interpolation)
 * - Shared Neo4jConnectionManager for connection pooling
 * - Dynamic import of neo4j-driver (optional peer dep)
 *
 * @module @framers/agentos/rag/implementations/vector_stores/Neo4jVectorStore
 * @see ../../IVectorStore.ts for the interface definition.
 */

import type {
  IVectorStore,
  VectorStoreProviderConfig,
  VectorDocument,
  RetrievedVectorDocument,
  QueryOptions,
  QueryResult,
  UpsertOptions,
  UpsertResult,
  DeleteOptions,
  DeleteResult,
  CreateCollectionOptions,
  MetadataFilter,
  MetadataFieldCondition,
  MetadataScalarValue,
  MetadataValue,
} from '../../IVectorStore.js';
import type { Neo4jConnectionConfig } from '../../../neo4j/types.js';
import { Neo4jConnectionManager } from '../../../neo4j/Neo4jConnectionManager.js';
import { Neo4jCypherRunner } from '../../../neo4j/Neo4jCypherRunner.js';

// ============================================================================
// Configuration
// ============================================================================

export interface Neo4jVectorStoreConfig extends VectorStoreProviderConfig {
  type: 'neo4j';
  /** Neo4j connection config. Ignored if connectionManager is provided. */
  neo4j?: Neo4jConnectionConfig;
  /** Pre-initialized connection manager (shared across backends). */
  connectionManager?: Neo4jConnectionManager;
  /** Vector index name prefix — default 'agentos_vec' */
  indexNamePrefix?: string;
}

// ============================================================================
// Helpers
// ============================================================================

const DEFAULT_INDEX_PREFIX = 'agentos_vec';
const VECTOR_DOC_LABEL = 'VectorDocument';
const METADATA_OVER_FETCH_FACTOR = 3;

function vectorIndexName(prefix: string, collectionName: string): string {
  // Neo4j index names: alphanumeric + underscore
  return `${prefix}_${collectionName.replace(/[^a-zA-Z0-9_]/g, '_')}`;
}

function fulltextIndexName(prefix: string, collectionName: string): string {
  return `${prefix}_ft_${collectionName.replace(/[^a-zA-Z0-9_]/g, '_')}`;
}

function serializeMetadata(metadata?: Record<string, MetadataValue>): string {
  return metadata ? JSON.stringify(metadata) : '{}';
}

function deserializeMetadata(json: string | null | undefined): Record<string, MetadataValue> {
  if (!json) return {};
  try {
    return JSON.parse(json);
  } catch {
    return {};
  }
}

/**
 * Evaluate a MetadataFilter against a metadata object.
 * Returns true if the metadata matches all filter conditions.
 */
function matchesFilter(metadata: Record<string, MetadataValue>, filter: MetadataFilter): boolean {
  for (const [key, condition] of Object.entries(filter)) {
    const value = metadata[key];

    // Simple equality (scalar shorthand)
    if (typeof condition !== 'object' || condition === null) {
      if (value !== condition) return false;
      continue;
    }

    // MetadataFieldCondition
    const cond = condition as MetadataFieldCondition;

    if (cond.$eq !== undefined && value !== cond.$eq) return false;
    if (cond.$ne !== undefined && value === cond.$ne) return false;
    if (cond.$gt !== undefined && (typeof value !== 'number' || value <= cond.$gt)) return false;
    if (cond.$gte !== undefined && (typeof value !== 'number' || value < cond.$gte)) return false;
    if (cond.$lt !== undefined && (typeof value !== 'number' || value >= cond.$lt)) return false;
    if (cond.$lte !== undefined && (typeof value !== 'number' || value > cond.$lte)) return false;
    if (cond.$in !== undefined && !cond.$in.includes(value as MetadataScalarValue)) return false;
    if (cond.$nin !== undefined && cond.$nin.includes(value as MetadataScalarValue)) return false;
    if (cond.$exists !== undefined) {
      const exists = value !== undefined && value !== null;
      if (cond.$exists !== exists) return false;
    }
    if (cond.$contains !== undefined) {
      if (Array.isArray(value)) {
        if (!value.includes(cond.$contains)) return false;
      } else if (typeof value === 'string') {
        if (!value.includes(String(cond.$contains))) return false;
      } else {
        return false;
      }
    }
    if (cond.$all !== undefined) {
      if (!Array.isArray(value)) return false;
      if (!cond.$all.every((v) => (value as MetadataScalarValue[]).includes(v))) return false;
    }
    if (cond.$textSearch !== undefined) {
      const text = typeof value === 'string' ? value : JSON.stringify(value);
      if (!text.toLowerCase().includes(cond.$textSearch.toLowerCase())) return false;
    }
  }
  return true;
}

// ============================================================================
// Implementation
// ============================================================================

export class Neo4jVectorStore implements IVectorStore {
  private connectionManager!: Neo4jConnectionManager;
  private cypher!: Neo4jCypherRunner;
  private indexPrefix!: string;
  private ownsConnectionManager = false;

  async initialize(config: VectorStoreProviderConfig): Promise<void> {
    const cfg = config as Neo4jVectorStoreConfig;
    this.indexPrefix = cfg.indexNamePrefix ?? DEFAULT_INDEX_PREFIX;

    if (cfg.connectionManager) {
      this.connectionManager = cfg.connectionManager;
    } else if (cfg.neo4j) {
      this.connectionManager = new Neo4jConnectionManager();
      await this.connectionManager.initialize(cfg.neo4j);
      this.ownsConnectionManager = true;
    } else {
      throw new Error('Neo4jVectorStoreConfig requires either connectionManager or neo4j connection config.');
    }

    this.cypher = new Neo4jCypherRunner(this.connectionManager);

    // Ensure constraint for fast lookups
    await this.cypher.writeVoid(
      `CREATE CONSTRAINT vec_doc_unique IF NOT EXISTS FOR (n:${VECTOR_DOC_LABEL}) REQUIRE (n.docId, n.collectionName) IS UNIQUE`,
    );
  }

  async createCollection(
    collectionName: string,
    dimension: number,
    options?: CreateCollectionOptions,
  ): Promise<void> {
    const idxName = vectorIndexName(this.indexPrefix, collectionName);
    const metric = options?.similarityMetric ?? 'cosine';

    // Create vector index
    await this.cypher.writeVoid(
      `CREATE VECTOR INDEX ${idxName} IF NOT EXISTS
       FOR (n:${VECTOR_DOC_LABEL})
       ON (n.embedding)
       OPTIONS {
         indexConfig: {
           \`vector.dimensions\`: toInteger($dimension),
           \`vector.similarity_function\`: $metric
         }
       }`,
      { dimension, metric },
    );

    // Create fulltext index for hybrid search
    const ftName = fulltextIndexName(this.indexPrefix, collectionName);
    await this.cypher.writeVoid(
      `CREATE FULLTEXT INDEX ${ftName} IF NOT EXISTS
       FOR (n:${VECTOR_DOC_LABEL})
       ON EACH [n.textContent]`,
    );
  }

  async upsert(
    collectionName: string,
    documents: VectorDocument[],
    options?: UpsertOptions,
  ): Promise<UpsertResult> {
    const batchSize = options?.batchSize ?? 100;
    let upsertedCount = 0;
    const upsertedIds: string[] = [];
    const errors: Array<{ id: string; message: string }> = [];

    // Process in batches
    for (let i = 0; i < documents.length; i += batchSize) {
      const batch = documents.slice(i, i + batchSize);
      const docs = batch.map((d) => ({
        id: d.id,
        embedding: d.embedding,
        textContent: d.textContent ?? '',
        metadata_json: serializeMetadata(d.metadata),
      }));

      try {
        const results = await this.cypher.write<{ id: string }>(
          `UNWIND $docs AS doc
           MERGE (n:${VECTOR_DOC_LABEL} { docId: doc.id, collectionName: $collectionName })
           SET n.embedding = doc.embedding,
               n.textContent = doc.textContent,
               n.metadata_json = doc.metadata_json,
               n.updatedAt = datetime()
           RETURN doc.id AS id`,
          { docs, collectionName },
        );
        for (const r of results) {
          upsertedIds.push(r.id);
          upsertedCount++;
        }
      } catch (err: any) {
        for (const d of batch) {
          errors.push({ id: d.id, message: err?.message ?? 'Unknown error' });
        }
      }
    }

    return {
      upsertedCount,
      upsertedIds,
      failedCount: errors.length,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  async query(
    collectionName: string,
    queryEmbedding: number[],
    options?: QueryOptions,
  ): Promise<QueryResult> {
    const topK = options?.topK ?? 10;
    const minScore = options?.minSimilarityScore ?? 0;
    const hasFilter = options?.filter && Object.keys(options.filter).length > 0;
    const idxName = vectorIndexName(this.indexPrefix, collectionName);

    // Over-fetch when we need client-side metadata filtering
    const fetchK = hasFilter ? topK * METADATA_OVER_FETCH_FACTOR : topK;

    const results = await this.cypher.read<{
      docId: string;
      embedding: number[];
      textContent: string;
      metadata_json: string;
      score: number;
    }>(
      `CALL db.index.vector.queryNodes($idxName, $fetchK, $queryEmbedding)
       YIELD node, score
       WHERE node.collectionName = $collectionName
       RETURN node.docId AS docId,
              node.embedding AS embedding,
              node.textContent AS textContent,
              node.metadata_json AS metadata_json,
              score
       ORDER BY score DESC`,
      { idxName, fetchK, queryEmbedding, collectionName },
    );

    let documents: RetrievedVectorDocument[] = results.map((r) => {
      const doc: RetrievedVectorDocument = {
        id: r.docId,
        embedding: options?.includeEmbedding ? r.embedding : [],
        similarityScore: r.score,
      };
      if (options?.includeMetadata !== false) {
        doc.metadata = deserializeMetadata(r.metadata_json);
      }
      if (options?.includeTextContent) {
        doc.textContent = r.textContent;
      }
      return doc;
    });

    // Client-side metadata filtering
    if (hasFilter && options?.filter) {
      const filter = options.filter;
      documents = documents.filter((d) => {
        const meta = d.metadata ?? deserializeMetadata(
          results.find((r) => r.docId === d.id)?.metadata_json,
        );
        return matchesFilter(meta, filter);
      });
    }

    // Apply minScore filter
    if (minScore > 0) {
      documents = documents.filter((d) => d.similarityScore >= minScore);
    }

    // Truncate to requested topK
    documents = documents.slice(0, topK);

    return { documents };
  }

  async hybridSearch(
    collectionName: string,
    queryEmbedding: number[],
    queryText: string,
    options?: QueryOptions & {
      alpha?: number;
      fusion?: 'rrf' | 'weighted';
      rrfK?: number;
      lexicalTopK?: number;
    },
  ): Promise<QueryResult> {
    const topK = options?.topK ?? 10;
    const alpha = options?.alpha ?? 0.7; // Dense weight
    const rrfK = options?.rrfK ?? 60;
    const lexicalTopK = options?.lexicalTopK ?? topK * 2;

    // Dense search
    const denseResult = await this.query(collectionName, queryEmbedding, {
      ...options,
      topK: topK * 2,
    });

    // Lexical search via fulltext index
    const ftName = fulltextIndexName(this.indexPrefix, collectionName);
    const lexResults = await this.cypher.read<{
      docId: string;
      embedding: number[];
      textContent: string;
      metadata_json: string;
      score: number;
    }>(
      `CALL db.index.fulltext.queryNodes($ftName, $queryText)
       YIELD node, score
       WHERE node.collectionName = $collectionName
       RETURN node.docId AS docId,
              node.embedding AS embedding,
              node.textContent AS textContent,
              node.metadata_json AS metadata_json,
              score
       LIMIT $lexicalTopK`,
      { ftName, queryText, collectionName, lexicalTopK },
    );

    // RRF fusion
    const denseRanks = new Map<string, number>();
    denseResult.documents.forEach((d, i) => denseRanks.set(d.id, i + 1));

    const lexRanks = new Map<string, number>();
    lexResults.forEach((r, i) => lexRanks.set(r.docId, i + 1));

    const allIds = new Set([
      ...denseResult.documents.map((d) => d.id),
      ...lexResults.map((r) => r.docId),
    ]);

    const scored: Array<{ id: string; rrfScore: number }> = [];
    for (const id of allIds) {
      const dRank = denseRanks.get(id) ?? allIds.size + 1;
      const lRank = lexRanks.get(id) ?? allIds.size + 1;
      const rrfScore = alpha / (rrfK + dRank) + (1 - alpha) / (rrfK + lRank);
      scored.push({ id, rrfScore });
    }
    scored.sort((a, b) => b.rrfScore - a.rrfScore);

    // Build result documents from dense results + lexical results
    const denseMap = new Map(denseResult.documents.map((d) => [d.id, d]));
    const lexMap = new Map(lexResults.map((r) => [r.docId, r]));

    const documents: RetrievedVectorDocument[] = scored.slice(0, topK).map((s) => {
      const densDoc = denseMap.get(s.id);
      if (densDoc) {
        return { ...densDoc, similarityScore: s.rrfScore };
      }
      const lexDoc = lexMap.get(s.id)!;
      const doc: RetrievedVectorDocument = {
        id: s.id,
        embedding: options?.includeEmbedding ? lexDoc.embedding : [],
        similarityScore: s.rrfScore,
      };
      if (options?.includeMetadata !== false) {
        doc.metadata = deserializeMetadata(lexDoc.metadata_json);
      }
      if (options?.includeTextContent) {
        doc.textContent = lexDoc.textContent;
      }
      return doc;
    });

    return { documents };
  }

  async delete(
    collectionName: string,
    ids?: string[],
    options?: DeleteOptions,
  ): Promise<DeleteResult> {
    if (options?.deleteAll) {
      const results = await this.cypher.write<{ count: number }>(
        `MATCH (n:${VECTOR_DOC_LABEL} { collectionName: $collectionName })
         WITH n, count(n) AS total
         DETACH DELETE n
         RETURN total AS count`,
        { collectionName },
      );
      const count = Number(results[0]?.count ?? 0);
      return { deletedCount: count };
    }

    if (ids && ids.length > 0) {
      const results = await this.cypher.write<{ deletedCount: number }>(
        `MATCH (n:${VECTOR_DOC_LABEL} { collectionName: $collectionName })
         WHERE n.docId IN $ids
         WITH n, count(n) AS cnt
         DETACH DELETE n
         RETURN cnt AS deletedCount`,
        { collectionName, ids },
      );
      return { deletedCount: Number(results[0]?.deletedCount ?? 0) };
    }

    return { deletedCount: 0 };
  }

  async deleteCollection(collectionName: string): Promise<void> {
    const idxName = vectorIndexName(this.indexPrefix, collectionName);
    const ftName = fulltextIndexName(this.indexPrefix, collectionName);

    // Drop indexes (ignore if not exists)
    try {
      await this.cypher.writeVoid(`DROP INDEX ${idxName} IF EXISTS`);
    } catch { /* index may not exist */ }

    try {
      await this.cypher.writeVoid(`DROP INDEX ${ftName} IF EXISTS`);
    } catch { /* index may not exist */ }

    // Delete all documents in collection
    await this.cypher.writeVoid(
      `MATCH (n:${VECTOR_DOC_LABEL} { collectionName: $collectionName }) DETACH DELETE n`,
      { collectionName },
    );
  }

  async collectionExists(collectionName: string): Promise<boolean> {
    const idxName = vectorIndexName(this.indexPrefix, collectionName);
    const results = await this.cypher.read<{ exists: boolean }>(
      `SHOW INDEXES
       YIELD name, type
       WHERE name = $idxName AND type = 'VECTOR'
       RETURN count(*) > 0 AS exists`,
      { idxName },
    );
    return results[0]?.exists ?? false;
  }

  async checkHealth(): Promise<{ isHealthy: boolean; details?: any }> {
    return this.connectionManager.checkHealth();
  }

  async shutdown(): Promise<void> {
    if (this.ownsConnectionManager) {
      await this.connectionManager.shutdown();
    }
  }

  async getStats(collectionName?: string): Promise<Record<string, any>> {
    if (collectionName) {
      const results = await this.cypher.read<{ count: number }>(
        `MATCH (n:${VECTOR_DOC_LABEL} { collectionName: $collectionName })
         RETURN count(n) AS count`,
        { collectionName },
      );
      return { collectionName, documentCount: Number(results[0]?.count ?? 0) };
    }

    const results = await this.cypher.read<{ collectionName: string; count: number }>(
      `MATCH (n:${VECTOR_DOC_LABEL})
       RETURN n.collectionName AS collectionName, count(n) AS count
       ORDER BY count DESC`,
    );
    return {
      collections: results.map((r) => ({
        name: r.collectionName,
        documentCount: Number(r.count),
      })),
      totalDocuments: results.reduce((sum, r) => sum + Number(r.count), 0),
    };
  }
}
