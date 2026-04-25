/**
 * @file SummarizedIngestExecutor.test.ts
 * @description Tests for the per-session caching executor that prepends
 * the Anthropic Contextual Retrieval summary to every chunk before
 * embedding (Stage L).
 */

import { describe, it, expect, vi } from 'vitest';
import { SummarizedIngestExecutor } from '../SummarizedIngestExecutor.js';
import type { SummarizerLLM } from '../types.js';

const stubLLM: SummarizerLLM = {
  invoke: async () => ({
    text: 'Session summary about deployment.',
    tokensIn: 500,
    tokensOut: 7,
    model: 'gpt-5-mini',
  }),
};

describe('SummarizedIngestExecutor', () => {
  it('prepends summary to each chunk before embedding', async () => {
    const executor = new SummarizedIngestExecutor({ llm: stubLLM });
    const result = await executor.ingest('user: deploy?\nassistant: Q3', {
      sessionId: 'sess-1',
    });

    expect(result.writtenTraces).toBe(1);
    expect(result.summary).toBe('Session summary about deployment.');
    expect(result.embedTexts[0]).toMatch(/^Session summary about deployment\./);
    expect(result.embedTexts[0]).toContain('user: deploy?');
  });

  it('caches summaries by sessionId across repeated calls', async () => {
    const invoke = vi.fn(async () => ({
      text: 'Cached summary',
      tokensIn: 100,
      tokensOut: 3,
      model: 'gpt-5-mini',
    }));
    const executor = new SummarizedIngestExecutor({ llm: { invoke } });

    await executor.ingest('text 1', { sessionId: 'sess-A' });
    await executor.ingest('text 2', { sessionId: 'sess-A' });

    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('runs a fresh summarize call when sessionId changes', async () => {
    const invoke = vi.fn(async () => ({
      text: 'Fresh summary',
      tokensIn: 80,
      tokensOut: 3,
      model: 'gpt-5-mini',
    }));
    const executor = new SummarizedIngestExecutor({ llm: { invoke } });

    await executor.ingest('text A', { sessionId: 'sess-A' });
    await executor.ingest('text B', { sessionId: 'sess-B' });

    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it('splits content across explicit chunks when payload.chunks supplied', async () => {
    const executor = new SummarizedIngestExecutor({ llm: stubLLM });
    const result = await executor.ingest('full session text', {
      sessionId: 'sess-multi',
      chunks: ['chunk-one', 'chunk-two', 'chunk-three'],
    });

    expect(result.writtenTraces).toBe(3);
    expect(result.embedTexts).toHaveLength(3);
    for (const text of result.embedTexts) {
      expect(text).toMatch(/^Session summary about deployment\./);
    }
    expect(result.embedTexts[0]).toContain('chunk-one');
    expect(result.embedTexts[1]).toContain('chunk-two');
    expect(result.embedTexts[2]).toContain('chunk-three');
  });

  it('returns the strategy ID expected by IngestRouter dispatcher', () => {
    const executor = new SummarizedIngestExecutor({ llm: stubLLM });
    expect(executor.strategyId).toBe('summarized');
  });
});
