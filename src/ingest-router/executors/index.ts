/**
 * @file executors/index.ts
 * @description Sub-barrel for IngestRouter reference executors. The
 * top-level `@framers/agentos/ingest-router` barrel re-exports these
 * symbols so consumers can write
 * `import { SummarizedIngestExecutor } from '@framers/agentos/ingest-router'`.
 *
 * Reference executors ship in agentos core (not in extension packages)
 * so the IngestRouter strategy IDs (`summarized`, `raw-chunks`, `skip`)
 * work out of the box rather than being empty promises.
 *
 * The summarized executor wraps the existing
 * {@link SessionSummarizer} from `@framers/agentos/memory` so the
 * production summarization primitive is the single source of truth.
 */

export { SummarizedIngestExecutor } from './SummarizedIngestExecutor.js';
export type { IngestOutcome, IngestPayload } from './SummarizedIngestExecutor.js';
export { RawChunksIngestExecutor } from './RawChunksIngestExecutor.js';
export type { RawChunksOutcome } from './RawChunksIngestExecutor.js';
export { SkipIngestExecutor } from './SkipIngestExecutor.js';

import { SummarizedIngestExecutor } from './SummarizedIngestExecutor.js';
import { RawChunksIngestExecutor } from './RawChunksIngestExecutor.js';
import { SkipIngestExecutor } from './SkipIngestExecutor.js';
import type { SessionSummarizer } from '../../memory/ingest/SessionSummarizer.js';

export function createSummarizedIngestExecutor(opts: {
  summarizer: SessionSummarizer;
}): SummarizedIngestExecutor {
  return new SummarizedIngestExecutor(opts);
}

export function createRawChunksIngestExecutor(): RawChunksIngestExecutor {
  return new RawChunksIngestExecutor();
}

export function createSkipIngestExecutor(): SkipIngestExecutor {
  return new SkipIngestExecutor();
}
