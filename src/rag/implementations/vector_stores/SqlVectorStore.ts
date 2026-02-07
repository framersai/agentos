/**
 * @fileoverview SQL-backed Vector Store Implementation
 * 
 * Implements `IVectorStore` using `@framers/sql-storage-adapter` for persistence.
 * This allows vector storage to work across all platforms supported by the storage
 * adapter (SQLite, PostgreSQL, IndexedDB, Capacitor, etc.).
 * 
 * **Key Features:**
 * - Cross-platform persistence using sql-storage-adapter
 * - Full-text search support via SQLite FTS5 / PostgreSQL tsvector
 * - Hybrid search (vector similarity + keyword matching)
 * - Automatic schema management
 * - Works with pgvector extension for PostgreSQL (when available)
 * 
 * **Architecture:**
 * ```
 * AgentOS RAG System (RetrievalAugmentor)
 *          ↓
 *   VectorStoreManager
 *          ↓
 *   SqlVectorStore (this file)
 *          ↓
 *   @framers/sql-storage-adapter
 *          ↓
 *   Database (SQLite/PostgreSQL/IndexedDB/etc.)
 * ```
 * 
 * @module @framers/agentos/rag/implementations/vector_stores/SqlVectorStore
 * @see ../../IVectorStore.ts for the interface definition.
 * @see @framers/sql-storage-adapter for storage abstraction.
 */

import {
  type StorageAdapter,
  resolveStorageAdapter,
  type StorageResolutionOptions,
} from '@framers/sql-storage-adapter';
import {
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
  MetadataValue,
  MetadataFieldCondition,
  MetadataScalarValue,
} from '../../IVectorStore.js';
import { GMIError, GMIErrorCode } from '../../../utils/errors.js';
import { uuidv4 } from '../../../utils/uuid.js';

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Configuration for SQL-backed vector store.
 * 
 * @interface SqlVectorStoreConfig
 * @extends VectorStoreProviderConfig
 */
export interface SqlVectorStoreConfig extends VectorStoreProviderConfig {
  /** Must be 'sql' for this provider */
  type: 'sql';
  
  /**
   * Storage adapter configuration.
   * Passed directly to `resolveStorageAdapter()`.
   */
  storage?: StorageResolutionOptions;
  
  /**
   * Pre-initialized storage adapter.
   * If provided, `storage` config is ignored.
   */
  adapter?: StorageAdapter;
  
  /**
   * Default embedding dimension for new collections.
   */
  defaultEmbeddingDimension?: number;
  
  /**
   * Default similarity metric.
   * @default 'cosine'
   */
  similarityMetric?: 'cosine' | 'euclidean' | 'dotproduct';
  
  /**
   * Enable full-text search indexing.
   * Creates FTS5 virtual tables for SQLite or tsvector columns for PostgreSQL.
   * @default true
   */
  enableFullTextSearch?: boolean;
  
  /**
   * Table name prefix for all vector store tables.
   * @default 'agentos_rag_'
   */
  tablePrefix?: string;
}

// ============================================================================
// Internal Types
// ============================================================================

/**
 * Represents a collection in the database.
 * @internal
 */
interface CollectionMetadata {
  name: string;
  dimension: number;
  similarityMetric: 'cosine' | 'euclidean' | 'dotproduct';
  documentCount: number;
  createdAt: number;
  updatedAt: number;
}

/**
 * Database row for a vector document.
 * @internal
 */
interface DocumentRow {
  id: string;
  collection_name: string;
  embedding_blob: string; // JSON array stored as text
  text_content: string | null;
  metadata_json: string | null;
  created_at: number;
  updated_at: number;
}

// ============================================================================
// SQL Vector Store Implementation
// ============================================================================

/**
 * SQL-backed vector store implementation.
 * 
 * Uses `@framers/sql-storage-adapter` for cross-platform persistence.
 * Stores embeddings as JSON blobs and computes similarity in application code
 * (with optional native vector extensions for PostgreSQL).
 * 
 * @class SqlVectorStore
 * @implements {IVectorStore}
 * 
 * @example
 * ```typescript
 * const store = new SqlVectorStore();
 * 
 * await store.initialize({
 *   id: 'sql-vector-store',
 *   type: 'sql',
 *   storage: {
 *     filePath: './vectors.db',
 *     priority: ['better-sqlite3', 'sqljs']
 *   },
 *   enableFullTextSearch: true
 * });
 * 
 * // Create a collection
 * await store.createCollection('documents', 1536);
 * 
 * // Upsert documents
 * await store.upsert('documents', [{
 *   id: 'doc-1',
 *   embedding: [...], // 1536-dim vector
 *   textContent: 'Example document content',
 *   metadata: { author: 'Alice', category: 'tech' }
 * }]);
 * 
 * // Query by similarity
 * const results = await store.query('documents', queryEmbedding, { topK: 5 });
 * ```
 */
