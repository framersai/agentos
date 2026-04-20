/**
 * @file SessionRetriever.ts
 * @description Two-stage hierarchical retriever: select top-K sessions
 * by summary similarity, then return top-M chunks per selected session
 * from the underlying {@link MemoryStore}. Optional rerank pass over
 * the merged pool. Returns a standard `CognitiveRetrievalResult` so
 * downstream consumers (prompt assembly, bench adapters) don't change
 * shape.
 *
 * ## What this does
 *
 * Implements the xMemory (arxiv 2602.02007v3) / TACITREE (EMNLP 2025)
 * hierarchical-retrieval pattern, session-granularity variant: a
 * coverage mechanism that guarantees the reader sees chunks from
 * multiple distinct sessions on multi-session queries. Single-stage
 * retrieval tends to cluster on the single most-relevant session,
 * missing multi-session evidence; this retriever forces diversity by
 * construction.
 *
 * ## Why a separate class, not a `CognitiveMemoryManager` option
 *
 * Keeps the existing manager retrieval path untouched. Step 2 MVP.
 * Future steps may promote session-level retrieval into the manager
 * once it's proven on benchmarks.
 *
 * ## Two-stage flow
 *
 * 1. Stage 1: `summaryStore.querySessions(query, topK=K)` — select
 *    top-K sessions.
 * 2. Stage 2: single `memoryStore.query(query, topK=K*M*OVER_FETCH)` —
 *    over-fetch to ensure chunks from Stage-1 sessions land in the
 *    candidate pool.
 * 3. Post-filter: keep only traces whose `bench-session:<id>` tag
 *    matches a Stage-1 session.
 * 4. Group by session, take top-`chunksPerSession` (M) per session.
 * 5. Optional rerank over the merged pool.
 * 6. Truncate to `recallTopK`.
 *
 * ## Fallbacks
 *
 * - Stage 1 returns zero sessions (cold scope, no summaries indexed):
 *   fall through to `memoryStore.query` and return its top-
 *   `recallTopK` directly. Diagnostics tag
 *   `escalations: ['session-retriever:stage1-empty']`.
 * - Stage 2 post-filter wipes the pool: return the raw Stage-2 top-
 *   `recallTopK` without session filtering. Diagnostics tag
 *   `escalations: ['session-retriever:stage2-empty']`.
 *
 * @module agentos/memory/retrieval/session/SessionRetriever
 */

import type { IEmbeddingManager } from '../../../core/embeddings/IEmbeddingManager.js';
import type { MemoryStore } from '../store/MemoryStore.js';
import type { RerankerService } from '../../../rag/reranking/RerankerService.js';
import type {
  CognitiveRetrievalResult,
  MemoryScope,
  PADState,
  ScoredMemoryTrace,
} from '../../core/types.js';
import type { SessionSummaryStore } from './SessionSummaryStore.js';

/**
 * Over-fetch multiplier applied to the Stage-2 `MemoryStore.query`
 * topK, so post-filtering by session tag has enough candidates to
 * find chunks from every Stage-1 session.
 *
 * At the defaults (K=5 sessions × M=3 chunks), Stage-2 requests
 * `5 * 3 * 3 = 45` candidates. Empirically this is enough overhead
 * even when the question is topically dominated by one session.
 */
const STAGE2_OVER_FETCH = 3;

/**
 * Options for constructing a {@link SessionRetriever}.
 */
export interface SessionRetrieverOptions {
  summaryStore: SessionSummaryStore;
  memoryStore: MemoryStore;
  embeddingManager: IEmbeddingManager;
  /** Optional reranker. When provided, the merged chunk pool is reranked before truncation. */
  rerankerService?: RerankerService;
  /** Default K (sessions to select in Stage 1). @default 5 */
  defaultTopSessions?: number;
  /** Default M (chunks per session in Stage 2). @default 3 */
  defaultChunksPerSession?: number;
}

/**
 * Per-call options for {@link SessionRetriever.retrieve}.
 */
export interface SessionRetrieveOptions {
  /** Override K (sessions). */
  topSessions?: number;
  /** Override M (chunks per session). */
  chunksPerSession?: number;
  /** Final truncation after merge and rerank. @default 10 */
  recallTopK?: number;
  /** Prefix for parsing session IDs off trace tags. @default 'bench-session:' */
  sessionTagPrefix?: string;
}

/**
 * Two-stage hierarchical retriever.
 *
 * @example
 * ```ts
 * const retriever = new SessionRetriever({
 *   summaryStore,
 *   memoryStore,
 *   embeddingManager,
 *   rerankerService,
 *   defaultTopSessions: 5,
 *   defaultChunksPerSession: 3,
 * });
 * const result = await retriever.retrieve(
 *   'What did the user say about their rescue dog?',
 *   { valence: 0, arousal: 0, dominance: 0 },
 *   { scope: 'user', scopeId: 'u42' },
 *   { recallTopK: 10 },
 * );
 * ```
 */
export class SessionRetriever {
  private readonly opts: Required<Omit<SessionRetrieverOptions, 'rerankerService'>> & {
    rerankerService?: RerankerService;
  };

  constructor(opts: SessionRetrieverOptions) {
    this.opts = {
      summaryStore: opts.summaryStore,
      memoryStore: opts.memoryStore,
      embeddingManager: opts.embeddingManager,
      rerankerService: opts.rerankerService,
      defaultTopSessions: opts.defaultTopSessions ?? 5,
      defaultChunksPerSession: opts.defaultChunksPerSession ?? 3,
    };
  }

