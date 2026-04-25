/**
 * @file dispatcher-integration.test.ts
 * @description Integration test wiring SummarizedIngestExecutor through
 * FunctionIngestDispatcher. Confirms the executor's signature is
 * compatible with the dispatcher's registry contract and that the
 * outcome shape stays uniform across all six strategy IDs.
 */

import { describe, it, expect } from 'vitest';
import { FunctionIngestDispatcher } from '../../dispatcher.js';
import { SessionSummarizer } from '../../../memory/ingest/SessionSummarizer.js';
import { SummarizedIngestExecutor } from '../SummarizedIngestExecutor.js';
import { RawChunksIngestExecutor } from '../RawChunksIngestExecutor.js';
import { SkipIngestExecutor } from '../SkipIngestExecutor.js';
import type { IngestPayload, IngestOutcome } from '../SummarizedIngestExecutor.js';

describe('Reference executors + FunctionIngestDispatcher', () => {
  const summarizer = new SessionSummarizer({
    invoker: async () => ({
      text: 'Q3 deployment context',
      tokensIn: 200,
      tokensOut: 5,
      model: 'mock-model',
    }),
    modelId: 'mock-model',
  });

  function buildDispatcher() {
    const summarized = new SummarizedIngestExecutor({ summarizer });
    const raw = new RawChunksIngestExecutor();
    const skip = new SkipIngestExecutor();

    return new FunctionIngestDispatcher<IngestOutcome, IngestPayload>({
      summarized: async (content, payload) =>
        summarized.ingest(content as string, payload as IngestPayload),
      'raw-chunks': async (content, payload) =>
        raw.ingest(content as string, payload as IngestPayload),
      skip: async (content, payload) => skip.ingest(content as string, payload as IngestPayload),
      observational: async () => ({
        writtenTraces: 0,
        summary: '',
        embedTexts: [],
        tokensIn: 0,
        tokensOut: 0,
      }),
      'fact-graph': async () => ({
        writtenTraces: 0,
        summary: '',
        embedTexts: [],
        tokensIn: 0,
        tokensOut: 0,
      }),
      hybrid: async () => ({
        writtenTraces: 0,
        summary: '',
        embedTexts: [],
        tokensIn: 0,
        tokensOut: 0,
      }),
    });
  }

  it('handles a summarized strategy dispatch end-to-end', async () => {
    const dispatcher = buildDispatcher();
    const result = await dispatcher.dispatch({
      strategy: 'summarized',
      content: 'user: when?\nassistant: Q3',
      payload: { sessionId: 'sess-1' },
    });

    expect(result.strategy).toBe('summarized');
    expect(result.outcome.writtenTraces).toBe(1);
    expect(result.outcome.summary).toBe('Q3 deployment context');
    expect(result.outcome.embedTexts[0]).toContain('Q3 deployment context');
    expect(result.outcome.embedTexts[0]).toContain('user: when?');
  });

  it('handles a raw-chunks dispatch end-to-end', async () => {
    const dispatcher = buildDispatcher();
    const result = await dispatcher.dispatch({
      strategy: 'raw-chunks',
      content: 'plain text',
      payload: { sessionId: 'sess-2' },
    });

    expect(result.strategy).toBe('raw-chunks');
    expect(result.outcome.writtenTraces).toBe(1);
    expect(result.outcome.embedTexts).toEqual(['plain text']);
  });

  it('handles a skip dispatch end-to-end', async () => {
    const dispatcher = buildDispatcher();
    const result = await dispatcher.dispatch({
      strategy: 'skip',
      content: 'discarded',
      payload: { sessionId: 'sess-3' },
    });

    expect(result.strategy).toBe('skip');
    expect(result.outcome.writtenTraces).toBe(0);
    expect(result.outcome.embedTexts).toEqual([]);
  });
});
