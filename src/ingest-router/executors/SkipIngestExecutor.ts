/**
 * @file SkipIngestExecutor.ts
 * @description No-op executor for the IngestRouter `skip` strategy.
 * Discards content; writes nothing. Useful for the routing-table case
 * where short conversations or low-value content shouldn't pollute the
 * memory store.
 *
 * @module @framers/agentos/ingest-router/executors/SkipIngestExecutor
 */

import type { IngestPayload } from './SummarizedIngestExecutor.js';
import type { RawChunksOutcome } from './RawChunksIngestExecutor.js';

/**
 * Discards content. Returns the same shape as other executors so the
 * dispatcher's outcome type stays uniform.
 */
export class SkipIngestExecutor {
  readonly strategyId = 'skip' as const;

  async ingest(_content: string, _payload: IngestPayload): Promise<RawChunksOutcome> {
    return {
      writtenTraces: 0,
      summary: '',
      embedTexts: [],
      tokensIn: 0,
      tokensOut: 0,
    };
  }
}