  /**
   * Two-stage retrieve. Returns a `CognitiveRetrievalResult`
   * compatible with the existing `CognitiveMemoryManager.retrieve`
   * shape.
   *
   * Diagnostics are best-effort: timings reflect wall-clock of each
   * stage, not the cognitive-scorer internal accounting.
   */
  async retrieve(
    query: string,
    mood: PADState,
    scope: { scope: MemoryScope; scopeId: string },
    options: SessionRetrieveOptions = {},
  ): Promise<CognitiveRetrievalResult> {
    const startTime = Date.now();
    const K = options.topSessions ?? this.opts.defaultTopSessions;
    const M = options.chunksPerSession ?? this.opts.defaultChunksPerSession;
    const recallTopK = options.recallTopK ?? 10;
    const tagPrefix = options.sessionTagPrefix ?? 'bench-session:';

    // Stage 1: select top-K sessions by summary similarity.
    const stage1Start = Date.now();
    const sessions = await this.opts.summaryStore.querySessions(query, {
      scope: scope.scope,
      scopeId: scope.scopeId,
      topK: K,
    });
    const stage1Ms = Date.now() - stage1Start;

    // Stage-1 fallback: no summaries indexed for this scope.
    if (sessions.length === 0) {
      const { scored, timings } = await this.opts.memoryStore.query(query, mood, {
        topK: recallTopK,
        scopes: [scope],
      });
      return this.buildResult(scored.slice(0, recallTopK), {
        fallback: 'stage1-empty',
        candidatesScanned: scored.length,
        vectorSearchMs: timings.vectorSearchMs,
        scoringMs: timings.scoringMs,
        totalMs: Date.now() - startTime,
      });
    }

    // Stage 2: over-fetch from MemoryStore so post-filter has enough
    // candidates per session.
    const overFetchTopK = K * M * STAGE2_OVER_FETCH;
    const { scored: stage2Pool, timings: stage2Timings } = await this.opts.memoryStore.query(
      query,
      mood,
      { topK: overFetchTopK, scopes: [scope] },
    );

    // Post-filter: keep only traces whose bench-session tag matches a
    // Stage-1 session. Group by session.
    const selectedIds = new Set(sessions.map((s) => s.sessionId));
    const bySession = new Map<string, ScoredMemoryTrace[]>();
    for (const trace of stage2Pool) {
      const tag = trace.tags.find((t) => t.startsWith(tagPrefix));
      if (!tag) continue;
      const sid = tag.slice(tagPrefix.length);
      if (!selectedIds.has(sid)) continue;
      const bucket = bySession.get(sid) ?? [];
      bucket.push(trace);
      bySession.set(sid, bucket);
    }

    // Stage-2 fallback: post-filter wiped the pool. Return raw Stage-2
    // top-recallTopK without session filtering.
    if (bySession.size === 0) {
      return this.buildResult(stage2Pool.slice(0, recallTopK), {
        fallback: 'stage2-empty',
        candidatesScanned: stage2Pool.length,
        vectorSearchMs: stage2Timings.vectorSearchMs,
        scoringMs: stage2Timings.scoringMs,
        totalMs: Date.now() - startTime,
      });
    }

    // Take top-M per session (bucket is already sorted by retrieval
    // score — MemoryStore.query returns scored traces in descending
    // order).
    const merged: ScoredMemoryTrace[] = [];
    for (const [, bucket] of bySession) merged.push(...bucket.slice(0, M));

    // Optional rerank over the merged pool.
    const final = merged;
    if (this.opts.rerankerService && final.length > 0) {
      try {
        const rerankerOutput = await this.opts.rerankerService.rerank(
          {
            query,
            documents: final.map((t) => ({
              id: t.id,
              content: t.content,
              originalScore: t.retrievalScore,
            })),
          },
          { topN: final.length },
        );
        const rerankedScores = new Map(
          rerankerOutput.results.map((r) => [r.id, r.relevanceScore]),
        );
        for (const trace of final) {
          const neural = rerankedScores.get(trace.id);
          if (neural !== undefined) {
            // Blend identical to CognitiveMemoryManager.retrieve: 0.7 cognitive + 0.3 neural.
            trace.retrievalScore = 0.7 * trace.retrievalScore + 0.3 * neural;
          }
        }
        final.sort((a, b) => b.retrievalScore - a.retrievalScore);
      } catch {
        // Reranker errors are non-critical; degrade to cognitive-only ordering.
      }
    } else {
      // No rerank: sort by cognitive score (bucket grouping left order
      // per-session, not global).
      final.sort((a, b) => b.retrievalScore - a.retrievalScore);
    }

    // Truncate to recallTopK.
    const truncated = final.slice(0, recallTopK);

    return this.buildResult(truncated, {
      candidatesScanned: stage2Pool.length,
      vectorSearchMs: stage2Timings.vectorSearchMs + stage1Ms,
      scoringMs: stage2Timings.scoringMs,
      totalMs: Date.now() - startTime,
    });
  }

  /** Assemble the CognitiveRetrievalResult shape. */
  private buildResult(
    retrieved: ScoredMemoryTrace[],
    d: {
      fallback?: 'stage1-empty' | 'stage2-empty';
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
        ...(d.fallback ? { escalations: [`session-retriever:${d.fallback}`] } : {}),
      },
    };
  }
}
