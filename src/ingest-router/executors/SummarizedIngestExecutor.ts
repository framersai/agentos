/**
 * @file SummarizedIngestExecutor.ts
 * @description Anthropic Contextual Retrieval reference executor for
 * the IngestRouter `summarized` strategy.
 *
 * Per session: one LLM summarize call. Per chunk: prepend that session's
 * summary before passing to the embedding pipeline. Designed to plug
 * into IngestRouter's {@link FunctionIngestDispatcher} as the
 * `summarized` strategy executor.
 *
 * Source recipe: platform.claude.com/cookbook/capabilities-contextual-embeddings-guide
 *
 * Cost model: ~$0.003 per session at gpt-5-mini, fully cached after
 * first run via the per-sessionId in-memory cache.
 *
 * @module @framers/agentos/ingest-router/executors/SummarizedIngestExecutor
 */

import { summarizeSession } from './sessionSummarizer.js';
import type { SummarizerLLM } from './types.js';

/**
 * Outcome shape returned by {@link SummarizedIngestExecutor.ingest}.
 * Compatible with the {@link IIngestDispatcher.dispatch} expected
 * outcome type when wired through {@link FunctionIngestDispatcher}.
 */
export interface IngestOutcome {
  writtenTraces: number;
  summary: string;
  embedTexts: string[];
}

/**
 * Per-call payload. The executor needs the sessionId for caching and
 * the optional chunks list for splitting content. When `chunks` is
 * omitted, the entire `content` becomes a single chunk.
 */
export interface IngestPayload {
  sessionId: string;
  chunks?: string[];
}

/**
 * Reference executor for the IngestRouter `summarized` strategy.
 * Wire as: `new FunctionIngestDispatcher({ summarized: (c, p) => exec.ingest(c, p), ... })`.
 */
export class SummarizedIngestExecutor {
  /** Strategy ID expected by IngestRouter's FunctionIngestDispatcher registry. */
  readonly strategyId = 'summarized' as const;

  private readonly llm: SummarizerLLM;
  private readonly maxSummaryTokens?: number;
  private readonly cache = new Map<string, string>();

  constructor(opts: { llm: SummarizerLLM; maxSummaryTokens?: number }) {
    this.llm = opts.llm;
    this.maxSummaryTokens = opts.maxSummaryTokens;
  }

  /**
   * Ingest a session's content. On first call for a sessionId, runs the
   * summarize LLM call. On subsequent calls for the same sessionId,
   * uses the cached summary.
   */
  async ingest(content: string, payload: IngestPayload): Promise<IngestOutcome> {
    const sessionId = payload.sessionId;
    let summary = this.cache.get(sessionId);
    if (summary === undefined) {
      const result = await summarizeSession(
        { sessionId, text: content },
        { llm: this.llm, maxSummaryTokens: this.maxSummaryTokens },
      );
      summary = result.summary;
      this.cache.set(sessionId, summary);
    }

    const chunks = payload.chunks ?? [content];
    const embedTexts = chunks.map((chunk) => `${summary}\n\n${chunk}`);

    return {
      writtenTraces: chunks.length,
      summary,
      embedTexts,
    };
  }

  /**
   * Drop the per-session cache. Useful for tests or memory-pressure
   * scenarios. The shipping caller typically lets the cache live for
   * the agent's lifetime.
   */
  clearCache(): void {
    this.cache.clear();
  }
}
