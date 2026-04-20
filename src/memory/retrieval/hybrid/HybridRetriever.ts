/**
 * @file HybridRetriever.ts
 * @description Hybrid BM25 + dense retrieval for memory-domain traces.
 * Dense side uses {@link MemoryStore} (preserves 6-signal cognitive
 * scoring). Sparse side uses a per-instance {@link BM25Index}. RRF
 * merges by rank. Optional {@link RerankerService} runs over the
 * merged pool.
 *
 * ## What this does
 *
 * Given a query, runs dense retrieval through `MemoryStore.query`
 * (cognitive-scored traces) and sparse retrieval through an owned
 * `BM25Index` (keyword-matched trace content). Fuses the two ranked
 * lists via Reciprocal Rank Fusion, optionally reranks the merged
 * pool with a neural cross-encoder, and returns a standard
 * `CognitiveRetrievalResult` so downstream consumers (prompt
 * assembly, bench adapters) don't change shape.
 *
 * ## Why a separate class, not a `CognitiveMemoryManager` option
 *
 * Keeps the existing manager retrieval path untouched (same reason
 * as SessionRetriever in Step 2). MVP ships as opt-in.
 *
 * ## Rerank integration is mandatory-wired from the bench
 *
 * Per the Step 2 post-mortem (rerank-skip was the root cause of
 * that step's RED verdict), Step 3 threads rerank from day 1 when
 * the bench is configured with `--rerank cohere`. Callers outside
 * the bench can pass `undefined` for `rerankerService` to skip
 * rerank explicitly.
 *
 * ## Sparse-only documents are skipped in MVP
 *
 * A document that appears in `bm25.search` results but NOT in the
 * dense over-fetch pool is skipped. Rationale: at the default
 * over-fetch=3 and K=10 (30 dense candidates), a doc ranked top-30
 * on sparse is very likely in dense's top-30 on any coherent query.
 * Measured impact is expected to be negligible. If Tier A surfaces
 * a meaningful drop rate, the fix is to add a
 * `memoryStore.getTrace(id)` hydration path.
 *
 * @module agentos/memory/retrieval/hybrid/HybridRetriever
 */

import { BM25Index, type BM25Config } from '../../../rag/search/BM25Index.js';
import { reciprocalRankFusion, type RankedDoc } from './reciprocalRankFusion.js';
import type { MemoryStore } from '../store/MemoryStore.js';
import type { RerankerService } from '../../../rag/reranking/RerankerService.js';
import type {
  CognitiveRetrievalResult,
  MemoryScope,
  ScoredMemoryTrace,
} from '../../core/types.js';
import type { PADState } from '../../core/config.js';

/**
 * Options for constructing a {@link HybridRetriever}.
 */
export interface HybridRetrieverOptions {
  memoryStore: MemoryStore;
  /** BM25 config (k1, b, optional tokenizer). Defaults match BM25Index. */
  bm25Config?: BM25Config;
  /**
   * Optional neural reranker. When provided, the merged pool is
   * reranked before truncation. Passing the same reranker the
   * baseline uses is the matched-ablation path.
   */
  rerankerService?: RerankerService;
  /** Default dense weight in RRF. @default 0.7 */
  defaultDenseWeight?: number;
  /** Default sparse weight in RRF. @default 0.3 */
  defaultSparseWeight?: number;
  /** Default RRF constant. @default 60 */
  defaultRrfK?: number;
}

/**
 * Per-call options for {@link HybridRetriever.retrieve}.
 */
export interface HybridRetrieveOptions {
  /** Final truncation after merge + rerank. @default 10 */
  recallTopK?: number;
  /** Over-fetch multiplier for each side before merge. @default 3 */
  overFetchMultiplier?: number;
  denseWeight?: number;
  sparseWeight?: number;
  rrfK?: number;
}

/**
 * Hybrid BM25 + dense retriever.
 *
 * @example
 * ```ts
 * const hybrid = new HybridRetriever({ memoryStore, rerankerService });
 * // At ingest:
 * hybrid.bm25.addDocument(trace.id, trace.content, { tag: 'bench-session:s-1' });
 * // At query time:
 * const result = await hybrid.retrieve(
 *   'What did the user say about their mortgage?',
 *   { valence: 0, arousal: 0, dominance: 0 },
 *   { scope: 'user', scopeId: 'u1' },
 *   { recallTopK: 10 },
 * );
 * ```
 */
export class HybridRetriever {
  readonly bm25: BM25Index;

  private readonly memoryStore: MemoryStore;
  private readonly rerankerService?: RerankerService;
  private readonly defaultDenseWeight: number;
  private readonly defaultSparseWeight: number;
  private readonly defaultRrfK: number;

