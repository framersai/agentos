/**
 * @fileoverview UnifiedRetriever — single-entry-point retrieval orchestrator
 * that executes a {@link RetrievalPlan} across ALL available sources in
 * parallel, merges results via Reciprocal Rank Fusion (RRF), reranks, and
 * feeds back into cognitive memory.
 *
 * This replaces the need to call RetrievalAugmentor, QueryDispatcher,
 * CognitiveMemoryManager, and MultimodalIndexer separately. It is the
 * canonical retrieval path for AgentOS v2.
 *
 * Architecture:
 * ```
 *   RetrievalPlan
 *       │
 *       ▼
 *   ┌─────────────────────────┐
 *   │  1. Memory-first check  │  (episodic cache shortcut)
 *   └───────────┬─────────────┘
 *               ▼
 *   ┌─────────────────────────┐
 *   │  2. Parallel sources    │  Promise.allSettled across enabled sources
 *   │  • hybrid (vector+BM25) │
 *   │  • RAPTOR tree          │
 *   │  • GraphRAG             │
 *   │  • Cognitive memory     │
 *   │  • Multimodal index     │
 *   │  • HyDE hypotheses      │
 *   └───────────┬─────────────┘
 *               ▼
 *   ┌─────────────────────────┐
 *   │  3. RRF merge           │  Reciprocal Rank Fusion across all source lists
 *   └───────────┬─────────────┘
 *               ▼
 *   ┌─────────────────────────┐
 *   │  4. Temporal boosting   │  Exponential decay boost for recent results
 *   └───────────┬─────────────┘
 *               ▼
 *   ┌─────────────────────────┐
 *   │  5. Rerank              │  Cross-encoder or LLM-based reranking
 *   └───────────┬─────────────┘
 *               ▼
 *   ┌─────────────────────────┐
 *   │  6. Deep research       │  (complex strategy only: decompose → recurse)
 *   └───────────┬─────────────┘
 *               ▼
 *   ┌─────────────────────────┐
 *   │  7. Memory feedback     │  Store retrieval as episodic memory + Hebbian
 *   └─────────────────────────┘
 * ```
 *
 * @module agentos/rag/unified/UnifiedRetriever
 * @see RetrievalPlan for the plan specification
 * @see buildDefaultPlan for creating default plans
 */
import { EventEmitter } from 'node:events';
// ============================================================================
// UNIFIED RETRIEVER
// ============================================================================
/**
 * Unified retrieval orchestrator that executes a {@link RetrievalPlan}
 * across ALL available sources in parallel, merges results via RRF,
 * reranks, and feeds back into cognitive memory.
 *
 * This is the single entry point for ALL retrieval in AgentOS. It replaces
 * the need to call RetrievalAugmentor, QueryDispatcher, CognitiveMemoryManager,
 * and MultimodalIndexer separately.
 *
 * All source queries are executed with `Promise.allSettled` so partial
 * failures degrade gracefully — a failed GraphRAG query does not prevent
 * vector results from being returned.
 *
 * @example
 * ```typescript
 * import { UnifiedRetriever } from '../../rag/unified/index.js';
 * import { buildDefaultPlan } from '../../rag/unified/types.js';
 *
 * const retriever = new UnifiedRetriever({
 *   hybridSearcher,
 *   raptorTree,
 *   graphEngine,
 *   memoryManager,
 *   hydeRetriever,
 *   rerank: async (q, chunks, n) => reranker.rerank(q, chunks, n),
 * });
 *
 * const plan = buildDefaultPlan('moderate');
 * const result = await retriever.retrieve('How does authentication work?', plan);
 * console.log(`Found ${result.chunks.length} chunks from ${Object.keys(result.sourceDiagnostics).length} sources`);
 * ```
 *
 * @see RetrievalPlan for plan specification
 * @see buildDefaultPlan for creating default plans
 * @see UnifiedRetrieverDeps for dependency injection
 */
