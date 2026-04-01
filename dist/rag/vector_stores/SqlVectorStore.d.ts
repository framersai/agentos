/**
 * @fileoverview SQL-backed Vector Store Implementation
 *
 * Implements `IVectorStore` using `@framers/sql-storage-adapter` for persistence.
 * This allows vector storage to work across all platforms supported by the storage
 * adapter (SQLite, PostgreSQL, IndexedDB, Capacitor, etc.).
 *
 * **Key Features:**
 * - Cross-platform persistence using sql-storage-adapter
 * - Storage-feature-aware SQL, FTS, and blob encoding
 * - Hybrid search (vector similarity + keyword matching)
 * - Automatic schema management
 * - Portable embedding storage across SQLite, PostgreSQL, IndexedDB, etc.
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
 * @module @framers/agentos/rag/vector_stores/SqlVectorStore
 * @see ../../IVectorStore.ts for the interface definition.
 * @see @framers/sql-storage-adapter for storage abstraction.
 */
import { type StorageAdapter, type StorageResolutionOptions } from '@framers/sql-storage-adapter';
import { IVectorStore, VectorStoreProviderConfig, VectorDocument, QueryOptions, QueryResult, UpsertOptions, UpsertResult, DeleteOptions, DeleteResult, CreateCollectionOptions } from '../IVectorStore.js';
import type { HnswIndexSidecar } from '../vector-search/HnswIndexSidecar.js';
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
     * Enable full-text search index provisioning.
     * Creates FTS5 virtual tables for SQLite or tsvector columns for PostgreSQL.
     * @default true
     */
    enableFullTextSearch?: boolean;
    /**
     * Table name prefix for all vector store tables.
     * @default 'agentos_rag_'
     */
    tablePrefix?: string;
    /**
     * Optional text processing pipeline for hybrid search tokenization.
     * Replaces the built-in regex tokenizer with configurable stemming,
     * lemmatization, and stop word handling.
     * @see createRagPipeline from nlp
     */
    pipeline?: import('../../nlp/TextProcessingPipeline').TextProcessingPipeline;
    /**
     * Document count threshold before HNSW sidecar activates.
     * Below this count, brute-force cosine similarity is used.
     * Set to 0 to disable HNSW. Set to Infinity to always use brute-force.
     * @default 1000
     */
    hnswThreshold?: number;
    /**
     * Embedding dimensions for the HNSW sidecar index.
     * @default 1536
     */
    hnswDimensions?: number;
    /**
     * Optional custom HNSW sidecar factory.
     * Primarily useful for tests or advanced hosts that need to provide their
     * own ANN sidecar implementation.
     */
    hnswSidecarFactory?: () => HnswIndexSidecar;
}
/**
 * SQL-backed vector store implementation.
 *
 * Uses `@framers/sql-storage-adapter` for cross-platform persistence.
 * Stores embeddings as base64-encoded Float32 payloads and computes similarity
 * in application code.
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
export declare class SqlVectorStore implements IVectorStore {
    private config;
    private adapter;
    private features;
    private ownsAdapter;
    private isInitialized;
    private readonly providerId;
    private tablePrefix;
    /** Per-collection HNSW sidecars for accelerated vector search. */
    private sidecars;
    /** Cached HNSW sidecar constructor when the dependency is available. */
    private hnswSidecarClass;
    /** Optional text processing pipeline for hybrid search tokenization. */
    private pipeline?;
    /**
     * Constructs a SqlVectorStore instance.
     * The store is not operational until `initialize()` is called.
     */
    constructor();
    /**
     * Initializes the vector store with the provided configuration.
     *
     * Creates necessary tables and indexes if they don't exist.
     *
     * @param {VectorStoreProviderConfig} config - Configuration object
     * @throws {GMIError} If configuration is invalid or initialization fails
     */
    initialize(config: VectorStoreProviderConfig): Promise<void>;
    /**
     * Creates the database schema for vector storage.
     * @private
     */
    private createSchema;
    /**
     * Ensures the store is initialized before operations.
     * @private
     */
    private ensureInitialized;
    /**
     * Creates a new collection for storing vectors.
     *
     * @param {string} collectionName - Unique name for the collection
     * @param {number} dimension - Vector embedding dimension
     * @param {CreateCollectionOptions} [options] - Creation options
     */
    createCollection(collectionName: string, dimension: number, options?: CreateCollectionOptions): Promise<void>;
    /**
     * Checks if a collection exists.
     *
     * @param {string} collectionName - Collection name to check
     * @returns {Promise<boolean>} True if collection exists
     */
    collectionExists(collectionName: string): Promise<boolean>;
    /**
     * Deletes a collection and all its documents.
     *
     * @param {string} collectionName - Collection to delete
     */
    deleteCollection(collectionName: string): Promise<void>;
    /**
     * Gets collection metadata.
     * @private
     */
    private getCollectionMetadata;
    /**
     * Upserts documents into a collection.
     *
     * @param {string} collectionName - Target collection
     * @param {VectorDocument[]} documents - Documents to upsert
     * @param {UpsertOptions} [options] - Upsert options
     * @returns {Promise<UpsertResult>} Result of the upsert operation
     */
    upsert(collectionName: string, documents: VectorDocument[], options?: UpsertOptions): Promise<UpsertResult>;
    /**
     * Queries a collection for similar documents.
     *
     * @param {string} collectionName - Collection to query
     * @param {number[]} queryEmbedding - Query vector
     * @param {QueryOptions} [options] - Query options
     * @returns {Promise<QueryResult>} Query results sorted by similarity
     */
    query(collectionName: string, queryEmbedding: number[], options?: QueryOptions): Promise<QueryResult>;
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
    hybridSearch(collectionName: string, queryEmbedding: number[], queryText: string, options?: QueryOptions & {
        alpha?: number;
        fusion?: 'rrf' | 'weighted';
        rrfK?: number;
        lexicalTopK?: number;
    }): Promise<QueryResult>;
    /**
     * Deletes documents from a collection.
     *
     * @param {string} collectionName - Collection to delete from
     * @param {string[]} [ids] - Specific document IDs to delete
     * @param {DeleteOptions} [options] - Delete options (filter, deleteAll)
     * @returns {Promise<DeleteResult>} Deletion result
     */
    delete(collectionName: string, ids?: string[], options?: DeleteOptions): Promise<DeleteResult>;
    /**
     * Checks the health of the vector store.
     *
     * @returns {Promise<{ isHealthy: boolean; details?: any }>} Health status
     */
    checkHealth(): Promise<{
        isHealthy: boolean;
        details?: any;
    }>;
    /**
     * Gracefully shuts down the vector store.
     */
    shutdown(): Promise<void>;
    /**
     * Gets statistics for a collection or the entire store.
     *
     * @param {string} [collectionName] - Specific collection, or all if omitted
     * @returns {Promise<Record<string, any>>} Statistics
     */
    getStats(collectionName?: string): Promise<Record<string, any>>;
    /**
     * Lazily load the HNSW sidecar class once for this store instance.
     */
    private loadHnswSidecarClass;
    /**
     * Get or create the HNSW sidecar for a specific collection.
     *
     * Sidecars are collection-scoped so dimensions, metrics, and document IDs
     * stay isolated between collections.
     */
    private getOrCreateSidecar;
    /**
     * Derive a stable per-collection sidecar path from the configured SQL store.
     */
    private getSidecarIndexPath;
    /**
     * Translate a MetadataFilter into dialect-aware SQL WHERE clauses.
     * Pushes the easy scalar predicates into SQL so fewer rows are loaded into JS.
     * Exact semantics are enforced by `matchesFilter()` after row hydration.
     *
     * @param filter   - The metadata filter to translate.
     * @param column   - The JSON column name (default: 'metadata_json').
     * @returns Object with `clause` (SQL fragment) and `params` (bind values).
     */
    private buildMetadataFilterSQL;
    private encodeEmbedding;
    private decodeStoredEmbedding;
    private isLegacyJsonEmbedding;
    private asBinaryBytes;
    private bytesToBase64;
    private base64ToBytes;
    /**
     * Checks if metadata matches a filter.
     * @private
     */
    private matchesFilter;
    /**
     * Evaluates a single filter condition.
     * @private
     */
    private evaluateCondition;
}
//# sourceMappingURL=SqlVectorStore.d.ts.map