  constructor(opts: HybridRetrieverOptions) {
    this.memoryStore = opts.memoryStore;
    this.bm25 = new BM25Index(opts.bm25Config);
    this.rerankerService = opts.rerankerService;
    this.defaultDenseWeight = opts.defaultDenseWeight ?? 0.7;
    this.defaultSparseWeight = opts.defaultSparseWeight ?? 0.3;
    this.defaultRrfK = opts.defaultRrfK ?? 60;
  }

  async retrieve(
    query: string,
    mood: PADState,
    scope: { scope: MemoryScope; scopeId: string },
    options: HybridRetrieveOptions = {},
  ): Promise<CognitiveRetrievalResult> {
    const startTime = Date.now();
    const recallTopK = options.recallTopK ?? 10;
    const overFetchMultiplier = options.overFetchMultiplier ?? 3;
    const overFetchTopK = recallTopK * overFetchMultiplier;
    const wDense = options.denseWeight ?? this.defaultDenseWeight;
    const wSparse = options.sparseWeight ?? this.defaultSparseWeight;
    const rrfK = options.rrfK ?? this.defaultRrfK;

    // Dense side: use MemoryStore.query so we keep the 6-signal
    // cognitive scoring (strength, recency, etc.) — matches baseline.
    const { scored: denseScored, timings: denseTimings } = await this.memoryStore.query(
      query,
      mood,
      { topK: overFetchTopK, scopes: [scope] },
    );

    // Sparse side: BM25 over the per-instance index.
    const sparseResults = this.bm25.search(query, overFetchTopK);

    // Fallback: empty BM25 index or zero sparse hits => dense-only
    // with explicit escalation diagnostic.
    if (sparseResults.length === 0) {
      return this.buildResult(denseScored.slice(0, recallTopK), {
        escalations: ['hybrid-retriever:sparse-empty'],
        candidatesScanned: denseScored.length,
        vectorSearchMs: denseTimings.vectorSearchMs,
        scoringMs: denseTimings.scoringMs,
        totalMs: Date.now() - startTime,
      });
    }

    // Build 1-based ranked lists for RRF.
    const denseRanked: RankedDoc[] = denseScored.map((t, i) => ({ id: t.id, rank: i + 1 }));
    const sparseRanked: RankedDoc[] = sparseResults.map((r, i) => ({ id: r.id, rank: i + 1 }));
    const merged = reciprocalRankFusion(denseRanked, sparseRanked, {
      denseWeight: wDense,
      sparseWeight: wSparse,
      k: rrfK,
    });

    // Hydrate: resolve each RRFResult.id to the ScoredMemoryTrace from
    // the dense side. Skip sparse-only docs (see file docstring).
    const denseById = new Map(denseScored.map((t) => [t.id, t]));
    const hydrated: ScoredMemoryTrace[] = [];
    for (const m of merged) {
      const trace = denseById.get(m.id);
      if (trace) {
        hydrated.push(trace);
      }
      // MVP: sparse-only docs (not in denseById) are skipped.
    }

    // Optional rerank: same 0.7 cognitive + 0.3 neural blend as baseline.
    if (this.rerankerService && hydrated.length > 0) {
      try {
        const rerankerOutput = await this.rerankerService.rerank(
          {
            query,
            documents: hydrated.map((t) => ({
              id: t.id,
              content: t.content,
              originalScore: t.retrievalScore,
            })),
          },
          { topN: hydrated.length },
        );
        const neuralScores = new Map(
          rerankerOutput.results.map((r) => [r.id, r.relevanceScore]),
        );
        for (const trace of hydrated) {
          const neural = neuralScores.get(trace.id);
          if (neural !== undefined) {
            trace.retrievalScore = 0.7 * trace.retrievalScore + 0.3 * neural;
          }
        }
        hydrated.sort((a, b) => b.retrievalScore - a.retrievalScore);
      } catch {
        // Reranker errors are non-critical: keep RRF ordering.
      }
    }

    // Truncate to recallTopK.
    const truncated = hydrated.slice(0, recallTopK);
    return this.buildResult(truncated, {
      candidatesScanned: denseScored.length + sparseResults.length,
      vectorSearchMs: denseTimings.vectorSearchMs,
      scoringMs: denseTimings.scoringMs,
      totalMs: Date.now() - startTime,
    });
  }

  /** Assemble the CognitiveRetrievalResult shape. */
  private buildResult(
    retrieved: ScoredMemoryTrace[],
    d: {
      escalations?: string[];
      candidatesScanned: number;
      vectorSearchMs: number;
      scoringMs: number;
      totalMs: number;
    },
  ): CognitiveRetrievalResult {
    return {
      retrieved,
      partiallyRetrieved: [],
      diagnostics: {
        candidatesScanned: d.candidatesScanned,
        vectorSearchTimeMs: d.vectorSearchMs,
        scoringTimeMs: d.scoringMs,
        totalTimeMs: d.totalMs,
        ...(d.escalations ? { escalations: d.escalations } : {}),
      },
    };
  }
}
