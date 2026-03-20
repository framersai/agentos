/**
 * @file LlmJudgeRecognizer.spec.ts
 * @description Tests for the Tier 4 LlmJudgeRecognizer with a mocked fetch.
 *
 * All LLM API calls are intercepted by an injectable fetch mock so no
 * network requests are made during testing.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LlmJudgeRecognizer } from '../../../../src/extensions/packs/pii-redaction/recognizers/LlmJudgeRecognizer';
import type { PiiEntity, LlmJudgeConfig } from '../../../../src/extensions/packs/pii-redaction/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Default LLM judge configuration for tests. */
const TEST_CONFIG: LlmJudgeConfig = {
  provider: 'openai',
  model: 'gpt-4o-mini',
  apiKey: 'test-key-12345',
  maxConcurrency: 3,
  cacheSize: 64,
};

/** A sample PII entity candidate for testing. */
function makeSampleEntity(overrides?: Partial<PiiEntity>): PiiEntity {
  return {
    entityType: 'PERSON',
    text: 'John Smith',
    start: 0,
    end: 10,
    score: 0.55,
    source: 'nlp-prefilter',
    ...overrides,
  };
}

/**
 * Creates a mock fetch function that returns a pre-configured LLM response.
 *
 * @param response - The JSON response body the LLM "returns".
 * @param ok       - Whether the HTTP response is successful (default true).
 * @param status   - HTTP status code (default 200).
 * @returns A vi.fn() mock of the fetch function.
 */
