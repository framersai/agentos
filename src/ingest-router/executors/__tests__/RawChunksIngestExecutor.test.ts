/**
 * @file RawChunksIngestExecutor.test.ts
 * @description Tests for the trivial reference executor that fulfills
 * the IngestRouter `raw-chunks` strategy. No LLM calls; chunks pass
 * through unchanged.
 */

import { describe, it, expect } from 'vitest';
import { RawChunksIngestExecutor } from '../RawChunksIngestExecutor.js';

describe('RawChunksIngestExecutor', () => {
  const executor = new RawChunksIngestExecutor();

  it('returns the strategy ID expected by IngestRouter dispatcher', () => {
    expect(executor.strategyId).toBe('raw-chunks');
  });

  it('returns single chunk as one embed-text when no chunks supplied', async () => {
    const result = await executor.ingest('user: hello\nassistant: hi', {
      sessionId: 'sess-1',
    });

    expect(result.writtenTraces).toBe(1);
    expect(result.embedTexts).toEqual(['user: hello\nassistant: hi']);
  });

  it('returns each chunk unchanged when payload.chunks supplied', async () => {
    const result = await executor.ingest('full session text', {
      sessionId: 'sess-multi',
      chunks: ['chunk-one', 'chunk-two', 'chunk-three'],
    });

    expect(result.writtenTraces).toBe(3);
    expect(result.embedTexts).toEqual(['chunk-one', 'chunk-two', 'chunk-three']);
  });

  it('costs nothing in tokensIn/tokensOut (no LLM call)', async () => {
    const result = await executor.ingest('any text', { sessionId: 'sess' });
    expect(result.tokensIn).toBe(0);
    expect(result.tokensOut).toBe(0);
  });
});
