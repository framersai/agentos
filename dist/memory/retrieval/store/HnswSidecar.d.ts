/**
 * @fileoverview Memory-specific HNSW sidecar adapter.
 * @module memory/store/HnswSidecar
 *
 * Thin compatibility wrapper around the canonical {@link HnswIndexSidecar}
 * from `rag/vector-search/`. Preserves the Memory subsystem's constructor-based
 * API (sqlitePath, autoThreshold, etc.) and delegates to the shared implementation.
 *
 * New code should use `HnswIndexSidecar` from `rag/vector-search/` directly.
 *
 * @see rag/vector-search/HnswIndexSidecar for the canonical implementation
 */
/** Configuration for the memory-specific HNSW sidecar wrapper. */
export interface HnswSidecarConfig {
    /** Path to brain.sqlite — HNSW file will be at same dir with .hnsw extension. */
    sqlitePath: string;
    /** Embedding dimensions. */
    dimensions: number;
    /** Auto-build threshold. Below this count, brute-force is used. @default 1000 */
    autoThreshold?: number;
    /** HNSW M parameter (connections per node). @default 16 */
    m?: number;
    /** HNSW efConstruction (build quality). @default 200 */
    efConstruction?: number;
    /** HNSW efSearch (query quality). @default 50 */
    efSearch?: number;
}
/** Result from a KNN query. */
export interface HnswQueryResult {
    /** Trace ID. */
    id: string;
    /** Distance from query vector (lower = closer for cosine distance). */
    distance: number;
}
/**
 * Memory-specific HNSW sidecar that wraps the canonical {@link HnswIndexSidecar}.
 *
 * Maintains the original constructor-based API expected by `Memory` facade
 * and `SqliteBrain` consumers, while delegating all index operations to the
 * shared RAG implementation.
 */
export declare class HnswSidecar {
    private readonly _delegate;
    private readonly _indexPath;
    private readonly _mapPath;
    private readonly _config;
    constructor(config: HnswSidecarConfig);
    /** Whether the HNSW index is currently active and queryable. */
    get isActive(): boolean;
    /** Number of vectors currently indexed. */
    get size(): number;
    /**
     * Initialize the sidecar. Loads existing index from disk if present.
     * If hnswlib-node is not installed, silently stays inactive.
     */
    init(): Promise<void>;
    /**
     * Add a vector to the index. If below threshold, does nothing.
     * If threshold is crossed, caller should call rebuildFromData().
     *
     * @param traceId    - The trace ID to associate with this vector.
     * @param embedding  - The embedding vector.
     * @param _totalCount - Current total trace count (unused, kept for API compat).
     */
    add(traceId: string, embedding: number[], _totalCount: number): Promise<void>;
    /**
     * Query the HNSW index for top-K nearest neighbors.
     * Returns trace IDs sorted by distance (closest first).
     *
     * @param embedding - Query vector.
     * @param topK      - Number of results to return.
     * @returns Array of { id, distance } sorted by distance ascending.
     */
    query(embedding: number[], topK: number): HnswQueryResult[];
    /**
     * Remove a trace from the index by marking its label as deleted.
     * HNSW doesn't support true deletion — cleaned up on rebuild.
     *
     * @param traceId - The trace ID to remove.
     */
    remove(traceId: string): void;
    /**
     * Rebuild the entire index from a set of id/embedding pairs.
     * Called on first threshold crossing or when brain.hnsw is missing/corrupt.
     * Filters out dimension-mismatched vectors before delegating.
     *
     * @param data - Array of { id, embedding } to index.
     */
    rebuildFromData(data: {
        id: string;
        embedding: number[];
    }[]): Promise<void>;
    /**
     * Persist index and label map to disk.
     * Called after rebuildFromData() and periodically after adds.
     */
    saveToDisk(): void;
    /**
     * Delete index files from disk and deactivate.
     */
    destroy(): void;
    /**
     * Synchronous query that accesses the delegate's internal index.
     * This is needed because the original HnswSidecar.query() was synchronous,
     * and Memory.ts calls it in a synchronous context within an async function.
     */
    private _syncQuery;
}
//# sourceMappingURL=HnswSidecar.d.ts.map