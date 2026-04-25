/**
 * @file RawChunksIngestExecutor.ts
 * @description Trivial reference executor for the IngestRouter
 * `raw-chunks` strategy. Passes content through unchanged so the
 * downstream embedder sees the original chunks.
 *
 * Use case: high-volume / cost-sensitive workloads where retrieval
 * does the work and per-session preprocessing isn't worth the LLM
 * cost. The default IngestRouter preset (`raw-chunks`) routes every
 * content kind through this executor.
 *
 * @module @framers/agentos/ingest-router/executors/RawChunksIngestExecutor
 */

import type { IngestPayload } from './SummarizedIngestExecutor.js';

/**
 * Outcome shape returned by {@link RawChunksIngestExecutor.ingest}.
 * Mirrors the shape returned by {@link SummarizedIngestExecutor.ingest}
 * so consumers can swap executors without rewriting downstream code.
 * `summary` is always the empty string for raw chunks.
 */
export interface RawChunksOutcome {
  writtenTraces: number;
  summary: string;
  embedTexts: string[];
  tokensIn: number;
  tokensOut: number;
}

/**
 * No-op preprocessor: returns chunks as-is. Zero LLM cost.
 */
export class RawChunksIngestExecutor {
  /** Strategy ID expected by IngestRouter's FunctionIngestDispatcher registry. */
  readonly strategyId = 'raw-chunks' as const;

  async ingest(content: string, payload: IngestPayload): Promise<RawChunksOutcome> {
    const chunks = payload.chunks ?? [content];
    return {
      writtenTraces: chunks.length,
      summary: '',
      embedTexts: chunks,
      tokensIn: 0,
      tokensOut: 0,
    };
  }
}
