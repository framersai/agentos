/**
 * @fileoverview Hybrid dense+sparse searcher combining vector embeddings with BM25.
 *
 * Uses Reciprocal Rank Fusion (RRF) to merge results from both systems:
 * - Dense: semantic understanding, handles paraphrasing and conceptual similarity
 * - Sparse: keyword matching, handles exact terms, error codes, function names
 *
 * RRF formula (Cormack et al. 2009):
 * ```
 * score(d) = sum_{i} weight_i / (k + rank_i(d))
 * ```
 * where `k=60` (standard constant) and `rank_i(d)` is the rank of document `d`
 * in result set `i`. Documents not present in a result set are assigned rank infinity.
 *
 * Alternative fusion methods:
 * - **weighted-sum**: `score(d) = w_dense * norm_score_dense(d) + w_sparse * norm_score_sparse(d)`
 * - **interleave**: Round-robin from each result set, deduplicating
 *
 * @module agentos/rag/search/HybridSearcher
 * @see BM25Index for the sparse keyword index
 * @see IVectorStore for the dense vector store interface
 */
import type { IVectorStore, QueryOptions } from '../IVectorStore.js';
import type { IEmbeddingManager } from '../IEmbeddingManager.js';
import { BM25Index } from './BM25Index.js';
/**
 * Configuration for the hybrid searcher.
 *
 * @interface HybridSearcherConfig
 */
export interface HybridSearcherConfig {
    /** Weight for dense (vector) results. Range: 0-1. Default: 0.7. */
    denseWeight?: number;
    /** Weight for sparse (BM25) results. Range: 0-1. Default: 0.3. */
    sparseWeight?: number;
    /** RRF constant k. Higher values flatten score differences. Default: 60. */
    rrfK?: number;
    /** Fusion method for merging ranked lists. Default: 'rrf'. */
    fusionMethod?: 'rrf' | 'weighted-sum' | 'interleave';
}
/**
 * A hybrid search result combining dense and sparse signals.
 *
 * @interface HybridResult
 * @property {string} id - Document identifier.
 * @property {number} score - Fused relevance score.
 * @property {number} [denseScore] - Score from vector search (if present).
 * @property {number} [sparseScore] - Score from BM25 search (if present).
 * @property {number} [denseRank] - Rank in vector search results (1-based).
 * @property {number} [sparseRank] - Rank in BM25 search results (1-based).
 * @property {string} [textContent] - Document text content if available.
 * @property {Record<string, unknown>} [metadata] - Document metadata.
 */
export interface HybridResult {
    /** Document identifier. */
    id: string;
    /** Fused relevance score (higher = more relevant). */
    score: number;
    /** Score from the dense (vector) search, if this document appeared in dense results. */
    denseScore?: number;
    /** Score from the sparse (BM25) search, if this document appeared in sparse results. */
    sparseScore?: number;
    /** 1-based rank in the dense search results. */
    denseRank?: number;
    /** 1-based rank in the sparse search results. */
    sparseRank?: number;
    /** Document text content if available from the vector store. */
    textContent?: string;
    /** Document metadata merged from both sources. */
    metadata?: Record<string, unknown>;
}
/**
 * Hybrid dense+sparse searcher combining vector embeddings with BM25.
 *
 * Uses Reciprocal Rank Fusion (RRF) to merge results from both retrieval
 * systems, capturing both semantic similarity and exact keyword matches.
 *
 * @example Basic usage
 * ```typescript
 * const bm25 = new BM25Index();
 * bm25.addDocuments(documents);
 *
 * const hybrid = new HybridSearcher(vectorStore, embeddingManager, bm25, {
 *   denseWeight: 0.7,
 *   sparseWeight: 0.3,
 *   fusionMethod: 'rrf',
 * });
 *
 * const results = await hybrid.search(
 *   'error TS2304 type declarations',
 *   'my-collection',
 *   10,
 * );
 * ```
 *
 * @example Weighted sum fusion (when you have calibrated scores)
 * ```typescript
 * const hybrid = new HybridSearcher(vectorStore, embeddingManager, bm25, {
 *   fusionMethod: 'weighted-sum',
 *   denseWeight: 0.6,
 *   sparseWeight: 0.4,
 * });
 * ```
 */