function createMockFetch(
  response: {
    isPii: boolean;
    entityType: string;
    confidence: number;
    reasoning: string;
  },
  ok = true,
  status = 200,
) {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    json: async () => ({
      choices: [
        {
          message: {
            content: JSON.stringify(response),
          },
        },
      ],
    }),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LlmJudgeRecognizer', () => {
  // -----------------------------------------------------------------------
  // Confirms PII when LLM says isPii: true
  // -----------------------------------------------------------------------

  it('should confirm PII when LLM returns isPii: true', async () => {
    const mockFetch = createMockFetch({
      isPii: true,
      entityType: 'PERSON',
      confidence: 0.92,
      reasoning: 'John Smith appears to be a real person name in this context.',
    });

    const judge = new LlmJudgeRecognizer(TEST_CONFIG, mockFetch);
    const entity = makeSampleEntity();
    const result = await judge.judge(entity, 'Contact John Smith at john@example.com');

    expect(result).not.toBeNull();
    expect(result!.entityType).toBe('PERSON');
    expect(result!.score).toBe(0.92);
    expect(result!.source).toBe('llm');
    // Original values should be preserved in metadata.
    expect(result!.metadata?.originalEntityType).toBe('PERSON');
    expect(result!.metadata?.originalScore).toBe(0.55);
    expect(result!.metadata?.originalSource).toBe('nlp-prefilter');
    expect(result!.metadata?.llmReasoning).toContain('John Smith');
  });

  it('should reclassify entity type when LLM returns a different type', async () => {
    const mockFetch = createMockFetch({
      isPii: true,
      entityType: 'ORGANIZATION',
      confidence: 0.88,
      reasoning: 'Smith & Sons is a company name, not a person.',
    });

    const judge = new LlmJudgeRecognizer(TEST_CONFIG, mockFetch);
    const entity = makeSampleEntity({ text: 'Smith & Sons', entityType: 'PERSON' });
    const result = await judge.judge(entity, 'Smith & Sons filed a lawsuit.');

    expect(result).not.toBeNull();
    // Entity type should be reclassified by the LLM.
    expect(result!.entityType).toBe('ORGANIZATION');
  });

  // -----------------------------------------------------------------------
  // Returns null when LLM says NOT_PII
  // -----------------------------------------------------------------------

  it('should return null when LLM determines span is not PII', async () => {
    const mockFetch = createMockFetch({
      isPii: false,
      entityType: 'NOT_PII',
      confidence: 0.95,
      reasoning: '"Apple" in this context refers to the fruit, not the company.',
    });

    const judge = new LlmJudgeRecognizer(TEST_CONFIG, mockFetch);
    const entity = makeSampleEntity({
      text: 'Apple',
      entityType: 'ORGANIZATION',
    });
    const result = await judge.judge(entity, 'I ate an Apple for lunch.');

    expect(result).toBeNull();
  });

  it('should return null when LLM returns isPii: true but entityType is NOT_PII', async () => {
    // Edge case: isPii and entityType conflict — entityType wins.
    const mockFetch = createMockFetch({
      isPii: true,
      entityType: 'NOT_PII',
      confidence: 0.5,
      reasoning: 'Contradictory but entityType is NOT_PII.',
    });

    const judge = new LlmJudgeRecognizer(TEST_CONFIG, mockFetch);
    const entity = makeSampleEntity();
    const result = await judge.judge(entity, 'Some text with John Smith');

    expect(result).toBeNull();
  });

  // -----------------------------------------------------------------------
  // Caching
  // -----------------------------------------------------------------------

  it('should cache results for identical span + context', async () => {
    const mockFetch = createMockFetch({
      isPii: true,
      entityType: 'PERSON',
      confidence: 0.9,
      reasoning: 'Confirmed PII.',
    });

    const judge = new LlmJudgeRecognizer(TEST_CONFIG, mockFetch);
    const entity = makeSampleEntity();
    const fullText = 'Contact John Smith today';

    // First call — should hit the LLM.
    const result1 = await judge.judge(entity, fullText);
    expect(result1).not.toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Second call with same span + context — should use cache.
    const result2 = await judge.judge(entity, fullText);
    expect(result2).not.toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(1); // No additional call.

    // Results should be identical.
    expect(result1!.entityType).toBe(result2!.entityType);
    expect(result1!.score).toBe(result2!.score);
  });

  it('should make separate calls for different contexts', async () => {
    const mockFetch = createMockFetch({
      isPii: true,
      entityType: 'PERSON',
      confidence: 0.9,
      reasoning: 'Confirmed.',
    });

    const judge = new LlmJudgeRecognizer(TEST_CONFIG, mockFetch);
    const entity = makeSampleEntity();

    await judge.judge(entity, 'Contact John Smith at work');
    await judge.judge(entity, 'John Smith is a fictional character');

    // Different contexts → two separate LLM calls.
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('should cache null results (NOT_PII verdicts)', async () => {
    const mockFetch = createMockFetch({
      isPii: false,
      entityType: 'NOT_PII',
      confidence: 0.95,
      reasoning: 'Not PII.',
    });

    const judge = new LlmJudgeRecognizer(TEST_CONFIG, mockFetch);
    const entity = makeSampleEntity({ text: 'Apple' });
    const fullText = 'I ate an Apple';

    const r1 = await judge.judge(entity, fullText);
    const r2 = await judge.judge(entity, fullText);

    expect(r1).toBeNull();
    expect(r2).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(1); // Cached null.
  });

  // -----------------------------------------------------------------------
  // Concurrency control (semaphore)
  // -----------------------------------------------------------------------

  it('should respect maxConcurrency limit', async () => {
    let concurrentCalls = 0;
    let maxObservedConcurrency = 0;

    // Mock fetch that tracks concurrent calls with a small delay.
    const slowMockFetch = vi.fn().mockImplementation(async () => {
      concurrentCalls++;
      maxObservedConcurrency = Math.max(maxObservedConcurrency, concurrentCalls);

      // Simulate network latency.
      await new Promise((resolve) => setTimeout(resolve, 50));

      concurrentCalls--;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{
            message: {
              content: JSON.stringify({
                isPii: true,
                entityType: 'PERSON',
                confidence: 0.9,
                reasoning: 'Test',
              }),
            },
          }],
        }),
      };
    });

    const config: LlmJudgeConfig = {
      ...TEST_CONFIG,
      maxConcurrency: 2, // Limit to 2 concurrent requests.
      cacheSize: 0,       // Disable cache so all calls go to LLM.
    };
    const judge = new LlmJudgeRecognizer(config, slowMockFetch);

    // Fire 5 concurrent judge calls with different entities/contexts to
    // avoid caching.
    const promises = Array.from({ length: 5 }, (_, i) =>
      judge.judge(
        makeSampleEntity({ text: `Person${i}`, start: 0, end: 7 }),
        `Context for person ${i} which is unique`,
      ),
    );

    await Promise.all(promises);

    // maxConcurrency is 2, so we should never see more than 2 in flight.
    expect(maxObservedConcurrency).toBeLessThanOrEqual(2);
    // All 5 calls should have completed.
    expect(slowMockFetch).toHaveBeenCalledTimes(5);
  });

  // -----------------------------------------------------------------------
  // Fail-open behaviour
  // -----------------------------------------------------------------------

  it('should return original entity unchanged when LLM call fails (fail-open)', async () => {
    const failingFetch = vi.fn().mockRejectedValue(new Error('Network error'));

    const judge = new LlmJudgeRecognizer(TEST_CONFIG, failingFetch);
    const entity = makeSampleEntity();
    const result = await judge.judge(entity, 'John Smith was here');

    // Should return the original entity, not null and not throw.
    expect(result).not.toBeNull();
    expect(result!.entityType).toBe(entity.entityType);
    expect(result!.text).toBe(entity.text);
    expect(result!.score).toBe(entity.score);
    expect(result!.source).toBe(entity.source);
  });

  it('should return original entity when LLM returns non-OK status', async () => {
    const errorFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({ error: 'Rate limited' }),
    });

    const judge = new LlmJudgeRecognizer(TEST_CONFIG, errorFetch);
    const entity = makeSampleEntity();
    const result = await judge.judge(entity, 'John Smith was here');

    // Fail-open: return original entity.
    expect(result).not.toBeNull();
    expect(result!.text).toBe(entity.text);
  });

  it('should return original entity when LLM returns invalid JSON', async () => {
    const badJsonFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{
          message: {
            content: 'This is not JSON at all!',
          },
        }],
      }),
    });

    const judge = new LlmJudgeRecognizer(TEST_CONFIG, badJsonFetch);
    const entity = makeSampleEntity();
    const result = await judge.judge(entity, 'John Smith was here');

    // Fail-open: return original entity.
    expect(result).not.toBeNull();
    expect(result!.text).toBe(entity.text);
  });

  // -----------------------------------------------------------------------
  // Preserves entity position data
  // -----------------------------------------------------------------------

  it('should preserve start/end/text from original entity', async () => {
    const mockFetch = createMockFetch({
      isPii: true,
      entityType: 'PERSON',
      confidence: 0.95,
      reasoning: 'Confirmed PII.',
    });

    const judge = new LlmJudgeRecognizer(TEST_CONFIG, mockFetch);
    const entity = makeSampleEntity({ start: 15, end: 25, text: 'Jane Doe' });
    const result = await judge.judge(entity, 'Please contact Jane Doe for info');

    expect(result).not.toBeNull();
    // Position data must match the original.
    expect(result!.start).toBe(15);
    expect(result!.end).toBe(25);
    expect(result!.text).toBe('Jane Doe');
  });
});
