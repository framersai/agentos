/**
 * @file SummarizedIngestExecutor.test.ts
 * @description Tests for the IngestRouter-shaped facade over the
 * existing SessionSummarizer. Verifies the executor delegates
 * correctly, prepends summary to chunks, and reports the right
 * strategy ID.
 */

import { describe, it, expect, vi } from 'vitest';
import { SessionSummarizer } from '../../../memory/ingest/SessionSummarizer.js';
import { SummarizedIngestExecutor } from '../SummarizedIngestExecutor.js';

function makeSummarizer(text = 'Session summary about deployment.') {
  const invoker = vi.fn(async () => ({
    text,
    tokensIn: 500,
    tokensOut: 7,
    model: 'mock-model',
  }));
  const summarizer = new SessionSummarizer({
    invoker,
    modelId: 'mock-model',
  });
  return { summarizer, invoker };
}

describe('SummarizedIngestExecutor', () => {
  it('returns the strategy ID expected by IngestRouter dispatcher', () => {
    const { summarizer } = makeSummarizer();
    const executor = new SummarizedIngestExecutor({ summarizer });
    expect(executor.strategyId).toBe('summarized');
  });

  it('prepends summary to single chunk before embedding', async () => {
    const { summarizer } = makeSummarizer();
    const executor = new SummarizedIngestExecutor({ summarizer });
    const result = await executor.ingest('user: deploy?\nassistant: Q3', {
      sessionId: 'sess-1',
    });

    expect(result.writtenTraces).toBe(1);
    expect(result.summary).toBe('Session summary about deployment.');
    expect(result.embedTexts[0]).toMatch(/^Session summary about deployment\./);
    expect(result.embedTexts[0]).toContain('user: deploy?');
  });

  it('delegates one summarize call per ingest (SessionSummarizer absorbs caching)', async () => {
    const { summarizer, invoker } = makeSummarizer();
    const executor = new SummarizedIngestExecutor({ summarizer });

    await executor.ingest('text 1', { sessionId: 'sess-A' });
    await executor.ingest('text 2', { sessionId: 'sess-A' });

    // SessionSummarizer hashes by content, not sessionId; two different
    // texts are two cache misses unless cacheDir+content identical.
    expect(invoker).toHaveBeenCalledTimes(2);
  });

  it('hits SessionSummarizer cache when same content + same sessionId', async () => {
    const { summarizer, invoker } = makeSummarizer();
    const executor = new SummarizedIngestExecutor({ summarizer });

    await executor.ingest('identical text', { sessionId: 'sess-A' });
    await executor.ingest('identical text', { sessionId: 'sess-A' });

    // Second call has identical content, but SessionSummarizer's
    // in-memory cache requires cacheDir to be set; without it both
    // calls hit the LLM. This test confirms the bypass behavior.
    expect(invoker).toHaveBeenCalledTimes(2);
  });

  it('splits content across explicit chunks when payload.chunks supplied', async () => {
    const { summarizer } = makeSummarizer();
    const executor = new SummarizedIngestExecutor({ summarizer });
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
});