export declare class HybridSearcher {
    /** Dense vector store for semantic retrieval. */
    private vectorStore;
    /** Embedding manager for generating query embeddings. */
    private embeddingManager;
    /** Sparse BM25 index for keyword retrieval. */
    private bm25Index;
    /** Resolved configuration with defaults applied. */
    private config;
    /**
     * Creates a new HybridSearcher.
     *
     * @param {IVectorStore} vectorStore - Dense vector store for semantic search.
     * @param {IEmbeddingManager} embeddingManager - Manager for generating query embeddings.
     * @param {BM25Index} bm25Index - BM25 sparse keyword index.
     * @param {HybridSearcherConfig} [config] - Optional configuration overrides.
     *
     * @example
     * ```typescript
     * const searcher = new HybridSearcher(store, embeddings, bm25, {
     *   denseWeight: 0.7,
     *   sparseWeight: 0.3,
     * });
     * ```
     */
    constructor(vectorStore: IVectorStore, embeddingManager: IEmbeddingManager, bm25Index: BM25Index, config?: HybridSearcherConfig);
    /**
     * Searches both dense and sparse indexes, then fuses results.
     *
     * Pipeline:
     * 1. Generate query embedding via the embedding manager
     * 2. Query the dense vector store for semantically similar documents
     * 3. Query the BM25 sparse index for keyword-matching documents
     * 4. Fuse both result sets using the configured fusion method (RRF by default)
     * 5. Return the top K results sorted by fused score
     *
     * @param {string} query - The search query text.
     * @param {string} collectionName - Vector store collection to search.
     * @param {number} [topK=10] - Maximum number of results to return.
     * @param {Partial<QueryOptions>} [queryOptions] - Additional options for the vector store query.
     * @returns {Promise<HybridResult[]>} Fused results sorted by relevance.
     * @throws {Error} If embedding generation fails.
     *
     * @example
     * ```typescript
     * const results = await hybrid.search('error TS2304', 'knowledge-base', 5);
     * for (const r of results) {
     *   console.log(`${r.id}: fused=${r.score.toFixed(4)} dense=${r.denseRank} sparse=${r.sparseRank}`);
     * }
     * ```
     */
    search(query: string, collectionName: string, topK?: number, queryOptions?: Partial<QueryOptions>): Promise<HybridResult[]>;
    /**
     * Fuses results using Reciprocal Rank Fusion (RRF).
     *
     * Formula: `score(d) = sum_i weight_i / (k + rank_i(d))`
     *
     * Documents appearing in both result sets get contributions from both,
     * naturally boosting documents ranked highly by both systems.
     *
     * @param {RetrievedVectorDocument[]} denseResults - Dense vector search results.
     * @param {BM25Result[]} sparseResults - BM25 sparse search results.
     * @param {number} topK - Maximum results to return.
     * @returns {HybridResult[]} Fused results sorted by RRF score.
     */
    private fuseRRF;
    /**
     * Fuses results using weighted score summation with min-max normalization.
     *
     * Both score distributions are normalized to [0, 1] before weighting
     * to account for the different scoring scales of dense (cosine similarity)
     * and sparse (BM25 score) systems.
     *
     * @param {RetrievedVectorDocument[]} denseResults - Dense vector search results.
     * @param {BM25Result[]} sparseResults - BM25 sparse search results.
     * @param {number} topK - Maximum results to return.
     * @returns {HybridResult[]} Fused results sorted by weighted score.
     */
    private fuseWeightedSum;
    /**
     * Fuses results using round-robin interleaving with deduplication.
     *
     * Alternates between picking the next-best dense result and the
     * next-best sparse result, skipping documents already included.
     * This provides a simple diversity-preserving fusion.
     *
     * @param {RetrievedVectorDocument[]} denseResults - Dense vector search results.
     * @param {BM25Result[]} sparseResults - BM25 sparse search results.
     * @param {number} topK - Maximum results to return.
     * @returns {HybridResult[]} Interleaved results.
     */
    private fuseInterleave;
}
//# sourceMappingURL=HybridSearcher.d.ts.map