export class UnifiedRetriever extends EventEmitter {
    /**
     * Creates a new UnifiedRetriever.
     *
     * @param deps - Dependency injection container. All dependencies are optional;
     *   the retriever gracefully skips sources whose deps are not provided.
     *
     * @example
     * ```typescript
     * const retriever = new UnifiedRetriever({
     *   hybridSearcher: myHybridSearcher,
     *   raptorTree: myRaptorTree,
     *   graphEngine: myGraphEngine,
     *   memoryManager: myMemoryManager,
     *   rerank: myReranker,
     * });
     * ```
     */
    constructor(deps) {
        super();
        this.deps = deps;
        this.rrfK = deps.rrfK ?? 60;
        this.defaultTopK = deps.defaultTopK ?? 10;
        this.maxSubQueries = deps.maxSubQueries ?? 5;
        this.memoryCacheThreshold = deps.memoryCacheThreshold ?? 0.85;
        this.defaultMood = deps.defaultMood ?? { valence: 0, arousal: 0, dominance: 0 };
    }
    // --------------------------------------------------------------------------
    // PUBLIC API
    // --------------------------------------------------------------------------
    /**
     * Execute a retrieval plan across all enabled sources.
     *
     * Flow:
     * 1. Check memory first — if episodic memory has a cached answer, fast-return
     * 2. Execute all enabled sources in parallel (Promise.allSettled)
     * 3. Merge results via Reciprocal Rank Fusion (RRF)
     * 4. Apply temporal boosting if configured
     * 5. Rerank merged results
     * 6. For complex plans: decompose and recurse
     * 7. Store retrieval event as episodic memory (feedback loop)
     *
     * @param query - The user's natural-language query.
     * @param plan - The retrieval plan specifying which sources to query.
     * @param topK - Maximum number of final results. Defaults to deps.defaultTopK (10).
     * @returns Unified retrieval result with merged, reranked chunks and diagnostics.
     *
     * @throws Never — all source failures are caught and reported in diagnostics.
     *   The retriever always returns a result, even if empty.
     *
     * @example
     * ```typescript
     * const plan = buildDefaultPlan('moderate');
     * const result = await retriever.retrieve('How does auth work?', plan);
     * for (const chunk of result.chunks) {
     *   console.log(`[${chunk.matchType}] ${chunk.relevanceScore.toFixed(3)}: ${chunk.content.slice(0, 80)}`);
     * }
     * ```
     */
    async retrieve(query, plan, topK) {
        const startTime = Date.now();
        const resolvedTopK = topK ?? this.defaultTopK;
        // Emit plan start event
        this.emitEvent({ type: 'unified:plan-start', plan, timestamp: Date.now() });
        // None strategy → immediate empty return
        if (plan.strategy === 'none') {
            return this.buildEmptyResult(plan, startTime);
        }
        // Initialize diagnostics accumulator
        const diagnostics = this.emptyDiagnostics();
        // ── Phase 1: Memory-first check ──────────────────────────────────────
        const memoryCacheHit = await this.checkMemoryCache(query, plan, diagnostics);
        if (memoryCacheHit) {
            return this.buildResult(memoryCacheHit, plan, diagnostics, startTime, true);
        }
        // ── Phase 2: Parallel source execution ───────────────────────────────
        const sourceResults = await this.executeSourcesInParallel(query, plan, diagnostics);
        // ── Phase 3: RRF merge ───────────────────────────────────────────────
        let merged = this.rrfMerge(sourceResults, plan);
        this.emitEvent({
            type: 'unified:merge-complete',
            totalChunks: merged.length,
            timestamp: Date.now(),
        });
        // ── Phase 4: Temporal boosting ───────────────────────────────────────
        if (plan.temporal.preferRecent) {
            merged = this.applyTemporalBoosting(merged, plan);
        }
        // ── Phase 5: Rerank ──────────────────────────────────────────────────
        let reranked;
        if (this.deps.rerank && merged.length > 0) {
            const rerankStart = Date.now();
            try {
                reranked = await this.deps.rerank(query, merged, resolvedTopK);
                diagnostics.rerank = {
                    inputCount: merged.length,
                    outputCount: reranked.length,
                    durationMs: Date.now() - rerankStart,
                };
                this.emitEvent({
                    type: 'unified:rerank-complete',
                    inputCount: merged.length,
                    outputCount: reranked.length,
                    durationMs: Date.now() - rerankStart,
                    timestamp: Date.now(),
                });
            }
            catch {
                // Reranker failed — fall back to score-sorted merge
                reranked = merged
                    .sort((a, b) => b.relevanceScore - a.relevanceScore)
                    .slice(0, resolvedTopK);
            }
        }
        else {
            reranked = merged
                .sort((a, b) => b.relevanceScore - a.relevanceScore)
                .slice(0, resolvedTopK);
        }
        // ── Phase 6: Deep research (complex strategy only) ───────────────────
        let researchSynthesis;
        if (plan.deepResearch && this.deps.deepResearch) {
            const researchResult = await this.executeDeepResearch(query, plan, reranked, diagnostics);
            if (researchResult) {
                reranked = this.mergeChunks(reranked, researchResult.chunks);
                researchSynthesis = researchResult.synthesis;
            }
        }
        // ── Phase 7: Memory feedback ─────────────────────────────────────────
        await this.storeMemoryFeedback(query, reranked, plan);
        return this.buildResult(reranked, plan, diagnostics, startTime, false, researchSynthesis);
    }
    // --------------------------------------------------------------------------
    // PHASE 1: Memory-first check
    // --------------------------------------------------------------------------
    /**
     * Checks episodic memory for a previous retrieval about the same topic.
     *
     * If a high-confidence cached retrieval is found, returns the cached chunks
     * directly — avoiding the cost of external source queries.
     *
     * @param query - The user query.
     * @param plan - The retrieval plan.
     * @param diagnostics - Diagnostics accumulator.
     * @returns Cached chunks if a high-confidence match was found, null otherwise.
     */
    async checkMemoryCache(query, plan, diagnostics) {
        if (!plan.sources.memory ||
            !plan.memoryTypes.includes('episodic') ||
            !this.deps.memoryManager) {
            return null;
        }
        const memStart = Date.now();
        try {
            const cached = await this.deps.memoryManager.retrieve(`Previous retrieval about: ${query}`, this.defaultMood, {
                types: ['episodic'],
                topK: 3,
            });
            if (cached.retrieved.length > 0 &&
                cached.retrieved[0].retrievalScore > this.memoryCacheThreshold) {
                const cacheAge = Date.now() - (cached.retrieved[0].createdAt ?? Date.now());
                const chunks = cached.retrieved.map((trace, idx) => ({
                    id: trace.id,
                    content: trace.content,
                    heading: 'Memory',
                    sourcePath: 'memory://episodic',
                    relevanceScore: trace.retrievalScore,
                    matchType: 'vector',
                }));
                diagnostics.memory = {
                    chunkCount: chunks.length,
                    durationMs: Date.now() - memStart,
                };
                this.emitEvent({
                    type: 'unified:memory-cache-hit',
                    query,
                    cacheAge,
                    timestamp: Date.now(),
                });
                return chunks;
            }
        }
        catch {
            // Memory lookup is non-critical — continue to external sources
        }
        return null;
    }
    // --------------------------------------------------------------------------
    // PHASE 2: Parallel source execution
    // --------------------------------------------------------------------------
    /**
     * Executes all enabled retrieval sources in parallel using Promise.allSettled.
     *
     * Sources that fail are silently skipped — their error is recorded in diagnostics
     * and an event is emitted, but the overall retrieval continues with results from
     * other sources.
     *
     * @param query - The user query.
     * @param plan - The retrieval plan.
     * @param diagnostics - Diagnostics accumulator.
     * @returns Map of source name to retrieved chunks.
     */
    async executeSourcesInParallel(query, plan, diagnostics) {
        const sourcePromises = new Map();
        // --- Hybrid (vector + BM25) ---
        if (plan.sources.vector || plan.sources.bm25) {
            sourcePromises.set('hybrid', this.searchHybrid(query, diagnostics));
        }
        // --- RAPTOR ---
        if (plan.sources.raptor && this.deps.raptorTree) {
            sourcePromises.set('raptor', this.searchRaptor(query, plan, diagnostics));
        }
        // --- Memory ---
        if (plan.sources.memory && this.deps.memoryManager) {
            sourcePromises.set('memory', this.searchMemory(query, plan, diagnostics));
        }
        // --- Multimodal ---
        if (plan.sources.multimodal && this.deps.multimodalIndexer) {
            const nonTextModalities = plan.modalities.filter(m => m !== 'text');
            if (nonTextModalities.length > 0) {
                sourcePromises.set('multimodal', this.searchMultimodal(query, plan, diagnostics));
            }
        }
        // --- HyDE ---
        if (plan.hyde.enabled && this.deps.hydeRetriever) {
            sourcePromises.set('hyde', this.searchHyde(query, plan, diagnostics));
        }
        // Execute all sources in parallel
        const entries = Array.from(sourcePromises.entries());
        const settled = await Promise.allSettled(entries.map(([, p]) => p));
        const results = new Map();
        for (let i = 0; i < entries.length; i++) {
            const [name] = entries[i];
            const outcome = settled[i];
            if (outcome.status === 'fulfilled') {
                results.set(name, outcome.value);
                this.emitEvent({
                    type: 'unified:source-complete',
                    source: name,
                    chunkCount: outcome.value.length,
                    durationMs: 0, // Already tracked per-source
                    timestamp: Date.now(),
                });
            }
            else {
                results.set(name, []);
                this.emitEvent({
                    type: 'unified:source-error',
                    source: name,
                    error: outcome.reason?.message ?? 'Unknown error',
                    timestamp: Date.now(),
                });
            }
        }
        // --- GraphRAG (depends on hybrid results for seed chunks) ---
        if (plan.sources.graph && this.deps.graphEngine) {
            const hybridChunks = results.get('hybrid') ?? [];
            const graphChunks = await this.searchGraph(query, hybridChunks, plan, diagnostics);
            results.set('graph', graphChunks);
        }
        return results;
    }
    // --------------------------------------------------------------------------
    // Individual source searches
    // --------------------------------------------------------------------------
    /**
     * Searches the hybrid dense+sparse index.
     *
     * @param query - The search query.
     * @param diagnostics - Diagnostics accumulator.
     * @returns Retrieved chunks from hybrid search.
     */
    async searchHybrid(query, diagnostics) {
        const start = Date.now();
        if (this.deps.hybridSearcher) {
            const collectionName = this.deps.collectionName ?? 'knowledge-base';
            const results = await this.deps.hybridSearcher.search(query, collectionName, 15);
            const chunks = results.map((r) => ({
                id: r.id,
                content: r.textContent ?? '',
                heading: r.metadata?.heading ?? '',
                sourcePath: r.metadata?.sourcePath ?? '',
                relevanceScore: r.score,
                matchType: 'vector',
            }));
            diagnostics.hybrid = { chunkCount: chunks.length, durationMs: Date.now() - start };
            return chunks;
        }
        if (this.deps.vectorSearch) {
            const chunks = await this.deps.vectorSearch(query, 15);
            diagnostics.hybrid = { chunkCount: chunks.length, durationMs: Date.now() - start };
            return chunks;
        }
        return [];
    }
    /**
     * Searches the RAPTOR hierarchical summary tree.
     *
     * @param query - The search query.
     * @param plan - The retrieval plan (for layer filtering).
     * @param diagnostics - Diagnostics accumulator.
     * @returns Retrieved chunks from RAPTOR search.
     */
    async searchRaptor(query, plan, diagnostics) {
        const start = Date.now();
        const results = await this.deps.raptorTree.search(query, 10);
        // Filter by requested layers if specified
        let filtered = results;
        if (plan.raptorLayers.length > 0) {
            const layerSet = new Set(plan.raptorLayers);
            filtered = results.filter(r => layerSet.has(r.layer));
        }
        const chunks = filtered.map(r => ({
            id: r.id,
            content: r.text,
            heading: r.isSummary ? `RAPTOR L${r.layer} Summary` : r.metadata?.heading ?? '',
            sourcePath: r.metadata?.sourcePath ?? `raptor://layer-${r.layer}`,
            relevanceScore: r.score,
            matchType: 'vector',
        }));
        diagnostics.raptor = { chunkCount: chunks.length, durationMs: Date.now() - start };
        return chunks;
    }
    /**
     * Searches the GraphRAG engine using seed chunks from hybrid search.
     *
     * @param query - The search query.
     * @param seedChunks - Seed chunks from hybrid search for entity extraction.
     * @param plan - The retrieval plan (for graph traversal config).
     * @param diagnostics - Diagnostics accumulator.
     * @returns Retrieved chunks from graph search.
     */
    async searchGraph(query, seedChunks, plan, diagnostics) {
        const start = Date.now();
        try {
            const result = await this.deps.graphEngine.localSearch(query, {
                topK: 10,
            });
            const chunks = (result.entities ?? []).map((entity, idx) => ({
                id: `graph-entity-${idx}`,
                content: entity.description,
                heading: `${entity.type}: ${entity.name}`,
                sourcePath: 'graphrag://entities',
                relevanceScore: entity.relevanceScore ?? 0.7,
                matchType: 'graph',
            }));
            diagnostics.graph = { chunkCount: chunks.length, durationMs: Date.now() - start };
            this.emitEvent({
                type: 'unified:source-complete',
                source: 'graph',
                chunkCount: chunks.length,
                durationMs: Date.now() - start,
                timestamp: Date.now(),
            });
            return chunks;
        }
        catch {
            diagnostics.graph = { chunkCount: 0, durationMs: Date.now() - start };
            this.emitEvent({
                type: 'unified:source-error',
                source: 'graph',
                error: 'GraphRAG search failed',
                timestamp: Date.now(),
            });
            return [];
        }
    }
    /**
     * Searches cognitive memory for relevant traces.
     *
     * @param query - The search query.
     * @param plan - The retrieval plan (for memory type filtering).
     * @param diagnostics - Diagnostics accumulator.
     * @returns Retrieved chunks from memory.
     */
    async searchMemory(query, plan, diagnostics) {
        const start = Date.now();
        const result = await this.deps.memoryManager.retrieve(query, this.defaultMood, {
            types: plan.memoryTypes,
            topK: 5,
        });
        const chunks = result.retrieved.map(trace => ({
            id: trace.id,
            content: trace.content,
            heading: `Memory (${trace.type})`,
            sourcePath: `memory://${trace.type}`,
            relevanceScore: trace.retrievalScore,
            matchType: 'vector',
        }));
        diagnostics.memory = { chunkCount: chunks.length, durationMs: Date.now() - start };
        return chunks;
    }
    /**
     * Searches the multimodal index for non-text content.
     *
     * @param query - The search query.
     * @param plan - The retrieval plan (for modality filtering).
     * @param diagnostics - Diagnostics accumulator.
     * @returns Retrieved chunks from multimodal search.
     */
    async searchMultimodal(query, plan, diagnostics) {
        const start = Date.now();
        const nonTextModalities = plan.modalities.filter(m => m !== 'text');
        const results = await this.deps.multimodalIndexer.search(query, {
            modalities: nonTextModalities,
            topK: 5,
        });
        const chunks = results.map(r => ({
            id: r.id,
            content: r.content,
            heading: `${r.modality} content`,
            sourcePath: `multimodal://${r.modality}`,
            relevanceScore: r.score,
            matchType: 'vector',
        }));
        diagnostics.multimodal = { chunkCount: chunks.length, durationMs: Date.now() - start };
        return chunks;
    }
    /**
     * Generates HyDE hypotheses and searches with each hypothesis embedding.
     *
     * @param query - The search query.
     * @param plan - The retrieval plan (for hypothesis count).
     * @param diagnostics - Diagnostics accumulator.
     * @returns Retrieved chunks from HyDE search.
     */
    async searchHyde(query, plan, diagnostics) {
        const start = Date.now();
        const retriever = this.deps.hydeRetriever;
        const collectionName = this.deps.collectionName ?? 'knowledge-base';
        // Use multi-hypothesis retrieval when count > 1
        if (plan.hyde.hypothesisCount > 1) {
            // We need a vector store to use HyDE's retrieveMulti.
            // Since hybridSearcher wraps the vector store, we generate hypotheses
            // and search with each one individually.
            const { hypotheses } = await retriever.generateMultipleHypotheses(query, plan.hyde.hypothesisCount);
            // For each hypothesis, do a hybrid search and merge
            const allChunks = [];
            for (const hypothesis of hypotheses) {
                if (this.deps.hybridSearcher) {
                    const results = await this.deps.hybridSearcher.search(hypothesis, collectionName, 5);
                    for (const r of results) {
                        allChunks.push({
                            id: r.id,
                            content: r.textContent ?? '',
                            heading: r.metadata?.heading ?? '',
                            sourcePath: r.metadata?.sourcePath ?? '',
                            relevanceScore: r.score,
                            matchType: 'vector',
                        });
                    }
                }
                else if (this.deps.vectorSearch) {
                    const chunks = await this.deps.vectorSearch(hypothesis, 5);
                    allChunks.push(...chunks);
                }
            }
            // Deduplicate by ID, keeping highest score
            const deduped = this.deduplicateChunks(allChunks);
            diagnostics.hyde = {
                chunkCount: deduped.length,
                durationMs: Date.now() - start,
                hypothesisCount: hypotheses.length,
            };
            return deduped;
        }
        // Single hypothesis path
        const { hypothesis } = await retriever.generateHypothesis(query);
        let chunks = [];
        if (this.deps.hybridSearcher) {
            const results = await this.deps.hybridSearcher.search(hypothesis, collectionName, 10);
            chunks = results.map((r) => ({
                id: r.id,
                content: r.textContent ?? '',
                heading: r.metadata?.heading ?? '',
                sourcePath: r.metadata?.sourcePath ?? '',
                relevanceScore: r.score,
                matchType: 'vector',
            }));
        }
        else if (this.deps.vectorSearch) {
            chunks = await this.deps.vectorSearch(hypothesis, 10);
        }
        diagnostics.hyde = {
            chunkCount: chunks.length,
            durationMs: Date.now() - start,
            hypothesisCount: 1,
        };
        return chunks;
    }
    // --------------------------------------------------------------------------
    // PHASE 3: RRF Merge
    // --------------------------------------------------------------------------
    /**
     * Merges results from multiple sources using Reciprocal Rank Fusion (RRF).
     *
     * RRF formula (Cormack et al. 2009):
     * ```
     * score(d) = sum_{i} 1 / (k + rank_i(d))
     * ```
     * where k is the RRF constant (default 60) and rank_i(d) is the 1-based
     * rank of document d in source i's result list.
     *
     * Documents appearing in multiple sources naturally receive higher fused
     * scores, boosting documents that are relevant across different retrieval
     * methods.
     *
     * @param sourceResults - Map of source name to ranked chunk lists.
     * @param plan - The retrieval plan (unused currently, reserved for future weighting).
     * @returns Merged chunks with fused RRF scores, sorted descending.
     */
    rrfMerge(sourceResults, plan) {
        const k = this.rrfK;
        const scoreMap = new Map();
        for (const [_source, chunks] of sourceResults) {
            for (let rank = 0; rank < chunks.length; rank++) {
                const chunk = chunks[rank];
                const rrfScore = 1 / (k + rank + 1);
                const existing = scoreMap.get(chunk.id);
                if (existing) {
                    existing.score += rrfScore;
                    // Keep the chunk with more content
                    if (chunk.content.length > existing.chunk.content.length) {
                        existing.chunk = { ...chunk, relevanceScore: existing.score };
                    }
                    else {
                        existing.chunk = { ...existing.chunk, relevanceScore: existing.score };
                    }
                }
                else {
                    scoreMap.set(chunk.id, {
                        chunk: { ...chunk, relevanceScore: rrfScore },
                        score: rrfScore,
                    });
                }
            }
        }
        // Sort by fused score descending
        return Array.from(scoreMap.values())
            .sort((a, b) => b.score - a.score)
            .map(entry => ({ ...entry.chunk, relevanceScore: entry.score }));
    }
    // --------------------------------------------------------------------------
    // PHASE 4: Temporal Boosting
    // --------------------------------------------------------------------------
    /**
     * Applies exponential decay temporal boosting to results.
     *
     * Recent results receive a multiplicative boost based on their age.
     * The boost decays exponentially: `boost = exp(-age / maxAgeMs) * recencyBoost`.
     *
     * Also filters out results older than `maxAgeMs` when set.
     *
     * @param chunks - Chunks to boost.
     * @param plan - The retrieval plan with temporal configuration.
     * @returns Chunks with adjusted relevance scores.
     */
    applyTemporalBoosting(chunks, plan) {
        const now = Date.now();
        const maxAge = plan.temporal.maxAgeMs;
        const boostFactor = plan.temporal.recencyBoost;
        return chunks
            .filter(chunk => {
            if (maxAge === null)
                return true;
            const timestamp = chunk.metadata?.timestamp ?? 0;
            return timestamp === 0 || (now - timestamp) <= maxAge;
        })
            .map(chunk => {
            const timestamp = chunk.metadata?.timestamp ?? 0;
            if (timestamp === 0 || maxAge === null)
                return chunk;
            const age = now - timestamp;
            const decay = Math.exp(-age / maxAge);
            const boost = decay * boostFactor;
            return {
                ...chunk,
                relevanceScore: chunk.relevanceScore * (1 + boost),
            };
        });
    }
    // --------------------------------------------------------------------------
    // PHASE 6: Deep Research
    // --------------------------------------------------------------------------
    /**
     * Executes deep research by decomposing the query into sub-queries and
     * recursing with moderate-level plans.
     *
     * @param query - The original query.
     * @param plan - The retrieval plan.
     * @param existingChunks - Chunks already gathered from other sources.
     * @param diagnostics - Diagnostics accumulator.
     * @returns Research synthesis and additional chunks, or null if research failed.
     */
    async executeDeepResearch(query, plan, existingChunks, diagnostics) {
        const start = Date.now();
        const allChunks = [];
        let synthesis;
        // Sub-query decomposition and recursive retrieval
        if (this.deps.decompose) {
            try {
                const subQueries = await this.deps.decompose(query, this.maxSubQueries);
                this.emitEvent({
                    type: 'unified:decompose',
                    subQueries,
                    timestamp: Date.now(),
                });
                // Recurse with moderate plans for each sub-query (no further decomposition)
                for (const subQuery of subQueries) {
                    const subPlan = {
                        ...plan,
                        strategy: 'moderate',
                        deepResearch: false,
                        hyde: { enabled: plan.hyde.enabled, hypothesisCount: 1 },
                    };
                    const subResult = await this.retrieve(subQuery, subPlan, 5);
                    allChunks.push(...subResult.chunks);
                }
            }
            catch {
                // Decomposition failed — skip sub-query recursion
            }
        }
        // Deep research synthesis pass
        if (this.deps.deepResearch) {
            try {
                const researchResult = await this.deps.deepResearch(query, ['docs', 'web']);
                allChunks.push(...researchResult.sources);
                synthesis = researchResult.synthesis;
            }
            catch {
                // Research failed — continue with whatever we have
            }
        }
        diagnostics.research = { chunkCount: allChunks.length, durationMs: Date.now() - start };
        if (allChunks.length === 0 && !synthesis) {
            return null;
        }
        return {
            chunks: this.deduplicateChunks(allChunks),
            synthesis: synthesis ?? '',
        };
    }
    // --------------------------------------------------------------------------
    // PHASE 7: Memory Feedback
    // --------------------------------------------------------------------------
    /**
     * Stores the retrieval event as an episodic memory trace and strengthens
     * memory traces for top-retrieved content (Hebbian learning).
     *
     * This creates a feedback loop where frequently retrieved information
     * becomes easier to retrieve in the future, similar to how biological
     * memory consolidation strengthens neural pathways through repeated access.
     *
     * @param query - The original query.
     * @param chunks - The final reranked chunks.
     * @param plan - The retrieval plan.
     */
    async storeMemoryFeedback(query, chunks, plan) {
        if (!this.deps.memoryManager || !plan.sources.memory) {
            return;
        }
        try {
            // Store the retrieval event as an episodic memory
            const topContent = chunks[0]?.content?.slice(0, 200) ?? 'No results';
            await this.deps.memoryManager.encode(`Retrieved ${chunks.length} results for: "${query}". Top result: "${topContent}"`, this.defaultMood, 'neutral', {
                type: 'episodic',
                sourceType: 'reflection',
                tags: ['retrieval', 'unified-retriever'],
            });
            // Strengthen memory traces for retrieved content (Hebbian learning)
            const store = this.deps.memoryManager.getStore();
            if (store) {
                for (const chunk of chunks.slice(0, 3)) {
                    if (chunk.id.startsWith('mt_')) {
                        // This is a memory trace ID — record access to strengthen it
                        await store.recordAccess(chunk.id);
                    }
                }
            }
            this.emitEvent({
                type: 'unified:memory-feedback',
                tracesStored: 1,
                timestamp: Date.now(),
            });
        }
        catch {
            // Memory feedback is non-critical — never fail the retrieval
        }
    }
    // --------------------------------------------------------------------------
    // Utilities
    // --------------------------------------------------------------------------
    /**
     * Deduplicates chunks by ID, keeping the one with the highest relevance score.
     *
     * @param chunks - Chunks to deduplicate.
     * @returns Deduplicated chunks.
     */
    deduplicateChunks(chunks) {
        const seen = new Map();
        for (const chunk of chunks) {
            const existing = seen.get(chunk.id);
            if (!existing || chunk.relevanceScore > existing.relevanceScore) {
                seen.set(chunk.id, chunk);
            }
        }
        return Array.from(seen.values());
    }
    /**
     * Merges two chunk arrays, deduplicating by ID.
     *
     * @param primary - Primary chunk array.
     * @param secondary - Secondary chunk array.
     * @returns Merged, deduplicated array.
     */
    mergeChunks(primary, secondary) {
        return this.deduplicateChunks([...primary, ...secondary]);
    }
    /**
     * Emits a typed UnifiedRetriever event.
     *
     * Routes to both the injected deps.emit callback and the Node.js
     * EventEmitter for maximum flexibility.
     *
     * @param event - The event to emit.
     */
    emitEvent(event) {
        if (this.deps.emit) {
            this.deps.emit(event);
        }
        this.emit(event.type, event);
    }
    /**
     * Creates an empty diagnostics object.
     *
     * @returns Fresh diagnostics with all counters at zero.
     */
    emptyDiagnostics() {
        return {
            hybrid: { chunkCount: 0, durationMs: 0 },
            raptor: { chunkCount: 0, durationMs: 0 },
            graph: { chunkCount: 0, durationMs: 0 },
            memory: { chunkCount: 0, durationMs: 0 },
            multimodal: { chunkCount: 0, durationMs: 0 },
            hyde: { chunkCount: 0, durationMs: 0, hypothesisCount: 0 },
            rerank: { inputCount: 0, outputCount: 0, durationMs: 0 },
            research: { chunkCount: 0, durationMs: 0 },
        };
    }
    /**
     * Builds an empty result for the 'none' strategy.
     *
     * @param plan - The retrieval plan.
     * @param startTime - Pipeline start timestamp.
     * @returns Empty unified retrieval result.
     */
    buildEmptyResult(plan, startTime) {
        const result = {
            chunks: [],
            plan,
            sourceDiagnostics: this.emptyDiagnostics(),
            durationMs: Date.now() - startTime,
            memoryCacheHit: false,
        };
        this.emitEvent({ type: 'unified:complete', result, timestamp: Date.now() });
        return result;
    }
    /**
     * Builds the final unified retrieval result.
     *
     * @param chunks - The final merged, reranked chunks.
     * @param plan - The retrieval plan that was executed.
     * @param diagnostics - Per-source diagnostics.
     * @param startTime - Pipeline start timestamp.
     * @param memoryCacheHit - Whether a memory cache hit was used.
     * @param researchSynthesis - Optional deep research synthesis.
     * @returns Complete unified retrieval result.
     */
    buildResult(chunks, plan, diagnostics, startTime, memoryCacheHit, researchSynthesis) {
        const result = {
            chunks,
            plan,
            sourceDiagnostics: diagnostics,
            durationMs: Date.now() - startTime,
            memoryCacheHit,
            ...(researchSynthesis ? { researchSynthesis } : {}),
        };
        this.emitEvent({ type: 'unified:complete', result, timestamp: Date.now() });
        return result;
    }
}
//# sourceMappingURL=UnifiedRetriever.js.map