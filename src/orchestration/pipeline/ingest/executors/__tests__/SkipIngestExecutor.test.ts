/**
 * @file SkipIngestExecutor.test.ts
 * @description Tests for the no-op executor that fulfills the
 * IngestRouter `skip` strategy. Discards content; writes nothing.
 */

import { describe, it, expect } from 'vitest';
import { SkipIngestExecutor } from '../SkipIngestExecutor.js';

describe('SkipIngestExecutor', () => {
  const executor = new SkipIngestExecutor();

  it('returns the strategy ID expected by IngestRouter dispatcher', () => {
    expect(executor.strategyId).toBe('skip');
  });

  it('writes zero traces and emits no embed-texts', async () => {
    const result = await executor.ingest('content to discard', {
      sessionId: 'sess-1',
    });

    expect(result.writtenTraces).toBe(0);
    expect(result.embedTexts).toEqual([]);
  });

  it('costs nothing in tokensIn/tokensOut (no LLM call)', async () => {
    const result = await executor.ingest('any text', { sessionId: 'sess' });
    expect(result.tokensIn).toBe(0);
    expect(result.tokensOut).toBe(0);
  });

  it('returns the same shape regardless of payload.chunks', async () => {
    const result = await executor.ingest('full text', {
      sessionId: 'sess',
      chunks: ['a', 'b', 'c'],
    });
    expect(result.writtenTraces).toBe(0);
    expect(result.embedTexts).toEqual([]);
  });
});
