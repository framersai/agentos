/**
 * @file executors/index.ts
 * @description Sub-barrel for IngestRouter reference executors. The
 * top-level `@framers/agentos/ingest-router` barrel re-exports these
 * symbols so consumers can write
 * `import { SummarizedIngestExecutor } from '@framers/agentos/ingest-router'`.
 *
 * Reference executors ship in agentos core (not in extension packages)
 * so the IngestRouter strategy IDs (`summarized`, `fact-graph`) work
 * out of the box rather than being empty promises.
 */

export { SummarizedIngestExecutor } from './SummarizedIngestExecutor.js';
export type { IngestOutcome, IngestPayload } from './SummarizedIngestExecutor.js';
export { summarizeSession, ANTHROPIC_CONTEXTUAL_PROMPT } from './sessionSummarizer.js';
export type {
  SessionContent,
  SummarizerLLM,
  SummarizedIngestOptions,
  SummarizedTrace,
} from './types.js';

import { SummarizedIngestExecutor } from './SummarizedIngestExecutor.js';
import type { SummarizerLLM } from './types.js';

export function createSummarizedIngestExecutor(opts: {
  llm: SummarizerLLM;
  maxSummaryTokens?: number;
}): SummarizedIngestExecutor {
  return new SummarizedIngestExecutor(opts);
}
