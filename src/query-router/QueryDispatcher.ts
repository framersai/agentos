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

import {
  STRATEGY_TO_TIER,
} from './types.js';
import type {
  QueryTier,
  RetrievalStrategy,
  RetrievedChunk,
  RetrievalResult,
  QueryRouterEventUnion,
} from './types.js';

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

  /**
   * Maximum number of sub-queries for decomposition.
   * Only relevant for the `complex` strategy.
   * @default 5
   */
  maxSubQueries?: number;
}

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
  /** Injected retrieval dependencies. */
  private readonly deps: QueryDispatcherDeps;

  constructor(deps: QueryDispatcherDeps) {
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
   * @param suggestedSources - Optional source hints for deep research (complex).
   * @returns Aggregated retrieval result with chunks, optional synthesis,
   *          and timing metadata.
   */
  async dispatchByStrategy(
    query: string,
    strategy: RetrievalStrategy,
    suggestedSources?: string[],
  ): Promise<RetrievalResult> {
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
        return this.dispatchComplex(query, suggestedSources ?? ['web'], start);

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
  // STRATEGY PIPELINES (new — HyDE-aware)
  // --------------------------------------------------------------------------

  /**
   * Simple strategy pipeline: direct vector search only, topK=5.
   *
   * No HyDE hypothesis generation, no graph traversal, no reranking.
   * Best for concrete queries with vocabulary that matches stored docs.
   */
  private async dispatchSimple(query: string, start: number): Promise<RetrievalResult> {
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
   * Moderate strategy pipeline: HyDE-powered search + optional graph + rerank.
   *
   * Generates a hypothetical answer, embeds *that* for vector search, then
   * optionally expands via graph traversal and reranks. Falls back to direct
   * vector search if HyDE is unavailable.
   */
  private async dispatchModerate(query: string, start: number): Promise<RetrievalResult> {
    // --- HyDE search (topK=15 for graph+rerank pipeline) ---
    const hydeStart = Date.now();
    let hydeChunks: RetrievedChunk[];

    if (this.deps.hydeSearch) {
      try {
        hydeChunks = await this.deps.hydeSearch(query, 15);
      } catch (err) {
        // HyDE failed — fall back to direct vector search
        this.deps.emit({
          type: 'retrieve:fallback',
          strategy: 'hyde-to-vector',
          reason: `HyDE search failed: ${(err as Error).message}`,
          timestamp: Date.now(),
        });
        hydeChunks = await this.deps.vectorSearch(query, 15);
      }
    } else {
      // HyDE not available — use direct vector search
      this.deps.emit({
        type: 'retrieve:fallback',
        strategy: 'hyde-unavailable',
        reason: 'HyDE search not configured; using direct vector search',
        timestamp: Date.now(),
      });
      hydeChunks = await this.deps.vectorSearch(query, 15);
    }

    const hydeDuration = Date.now() - hydeStart;

    this.deps.emit({
      type: 'retrieve:vector',
      chunkCount: hydeChunks.length,
      durationMs: hydeDuration,
      timestamp: Date.now(),
    });

    // --- Graph expansion (fallback-safe) ---
    let graphChunks: RetrievedChunk[] = [];

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
      } catch (err) {
        this.deps.emit({
          type: 'retrieve:fallback',
          strategy: 'graph-skip',
          reason: `Graph expansion failed: ${(err as Error).message}`,
          timestamp: Date.now(),
        });
      }
    }

    // --- Merge + deduplicate ---
    const merged = this.mergeAndDedup(hydeChunks, graphChunks);

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
   * Complex strategy pipeline: decompose → HyDE per sub-query → merge → rank.
   *
   * For multi-part queries, decomposes into independent sub-queries, runs
   * HyDE search per sub-query, deduplicates and ranks the combined results.
   * Falls back to moderate (single HyDE pass) if decomposition fails.
   *
   * When deep research is enabled, a research synthesis pass runs after the
   * merged retrieval stage (inheriting from the T3 pipeline).
   */
  private async dispatchComplex(
    query: string,
    suggestedSources: string[],
    start: number,
  ): Promise<RetrievalResult> {
    const maxSubQueries = this.deps.maxSubQueries ?? 5;

    // --- Step 1: Decompose the query into sub-queries ---
    let subQueries: string[];
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
      } catch (err) {
        // Decomposition failed — fall through to single-pass HyDE
        this.deps.emit({
          type: 'retrieve:fallback',
          strategy: 'decompose-skip',
          reason: `Query decomposition failed: ${(err as Error).message}`,
          timestamp: Date.now(),
        });
        subQueries = [query];
      }
    } else {
      // No decomposer available — use the original query as-is
      subQueries = [query];
    }

    // --- Step 2: HyDE search per sub-query ---
    const allChunks: RetrievedChunk[] = [];
    const searchFn = this.deps.hydeSearch ?? this.deps.vectorSearch;

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
      } catch (err) {
        // Sub-query search failed — try direct vector search as fallback
        this.deps.emit({
          type: 'retrieve:fallback',
          strategy: 'sub-query-fallback',
          reason: `Sub-query search failed for "${subQuery.slice(0, 60)}": ${(err as Error).message}`,
          timestamp: Date.now(),
        });

        try {
          const fallbackChunks = await this.deps.vectorSearch(subQuery, 10);
          allChunks.push(...fallbackChunks);
        } catch {
          // Both failed — skip this sub-query
        }
      }
    }

    // --- Step 2b: Optional graph expansion (same as moderate pipeline) ---
    let graphChunks: RetrievedChunk[] = [];
    if (this.deps.graphEnabled) {
      try {
        graphChunks = await this.deps.graphExpand(allChunks);
        this.deps.emit({
          type: 'retrieve:graph',
          seedCount: allChunks.length,
          expandedCount: graphChunks.length,
          durationMs: 0,
          timestamp: Date.now(),
        });
      } catch (err) {
        this.deps.emit({
          type: 'retrieve:fallback',
          strategy: 'graph-skip',
          reason: `Graph expansion failed in complex pipeline: ${(err as Error).message}`,
          timestamp: Date.now(),
        });
      }
    }

    // --- Step 3: Deduplicate and rank ---
    const deduped = this.mergeAndDedup(allChunks, graphChunks);
    let finalChunks: RetrievedChunk[];

    // Rerank the merged results against the original query
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
    } catch (err) {
      finalChunks = [...deduped]
        .sort((a, b) => b.relevanceScore - a.relevanceScore)
        .slice(0, 10);

      this.deps.emit({
        type: 'retrieve:fallback',
        strategy: 'rerank-skip',
        reason: `Rerank failed: ${(err as Error).message}`,
        timestamp: Date.now(),
      });
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

        const result: RetrievalResult = {
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
      } catch (err) {
        this.deps.emit({
          type: 'retrieve:fallback',
          strategy: 'research-skip',
          reason: `Deep research failed: ${(err as Error).message}`,
          timestamp: Date.now(),
        });
      }
    }

    // Return merged HyDE results without research
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

  // --------------------------------------------------------------------------
  // TIER PIPELINES (legacy)
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
    return this.dispatchTier2Internal(query, start, true);
  }

  /**
   * Internal Tier 2 pipeline used by both direct T2 routing and the T3
   * pre-research retrieval stage. T3 suppresses the early retrieve:complete
   * event so the final completion event reflects the post-research result.
   */
  private async dispatchTier2Internal(
    query: string,
    start: number,
    emitComplete: boolean,
  ): Promise<RetrievalResult> {
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
  private async dispatchTier3(
    query: string,
    suggestedSources: string[],
    start: number,
  ): Promise<RetrievalResult> {
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

        const result: RetrievalResult = {
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
    const result: RetrievalResult = {
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
