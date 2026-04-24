/**
 * @file classifier.test.ts
 * @description Contract tests for the {@link IMemoryClassifier} interface
 * and the {@link LLMMemoryClassifier} reference implementation.
 *
 * The classifier is the first LLM-as-judge in the MemoryRouter pipeline:
 * it takes a user query, invokes a cheap LLM (typically gpt-5-mini) with a
 * category-discrimination prompt, and returns the predicted
 * {@link MemoryQueryCategory}. The classifier is deliberately abstract
 * (IMemoryClassifier) so callers can plug in their own provider/model,
 * a mock for tests, or swap the prompt strategy (base vs few-shot).
 *
 * Tests cover:
 *   - Parsing robustness: handles bare tokens, trailing punctuation,
 *     surrounding quotes, label prefixes ("Category: ..."), case variations,
 *     multi-line output.
 *   - Safe fallback on unparseable output (returns 'multi-session' — the
 *     route that at least covers cross-session synthesis if the category
 *     was a multi-session question misidentified).
 *   - Token-usage propagation so callers can cost-track classifier calls.
 *   - Few-shot prompt variant switches correctly.
 *
 * @module memory-router/__tests__/classifier.test
 */

import { describe, it, expect, vi } from 'vitest';
import {
  LLMMemoryClassifier,
  CLASSIFIER_SYSTEM_PROMPT,
  CLASSIFIER_SYSTEM_PROMPT_FEWSHOT,
  type IMemoryClassifierLLM,
  type MemoryClassifierLLMResponse,
} from '../classifier.js';

function mockLLM(text: string, tokensIn = 40, tokensOut = 4, model = 'gpt-5-mini'): IMemoryClassifierLLM {
  return {
    invoke: vi.fn(async (): Promise<MemoryClassifierLLMResponse> => ({
      text,
      tokensIn,
      tokensOut,
      model,
    })),
  };
}

describe('LLMMemoryClassifier: output parsing', () => {
  it('returns the bare category token when the LLM emits it cleanly', async () => {
    const llm = mockLLM('multi-session');
    const classifier = new LLMMemoryClassifier({ llm });
    const result = await classifier.classify('How many books did I buy?');
    expect(result.category).toBe('multi-session');
  });

  it('strips trailing punctuation', async () => {
    const llm = mockLLM('temporal-reasoning.');
    const classifier = new LLMMemoryClassifier({ llm });
    const result = await classifier.classify('When did I move?');
    expect(result.category).toBe('temporal-reasoning');
  });

  it('strips surrounding quotes', async () => {
    const llm = mockLLM('"knowledge-update"');
    const classifier = new LLMMemoryClassifier({ llm });
    const result = await classifier.classify("What's my current job?");
    expect(result.category).toBe('knowledge-update');
  });

  it('strips label prefixes like "Category:"', async () => {
    const llm = mockLLM('Category: single-session-user');
    const classifier = new LLMMemoryClassifier({ llm });
    const result = await classifier.classify('What did I tell you?');
    expect(result.category).toBe('single-session-user');
  });

  it('handles case variations (uppercase)', async () => {
    const llm = mockLLM('SINGLE-SESSION-ASSISTANT');
    const classifier = new LLMMemoryClassifier({ llm });
    const result = await classifier.classify('What did you suggest?');
    expect(result.category).toBe('single-session-assistant');
  });

  it('handles multi-line output by keeping only the first line', async () => {
    const llm = mockLLM('single-session-preference\nThis category fits because...');
    const classifier = new LLMMemoryClassifier({ llm });
    const result = await classifier.classify('Do I prefer tea?');
    expect(result.category).toBe('single-session-preference');
  });
});

describe('LLMMemoryClassifier: safe fallback on unparseable output', () => {
  it('falls back to multi-session when the output matches no known category', async () => {
    const llm = mockLLM('something-unrelated');
    const classifier = new LLMMemoryClassifier({ llm });
    const result = await classifier.classify('???');
    // multi-session is the safest fallback — it covers cross-session
    // synthesis which gracefully handles many misidentified question types.
    expect(result.category).toBe('multi-session');
  });

  it('falls back to multi-session on empty output', async () => {
    const llm = mockLLM('');
    const classifier = new LLMMemoryClassifier({ llm });
    const result = await classifier.classify('anything');
    expect(result.category).toBe('multi-session');
  });
});

describe('LLMMemoryClassifier: token usage propagation', () => {
  it('returns tokensIn/tokensOut/model so callers can cost-track', async () => {
    const llm = mockLLM('multi-session', 123, 7, 'gpt-5-mini-2025-08-07');
    const classifier = new LLMMemoryClassifier({ llm });
    const result = await classifier.classify('test');
    expect(result.tokensIn).toBe(123);
    expect(result.tokensOut).toBe(7);
    expect(result.model).toBe('gpt-5-mini-2025-08-07');
  });
});

describe('LLMMemoryClassifier: prompt variant selection', () => {
  it('uses the base prompt by default', async () => {
    const llm = mockLLM('multi-session');
    const classifier = new LLMMemoryClassifier({ llm });
    await classifier.classify('anything');
    const invoked = (llm.invoke as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(invoked?.system).toBe(CLASSIFIER_SYSTEM_PROMPT);
  });

  it('switches to the few-shot prompt when useFewShotPrompt is true', async () => {
    const llm = mockLLM('multi-session');
    const classifier = new LLMMemoryClassifier({ llm });
    await classifier.classify('anything', { useFewShotPrompt: true });
    const invoked = (llm.invoke as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(invoked?.system).toBe(CLASSIFIER_SYSTEM_PROMPT_FEWSHOT);
  });

  it('sends temperature=0 for classification determinism', async () => {
    const llm = mockLLM('multi-session');
    const classifier = new LLMMemoryClassifier({ llm });
    await classifier.classify('anything');
    const invoked = (llm.invoke as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(invoked?.temperature).toBe(0);
  });

  it('caps maxTokens low (≤32) so classification calls stay cheap', async () => {
    const llm = mockLLM('multi-session');
    const classifier = new LLMMemoryClassifier({ llm });
    await classifier.classify('anything');
    const invoked = (llm.invoke as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(invoked?.maxTokens).toBeLessThanOrEqual(32);
  });
});

describe('LLMMemoryClassifier: all six categories round-trip', () => {
  it.each([
    'single-session-user',
    'single-session-assistant',
    'single-session-preference',
    'knowledge-update',
    'multi-session',
    'temporal-reasoning',
  ] as const)('parses %s correctly', async (category) => {
    const llm = mockLLM(category);
    const classifier = new LLMMemoryClassifier({ llm });
    const result = await classifier.classify('test question');
    expect(result.category).toBe(category);
  });
});
