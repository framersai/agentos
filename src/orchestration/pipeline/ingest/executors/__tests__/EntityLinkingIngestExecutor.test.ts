/**
 * @file EntityLinkingIngestExecutor.test.ts
 * @description Tests for the ingest-side executor that extracts entities
 * from content and emits them alongside chunks for downstream indexing
 * (Stage I, Mem0-v3 style).
 */

import { describe, it, expect } from 'vitest';
import { EntityLinkingIngestExecutor } from '../EntityLinkingIngestExecutor.js';

describe('EntityLinkingIngestExecutor', () => {
  const executor = new EntityLinkingIngestExecutor();

  it('returns the strategy ID expected by IngestRouter dispatcher', () => {
    expect(executor.strategyId).toBe('fact-graph');
  });

  it('extracts entities and surfaces them on the result', async () => {
    const result = await executor.ingest('Anthropic released Claude 3 Opus.', {
      sessionId: 'sess-1',
    });
    expect(result.writtenTraces).toBe(1);
    expect(result.entities).toEqual(expect.arrayContaining(['Anthropic']));
  });

  it('passes content through unchanged in embedTexts (no summary prepend)', async () => {
    const result = await executor.ingest('plain content', { sessionId: 'sess-2' });
    expect(result.embedTexts).toEqual(['plain content']);
  });

  it('returns one entity-tagged trace per chunk when payload.chunks supplied', async () => {
    const result = await executor.ingest('full text', {
      sessionId: 'sess-multi',
      chunks: ['John works at Anthropic.', 'Bob works at OpenAI.'],
    });
    expect(result.writtenTraces).toBe(2);
    expect(result.embedTexts).toEqual([
      'John works at Anthropic.',
      'Bob works at OpenAI.',
    ]);
    expect(result.entitiesPerChunk).toHaveLength(2);
    expect(result.entitiesPerChunk[0]).toEqual(expect.arrayContaining(['John', 'Anthropic']));
    expect(result.entitiesPerChunk[1]).toEqual(expect.arrayContaining(['Bob', 'OpenAI']));
  });

  it('costs nothing in tokensIn/tokensOut (regex-only, no LLM)', async () => {
    const result = await executor.ingest('any text', { sessionId: 'sess' });
    expect(result.tokensIn).toBe(0);
    expect(result.tokensOut).toBe(0);
  });
});
