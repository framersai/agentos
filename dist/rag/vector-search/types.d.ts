/**
 * @fileoverview Types for the HNSW index sidecar.
 * @module agentos/rag/vector-search/types
 */
/** Configuration for {@link HnswIndexSidecar}. */
export interface HnswSidecarConfig {
    /** Path to the HNSW index file (e.g. `/path/to/data.hnsw`). */
    indexPath: string;
    /** Embedding dimensions (e.g. 1536 for OpenAI, 768 for smaller models). */
    dimensions: number;
    /** Distance metric for similarity computation. */
    metric: 'cosine' | 'euclidean' | 'dotproduct';
    /** Document count threshold before HNSW activates (default 1000). Below this, brute-force is used. */
    activationThreshold: number;
    /** HNSW M parameter — connections per node (default 16). Higher = more accuracy, more memory. */
    hnswM?: number;
    /** HNSW efConstruction — build-time search width (default 200). Higher = better index quality. */
    hnswEfConstruction?: number;
    /** HNSW efSearch — query-time search width (default 50). Higher = more accuracy, slower queries. */
    hnswEfSearch?: number;
}
/** Statistics from an HNSW sidecar instance. */
export interface HnswSidecarStats {
    /** Whether the sidecar is actively serving queries. */
    active: boolean;
    /** Whether hnswlib-node is importable on this platform. */
    available: boolean;
    /** Number of vectors in the index. */
    vectorCount: number;
    /** Current index capacity. */
    capacity: number;
    /** Path to the index file. */
    indexPath: string;
}
/** A single search result from the HNSW index. */
export interface HnswSearchResult {
    /** Document ID. */
    id: string;
    /** Similarity score (higher = more similar for cosine/dot, lower = closer for euclidean). */
    score: number;
}
//# sourceMappingURL=types.d.ts.map