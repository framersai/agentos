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
import { STRATEGY_TO_TIER, } from './types.js';
// ============================================================================
// QUERY DISPATCHER
// ============================================================================
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
export class QueryDispatcher {
    constructor(deps) {
        this.deps = deps;
    }
    // --------------------------------------------------------------------------
    // PUBLIC API — Strategy-based dispatch (new)
    // --------------------------------------------------------------------------
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
    async dispatchByStrategy(query, strategy, suggestedSources) {
        // Map strategy to tier for event emission
        const tier = STRATEGY_TO_TIER[strategy];
        // none → skip retrieval entirely
        if (strategy === 'none') {
            return { chunks: [], durationMs: 0 };
        }
        const start = Date.now();
        this.deps.emit({
            type: 'retrieve:start',
            tier,
            timestamp: Date.now(),
        });
        switch (strategy) {
            case 'simple':
                return this.dispatchSimple(query, start);
            case 'moderate':
                return this.dispatchModerate(query, start);
            case 'complex':
                return this.dispatchComplex(query, this.normalizeResearchSources(suggestedSources), start);
            default:
                // Unreachable for valid RetrievalStrategy, but TypeScript exhaustiveness
                return this.dispatchSimple(query, start);
        }
    }
    // --------------------------------------------------------------------------
    // PUBLIC API — Tier-based dispatch (legacy)
    // --------------------------------------------------------------------------
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
    async dispatch(query, tier, suggestedSources) {
        // T0 — trivial queries need no retrieval at all
        if (tier === 0) {
            return { chunks: [], durationMs: 0 };
        }
        const start = Date.now();
        this.deps.emit({
            type: 'retrieve:start',
            tier,
            timestamp: Date.now(),
        });
        // T1 — simple vector-only retrieval
        if (tier === 1) {
            return this.dispatchTier1(query, start);
        }
        // T2 — hybrid: vector + graph + rerank
        if (tier === 2) {
            return this.dispatchTier2(query, start);
        }
        // T3 — hybrid + deep research
        return this.dispatchTier3(query, this.normalizeResearchSources(suggestedSources), start);
    }
    // --------------------------------------------------------------------------
    // STRATEGY PIPELINES (new — HyDE-aware)
    // --------------------------------------------------------------------------
    /**
     * Simple strategy pipeline: direct vector search only, topK=5.
     *
     * No HyDE hypothesis generation, no graph traversal, no reranking.
     * Best for concrete queries with vocabulary that matches stored docs.
     */
    async dispatchSimple(query, start) {
        const vectorStart = Date.now();
        const chunks = await this.safeVectorSearch(query, 5);
        const vectorDuration = Date.now() - vectorStart;
        this.deps.emit({
            type: 'retrieve:vector',
            chunkCount: chunks.length,
            durationMs: vectorDuration,
            timestamp: Date.now(),
        });
        const result = {
            chunks,
            durationMs: Date.now() - start,
        };
        this.deps.emit({
            type: 'retrieve:complete',
            result,
            timestamp: Date.now(),
        });
        return result;
    }
    /**
     * Moderate strategy pipeline: HyDE-powered search + optional graph + rerank.
     *
     * Generates a hypothetical answer, embeds *that* for vector search, then
     * optionally expands via graph traversal and reranks. Falls back to direct
     * vector search if HyDE is unavailable.
     */
    async dispatchModerate(query, start) {
        // --- HyDE search (topK=15 for graph+rerank pipeline) ---
        const hydeStart = Date.now();
        let hydeChunks;
        if (this.deps.hydeSearch) {
            try {
                hydeChunks = await this.deps.hydeSearch(query, 15);
            }
            catch (err) {
                // HyDE failed — fall back to direct vector search
                this.deps.emit({
                    type: 'retrieve:fallback',
                    strategy: 'hyde-to-vector',
                    reason: `HyDE search failed: ${err.message}`,
                    timestamp: Date.now(),
                });
                hydeChunks = await this.safeVectorSearch(query, 15, 'vector-empty', 'Vector search fallback failed');
            }
        }
        else {
            // HyDE not available — use direct vector search
            this.deps.emit({
                type: 'retrieve:fallback',
                strategy: 'hyde-unavailable',
                reason: 'HyDE search not configured; using direct vector search',
                timestamp: Date.now(),
            });
            hydeChunks = await this.safeVectorSearch(query, 15);
        }
        const hydeDuration = Date.now() - hydeStart;
        this.deps.emit({
            type: 'retrieve:vector',
            chunkCount: hydeChunks.length,
            durationMs: hydeDuration,
            timestamp: Date.now(),
        });
        // --- Graph expansion (fallback-safe) ---
        let graphChunks = [];
        if (this.deps.graphEnabled) {
            const graphStart = Date.now();
            try {
                graphChunks = await this.deps.graphExpand(hydeChunks);
                const graphDuration = Date.now() - graphStart;
                this.deps.emit({
                    type: 'retrieve:graph',
                    entityCount: graphChunks.length,
                    durationMs: graphDuration,
                    timestamp: Date.now(),
                });
            }
            catch (err) {
                this.deps.emit({
                    type: 'retrieve:fallback',
                    strategy: 'graph-skip',
                    reason: `Graph expansion failed: ${err.message}`,
                    timestamp: Date.now(),
                });
            }
        }
        // --- Merge + deduplicate ---
        const merged = this.mergeAndDedup(hydeChunks, graphChunks);
        // --- Rerank (fallback-safe) ---
        let finalChunks = [];
        if (merged.length > 0) {
            const rerankStart = Date.now();
            try {
                finalChunks = await this.deps.rerank(query, merged, 5);
                const rerankDuration = Date.now() - rerankStart;
                this.deps.emit({
                    type: 'retrieve:rerank',
                    inputCount: merged.length,
                    outputCount: finalChunks.length,
                    durationMs: rerankDuration,
                    timestamp: Date.now(),
                });
            }
            catch (err) {
                finalChunks = [...merged]
                    .sort((a, b) => b.relevanceScore - a.relevanceScore)
                    .slice(0, 5);
                this.deps.emit({
                    type: 'retrieve:fallback',
                    strategy: 'rerank-skip',
                    reason: `Rerank failed: ${err.message}`,
                    timestamp: Date.now(),
                });
            }
        }
        const result = {
            chunks: finalChunks,
            durationMs: Date.now() - start,
        };
        this.deps.emit({
            type: 'retrieve:complete',
            result,
            timestamp: Date.now(),
        });
        return result;
    }
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
    async dispatchComplex(query, suggestedSources, start) {
        const maxSubQueries = this.deps.maxSubQueries ?? 5;
        // --- Step 1: Decompose the query into sub-queries ---
        let subQueries;
        const decomposeStart = Date.now();
        if (this.deps.decompose) {
            try {
                subQueries = await this.deps.decompose(query, maxSubQueries);
                this.deps.emit({
                    type: 'strategy:decompose',
                    originalQuery: query,
                    subQueries,
                    durationMs: Date.now() - decomposeStart,
                    timestamp: Date.now(),
                });
            }
            catch (err) {
                // Decomposition failed — fall through to single-pass HyDE
                this.deps.emit({
                    type: 'retrieve:fallback',
                    strategy: 'decompose-skip',
                    reason: `Query decomposition failed: ${err.message}`,
                    timestamp: Date.now(),
                });
                subQueries = [query];
            }
        }
        else {
            // No decomposer available — use the original query as-is
            subQueries = [query];
        }
        // --- Step 2: HyDE search per sub-query ---
        const allChunks = [];
        const searchFn = this.deps.hydeSearch ?? this.deps.vectorSearch;
        const usesHyde = this.deps.hydeSearch !== undefined;
        for (const subQuery of subQueries) {
            const subStart = Date.now();
            try {
                const chunks = await searchFn(subQuery, 10);
                allChunks.push(...chunks);
                this.deps.emit({
                    type: 'retrieve:vector',
                    chunkCount: chunks.length,
                    durationMs: Date.now() - subStart,
                    timestamp: Date.now(),
                });
            }
            catch (err) {
                // Sub-query search failed — try direct vector search as fallback
                this.deps.emit({
                    type: 'retrieve:fallback',
                    strategy: 'sub-query-fallback',
                    reason: `Sub-query search failed for "${subQuery.slice(0, 60)}": ${err.message}`,
                    timestamp: Date.now(),
                });
                if (usesHyde) {
                    const fallbackChunks = await this.safeVectorSearch(subQuery, 10, 'sub-query-skip', `Direct vector fallback failed for "${subQuery.slice(0, 60)}"`);
                    allChunks.push(...fallbackChunks);
                }
                else {
                    this.deps.emit({
                        type: 'retrieve:fallback',
                        strategy: 'sub-query-skip',
                        reason: `Sub-query skipped for "${subQuery.slice(0, 60)}": ${err.message}`,
                        timestamp: Date.now(),
                    });
                }
            }
        }
        // --- Step 2b: Optional graph expansion (same as moderate pipeline) ---
        let graphChunks = [];
        if (this.deps.graphEnabled) {
            try {
                graphChunks = await this.deps.graphExpand(allChunks);
                this.deps.emit({
                    type: 'retrieve:graph',
                    entityCount: graphChunks.length,
                    durationMs: 0,
                    timestamp: Date.now(),
                });
            }
            catch (err) {
                this.deps.emit({
                    type: 'retrieve:fallback',
                    strategy: 'graph-skip',
                    reason: `Graph expansion failed in complex pipeline: ${err.message}`,
                    timestamp: Date.now(),
                });
            }
        }
        // --- Step 3: Deduplicate and rank ---
        const deduped = this.mergeAndDedup(allChunks, graphChunks);
        let finalChunks = [];
        // Rerank the merged results against the original query
        if (deduped.length > 0) {
            const rerankStart = Date.now();
            try {
                finalChunks = await this.deps.rerank(query, deduped, 10);
                const rerankDuration = Date.now() - rerankStart;
                this.deps.emit({
                    type: 'retrieve:rerank',
                    inputCount: deduped.length,
                    outputCount: finalChunks.length,
                    durationMs: rerankDuration,
                    timestamp: Date.now(),
                });
            }
            catch (err) {
                finalChunks = [...deduped]
                    .sort((a, b) => b.relevanceScore - a.relevanceScore)
                    .slice(0, 10);
                this.deps.emit({
                    type: 'retrieve:fallback',
                    strategy: 'rerank-skip',
                    reason: `Rerank failed: ${err.message}`,
                    timestamp: Date.now(),
                });
            }
        }
        // --- Step 4: Optional deep research synthesis ---
        if (this.deps.deepResearchEnabled) {
            this.deps.emit({
                type: 'research:start',
                query,
                maxIterations: 3,
                timestamp: Date.now(),
            });
            try {
                const researchResult = await this.deps.deepResearch(query, suggestedSources);
                this.deps.emit({
                    type: 'research:phase',
                    iteration: 1,
                    totalIterations: 1,
                    newChunksFound: researchResult.sources.length,
                    timestamp: Date.now(),
                });
                this.deps.emit({
                    type: 'research:complete',
                    iterationsUsed: 1,
                    totalChunks: researchResult.sources.length,
                    durationMs: Date.now() - start,
                    timestamp: Date.now(),
                });
                // Merge research chunks with HyDE-gathered chunks
                const withResearch = this.mergeAndDedup(finalChunks, researchResult.sources);
                const result = {
                    chunks: withResearch,
                    researchSynthesis: researchResult.synthesis,
                    durationMs: Date.now() - start,
                };
                this.deps.emit({
                    type: 'retrieve:complete',
                    result,
                    timestamp: Date.now(),
                });
                return result;
            }
            catch (err) {
                this.deps.emit({
                    type: 'retrieve:fallback',
                    strategy: 'research-skip',
                    reason: `Deep research failed: ${err.message}`,
                    timestamp: Date.now(),
                });
            }
        }
        // Return merged HyDE results without research
        const result = {
            chunks: finalChunks,
            durationMs: Date.now() - start,
        };
        this.deps.emit({
            type: 'retrieve:complete',
            result,
            timestamp: Date.now(),
        });
        return result;
    }
    // --------------------------------------------------------------------------
    // TIER PIPELINES (legacy)
    // --------------------------------------------------------------------------
    /**
     * Tier 1 pipeline: vector search only, topK=5.
     * No graph traversal, no reranking, no research.
     */
    async dispatchTier1(query, start) {
        const vectorStart = Date.now();
        const chunks = await this.safeVectorSearch(query, 5);
        const vectorDuration = Date.now() - vectorStart;
        this.deps.emit({
            type: 'retrieve:vector',
            chunkCount: chunks.length,
            durationMs: vectorDuration,
            timestamp: Date.now(),
        });
        const result = {
            chunks,
            durationMs: Date.now() - start,
        };
        this.deps.emit({
            type: 'retrieve:complete',
            result,
            timestamp: Date.now(),
        });
        return result;
    }
    /**
     * Tier 2 pipeline: vector(15) + graph expand + merge/dedup + rerank(5).
     *
     * Fallbacks:
     * - If graph expand fails, continues with vector-only chunks.
     * - If rerank fails, falls back to sorting by score and taking top 5.
     */
    async dispatchTier2(query, start) {
        return this.dispatchTier2Internal(query, start, true);
    }
    /**
     * Internal Tier 2 pipeline used by both direct T2 routing and the T3
     * pre-research retrieval stage. T3 suppresses the early retrieve:complete
     * event so the final completion event reflects the post-research result.
     */
    async dispatchTier2Internal(query, start, emitComplete) {
        // --- Vector search (topK=15) ---
        const vectorStart = Date.now();
        const vectorChunks = await this.safeVectorSearch(query, 15);
        const vectorDuration = Date.now() - vectorStart;
        this.deps.emit({
            type: 'retrieve:vector',
            chunkCount: vectorChunks.length,
            durationMs: vectorDuration,
            timestamp: Date.now(),
        });
        // --- Graph expansion (fallback-safe) ---
        let graphChunks = [];
        if (this.deps.graphEnabled) {
            const graphStart = Date.now();
            try {
                graphChunks = await this.deps.graphExpand(vectorChunks);
                const graphDuration = Date.now() - graphStart;
                this.deps.emit({
                    type: 'retrieve:graph',
                    entityCount: graphChunks.length,
                    durationMs: graphDuration,
                    timestamp: Date.now(),
                });
            }
            catch (err) {
                this.deps.emit({
                    type: 'retrieve:fallback',
                    strategy: 'graph-skip',
                    reason: `Graph expansion failed: ${err.message}`,
                    timestamp: Date.now(),
                });
            }
        }
        // --- Merge + deduplicate by id ---
        const merged = this.mergeAndDedup(vectorChunks, graphChunks);
        // --- Rerank (fallback-safe) ---
        let finalChunks = [];
        if (merged.length > 0) {
            const rerankStart = Date.now();
            try {
                finalChunks = await this.deps.rerank(query, merged, 5);
                const rerankDuration = Date.now() - rerankStart;
                this.deps.emit({
                    type: 'retrieve:rerank',
                    inputCount: merged.length,
                    outputCount: finalChunks.length,
                    durationMs: rerankDuration,
                    timestamp: Date.now(),
                });
            }
            catch (err) {
                // Fallback: sort by score descending, take top 5
                finalChunks = [...merged]
                    .sort((a, b) => b.relevanceScore - a.relevanceScore)
                    .slice(0, 5);
                this.deps.emit({
                    type: 'retrieve:fallback',
                    strategy: 'rerank-skip',
                    reason: `Rerank failed: ${err.message}`,
                    timestamp: Date.now(),
                });
            }
        }
        const result = {
            chunks: finalChunks,
            durationMs: Date.now() - start,
        };
        if (emitComplete) {
            this.deps.emit({
                type: 'retrieve:complete',
                result,
                timestamp: Date.now(),
            });
        }
        return result;
    }
    /**
     * Tier 3 pipeline: everything in T2 + deep research synthesis.
     *
     * Fallback: if deep research fails, the result is identical to T2
     * (no synthesis, no research chunks), and a fallback event is emitted.
     */
    async dispatchTier3(query, suggestedSources, start) {
        // Run the T2 pipeline first to get hybrid chunks
        const t2Result = await this.dispatchTier2Internal(query, start, false);
        // --- Deep research (fallback-safe) ---
        if (this.deps.deepResearchEnabled) {
            this.deps.emit({
                type: 'research:start',
                query,
                maxIterations: 3,
                timestamp: Date.now(),
            });
            try {
                const researchResult = await this.deps.deepResearch(query, suggestedSources);
                this.deps.emit({
                    type: 'research:phase',
                    iteration: 1,
                    totalIterations: 1,
                    newChunksFound: researchResult.sources.length,
                    timestamp: Date.now(),
                });
                this.deps.emit({
                    type: 'research:complete',
                    iterationsUsed: 1,
                    totalChunks: researchResult.sources.length,
                    durationMs: Date.now() - start,
                    timestamp: Date.now(),
                });
                // Merge research chunks with T2 chunks, dedup
                const allChunks = this.mergeAndDedup(t2Result.chunks, researchResult.sources);
                const result = {
                    chunks: allChunks,
                    researchSynthesis: researchResult.synthesis,
                    durationMs: Date.now() - start,
                };
                this.deps.emit({
                    type: 'retrieve:complete',
                    result,
                    timestamp: Date.now(),
                });
                return result;
            }
            catch (err) {
                this.deps.emit({
                    type: 'retrieve:fallback',
                    strategy: 'research-skip',
                    reason: `Deep research failed: ${err.message}`,
                    timestamp: Date.now(),
                });
            }
        }
        // If research was disabled or failed, return T2 result with updated duration
        const result = {
            ...t2Result,
            durationMs: Date.now() - start,
        };
        this.deps.emit({
            type: 'retrieve:complete',
            result,
            timestamp: Date.now(),
        });
        return result;
    }
    // --------------------------------------------------------------------------
    // UTILITIES
    // --------------------------------------------------------------------------
    /**
     * Merge two arrays of chunks and deduplicate by chunk ID.
     * When duplicates exist, the chunk with the higher relevanceScore is kept.
     *
     * @param primary   - Primary chunk array (typically vector results).
     * @param secondary - Secondary chunk array (typically graph or research results).
     * @returns Merged, deduplicated array preserving insertion order of first occurrence.
     */
    mergeAndDedup(primary, secondary) {
        const seen = new Map();
        for (const chunk of primary) {
            const existing = seen.get(chunk.id);
            if (!existing || chunk.relevanceScore > existing.relevanceScore) {
                seen.set(chunk.id, chunk);
            }
        }
        for (const chunk of secondary) {
            const existing = seen.get(chunk.id);
            if (!existing || chunk.relevanceScore > existing.relevanceScore) {
                seen.set(chunk.id, chunk);
            }
        }
        return Array.from(seen.values());
    }
    /**
     * Normalize classifier retrieval hints into the research-source vocabulary
     * expected by deep-research runtimes.
     */
    normalizeResearchSources(suggestedSources) {
        const sources = suggestedSources?.length ? suggestedSources : ['web'];
        const normalizedSources = [];
        const seen = new Set();
        const push = (source) => {
            const normalizedSource = source.trim().toLowerCase();
            if (!normalizedSource || seen.has(normalizedSource)) {
                return;
            }
            seen.add(normalizedSource);
            normalizedSources.push(normalizedSource);
        };
        for (const source of sources) {
            const normalizedSource = source.trim().toLowerCase();
            switch (normalizedSource) {
                case 'vector':
                case 'graph':
                case 'bm25':
                case 'memory':
                case 'raptor':
                case 'docs':
                case 'documentation':
                case 'repo':
                case 'repository':
                case 'code':
                    push('docs');
                    break;
                case 'research':
                case 'web':
                case 'search':
                case 'internet':
                    push('web');
                    break;
                case 'multimodal':
                case 'media':
                case 'image':
                case 'images':
                case 'audio':
                case 'video':
                    push('media');
                    break;
                default:
                    push(normalizedSource);
                    break;
            }
        }
        return normalizedSources.length > 0 ? normalizedSources : ['web'];
    }
    /**
     * Best-effort vector search that degrades to an empty result set instead of
     * aborting the entire retrieval pipeline.
     */
    async safeVectorSearch(query, topK, fallbackStrategy = 'vector-empty', reasonPrefix = 'Vector search failed') {
        try {
            return await this.deps.vectorSearch(query, topK);
        }
        catch (err) {
            this.deps.emit({
                type: 'retrieve:fallback',
                strategy: fallbackStrategy,
                reason: `${reasonPrefix}: ${err.message}`,
                timestamp: Date.now(),
            });
            return [];
        }
    }
}
//# sourceMappingURL=QueryDispatcher.js.map