export class SqlVectorStore implements IVectorStore {
  private config!: SqlVectorStoreConfig;
  private adapter!: StorageAdapter;
  private ownsAdapter: boolean = false; // Whether we created the adapter
  private isInitialized: boolean = false;
  private readonly providerId: string;
  private tablePrefix: string = 'agentos_rag_';

  /**
   * Constructs a SqlVectorStore instance.
   * The store is not operational until `initialize()` is called.
   */
  constructor() {
    this.providerId = `sql-vector-store-${uuidv4()}`;
  }

  /**
   * Initializes the vector store with the provided configuration.
   * 
   * Creates necessary tables and indexes if they don't exist.
   * 
   * @param {VectorStoreProviderConfig} config - Configuration object
   * @throws {GMIError} If configuration is invalid or initialization fails
   */
  public async initialize(config: VectorStoreProviderConfig): Promise<void> {
    if (this.isInitialized) {
      console.warn(`SqlVectorStore (ID: ${this.providerId}) already initialized. Re-initializing.`);
      await this.shutdown();
    }

    if (config.type !== 'sql') {
      throw new GMIError(
        `Invalid configuration type for SqlVectorStore: ${config.type}. Expected 'sql'.`,
        GMIErrorCode.CONFIG_ERROR,
        { providedType: config.type }
      );
    }

    this.config = config as SqlVectorStoreConfig;
    this.tablePrefix = this.config.tablePrefix ?? 'agentos_rag_';

    // Initialize storage adapter
    if (this.config.adapter) {
      this.adapter = this.config.adapter;
      this.ownsAdapter = false;
    } else if (this.config.storage) {
      this.adapter = await resolveStorageAdapter(this.config.storage);
      this.ownsAdapter = true;
    } else {
      // Default to sql.js (in-memory when no file path provided)
      this.adapter = await resolveStorageAdapter({ priority: ['sqljs'] });
      this.ownsAdapter = true;
      console.warn(`SqlVectorStore (ID: ${this.providerId}): No storage config provided, using sql.js (in-memory).`);
    }

    // Create schema
    await this.createSchema();

    this.isInitialized = true;
    console.log(`SqlVectorStore (ID: ${this.providerId}, Config ID: ${this.config.id}) initialized successfully.`);
  }

