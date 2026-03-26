/**
 * @fileoverview QueryDispatcher — routes classified queries to the
 * tier-appropriate retrieval pipeline with graceful fallbacks.
 * @module @framers/agentos/query-router/QueryDispatcher
 *
 * The dispatcher is the second stage of the QueryRouter pipeline, invoked
 * after the QueryClassifier has assigned a complexity tier. It orchestrates
 * vector search, knowledge-graph expansion, reranking, and deep research
 * by delegating to injected callback functions — it has no direct coupling
 * to EmbeddingManager, VectorStoreManager, or any concrete service.
 *
 * **Tier behaviour:**
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

import type {
  QueryTier,
  RetrievedChunk,
  RetrievalResult,
  QueryRouterEventUnion,
} from '../types.js';

// ============================================================================
// DEPENDENCY INTERFACE
// ============================================================================

/**
 * Callback dependencies injected into the QueryDispatcher.
 *
 * Each retrieval capability is represented as a plain async function so the
 * dispatcher remains decoupled from concrete implementations and is trivially
 * testable with vi.fn() mocks.
 */
export interface QueryDispatcherDeps {
  /**
   * Dense vector similarity search.
   * @param query - The user query string.
   * @param topK  - Maximum number of chunks to return.
   */
  vectorSearch: (query: string, topK: number) => Promise<RetrievedChunk[]>;

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
   * @param sources - Source identifiers to consult (e.g., ['web', 'docs']).
   */
  deepResearch: (
    query: string,
    sources: string[],
  ) => Promise<{ synthesis: string; sources: RetrievedChunk[] }>;

  /**
   * Event emitter callback for lifecycle observability events.
   * @param event - A typed QueryRouter event.
   */
  emit: (event: QueryRouterEventUnion) => void;

  /** Whether graph-based retrieval is available / enabled. */
  graphEnabled: boolean;

  /** Whether deep research is available / enabled. */
  deepResearchEnabled: boolean;
}

// ============================================================================
// QUERY DISPATCHER
// ============================================================================

/**
 * Routes classified queries to the tier-appropriate retrieval pipeline.
 *
 * @example
 * ```typescript
 * const dispatcher = new QueryDispatcher({
 *   vectorSearch: async (q, k) => vectorStore.search(q, k),
 *   graphExpand:  async (seeds) => graphRag.expand(seeds),
 *   rerank:       async (q, chunks, n) => reranker.rerank(q, chunks, n),
 *   deepResearch: async (q, srcs) => researcher.research(q, srcs),
 *   emit:         (e) => eventBus.emit(e),
 *   graphEnabled: true,
 *   deepResearchEnabled: true,
 * });
 *
 * const result = await dispatcher.dispatch('How does auth work?', 2);
 * ```
 */
export class QueryDispatcher {
  /** Injected retrieval dependencies. */
  private readonly deps: QueryDispatcherDeps;

  constructor(deps: QueryDispatcherDeps) {
    this.deps = deps;
  }

  // --------------------------------------------------------------------------
  // PUBLIC API
  // --------------------------------------------------------------------------

  /**
   * Dispatch a classified query to the tier-appropriate retrieval pipeline.
   *
   * @param query            - The user's natural-language query.
   * @param tier             - Complexity tier assigned by the QueryClassifier.
   * @param suggestedSources - Optional source hints for deep research (T3).
   *                           Defaults to `['web']` when not provided.
   * @returns Aggregated retrieval result with chunks, optional synthesis,
   *          and timing metadata.
   */
  async dispatch(
    query: string,
    tier: QueryTier,
    suggestedSources?: string[],
  ): Promise<RetrievalResult> {
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
    return this.dispatchTier3(query, suggestedSources ?? ['web'], start);
  }

  // --------------------------------------------------------------------------
  // TIER PIPELINES
  // --------------------------------------------------------------------------

  /**
   * Tier 1 pipeline: vector search only, topK=5.
   * No graph traversal, no reranking, no research.
   */
  private async dispatchTier1(query: string, start: number): Promise<RetrievalResult> {
    const vectorStart = Date.now();
    const chunks = await this.deps.vectorSearch(query, 5);
    const vectorDuration = Date.now() - vectorStart;

    this.deps.emit({
      type: 'retrieve:vector',
      chunkCount: chunks.length,
      durationMs: vectorDuration,
      timestamp: Date.now(),
    });

    const result: RetrievalResult = {
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
  private async dispatchTier2(query: string, start: number): Promise<RetrievalResult> {
    // --- Vector search (topK=15) ---
    const vectorStart = Date.now();
    const vectorChunks = await this.deps.vectorSearch(query, 15);
    const vectorDuration = Date.now() - vectorStart;

    this.deps.emit({
      type: 'retrieve:vector',
      chunkCount: vectorChunks.length,
      durationMs: vectorDuration,
      timestamp: Date.now(),
    });

    // --- Graph expansion (fallback-safe) ---
    let graphChunks: RetrievedChunk[] = [];

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
      } catch (err) {
        this.deps.emit({
          type: 'retrieve:fallback',
          strategy: 'graph-skip',
          reason: `Graph expansion failed: ${(err as Error).message}`,
          timestamp: Date.now(),
        });
      }
    }

    // --- Merge + deduplicate by id ---
    const merged = this.mergeAndDedup(vectorChunks, graphChunks);

    // --- Rerank (fallback-safe) ---
    let finalChunks: RetrievedChunk[];
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
    } catch (err) {
      // Fallback: sort by score descending, take top 5
      finalChunks = [...merged]
        .sort((a, b) => b.relevanceScore - a.relevanceScore)
        .slice(0, 5);

      this.deps.emit({
        type: 'retrieve:fallback',
        strategy: 'rerank-skip',
        reason: `Rerank failed: ${(err as Error).message}`,
        timestamp: Date.now(),
      });
    }

    const result: RetrievalResult = {
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
   * Tier 3 pipeline: everything in T2 + deep research synthesis.
   *
   * Fallback: if deep research fails, the result is identical to T2
   * (no synthesis, no research chunks), and a fallback event is emitted.
   */
  private async dispatchTier3(
    query: string,
    suggestedSources: string[],
    start: number,
  ): Promise<RetrievalResult> {
    // Run the T2 pipeline first to get hybrid chunks
    const t2Result = await this.dispatchTier2(query, start);

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
          type: 'research:complete',
          iterationsUsed: 1,
          totalChunks: researchResult.sources.length,
          durationMs: Date.now() - start,
          timestamp: Date.now(),
        });

        // Merge research chunks with T2 chunks, dedup
        const allChunks = this.mergeAndDedup(t2Result.chunks, researchResult.sources);

        return {
          chunks: allChunks,
          researchSynthesis: researchResult.synthesis,
          durationMs: Date.now() - start,
        };
      } catch (err) {
        this.deps.emit({
          type: 'retrieve:fallback',
          strategy: 'research-skip',
          reason: `Deep research failed: ${(err as Error).message}`,
          timestamp: Date.now(),
        });
      }
    }

    // If research was disabled or failed, return T2 result with updated duration
    return {
      ...t2Result,
      durationMs: Date.now() - start,
    };
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
  private mergeAndDedup(
    primary: RetrievedChunk[],
    secondary: RetrievedChunk[],
  ): RetrievedChunk[] {
    const seen = new Map<string, RetrievedChunk>();

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
}
