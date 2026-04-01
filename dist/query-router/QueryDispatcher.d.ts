/**
 * @fileoverview QueryDispatcher — routes classified queries to the
 * tier-appropriate retrieval pipeline with graceful fallbacks.
 * @module @framers/agentos/query-router/QueryDispatcher
 *
 * The dispatcher is the second stage of the QueryRouter pipeline, invoked
 * after the QueryClassifier has assigned a complexity tier **and** a
 * retrieval strategy. It orchestrates vector search, HyDE (Hypothetical
 * Document Embedding) search, knowledge-graph expansion, reranking, deep
 * research, and query decomposition by delegating to injected callback
 * functions — it has no direct coupling to EmbeddingManager,
 * VectorStoreManager, HydeRetriever, or any concrete service.
 *
 * **Strategy behaviour (new):**
 * - `none`:     Skip retrieval entirely, return empty.
 * - `simple`:   Direct vector search only (topK=5). No HyDE overhead.
 * - `moderate`: HyDE-powered search — generate hypothesis, embed, search.
 *               Falls back to direct vector search if HyDE unavailable.
 * - `complex`:  Decompose the query into sub-queries, run HyDE per
 *               sub-query, merge/dedup/rank the combined results.
 *
 * **Tier behaviour (legacy, still supported):**
 * - T0: Trivial — no retrieval, returns empty immediately
 * - T1: Simple lookup — vector search only (topK=5)
 * - T2: Multi-source — vector(15) + graph expand + merge/dedup + rerank(5)
 * - T3: Research — everything in T2 + deep research with synthesis
 *
 * **Fallback guarantees:**
 * Every external call is wrapped in a try/catch so partial failures degrade
 * gracefully rather than crashing the pipeline. A `retrieve:fallback` event
 * is emitted for each degradation so consumers have full observability.
 */
import type { QueryTier, RetrievalStrategy, RetrievedChunk, RetrievalResult, QueryRouterEventUnion } from './types.js';
/**
 * Callback dependencies injected into the QueryDispatcher.
 *
 * Each retrieval capability is represented as a plain async function so the
 * dispatcher remains decoupled from concrete implementations and is trivially
 * testable with vi.fn() mocks.
 */
export interface QueryDispatcherDeps {
    /**
     * Dense vector similarity search (direct embedding of the raw query).
     * @param query - The user query string.
     * @param topK  - Maximum number of chunks to return.
     */
    vectorSearch: (query: string, topK: number) => Promise<RetrievedChunk[]>;
    /**
     * HyDE-powered vector search.
     *
     * Generates a hypothetical answer via LLM, embeds *that* answer, then
     * searches the vector store. Bridges vocabulary gaps between questions
     * and stored documents. (Gao et al. 2023)
     *
     * When `undefined`, the dispatcher falls back to `vectorSearch` for
     * moderate/complex strategies.
     *
     * @param query - The user query string.
     * @param topK  - Maximum number of chunks to return.
     * @returns Retrieved chunks with relevance scores.
     */
    hydeSearch?: (query: string, topK: number) => Promise<RetrievedChunk[]>;
    /**
     * Decompose a complex query into independent sub-queries.
     *
     * Used by the `complex` strategy to split multi-part questions before
     * running HyDE per sub-query.
     *
     * When `undefined`, the dispatcher runs the full query through HyDE
     * as a single pass (equivalent to `moderate`).
     *
     * @param query        - The original multi-part user query.
     * @param maxSubQueries - Maximum number of sub-queries to generate.
     * @returns Array of decomposed sub-query strings.
     */
    decompose?: (query: string, maxSubQueries: number) => Promise<string[]>;
    /**
     * Knowledge-graph expansion starting from seed chunks.
     * Returns additional related chunks discovered via graph traversal.
     * @param seedChunks - Initial chunks from vector search.
     */
    graphExpand: (seedChunks: RetrievedChunk[]) => Promise<RetrievedChunk[]>;
    /**
     * Cross-encoder or LLM-based reranker that scores and prunes chunks.
     * @param query  - The user query string for relevance scoring.
     * @param chunks - Candidate chunks to rerank.
     * @param topN   - Maximum number of chunks to keep after reranking.
     */
    rerank: (query: string, chunks: RetrievedChunk[], topN: number) => Promise<RetrievedChunk[]>;
    /**
     * Multi-pass deep research synthesis.
     * @param query   - The user query string.
     * @param sources - Normalized research source hints to consult
     *                  (e.g., ['web', 'docs']).
     */
    deepResearch: (query: string, sources: string[]) => Promise<{
        synthesis: string;
        sources: RetrievedChunk[];
    }>;
    /**
     * Event emitter callback for lifecycle observability events.
     * @param event - A typed QueryRouter event.
     */
    emit: (event: QueryRouterEventUnion) => void;
    /** Whether graph-based retrieval is available / enabled. */
    graphEnabled: boolean;
    /** Whether deep research is available / enabled. */
    deepResearchEnabled: boolean;
    /**
     * Maximum number of sub-queries for decomposition.
     * Only relevant for the `complex` strategy.
     * @default 5
     */
    maxSubQueries?: number;
}
/**
 * Routes classified queries to the strategy-appropriate retrieval pipeline.
 *
 * Supports both the new strategy-based dispatch ({@link dispatchByStrategy})
 * and the legacy tier-based dispatch ({@link dispatch}) for backward
 * compatibility.
 *
 * @example
 * ```typescript
 * const dispatcher = new QueryDispatcher({
 *   vectorSearch: async (q, k) => vectorStore.search(q, k),
 *   hydeSearch:   async (q, k) => hydeRetriever.search(q, k),
 *   decompose:    async (q, max) => decomposer.decompose(q, max),
 *   graphExpand:  async (seeds) => graphRag.expand(seeds),
 *   rerank:       async (q, chunks, n) => reranker.rerank(q, chunks, n),
 *   deepResearch: async (q, srcs) => researcher.research(q, srcs),
 *   emit:         (e) => eventBus.emit(e),
 *   graphEnabled: true,
 *   deepResearchEnabled: true,
 * });
 *
 * // Strategy-based (preferred):
 * const result = await dispatcher.dispatchByStrategy('How does auth work?', 'moderate');
 *
 * // Tier-based (legacy):
 * const result = await dispatcher.dispatch('How does auth work?', 2);
 * ```
 */
