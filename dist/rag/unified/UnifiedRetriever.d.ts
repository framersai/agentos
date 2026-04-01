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
import type { RetrievalPlan, UnifiedRetrievalResult, UnifiedRetrieverEvent } from './types.js';
import type { RetrievedChunk } from '../../query-router/types.js';
import type { HybridSearcher } from '../search/HybridSearcher.js';
import type { RaptorTree } from '../raptor/RaptorTree.js';
import type { HydeRetriever } from '../HydeRetriever.js';
import type { ICognitiveMemoryManager } from '../../memory/CognitiveMemoryManager.js';
import type { MultimodalIndexer } from '../multimodal/MultimodalIndexer.js';
import type { IGraphRAGEngine } from '../../memory/retrieval/graph/graphrag/IGraphRAG.js';
/**
 * Dependencies injected into the {@link UnifiedRetriever}.
 *
 * All dependencies are optional — the retriever gracefully skips sources
 * whose dependencies are not provided. This allows incremental adoption:
 * start with just vector + BM25, then add GraphRAG, RAPTOR, memory, etc.
 *
 * @example
 * ```typescript
 * const deps: UnifiedRetrieverDeps = {
 *   hybridSearcher: myHybridSearcher,
 *   rerank: async (q, chunks, n) => chunks.slice(0, n),
 *   emit: (event) => console.log(event.type),
 * };
 * ```
 */
