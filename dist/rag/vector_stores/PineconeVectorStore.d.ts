/**
 * @fileoverview Pinecone Vector Store Implementation.
 * @module rag/vector_stores/PineconeVectorStore
 *
 * Implements `IVectorStore` using Pinecone's REST API via native `fetch`.
 * No SDK dependency — works in any runtime that supports fetch (Node 18+,
 * Deno, Bun, edge runtimes).
 *
 * Features:
 * - Dense vector upsert/query via Pinecone Data Plane API
 * - Metadata filtering via Pinecone's filter syntax
 * - Namespace-based collection isolation
 * - Serverless and pod-based index support
 *
 * Pinecone API docs: https://docs.pinecone.io/reference/api
 *
 * @see ../../IVectorStore.ts for the interface definition.
 */
import type { IVectorStore, VectorStoreProviderConfig, VectorDocument, QueryOptions, QueryResult, UpsertOptions, UpsertResult, DeleteOptions, DeleteResult, CreateCollectionOptions } from '../IVectorStore.js';
/** Configuration specific to Pinecone. */
export interface PineconeVectorStoreConfig extends VectorStoreProviderConfig {
    type: 'pinecone';
    /** Pinecone API key. Required. */
    apiKey: string;
    /**
     * Pinecone index host URL (e.g. 'https://my-index-abc123.svc.aped-1234.pinecone.io').
     * This is the Data Plane endpoint for a specific index — NOT the control plane URL.
     * Find it in the Pinecone console under your index details.
     */
    indexHost: string;
    /** Default namespace for operations. @default '' (default namespace) */
    namespace?: string;
    /** Default embedding dimensions. @default 1536 */
    defaultDimension?: number;
}
export declare class PineconeVectorStore implements IVectorStore {
    private config;
    private isInitialized;
    constructor(config: PineconeVectorStoreConfig);
    /** Verify connectivity by calling the describe index stats endpoint. */
    initialize(): Promise<void>;
    /** No-op — Pinecone is cloud-managed. */
    close(): Promise<void>;
    /** Gracefully shut down the store (alias for close). */
    shutdown(): Promise<void>;
    /** Health check — verify index is reachable (legacy). */
    healthCheck(): Promise<boolean>;
    /** IVectorStore-compliant health check. */
    checkHealth(): Promise<{
        isHealthy: boolean;
        details?: any;
    }>;
    /**
     * Create a "collection" — in Pinecone this maps to a namespace.
     * Namespaces are created implicitly on first upsert, so this is a no-op.
     */
    createCollection(_name: string, _dimension: number, _options?: CreateCollectionOptions): Promise<void>;
    /**
     * Drop a "collection" — deletes all vectors in the namespace.
     */
    dropCollection(name: string): Promise<void>;
    /**
     * Upsert vectors into Pinecone.
     * Batches automatically in chunks of 100 (Pinecone's max batch size).
     */
    upsert(collectionName: string, documents: VectorDocument[], options?: UpsertOptions): Promise<UpsertResult>;
    /**
     * Query for top-K nearest neighbors via Pinecone's query endpoint.
     * Supports metadata filtering via Pinecone's native filter syntax.
     */
    query(collectionName: string, queryEmbedding: number[], options?: QueryOptions): Promise<QueryResult>;
    /**
     * Hybrid search is not natively supported by Pinecone in a single call.
     * Falls back to dense-only query. For true hybrid search, use Postgres
     * or Qdrant backends which support server-side RRF fusion.
     */
    hybridSearch(collectionName: string, queryEmbedding: number[], _queryText: string, options?: QueryOptions & {
        alpha?: number;
    }): Promise<QueryResult>;
    /** Delete vectors by ID or delete all in namespace. */
    delete(collectionName: string, ids?: string[], options?: DeleteOptions): Promise<DeleteResult>;
    /** Ensure initialization before operations. */
    private _ensureInit;
    /**
     * Make a fetch request to the Pinecone Data Plane API.
     * Automatically sets Authorization header and Content-Type.
     */
    private _fetch;
    /**
     * Flatten metadata to Pinecone-compatible format.
     * Pinecone metadata values must be string, number, boolean, or string[].
     * Complex objects are JSON-stringified.
     */
    private _flattenMetadata;
    private _normalizeSparseVector;
    private _readSparseVectorsById;
    /**
     * Translate AgentOS MetadataFilter to Pinecone's filter format.
     *
     * Pinecone uses MongoDB-style operators:
     * `{ "field": { "$eq": "value" } }`
     *
     * @see https://docs.pinecone.io/guides/data/filter-with-metadata
     */
    private _buildPineconeFilter;
}
//# sourceMappingURL=PineconeVectorStore.d.ts.map