export declare class QueryDispatcher {
    /** Injected retrieval dependencies. */
    private readonly deps;
    constructor(deps: QueryDispatcherDeps);
    /**
     * Dispatch a query using the recommended retrieval strategy.
     *
     * This is the preferred entry point for the HyDE-aware routing pipeline.
     * The strategy is typically produced by the QueryClassifier's LLM-as-judge
     * or heuristic classifier.
     *
     * @param query    - The user's natural-language query.
     * @param strategy - Retrieval strategy (`none`, `simple`, `moderate`, `complex`).
     * @param suggestedSources - Optional retrieval or research source hints for
     *                           deep research (complex). Internal classifier
     *                           hints such as `vector`/`graph`/`research` are
     *                           normalized to research hints before dispatch.
     * @returns Aggregated retrieval result with chunks, optional synthesis,
     *          and timing metadata.
     */
    dispatchByStrategy(query: string, strategy: RetrievalStrategy, suggestedSources?: string[]): Promise<RetrievalResult>;
    /**
     * Dispatch a classified query to the tier-appropriate retrieval pipeline.
     *
     * This is the legacy entry point. For HyDE-aware routing, prefer
     * {@link dispatchByStrategy}.
     *
     * @param query            - The user's natural-language query.
     * @param tier             - Complexity tier assigned by the QueryClassifier.
     * @param suggestedSources - Optional retrieval or research source hints for
     *                           deep research (T3). Internal classifier hints
     *                           are normalized before dispatch. Defaults to
     *                           `['web']` when not provided.
     * @returns Aggregated retrieval result with chunks, optional synthesis,
     *          and timing metadata.
     */
    dispatch(query: string, tier: QueryTier, suggestedSources?: string[]): Promise<RetrievalResult>;
    /**
     * Simple strategy pipeline: direct vector search only, topK=5.
     *
     * No HyDE hypothesis generation, no graph traversal, no reranking.
     * Best for concrete queries with vocabulary that matches stored docs.
     */
    private dispatchSimple;
    /**
     * Moderate strategy pipeline: HyDE-powered search + optional graph + rerank.
     *
     * Generates a hypothetical answer, embeds *that* for vector search, then
     * optionally expands via graph traversal and reranks. Falls back to direct
     * vector search if HyDE is unavailable.
     */
    private dispatchModerate;
    /**
     * Complex strategy pipeline: decompose → HyDE per sub-query → merge → rank.
     *
     * For multi-part queries, decomposes into independent sub-queries, runs
     * HyDE search per sub-query, deduplicates and ranks the combined results.
     * Falls back to moderate (single HyDE pass) if decomposition fails.
     *
     * When deep research is enabled, a research synthesis pass runs after the
     * merged retrieval stage (inheriting from the T3 pipeline).
     */
    private dispatchComplex;
    /**
     * Tier 1 pipeline: vector search only, topK=5.
     * No graph traversal, no reranking, no research.
     */
    private dispatchTier1;
    /**
     * Tier 2 pipeline: vector(15) + graph expand + merge/dedup + rerank(5).
     *
     * Fallbacks:
     * - If graph expand fails, continues with vector-only chunks.
     * - If rerank fails, falls back to sorting by score and taking top 5.
     */
    private dispatchTier2;
    /**
     * Internal Tier 2 pipeline used by both direct T2 routing and the T3
     * pre-research retrieval stage. T3 suppresses the early retrieve:complete
     * event so the final completion event reflects the post-research result.
     */
    private dispatchTier2Internal;
    /**
     * Tier 3 pipeline: everything in T2 + deep research synthesis.
     *
     * Fallback: if deep research fails, the result is identical to T2
     * (no synthesis, no research chunks), and a fallback event is emitted.
     */
    private dispatchTier3;
    /**
     * Merge two arrays of chunks and deduplicate by chunk ID.
     * When duplicates exist, the chunk with the higher relevanceScore is kept.
     *
     * @param primary   - Primary chunk array (typically vector results).
     * @param secondary - Secondary chunk array (typically graph or research results).
     * @returns Merged, deduplicated array preserving insertion order of first occurrence.
     */
    private mergeAndDedup;
    /**
     * Normalize classifier retrieval hints into the research-source vocabulary
     * expected by deep-research runtimes.
     */
    private normalizeResearchSources;
    /**
     * Best-effort vector search that degrades to an empty result set instead of
     * aborting the entire retrieval pipeline.
     */
    private safeVectorSearch;
}
//# sourceMappingURL=QueryDispatcher.d.ts.map