export interface UnifiedRetrieverDeps {
    /**
     * Hybrid dense+sparse searcher (vector + BM25).
     * When provided, enables the `vector` and `bm25` sources.
     */
    hybridSearcher?: HybridSearcher;
    /**
     * Vector store collection name for hybrid search.
     * @default 'knowledge-base'
     */
    collectionName?: string;
    /**
     * RAPTOR hierarchical summary tree.
     * When provided, enables the `raptor` source.
     */
    raptorTree?: RaptorTree;
    /**
     * GraphRAG engine for entity/relationship traversal.
     * When provided, enables the `graph` source.
     */
    graphEngine?: IGraphRAGEngine;
    /**
     * Cognitive memory manager.
     * When provided, enables the `memory` source and memory feedback loop.
     */
    memoryManager?: ICognitiveMemoryManager;
    /**
     * HyDE (Hypothetical Document Embedding) retriever.
     * When provided and plan.hyde.enabled is true, generates hypothetical
     * answers before embedding for improved recall.
     */
    hydeRetriever?: HydeRetriever;
    /**
     * Multimodal indexer for image/audio/video search.
     * When provided, enables the `multimodal` source.
     */
    multimodalIndexer?: MultimodalIndexer;
    /**
     * Vector search function (fallback when hybridSearcher is not available).
     *
     * @param query - The search query.
     * @param topK - Maximum results to return.
     * @returns Retrieved chunks.
     */
    vectorSearch?: (query: string, topK: number) => Promise<RetrievedChunk[]>;
    /**
     * Cross-encoder or LLM-based reranker.
     *
     * @param query - The user query for relevance scoring.
     * @param chunks - Candidate chunks to rerank.
     * @param topN - Maximum chunks to keep after reranking.
     * @returns Reranked chunks.
     */
    rerank?: (query: string, chunks: RetrievedChunk[], topN: number) => Promise<RetrievedChunk[]>;
    /**
     * Deep research synthesis callback.
     *
     * @param query - The user query.
     * @param sources - Source hints for research.
     * @returns Synthesis narrative and source chunks.
     */
    deepResearch?: (query: string, sources: string[]) => Promise<{
        synthesis: string;
        sources: RetrievedChunk[];
    }>;
    /**
     * Query decomposition callback for complex strategies.
     *
     * @param query - The original multi-part query.
     * @param maxSubQueries - Maximum sub-queries to generate.
     * @returns Array of decomposed sub-query strings.
     */
    decompose?: (query: string, maxSubQueries: number) => Promise<string[]>;
    /**
     * Event listener callback for retrieval lifecycle events.
     * @param event - A typed UnifiedRetriever event.
     */
    emit?: (event: UnifiedRetrieverEvent) => void;
    /**
     * RRF constant k. Higher values flatten score differences.
     * @default 60
     */
    rrfK?: number;
    /**
     * Default topK for final results.
     * @default 10
     */
    defaultTopK?: number;
    /**
     * Maximum sub-queries for complex decomposition.
     * @default 5
     */
    maxSubQueries?: number;
    /**
     * Memory cache hit confidence threshold.
     * Episodic memories above this confidence skip external sources.
     * @default 0.85
     */
    memoryCacheThreshold?: number;
    /**
     * Default PAD mood state for memory operations.
     * Used when no mood context is available.
     */
    defaultMood?: {
        valence: number;
        arousal: number;
        dominance: number;
    };
}
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
 * import { UnifiedRetriever } from '../../rag/unified';
 * import { buildDefaultPlan } from '../../rag/unified/types';
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
export declare class UnifiedRetriever extends EventEmitter {
    /** Injected dependencies. */
    private readonly deps;
    /** Resolved RRF constant. */
    private readonly rrfK;
    /** Resolved default topK. */
    private readonly defaultTopK;
    /** Resolved max sub-queries for decomposition. */
    private readonly maxSubQueries;
    /** Memory cache hit confidence threshold. */
    private readonly memoryCacheThreshold;
    /** Default mood for memory operations. */
    private readonly defaultMood;
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
    constructor(deps: UnifiedRetrieverDeps);
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
    retrieve(query: string, plan: RetrievalPlan, topK?: number): Promise<UnifiedRetrievalResult>;
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
    private checkMemoryCache;
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
    private executeSourcesInParallel;
    /**
     * Searches the hybrid dense+sparse index.
     *
     * @param query - The search query.
     * @param diagnostics - Diagnostics accumulator.
     * @returns Retrieved chunks from hybrid search.
     */
    private searchHybrid;
    /**
     * Searches the RAPTOR hierarchical summary tree.
     *
     * @param query - The search query.
     * @param plan - The retrieval plan (for layer filtering).
     * @param diagnostics - Diagnostics accumulator.
     * @returns Retrieved chunks from RAPTOR search.
     */
    private searchRaptor;
    /**
     * Searches the GraphRAG engine using seed chunks from hybrid search.
     *
     * @param query - The search query.
     * @param seedChunks - Seed chunks from hybrid search for entity extraction.
     * @param plan - The retrieval plan (for graph traversal config).
     * @param diagnostics - Diagnostics accumulator.
     * @returns Retrieved chunks from graph search.
     */
    private searchGraph;
    /**
     * Searches cognitive memory for relevant traces.
     *
     * @param query - The search query.
     * @param plan - The retrieval plan (for memory type filtering).
     * @param diagnostics - Diagnostics accumulator.
     * @returns Retrieved chunks from memory.
     */
    private searchMemory;
    /**
     * Searches the multimodal index for non-text content.
     *
     * @param query - The search query.
     * @param plan - The retrieval plan (for modality filtering).
     * @param diagnostics - Diagnostics accumulator.
     * @returns Retrieved chunks from multimodal search.
     */
    private searchMultimodal;
    /**
     * Generates HyDE hypotheses and searches with each hypothesis embedding.
     *
     * @param query - The search query.
     * @param plan - The retrieval plan (for hypothesis count).
     * @param diagnostics - Diagnostics accumulator.
     * @returns Retrieved chunks from HyDE search.
     */
    private searchHyde;
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
    private rrfMerge;
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
    private applyTemporalBoosting;
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
    private executeDeepResearch;
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
    private storeMemoryFeedback;
    /**
     * Deduplicates chunks by ID, keeping the one with the highest relevance score.
     *
     * @param chunks - Chunks to deduplicate.
     * @returns Deduplicated chunks.
     */
    private deduplicateChunks;
    /**
     * Merges two chunk arrays, deduplicating by ID.
     *
     * @param primary - Primary chunk array.
     * @param secondary - Secondary chunk array.
     * @returns Merged, deduplicated array.
     */
    private mergeChunks;
    /**
     * Emits a typed UnifiedRetriever event.
     *
     * Routes to both the injected deps.emit callback and the Node.js
     * EventEmitter for maximum flexibility.
     *
     * @param event - The event to emit.
     */
    private emitEvent;
    /**
     * Creates an empty diagnostics object.
     *
     * @returns Fresh diagnostics with all counters at zero.
     */
    private emptyDiagnostics;
    /**
     * Builds an empty result for the 'none' strategy.
     *
     * @param plan - The retrieval plan.
     * @param startTime - Pipeline start timestamp.
     * @returns Empty unified retrieval result.
     */
    private buildEmptyResult;
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
    private buildResult;
}
//# sourceMappingURL=UnifiedRetriever.d.ts.map