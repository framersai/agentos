/**
 * @file sessionSummarizer.test.ts
 * @description Tests for the per-session summarizer used by the
 * Anthropic Contextual Retrieval ingest pipeline (Stage L).
 */

import { describe, it, expect, vi } from 'vitest';
import { summarizeSession, ANTHROPIC_CONTEXTUAL_PROMPT } from '../sessionSummarizer.js';
import type { SummarizerLLM } from '../types.js';

describe('summarizeSession', () => {
  it('uses the verbatim Anthropic Contextual Retrieval prompt format', async () => {
    const invoke = vi.fn(async () => ({
      text: 'Discussion about Q3 deployment strategy',
      tokensIn: 1500,
      tokensOut: 8,
      model: 'gpt-5-mini',
    }));
    const llm: SummarizerLLM = { invoke };

    await summarizeSession(
      { sessionId: 'sess-1', text: 'user: when do we deploy?\nassistant: Q3' },
      { llm },
    );

    expect(invoke).toHaveBeenCalledTimes(1);
    const arg = invoke.mock.calls[0][0];
    expect(arg.system).toContain('situate this');
    expect(arg.user).toContain('user: when do we deploy?');
    expect(arg.temperature).toBe(0);
    expect(arg.maxTokens).toBeLessThanOrEqual(120);
  });

  it('returns 50 to 100 token summaries by default', async () => {
    const llm: SummarizerLLM = {
      invoke: async () => ({
        text: 'Short summary',
        tokensIn: 100,
        tokensOut: 5,
        model: 'gpt-5-mini',
      }),
    };

    const result = await summarizeSession(
      { sessionId: 's1', text: 'hello' },
      { llm },
    );

    expect(result.summary).toBe('Short summary');
    expect(result.tokensOut).toBe(5);
    expect(result.tokensOut).toBeLessThanOrEqual(100);
  });

  it('exposes the verbatim Anthropic prompt as a constant', () => {
    expect(ANTHROPIC_CONTEXTUAL_PROMPT).toContain(
      'Please give a short succinct context to situate this chunk',
    );
    expect(ANTHROPIC_CONTEXTUAL_PROMPT).toContain('Answer only with the succinct context');
  });

  it('returns the sessionId on the result for caching', async () => {
    const llm: SummarizerLLM = {
      invoke: async () => ({
        text: 'Cached summary text',
        tokensIn: 50,
        tokensOut: 3,
        model: 'gpt-5-mini',
      }),
    };
    const result = await summarizeSession(
      { sessionId: 'sess-XYZ', text: 'foo' },
      { llm },
    );
    expect(result.sessionId).toBe('sess-XYZ');
  });
});
