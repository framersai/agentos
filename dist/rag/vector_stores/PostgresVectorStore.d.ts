/**
 * @fileoverview Postgres + pgvector Vector Store Implementation.
 * @module rag/vector_stores/PostgresVectorStore
 *
 * Implements `IVectorStore` using Postgres with the pgvector extension
 * for native HNSW-indexed approximate nearest neighbor search. Supports:
 *
 * - Dense vector search via pgvector `<=>` (cosine), `<->` (L2), `<#>` (inner product)
 * - Full-text search via tsvector + GIN indexes
 * - Hybrid search combining both with RRF fusion in a single SQL query
 * - JSONB metadata filtering with GIN indexes
 * - Connection pooling via pg.Pool
 *
 * Scaling target: 500K → 10M vectors with multi-tenant schema isolation.
 *
 * @see ../../IVectorStore.ts for the interface definition.
 */
import type { IVectorStore, VectorStoreProviderConfig, VectorDocument, QueryOptions, QueryResult, UpsertOptions, UpsertResult, DeleteOptions, DeleteResult, CreateCollectionOptions } from '../IVectorStore.js';
/** Configuration specific to the Postgres vector store. */
export interface PostgresVectorStoreConfig extends VectorStoreProviderConfig {
    type: 'postgres';
    /** Postgres connection string. */
    connectionString: string;
    /** Connection pool size. @default 10 */
    poolSize?: number;
    /** Default embedding dimensions for new collections. @default 1536 */
    defaultDimension?: number;
    /** Default similarity metric. @default 'cosine' */
    similarityMetric?: 'cosine' | 'euclidean' | 'dotproduct';
    /** Table name prefix for multi-tenancy. @default '' */
    tablePrefix?: string;
}
export declare class PostgresVectorStore implements IVectorStore {
    private pool;
    private config;
    private prefix;
    private isInitialized;
    constructor(config: PostgresVectorStoreConfig);
    /**
     * Initialize the connection pool, ensure pgvector extension exists,
     * and create the collections metadata table.
     */
    initialize(): Promise<void>;
    /** Close the connection pool. */
    close(): Promise<void>;
    /** Gracefully shut down the store (alias for close). */
    shutdown(): Promise<void>;
    /**
     * Health check — verifies connection and pgvector availability.
     * @returns True if Postgres + pgvector is reachable.
     */
    healthCheck(): Promise<boolean>;
    /** IVectorStore-compliant health check. */
    checkHealth(): Promise<{
        isHealthy: boolean;
        details?: any;
    }>;
    /**
     * Create a new collection (Postgres table) with pgvector HNSW index.
     */
    createCollection(name: string, dimension: number, options?: CreateCollectionOptions): Promise<void>;
    /** Drop a collection table. */
    dropCollection(name: string): Promise<void>;
    /**
     * Upsert documents into a collection.
     * Uses INSERT ... ON CONFLICT (id) DO UPDATE for idempotent writes.
     */
    upsert(collectionName: string, documents: VectorDocument[], _options?: UpsertOptions): Promise<UpsertResult>;
    /**
     * Query for top-K nearest neighbors using pgvector operators.
     * Uses HNSW index for O(log n) approximate search.
     */
    query(collectionName: string, queryEmbedding: number[], options?: QueryOptions): Promise<QueryResult>;
    /**
     * Hybrid search combining pgvector ANN and tsvector BM25 in a single
     * SQL query with Reciprocal Rank Fusion.
     *
     * This runs as one query with two CTEs — no application-level fusion needed.
     */
    hybridSearch(collectionName: string, queryEmbedding: number[], queryText: string, options?: QueryOptions & {
        alpha?: number;
        fusion?: 'rrf' | 'weighted';
        rrfK?: number;
    }): Promise<QueryResult>;
    /** Delete documents by ID. */
    delete(collectionName: string, ids?: string[], options?: DeleteOptions): Promise<DeleteResult>;
    /** Ensure the store is initialized before any operation. */
    private _ensureInit;
    /** Prefix a table name for multi-tenancy. */
    private _t;
    /** Get collection metadata. */
    private _getCollectionMeta;
    /**
     * Parse pgvector string format '[0.1,0.2,0.3]' to number[].
     */
    private _parseVectorString;
    /**
     * Build JSONB metadata filter SQL clauses.
     * Uses Postgres JSONB operators for efficient GIN-indexed filtering.
     *
     * @param filter   - MetadataFilter to translate.
     * @param startIdx - Starting parameter index ($N).
     * @returns SQL WHERE clause and parameter values.
     */
    private _buildMetadataFilter;
}
//# sourceMappingURL=PostgresVectorStore.d.ts.map