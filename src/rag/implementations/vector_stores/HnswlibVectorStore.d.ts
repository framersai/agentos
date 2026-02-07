/**
 * @file HnswlibVectorStore.ts
 * @description HNSW-based vector store using hnswlib-node for fast approximate nearest neighbor search.
 * Provides O(log n) query performance vs O(n) linear scan, with file-based persistence.
 *
 * @module AgentOS/RAG/VectorStores
 * @version 1.0.0
 */
import type { IVectorStore, VectorStoreProviderConfig, VectorDocument, QueryOptions, QueryResult, UpsertOptions, UpsertResult, DeleteOptions, DeleteResult, CreateCollectionOptions } from '../../IVectorStore.js';
/**
 * Configuration for HnswlibVectorStore
 */
export interface HnswlibVectorStoreConfig extends VectorStoreProviderConfig {
    type: 'hnswlib';
    /** Directory to persist index files. If not set, indexes are in-memory only. */
    persistDirectory?: string;
    /** Default embedding dimension for new collections */
    defaultEmbeddingDimension?: number;
    /** Default similarity metric */
    similarityMetric?: 'cosine' | 'euclidean' | 'dotproduct';
    /** HNSW M parameter (number of connections per node, default 16) */
    hnswM?: number;
    /** HNSW efConstruction parameter (index build quality, default 200) */
    hnswEfConstruction?: number;
    /** HNSW efSearch parameter (search quality, default 100) */
    hnswEfSearch?: number;
}
/**
 * Vector store implementation using hnswlib-node for fast ANN search.
 *
 * Features:
 * - O(log n) query time via HNSW graph structure
 * - 1-10ms queries for 100K vectors
 * - File-based persistence
 * - Configurable HNSW parameters (M, efConstruction, efSearch)
 * - Full metadata filtering support
 */
export declare class HnswlibVectorStore implements IVectorStore {
    private config;
    private collections;
    private isInitialized;
    private readonly providerId;
    private HierarchicalNSW;
    private hnswM;
    private hnswEfConstruction;
    private hnswEfSearch;
    private defaultDimension;
    private defaultMetric;
    initialize(config: VectorStoreProviderConfig): Promise<void>;
    private ensureInitialized;
    /**
     * Map similarity metric to hnswlib space type.
     * hnswlib supports: 'l2' (euclidean), 'ip' (inner product/dot), 'cosine'
     */
    private getSpaceType;
    createCollection(collectionName: string, dimension: number, options?: CreateCollectionOptions): Promise<void>;
    deleteCollection(collectionName: string): Promise<void>;
    collectionExists(collectionName: string): Promise<boolean>;
    private ensureCollection;
    private resizeIfNeeded;
    upsert(collectionName: string, documents: VectorDocument[], options?: UpsertOptions): Promise<UpsertResult>;
    query(collectionName: string, queryEmbedding: number[], options?: QueryOptions): Promise<QueryResult>;
    delete(collectionName: string, ids?: string[], options?: DeleteOptions): Promise<DeleteResult>;
    checkHealth(): Promise<{
        isHealthy: boolean;
        details?: any;
    }>;
    shutdown(): Promise<void>;
    getStats(collectionName?: string): Promise<Record<string, any>>;
    private matchesFilter;
}
//# sourceMappingURL=HnswlibVectorStore.d.ts.map