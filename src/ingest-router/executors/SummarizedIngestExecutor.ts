/**
 * @file SummarizedIngestExecutor.ts
 * @description Anthropic Contextual Retrieval reference executor for
 * the IngestRouter `summarized` strategy.
 *
 * Wraps the existing {@link SessionSummarizer} (in
 * `@framers/agentos/memory`) which carries the conversation-tuned
 * summarization prompt + persistent disk cache + cost-tracking. This
 * executor is the IngestRouter-shaped facade over that primitive, so
 * the production SessionSummarizer is the single source of truth for
 * session-level summarization across both the bench and the
 * IngestRouter dispatcher path.
 *
 * Cost model: ~$0.003 per session at gpt-5-mini. SessionSummarizer's
 * SHA-256 disk cache means re-runs against the same sessions are $0.
 *
 * @module @framers/agentos/ingest-router/executors/SummarizedIngestExecutor
 */

import { SessionSummarizer } from '../../memory/ingest/SessionSummarizer.js';

/**
 * Outcome shape returned by {@link SummarizedIngestExecutor.ingest}.
 * Mirrors the shape of every other executor's outcome so the dispatch
 * type stays uniform across strategies.
 */
export interface IngestOutcome {
  writtenTraces: number;
  summary: string;
  embedTexts: string[];
  tokensIn: number;
  tokensOut: number;
}

/**
 * Per-call payload. The executor needs the sessionId for SessionSummarizer
 * cache lookups (also used for stable identification in logging) and
 * the optional chunks list for splitting content.
 */
export interface IngestPayload {
  sessionId: string;
  chunks?: string[];
}

/**
 * Reference executor for the IngestRouter `summarized` strategy. Wires
 * the existing SessionSummarizer through the IngestRouter dispatcher
 * pattern so consumers using IngestRouter get Anthropic Contextual
 * Retrieval out of the box.
 */
export class SummarizedIngestExecutor {
  /** Strategy ID expected by IngestRouter's FunctionIngestDispatcher registry. */
  readonly strategyId = 'summarized' as const;

  private readonly summarizer: SessionSummarizer;

  constructor(opts: { summarizer: SessionSummarizer }) {
    this.summarizer = opts.summarizer;
  }

  /**
   * Ingest a session's content. Delegates to the wrapped
   * SessionSummarizer for the LLM call (which handles caching, cost
   * tracking, and prompt management). Returns the summary prepended
   * to every chunk, ready for embedding.
   *
   * Per-call tokensIn/tokensOut are reported as 0 because the
   * SessionSummarizer's disk cache obscures whether a particular
   * `summarize()` call hit the cache or fired the LLM. Callers that
   * need precise per-call cost should inspect
   * {@link SessionSummarizer.stats} directly.
   */
  async ingest(content: string, payload: IngestPayload): Promise<IngestOutcome> {
    const summary = await this.summarizer.summarize(payload.sessionId, content);
    const chunks = payload.chunks ?? [content];
    const embedTexts = chunks.map((chunk) => `${summary}\n\n${chunk}`);

    return {
      writtenTraces: chunks.length,
      summary,
      embedTexts,
      tokensIn: 0,
      tokensOut: 0,
    };
  }
}
