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
 * @module @framers/agentos/rag/vector_stores/Neo4jVectorStore
 * @see ../../IVectorStore.ts for the interface definition.
 */
import type { IVectorStore, VectorStoreProviderConfig, VectorDocument, QueryOptions, QueryResult, UpsertOptions, UpsertResult, DeleteOptions, DeleteResult, CreateCollectionOptions } from '../IVectorStore.js';
import type { Neo4jConnectionConfig } from '../../memory/retrieval/graph/neo4j/types.js';
import { Neo4jConnectionManager } from '../../memory/retrieval/graph/neo4j/Neo4jConnectionManager.js';
export interface Neo4jVectorStoreConfig extends VectorStoreProviderConfig {
    type: 'neo4j';
    /** Neo4j connection config. Ignored if connectionManager is provided. */
    neo4j?: Neo4jConnectionConfig;
    /** Pre-initialized connection manager (shared across backends). */
    connectionManager?: Neo4jConnectionManager;
    /** Vector index name prefix — default 'agentos_vec' */
    indexNamePrefix?: string;
}
export declare class Neo4jVectorStore implements IVectorStore {
    private connectionManager;
    private cypher;
    private indexPrefix;
    private ownsConnectionManager;
    initialize(config: VectorStoreProviderConfig): Promise<void>;
    createCollection(collectionName: string, dimension: number, options?: CreateCollectionOptions): Promise<void>;
    upsert(collectionName: string, documents: VectorDocument[], options?: UpsertOptions): Promise<UpsertResult>;
    query(collectionName: string, queryEmbedding: number[], options?: QueryOptions): Promise<QueryResult>;
    hybridSearch(collectionName: string, queryEmbedding: number[], queryText: string, options?: QueryOptions & {
        alpha?: number;
        fusion?: 'rrf' | 'weighted';
        rrfK?: number;
        lexicalTopK?: number;
    }): Promise<QueryResult>;
    delete(collectionName: string, ids?: string[], options?: DeleteOptions): Promise<DeleteResult>;
    deleteCollection(collectionName: string): Promise<void>;
    collectionExists(collectionName: string): Promise<boolean>;
    checkHealth(): Promise<{
        isHealthy: boolean;
        details?: any;
    }>;
    shutdown(): Promise<void>;
    getStats(collectionName?: string): Promise<Record<string, any>>;
}
//# sourceMappingURL=Neo4jVectorStore.d.ts.map