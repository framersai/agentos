/**
 * @fileoverview Qdrant-backed Vector Store Implementation
 *
 * Implements `IVectorStore` using Qdrant's HTTP API. Designed to work with both:
 * - Self-hosted Qdrant (Docker, bare metal)
 * - Managed Qdrant Cloud (remote URL + API key)
 *
 * Features:
 * - Dense vector search (client-provided embeddings)
 * - Optional BM25 lexical retrieval via Qdrant's built-in `qdrant/bm25` sparse vectors
 * - Hybrid search via server-side RRF fusion (or client-side weighted fusion)
 * - Metadata filtering via Qdrant payload filters
 *
 * Notes:
 * - This implementation uses `fetch` for runtime portability (Node 18+, browser, edge runtimes).
 * - Text content is stored in payload under a reserved key to support `includeTextContent`.
 *
 * @module @framers/agentos/rag/vector_stores/QdrantVectorStore
 * @see ../../IVectorStore.ts for the interface definition.
 */
import type { IVectorStore, VectorStoreProviderConfig, VectorDocument, QueryOptions, QueryResult, UpsertOptions, UpsertResult, DeleteOptions, DeleteResult, CreateCollectionOptions } from '../IVectorStore.js';
export interface QdrantVectorStoreConfig extends VectorStoreProviderConfig {
    type: 'qdrant';
    /** Base URL, e.g. `http://localhost:6333` or Qdrant Cloud endpoint. */
    url: string;
    /** Optional API key for Qdrant Cloud or secured self-host deployments. */
    apiKey?: string;
    /** Request timeout in milliseconds. Default: 15_000. */
    timeoutMs?: number;
    /** Named dense vector field. Default: `dense`. */
    denseVectorName?: string;
    /** Named BM25 sparse vector field. Default: `bm25`. */
    bm25VectorName?: string;
    /** Store BM25 sparse vectors and enable `hybridSearch()`. Default: true. */
    enableBm25?: boolean;
    /** Optional custom fetch implementation (testing/edge). Defaults to global `fetch`. */
    fetch?: typeof fetch;
}
export declare class QdrantVectorStore implements IVectorStore {
    private config;
    private isInitialized;
    private readonly providerId;
    private baseUrl;
    private timeoutMs;
    private denseVectorName;
    private bm25VectorName;
    private enableBm25;
    private fetchImpl;
    private headers;
    initialize(config: VectorStoreProviderConfig): Promise<void>;
    private ensureInitialized;
    private requestJson;
    checkHealth(): Promise<{
        isHealthy: boolean;
        details?: any;
    }>;
    shutdown(): Promise<void>;
    collectionExists(collectionName: string): Promise<boolean>;
    createCollection(collectionName: string, dimension: number, options?: CreateCollectionOptions): Promise<void>;
    deleteCollection(collectionName: string): Promise<void>;
    getStats(collectionName?: string): Promise<Record<string, any>>;
    upsert(collectionName: string, documents: VectorDocument[], options?: UpsertOptions): Promise<UpsertResult>;
    private toRetrievedDocs;
    query(collectionName: string, queryEmbedding: number[], options?: QueryOptions): Promise<QueryResult>;
    hybridSearch(collectionName: string, queryEmbedding: number[], queryText: string, options?: QueryOptions & {
        alpha?: number;
        fusion?: 'rrf' | 'weighted';
        rrfK?: number;
        lexicalTopK?: number;
    }): Promise<QueryResult>;
    delete(collectionName: string, ids?: string[], options?: DeleteOptions): Promise<DeleteResult>;
}
//# sourceMappingURL=QdrantVectorStore.d.ts.map