  /**
   * Creates the database schema for vector storage.
   * @private
   */
  private async createSchema(): Promise<void> {
    // Collections metadata table
    await this.adapter.exec(`
      CREATE TABLE IF NOT EXISTS ${this.tablePrefix}collections (
        name TEXT PRIMARY KEY,
        dimension INTEGER NOT NULL,
        similarity_metric TEXT NOT NULL DEFAULT 'cosine',
        document_count INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);

    // Documents table - stores vectors as JSON blobs
    await this.adapter.exec(`
      CREATE TABLE IF NOT EXISTS ${this.tablePrefix}documents (
        id TEXT NOT NULL,
        collection_name TEXT NOT NULL,
        embedding_blob TEXT NOT NULL,
        text_content TEXT,
        metadata_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (collection_name, id),
        FOREIGN KEY (collection_name) REFERENCES ${this.tablePrefix}collections(name) ON DELETE CASCADE
      );
      
      CREATE INDEX IF NOT EXISTS idx_${this.tablePrefix}docs_collection 
        ON ${this.tablePrefix}documents(collection_name);
      
      CREATE INDEX IF NOT EXISTS idx_${this.tablePrefix}docs_updated 
        ON ${this.tablePrefix}documents(updated_at);
    `);

    // Full-text search virtual table (SQLite FTS5)
    if (this.config.enableFullTextSearch !== false) {
      try {
        await this.adapter.exec(`
          CREATE VIRTUAL TABLE IF NOT EXISTS ${this.tablePrefix}documents_fts 
          USING fts5(
            id,
            collection_name,
            text_content,
            content='${this.tablePrefix}documents',
            content_rowid='rowid'
          );
        `);
        console.log(`SqlVectorStore (ID: ${this.providerId}): FTS5 index created.`);
      } catch (error: any) {
        // FTS5 might not be available (e.g., in some SQL.js builds)
        console.warn(`SqlVectorStore (ID: ${this.providerId}): FTS5 not available: ${error.message}`);
      }
    }
  }

  /**
   * Ensures the store is initialized before operations.
   * @private
   */
  private ensureInitialized(): void {
    if (!this.isInitialized) {
      throw new GMIError(
        `SqlVectorStore (ID: ${this.providerId}) is not initialized. Call initialize() first.`,
        GMIErrorCode.NOT_INITIALIZED
      );
    }
  }

  /**
   * Creates a new collection for storing vectors.
   * 
   * @param {string} collectionName - Unique name for the collection
   * @param {number} dimension - Vector embedding dimension
   * @param {CreateCollectionOptions} [options] - Creation options
   */
  public async createCollection(
    collectionName: string,
    dimension: number,
    options?: CreateCollectionOptions
  ): Promise<void> {
    this.ensureInitialized();

    if (dimension <= 0) {
      throw new GMIError(
        `Invalid dimension for collection '${collectionName}': ${dimension}. Must be positive.`,
        GMIErrorCode.VALIDATION_ERROR,
        { dimension }
      );
    }

    const exists = await this.collectionExists(collectionName);
    if (exists) {
      if (options?.overwriteIfExists) {
        await this.deleteCollection(collectionName);
      } else {
        throw new GMIError(
          `Collection '${collectionName}' already exists.`,
          GMIErrorCode.ALREADY_EXISTS,
          { collectionName }
        );
      }
    }

    const now = Date.now();
    const metric = options?.similarityMetric ?? this.config.similarityMetric ?? 'cosine';

    await this.adapter.run(
      `INSERT INTO ${this.tablePrefix}collections 
       (name, dimension, similarity_metric, document_count, created_at, updated_at)
       VALUES (?, ?, ?, 0, ?, ?)`,
      [collectionName, dimension, metric, now, now]
    );

    console.log(`SqlVectorStore (ID: ${this.providerId}): Collection '${collectionName}' created (dim=${dimension}, metric=${metric}).`);
  }

  /**
   * Checks if a collection exists.
   * 
   * @param {string} collectionName - Collection name to check
   * @returns {Promise<boolean>} True if collection exists
   */
  public async collectionExists(collectionName: string): Promise<boolean> {
    this.ensureInitialized();

    const row = await this.adapter.get<{ count: number }>(
      `SELECT COUNT(*) as count FROM ${this.tablePrefix}collections WHERE name = ?`,
      [collectionName]
    );

    return (row?.count ?? 0) > 0;
  }

  /**
   * Deletes a collection and all its documents.
   * 
   * @param {string} collectionName - Collection to delete
   */
  public async deleteCollection(collectionName: string): Promise<void> {
    this.ensureInitialized();

    // Delete documents first (due to foreign key)
    await this.adapter.run(
      `DELETE FROM ${this.tablePrefix}documents WHERE collection_name = ?`,
      [collectionName]
    );

    // Delete collection metadata
    await this.adapter.run(
      `DELETE FROM ${this.tablePrefix}collections WHERE name = ?`,
      [collectionName]
    );

    console.log(`SqlVectorStore (ID: ${this.providerId}): Collection '${collectionName}' deleted.`);
  }

  /**
   * Gets collection metadata.
   * @private
   */
  private async getCollectionMetadata(collectionName: string): Promise<CollectionMetadata> {
    const row = await this.adapter.get<any>(
      `SELECT * FROM ${this.tablePrefix}collections WHERE name = ?`,
      [collectionName]
    );

    if (!row) {
      throw new GMIError(
        `Collection '${collectionName}' not found.`,
        GMIErrorCode.NOT_FOUND,
        { collectionName }
      );
    }

    return {
      name: row.name,
      dimension: row.dimension,
      similarityMetric: row.similarity_metric as 'cosine' | 'euclidean' | 'dotproduct',
      documentCount: row.document_count,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Upserts documents into a collection.
   * 
   * @param {string} collectionName - Target collection
   * @param {VectorDocument[]} documents - Documents to upsert
   * @param {UpsertOptions} [options] - Upsert options
   * @returns {Promise<UpsertResult>} Result of the upsert operation
   */
  public async upsert(
    collectionName: string,
    documents: VectorDocument[],
    options?: UpsertOptions
  ): Promise<UpsertResult> {
    this.ensureInitialized();

    const collection = await this.getCollectionMetadata(collectionName);
    const upsertedIds: string[] = [];
    const errors: Array<{ id: string; message: string; details?: any }> = [];
    const now = Date.now();

    for (const doc of documents) {
      // Validate dimension
      if (doc.embedding.length !== collection.dimension) {
        errors.push({
          id: doc.id,
          message: `Embedding dimension ${doc.embedding.length} does not match collection dimension ${collection.dimension}.`,
          details: { expected: collection.dimension, got: doc.embedding.length }
        });
        continue;
      }

      try {
        // Check if document exists
        const existing = await this.adapter.get<{ id: string }>(
          `SELECT id FROM ${this.tablePrefix}documents WHERE collection_name = ? AND id = ?`,
          [collectionName, doc.id]
        );

        const embeddingBlob = JSON.stringify(doc.embedding);
        const metadataJson = doc.metadata ? JSON.stringify(doc.metadata) : null;

        if (existing && options?.overwrite === false) {
          errors.push({
            id: doc.id,
            message: `Document '${doc.id}' already exists and overwrite is disabled.`,
            details: { reason: 'NO_OVERWRITE' }
          });
          continue;
        }

        if (existing) {
          // Update existing document
          await this.adapter.run(
            `UPDATE ${this.tablePrefix}documents 
             SET embedding_blob = ?, text_content = ?, metadata_json = ?, updated_at = ?
             WHERE collection_name = ? AND id = ?`,
            [embeddingBlob, doc.textContent ?? null, metadataJson, now, collectionName, doc.id]
          );
        } else {
          // Insert new document
          await this.adapter.run(
            `INSERT INTO ${this.tablePrefix}documents 
             (id, collection_name, embedding_blob, text_content, metadata_json, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [doc.id, collectionName, embeddingBlob, doc.textContent ?? null, metadataJson, now, now]
          );
        }

        upsertedIds.push(doc.id);
      } catch (error: any) {
        errors.push({
          id: doc.id,
          message: `Failed to upsert document: ${error.message}`,
          details: error
        });
      }
    }

    // Update collection document count
    const countResult = await this.adapter.get<{ count: number }>(
      `SELECT COUNT(*) as count FROM ${this.tablePrefix}documents WHERE collection_name = ?`,
      [collectionName]
    );
    await this.adapter.run(
      `UPDATE ${this.tablePrefix}collections SET document_count = ?, updated_at = ? WHERE name = ?`,
      [countResult?.count ?? 0, now, collectionName]
    );

    return {
      upsertedCount: upsertedIds.length,
      upsertedIds,
      failedCount: errors.length,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  /**
   * Queries a collection for similar documents.
   * 
   * @param {string} collectionName - Collection to query
   * @param {number[]} queryEmbedding - Query vector
   * @param {QueryOptions} [options] - Query options
   * @returns {Promise<QueryResult>} Query results sorted by similarity
   */
  public async query(
    collectionName: string,
    queryEmbedding: number[],
    options?: QueryOptions
  ): Promise<QueryResult> {
    this.ensureInitialized();

    const collection = await this.getCollectionMetadata(collectionName);
    const topK = options?.topK ?? 10;

    // Validate query embedding dimension
    if (queryEmbedding.length !== collection.dimension) {
      throw new GMIError(
        `Query embedding dimension ${queryEmbedding.length} does not match collection dimension ${collection.dimension}.`,
        GMIErrorCode.VALIDATION_ERROR,
        { expected: collection.dimension, got: queryEmbedding.length }
      );
    }

    // Build query with optional metadata filter
    const query = `SELECT * FROM ${this.tablePrefix}documents WHERE collection_name = ?`;
    const params: any[] = [collectionName];

    // Note: For more advanced filtering, we'd parse the MetadataFilter and generate SQL
    // For now, we filter in application code for flexibility

    const rows = await this.adapter.all<DocumentRow>(query, params);

    // Compute similarities and filter
    const candidates: RetrievedVectorDocument[] = [];

    for (const row of rows) {
      const embedding = JSON.parse(row.embedding_blob) as number[];
      const metadata = row.metadata_json ? JSON.parse(row.metadata_json) : undefined;

      // Apply metadata filter in application code
      if (options?.filter && !this.matchesFilter(metadata, options.filter)) {
        continue;
      }

      // Compute similarity
      let similarityScore: number;
      switch (collection.similarityMetric) {
        case 'euclidean':
          similarityScore = -this.euclideanDistance(queryEmbedding, embedding); // Negate for "higher is better"
          break;
        case 'dotproduct':
          similarityScore = this.dotProduct(queryEmbedding, embedding);
          break;
        case 'cosine':
        default:
          similarityScore = this.cosineSimilarity(queryEmbedding, embedding);
          break;
      }

      // Apply minimum similarity threshold
      if (options?.minSimilarityScore !== undefined && similarityScore < options.minSimilarityScore) {
        continue;
      }

      // Build result document
      const retrievedDoc: RetrievedVectorDocument = {
        id: row.id,
        embedding: options?.includeEmbedding ? embedding : [],
        similarityScore,
      };

      if (options?.includeMetadata !== false && metadata) {
        retrievedDoc.metadata = metadata;
      }

      if (options?.includeTextContent && row.text_content) {
        retrievedDoc.textContent = row.text_content;
      }

      candidates.push(retrievedDoc);
    }

    // Sort by similarity (descending) and take topK
    candidates.sort((a, b) => b.similarityScore - a.similarityScore);
    const results = candidates.slice(0, topK);

    return {
      documents: results,
      queryId: `sql-query-${uuidv4()}`,
      stats: {
        totalCandidates: rows.length,
        filteredCandidates: candidates.length,
        returnedCount: results.length,
      },
    };
  }

  /**
   * Performs hybrid search combining vector similarity with keyword matching.
   * 
   * @param {string} collectionName - Collection to search
   * @param {number[]} queryEmbedding - Query vector for semantic search
   * @param {string} queryText - Text query for keyword search
   * @param {QueryOptions & { alpha?: number }} [options] - Search options
   * @returns {Promise<QueryResult>} Combined search results
   * 
   * @example
   * ```typescript
   * const results = await store.hybridSearch(
   *   'documents',
   *   queryEmbedding,
   *   'machine learning tutorial',
   *   { topK: 10, alpha: 0.7 } // 70% vector, 30% keyword
   * );
   * ```
   */
  public async hybridSearch(
    collectionName: string,
    queryEmbedding: number[],
    queryText: string,
    options?: QueryOptions & { alpha?: number; fusion?: 'rrf' | 'weighted'; rrfK?: number; lexicalTopK?: number }
  ): Promise<QueryResult> {
    this.ensureInitialized();

    const alphaRaw = options?.alpha ?? 0.7;
    const alpha = Number.isFinite(alphaRaw) ? Math.max(0, Math.min(1, alphaRaw)) : 0.7;
    const topK = options?.topK ?? 10;

    const fusion = options?.fusion === 'weighted' ? 'weighted' : 'rrf';
    const rrfK = Number.isFinite(options?.rrfK) ? Math.max(1, options!.rrfK!) : 60;
    const lexicalTopK =
      Number.isFinite(options?.lexicalTopK) ? Math.max(1, options!.lexicalTopK!) : topK * 3;
    const denseTopK = topK * 3;

    const collection = await this.getCollectionMetadata(collectionName);
    if (queryEmbedding.length !== collection.dimension) {
      throw new GMIError(
        `Query embedding dimension ${queryEmbedding.length} does not match collection dimension ${collection.dimension}.`,
        GMIErrorCode.VALIDATION_ERROR,
        { expected: collection.dimension, got: queryEmbedding.length }
      );
    }

    // Load all documents in the collection (this store computes similarity in application code).
    const rows = await this.adapter.all<DocumentRow>(
      `SELECT * FROM ${this.tablePrefix}documents WHERE collection_name = ?`,
      [collectionName],
    );

    const tokenize = (text: string): string[] =>
      text
        .toLowerCase()
        .split(/[^a-z0-9_]+/g)
        .filter((t) => t.length > 2);

    const queryTerms = tokenize(queryText);
    const queryTermSet = new Set(queryTerms);

    type ScoredDoc = {
      id: string;
      embedding: number[];
      textContent?: string;
      metadata?: Record<string, MetadataValue>;
      denseScore: number;
      bm25Score: number;
    };

    const scored: ScoredDoc[] = [];
    const termDocFreq = new Map<string, number>(); // df per term
    let totalDocLength = 0;

    // First pass: dense score + collect BM25 stats (doc length + df for query terms)
    for (const row of rows) {
      const embedding = JSON.parse(row.embedding_blob) as number[];
      const metadata = row.metadata_json ? (JSON.parse(row.metadata_json) as Record<string, MetadataValue>) : undefined;

      if (options?.filter && !this.matchesFilter(metadata, options.filter)) continue;

      let denseScore: number;
      switch (collection.similarityMetric) {
        case 'euclidean':
          denseScore = -this.euclideanDistance(queryEmbedding, embedding);
          break;
        case 'dotproduct':
          denseScore = this.dotProduct(queryEmbedding, embedding);
          break;
        case 'cosine':
        default:
          denseScore = this.cosineSimilarity(queryEmbedding, embedding);
          break;
      }

      // Allow dense thresholding without suppressing lexical-only matches.
      if (options?.minSimilarityScore !== undefined && denseScore < options.minSimilarityScore) {
        denseScore = Number.NEGATIVE_INFINITY;
      }

      const textContent = row.text_content ?? undefined;
      let docLength = 0;
      let uniqueTermsInDoc: Set<string> | null = null;
      if (textContent && queryTermSet.size > 0) {
        const tokens = tokenize(textContent);
        docLength = tokens.length;
        totalDocLength += docLength;

        uniqueTermsInDoc = new Set<string>();
        for (const token of tokens) {
          if (queryTermSet.has(token)) uniqueTermsInDoc.add(token);
        }
        for (const term of uniqueTermsInDoc) {
          termDocFreq.set(term, (termDocFreq.get(term) ?? 0) + 1);
        }
      }

      scored.push({
        id: row.id,
        embedding,
        textContent,
        metadata: options?.includeMetadata !== false ? metadata : undefined,
        denseScore,
        bm25Score: 0,
      });
    }

    const N = scored.length;
    const avgdl = N > 0 ? totalDocLength / Math.max(1, N) : 0;
    const k1 = 1.2;
    const b = 0.75;

    // Second pass: compute BM25 for query terms
    if (queryTerms.length > 0 && N > 0 && avgdl > 0) {
      const idfCache = new Map<string, number>();
      for (const term of queryTermSet) {
        const df = termDocFreq.get(term) ?? 0;
        const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
        idfCache.set(term, idf);
      }

      for (const doc of scored) {
        if (!doc.textContent) continue;
        const tokens = tokenize(doc.textContent);
        const dl = tokens.length;
        if (dl === 0) continue;

        const tf = new Map<string, number>();
        for (const token of tokens) {
          if (queryTermSet.has(token)) tf.set(token, (tf.get(token) ?? 0) + 1);
        }

        let score = 0;
        for (const term of queryTermSet) {
          const f = tf.get(term) ?? 0;
          if (f === 0) continue;
          const idf = idfCache.get(term) ?? 0;
          const denom = f + k1 * (1 - b + b * (dl / avgdl));
          score += idf * ((f * (k1 + 1)) / denom);
        }
        doc.bm25Score = score;
      }
    }

    // Build ranked lists for fusion.
    const denseRanked = scored
      .filter((d) => Number.isFinite(d.denseScore) && d.denseScore !== Number.NEGATIVE_INFINITY)
      .sort((a, b) => b.denseScore - a.denseScore)
      .slice(0, denseTopK);

    const lexicalRanked = scored
      .filter((d) => d.bm25Score > 0)
      .sort((a, b) => b.bm25Score - a.bm25Score)
      .slice(0, lexicalTopK);

    const denseRank = new Map<string, number>();
    denseRanked.forEach((d, idx) => denseRank.set(d.id, idx + 1));
    const lexRank = new Map<string, number>();
    lexicalRanked.forEach((d, idx) => lexRank.set(d.id, idx + 1));

    const candidateIds = new Set<string>();
    denseRanked.forEach((d) => candidateIds.add(d.id));
    lexicalRanked.forEach((d) => candidateIds.add(d.id));

    const docById = new Map<string, ScoredDoc>();
    scored.forEach((d) => docById.set(d.id, d));

    const fused: Array<{ doc: ScoredDoc; fusedScore: number }> = [];

    if (fusion === 'weighted') {
      const denseScores = denseRanked.map((d) => d.denseScore);
      const lexScores = lexicalRanked.map((d) => d.bm25Score);
      const denseMin = denseScores.length ? Math.min(...denseScores) : 0;
      const denseMax = denseScores.length ? Math.max(...denseScores) : 1;
      const lexMax = lexScores.length ? Math.max(...lexScores) : 1;

      for (const id of candidateIds) {
        const doc = docById.get(id);
        if (!doc) continue;
        const dense = denseRank.has(id)
          ? (doc.denseScore - denseMin) / Math.max(1e-9, denseMax - denseMin)
          : 0;
        const lex = lexRank.has(id) ? doc.bm25Score / Math.max(1e-9, lexMax) : 0;
        fused.push({ doc, fusedScore: alpha * dense + (1 - alpha) * lex });
      }
    } else {
      for (const id of candidateIds) {
        const doc = docById.get(id);
        if (!doc) continue;
        const dr = denseRank.get(id);
        const lr = lexRank.get(id);
        const dense = dr ? alpha * (1 / (rrfK + dr)) : 0;
        const lex = lr ? (1 - alpha) * (1 / (rrfK + lr)) : 0;
        fused.push({ doc, fusedScore: dense + lex });
      }
    }

    fused.sort((a, b) => b.fusedScore - a.fusedScore);

    const documents: RetrievedVectorDocument[] = fused.slice(0, topK).map(({ doc, fusedScore }) => {
      const out: RetrievedVectorDocument = {
        id: doc.id,
        embedding: options?.includeEmbedding ? doc.embedding : [],
        similarityScore: fusedScore,
      };

      if (options?.includeTextContent && doc.textContent) {
        out.textContent = doc.textContent;
      }

      if (options?.includeMetadata !== false && doc.metadata) {
        out.metadata = doc.metadata;
      }

      return out;
    });

    return {
      documents,
      queryId: `sql-hybrid-${uuidv4()}`,
      stats: {
        fusion,
        vectorWeight: alpha,
        lexicalWeight: 1 - alpha,
        rrfK: fusion === 'rrf' ? rrfK : undefined,
        queryTerms: queryTerms.length,
        corpusSize: N,
        denseCandidates: denseRanked.length,
        lexicalCandidates: lexicalRanked.length,
        returnedCount: documents.length,
      },
    };
  }

  /**
   * Deletes documents from a collection.
   * 
   * @param {string} collectionName - Collection to delete from
   * @param {string[]} [ids] - Specific document IDs to delete
   * @param {DeleteOptions} [options] - Delete options (filter, deleteAll)
   * @returns {Promise<DeleteResult>} Deletion result
   */
  public async delete(
    collectionName: string,
    ids?: string[],
    options?: DeleteOptions
  ): Promise<DeleteResult> {
    this.ensureInitialized();

    let deletedCount = 0;
    const errors: Array<{ id?: string; message: string; details?: any }> = [];

    if (options?.deleteAll && !ids && !options.filter) {
      // Delete all documents in collection
      const result = await this.adapter.run(
        `DELETE FROM ${this.tablePrefix}documents WHERE collection_name = ?`,
        [collectionName]
      );
      deletedCount = result.changes;
      console.warn(`SqlVectorStore (ID: ${this.providerId}): All ${deletedCount} documents deleted from '${collectionName}'.`);
    } else if (ids && ids.length > 0) {
      // Delete specific IDs
      const placeholders = ids.map(() => '?').join(',');
      const result = await this.adapter.run(
        `DELETE FROM ${this.tablePrefix}documents WHERE collection_name = ? AND id IN (${placeholders})`,
        [collectionName, ...ids]
      );
      deletedCount = result.changes;
    } else if (options?.filter) {
      // Delete by filter (fetch matching docs first, then delete)
      const rows = await this.adapter.all<DocumentRow>(
        `SELECT id, metadata_json FROM ${this.tablePrefix}documents WHERE collection_name = ?`,
        [collectionName]
      );

      const idsToDelete: string[] = [];
      for (const row of rows) {
        const metadata = row.metadata_json ? JSON.parse(row.metadata_json) : undefined;
        if (this.matchesFilter(metadata, options.filter)) {
          idsToDelete.push(row.id);
        }
      }

      if (idsToDelete.length > 0) {
        const placeholders = idsToDelete.map(() => '?').join(',');
        const result = await this.adapter.run(
          `DELETE FROM ${this.tablePrefix}documents WHERE collection_name = ? AND id IN (${placeholders})`,
          [collectionName, ...idsToDelete]
        );
        deletedCount = result.changes;
      }
    }

    // Update collection document count
    const now = Date.now();
    const countResult = await this.adapter.get<{ count: number }>(
      `SELECT COUNT(*) as count FROM ${this.tablePrefix}documents WHERE collection_name = ?`,
      [collectionName]
    );
    await this.adapter.run(
      `UPDATE ${this.tablePrefix}collections SET document_count = ?, updated_at = ? WHERE name = ?`,
      [countResult?.count ?? 0, now, collectionName]
    );

    return {
      deletedCount,
      failedCount: errors.length > 0 ? errors.length : undefined,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  /**
   * Checks the health of the vector store.
   * 
   * @returns {Promise<{ isHealthy: boolean; details?: any }>} Health status
   */
  public async checkHealth(): Promise<{ isHealthy: boolean; details?: any }> {
    try {
      this.ensureInitialized();

      // Simple health check query
      const collections = await this.adapter.all<{ name: string; document_count: number }>(
        `SELECT name, document_count FROM ${this.tablePrefix}collections`
      );

      const totalDocuments = collections.reduce((sum, c) => sum + c.document_count, 0);

      return {
        isHealthy: true,
        details: {
          providerId: this.providerId,
          configId: this.config.id,
          type: 'sql',
          collectionCount: collections.length,
          totalDocuments,
          collections: collections.map(c => ({ name: c.name, documentCount: c.document_count })),
        },
      };
    } catch (error: any) {
      return {
        isHealthy: false,
        details: {
          providerId: this.providerId,
          error: error.message,
        },
      };
    }
  }

  /**
   * Gracefully shuts down the vector store.
   */
  public async shutdown(): Promise<void> {
    if (!this.isInitialized) {
      return;
    }

    if (this.ownsAdapter && this.adapter) {
      await this.adapter.close();
    }

    this.isInitialized = false;
    console.log(`SqlVectorStore (ID: ${this.providerId}) shut down.`);
  }

  /**
   * Gets statistics for a collection or the entire store.
   * 
   * @param {string} [collectionName] - Specific collection, or all if omitted
   * @returns {Promise<Record<string, any>>} Statistics
   */
  public async getStats(collectionName?: string): Promise<Record<string, any>> {
    this.ensureInitialized();

    if (collectionName) {
      const collection = await this.getCollectionMetadata(collectionName);
      return {
        collectionName: collection.name,
        dimension: collection.dimension,
        similarityMetric: collection.similarityMetric,
        documentCount: collection.documentCount,
        createdAt: collection.createdAt,
        updatedAt: collection.updatedAt,
      };
    }

    const collections = await this.adapter.all<any>(
      `SELECT * FROM ${this.tablePrefix}collections`
    );

    return {
      providerId: this.providerId,
      configId: this.config.id,
      type: 'sql',
      collectionCount: collections.length,
      totalDocuments: collections.reduce((sum: number, c: any) => sum + c.document_count, 0),
      collections: collections.map((c: any) => ({
        name: c.name,
        dimension: c.dimension,
        documentCount: c.document_count,
      })),
    };
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  /**
   * Computes cosine similarity between two vectors.
   * @private
   */
  private cosineSimilarity(vecA: number[], vecB: number[]): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }

    const magnitudeA = Math.sqrt(normA);
    const magnitudeB = Math.sqrt(normB);

    if (magnitudeA === 0 || magnitudeB === 0) {
      return 0;
    }

    return dotProduct / (magnitudeA * magnitudeB);
  }

  /**
   * Computes Euclidean distance between two vectors.
   * @private
   */
  private euclideanDistance(vecA: number[], vecB: number[]): number {
    let sum = 0;
    for (let i = 0; i < vecA.length; i++) {
      const diff = vecA[i] - vecB[i];
      sum += diff * diff;
    }
    return Math.sqrt(sum);
  }

  /**
   * Computes dot product between two vectors.
   * @private
   */
  private dotProduct(vecA: number[], vecB: number[]): number {
    let sum = 0;
    for (let i = 0; i < vecA.length; i++) {
      sum += vecA[i] * vecB[i];
    }
    return sum;
  }

  /**
   * Checks if metadata matches a filter.
   * @private
   */
  private matchesFilter(metadata: Record<string, MetadataValue> | undefined, filter: MetadataFilter): boolean {
    if (!metadata) {
      // Check if filter only has $exists: false conditions
      for (const key in filter) {
        const condition = filter[key];
        if (typeof condition === 'object' && condition !== null && (condition as MetadataFieldCondition).$exists === false) {
          continue;
        }
        return false;
      }
      return true;
    }

    for (const key in filter) {
      const docValue = metadata[key];
      const filterValue = filter[key];

      if (typeof filterValue === 'object' && filterValue !== null) {
        if (!this.evaluateCondition(docValue, filterValue as MetadataFieldCondition)) {
          return false;
        }
      } else {
        // Direct equality check
        if (Array.isArray(docValue)) {
          if (!docValue.includes(filterValue as MetadataScalarValue)) {
            return false;
          }
        } else if (docValue !== filterValue) {
          return false;
        }
      }
    }

    return true;
  }

  /**
   * Evaluates a single filter condition.
   * @private
   */
  private evaluateCondition(docValue: MetadataValue | undefined, condition: MetadataFieldCondition): boolean {
    if (condition.$exists !== undefined) {
      return condition.$exists === (docValue !== undefined);
    }

    if (docValue === undefined) return false;

    if (condition.$eq !== undefined && docValue !== condition.$eq) return false;
    if (condition.$ne !== undefined && docValue === condition.$ne) return false;

    if (typeof docValue === 'number') {
      if (condition.$gt !== undefined && !(docValue > condition.$gt)) return false;
      if (condition.$gte !== undefined && !(docValue >= condition.$gte)) return false;
      if (condition.$lt !== undefined && !(docValue < condition.$lt)) return false;
      if (condition.$lte !== undefined && !(docValue <= condition.$lte)) return false;
    }

    if (condition.$in !== undefined) {
      if (Array.isArray(docValue)) {
        if (!docValue.some(val => (condition.$in as MetadataScalarValue[]).includes(val))) return false;
      } else {
        if (!(condition.$in as MetadataScalarValue[]).includes(docValue as MetadataScalarValue)) return false;
      }
    }

    if (condition.$nin !== undefined) {
      if (Array.isArray(docValue)) {
        if (docValue.some(val => (condition.$nin as MetadataScalarValue[]).includes(val))) return false;
      } else {
        if ((condition.$nin as MetadataScalarValue[]).includes(docValue as MetadataScalarValue)) return false;
      }
    }

    if (Array.isArray(docValue)) {
      if (condition.$contains !== undefined && !docValue.includes(condition.$contains as MetadataScalarValue)) return false;
      if (condition.$all !== undefined && !condition.$all.every(item => docValue.includes(item))) return false;
    } else if (typeof docValue === 'string' && condition.$contains !== undefined) {
      if (!docValue.includes(String(condition.$contains))) return false;
    }

    if (condition.$textSearch !== undefined && typeof docValue === 'string') {
      if (!docValue.toLowerCase().includes(condition.$textSearch.toLowerCase())) return false;
    }

    return true;
  }
}
