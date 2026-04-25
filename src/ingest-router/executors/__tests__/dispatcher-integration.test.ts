/**
 * @file dispatcher-integration.test.ts
 * @description Integration test wiring SummarizedIngestExecutor through
 * FunctionIngestDispatcher. Confirms the executor's signature is
 * compatible with the dispatcher's registry contract.
 */

import { describe, it, expect } from 'vitest';
import { FunctionIngestDispatcher } from '../../dispatcher.js';
import { SummarizedIngestExecutor } from '../SummarizedIngestExecutor.js';
import type { IngestPayload } from '../SummarizedIngestExecutor.js';
import type { SummarizerLLM } from '../types.js';

describe('SummarizedIngestExecutor + FunctionIngestDispatcher', () => {
  const llm: SummarizerLLM = {
    invoke: async () => ({
      text: 'Q3 deployment context',
      tokensIn: 200,
      tokensOut: 5,
      model: 'gpt-5-mini',
    }),
  };

  it('handles a summarized strategy dispatch end-to-end', async () => {
    const exec = new SummarizedIngestExecutor({ llm });

    const dispatcher = new FunctionIngestDispatcher<
      Awaited<ReturnType<typeof exec.ingest>>,
      IngestPayload
    >({
      summarized: async (content, payload) => exec.ingest(content as string, payload as IngestPayload),
      'raw-chunks': async () => ({
        writtenTraces: 0,
        summary: '',
        embedTexts: [],
      }),
      observational: async () => ({
        writtenTraces: 0,
        summary: '',
        embedTexts: [],
      }),
      'fact-graph': async () => ({
        writtenTraces: 0,
        summary: '',
        embedTexts: [],
      }),
      hybrid: async () => ({
        writtenTraces: 0,
        summary: '',
        embedTexts: [],
      }),
      skip: async () => ({
        writtenTraces: 0,
        summary: '',
        embedTexts: [],
      }),
    });

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
});
