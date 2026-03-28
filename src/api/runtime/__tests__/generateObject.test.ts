/**
 * @file generateObject.test.ts
 * Tests for the Zod-validated structured output generation API.
 *
 * Mocks the underlying model resolution and provider layer to exercise
 * JSON extraction, schema validation, retry logic, and error propagation
 * without hitting real LLM endpoints.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Mock setup — hoist provider mocks so they're available before imports
// ---------------------------------------------------------------------------

const hoisted = vi.hoisted(() => {
  const generateCompletion = vi.fn();
  const getProvider = vi.fn(() => ({ generateCompletion }));
  const createProviderManager = vi.fn(async () => ({ getProvider }));
  return {
    generateCompletion,
    getProvider,
    createProviderManager,
  };
});

vi.mock('../model.js', () => ({
  resolveModelOption: vi.fn(() => ({ providerId: 'openai', modelId: 'gpt-4o' })),
  resolveProvider: vi.fn(() => ({ providerId: 'openai', modelId: 'gpt-4o', apiKey: 'test-key' })),
  createProviderManager: hoisted.createProviderManager,
}));

import { generateObject, ObjectGenerationError } from '../generateObject.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Creates a mock completion response whose assistant message contains `text`.
 */
function mockResponse(text: string, usage = { promptTokens: 10, completionTokens: 5, totalTokens: 15 }) {
  return {
    modelId: 'gpt-4o',
    usage,
    choices: [
      {
        message: { role: 'assistant', content: text },
        finishReason: 'stop',
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('generateObject', () => {
  const personSchema = z.object({
    name: z.string(),
    age: z.number(),
  });

  beforeEach(() => {
    hoisted.generateCompletion.mockReset();
  });

  it('parses valid JSON and validates against the Zod schema', async () => {
    hoisted.generateCompletion.mockResolvedValue(
      mockResponse('{"name": "Alice", "age": 28}'),
    );

    const result = await generateObject({
      schema: personSchema,
      prompt: 'Extract person info',
    });

    expect(result.object).toEqual({ name: 'Alice', age: 28 });
    expect(result.provider).toBe('openai');
    expect(result.model).toBe('gpt-4o');
    expect(result.finishReason).toBe('stop');
    expect(result.usage.totalTokens).toBe(15);
  });

  it('extracts JSON from code fences when the model wraps output', async () => {
    hoisted.generateCompletion.mockResolvedValue(
      mockResponse('Here is the result:\n```json\n{"name": "Bob", "age": 42}\n```'),
    );

    const result = await generateObject({
      schema: personSchema,
      prompt: 'Extract person info',
    });

    expect(result.object).toEqual({ name: 'Bob', age: 42 });
  });

  it('extracts JSON from bare code fences (no json annotation)', async () => {
    hoisted.generateCompletion.mockResolvedValue(
      mockResponse('```\n{"name": "Carol", "age": 19}\n```'),
    );

    const result = await generateObject({
      schema: personSchema,
      prompt: 'Extract person info',
    });

    expect(result.object).toEqual({ name: 'Carol', age: 19 });
  });

  it('extracts JSON embedded in prose by finding outer braces', async () => {
    hoisted.generateCompletion.mockResolvedValue(
      mockResponse('Sure! The answer is {"name": "Dave", "age": 55} — hope that helps!'),
    );

    const result = await generateObject({
      schema: personSchema,
      prompt: 'Extract person info',
    });

    expect(result.object).toEqual({ name: 'Dave', age: 55 });
  });

  it('retries on malformed JSON then succeeds on the second attempt', async () => {
    // First call returns broken JSON; second returns valid JSON
    hoisted.generateCompletion
      .mockResolvedValueOnce(mockResponse('{"name": "Eve", "age":'))
      .mockResolvedValueOnce(mockResponse('{"name": "Eve", "age": 31}'));

    const result = await generateObject({
      schema: personSchema,
      prompt: 'Extract person info',
      maxRetries: 2,
    });

    expect(result.object).toEqual({ name: 'Eve', age: 31 });
    // Should have been called twice: initial attempt + 1 retry
    expect(hoisted.generateCompletion).toHaveBeenCalledTimes(2);
    // Usage should be aggregated across attempts
    expect(result.usage.totalTokens).toBe(30);
  });

  it('retries on Zod validation failure then succeeds', async () => {
    // First call returns JSON that doesn't match schema (age is a string)
    hoisted.generateCompletion
      .mockResolvedValueOnce(mockResponse('{"name": "Frank", "age": "thirty"}'))
      .mockResolvedValueOnce(mockResponse('{"name": "Frank", "age": 30}'));

    const result = await generateObject({
      schema: personSchema,
      prompt: 'Extract person info',
      maxRetries: 1,
    });

    expect(result.object).toEqual({ name: 'Frank', age: 30 });
    expect(hoisted.generateCompletion).toHaveBeenCalledTimes(2);
  });

  it('throws ObjectGenerationError after maxRetries exhausted with bad JSON', async () => {
    hoisted.generateCompletion.mockResolvedValue(
      mockResponse('This is not JSON at all'),
    );

    await expect(
      generateObject({
        schema: personSchema,
        prompt: 'Extract person info',
        maxRetries: 1,
      }),
    ).rejects.toThrow(ObjectGenerationError);

    // 1 initial + 1 retry = 2 calls
    expect(hoisted.generateCompletion).toHaveBeenCalledTimes(2);
  });

  it('throws ObjectGenerationError with rawText and validationErrors after schema failures', async () => {
    // Always returns wrong types — age as string
    hoisted.generateCompletion.mockResolvedValue(
      mockResponse('{"name": 123, "age": "young"}'),
    );

    try {
      await generateObject({
        schema: personSchema,
        prompt: 'Extract person info',
        maxRetries: 0,
      });
      // Should not reach here
      expect.unreachable('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ObjectGenerationError);
      const ogErr = err as ObjectGenerationError;
      expect(ogErr.rawText).toBe('{"name": 123, "age": "young"}');
      expect(ogErr.validationErrors).toBeDefined();
    }
  });

  it('uses maxRetries: 2 by default', async () => {
    hoisted.generateCompletion.mockResolvedValue(
      mockResponse('not json'),
    );

    await expect(
      generateObject({
        schema: personSchema,
        prompt: 'Extract person info',
        // maxRetries defaults to 2
      }),
    ).rejects.toThrow(ObjectGenerationError);

    // 1 initial + 2 retries = 3 calls
    expect(hoisted.generateCompletion).toHaveBeenCalledTimes(3);
  });

  it('passes schemaName and schemaDescription through to the system prompt', async () => {
    hoisted.generateCompletion.mockResolvedValue(
      mockResponse('{"name": "Grace", "age": 25}'),
    );

    await generateObject({
      schema: personSchema,
      schemaName: 'PersonRecord',
      schemaDescription: 'A person extracted from text.',
      prompt: 'Extract person info',
    });

    // Verify the system prompt was constructed with schema info by
    // inspecting the first call's messages argument
    const messages = hoisted.generateCompletion.mock.calls[0][1];
    const systemMsg = messages.find((m: Record<string, unknown>) => m.role === 'system');
    expect(systemMsg?.content).toContain('PersonRecord');
    expect(systemMsg?.content).toContain('A person extracted from text.');
    expect(systemMsg?.content).toContain('JSON Schema');
  });

  it('preserves user-supplied system prompt alongside schema instructions', async () => {
    hoisted.generateCompletion.mockResolvedValue(
      mockResponse('{"name": "Hana", "age": 22}'),
    );

    await generateObject({
      schema: personSchema,
      system: 'You are an expert data extractor.',
      prompt: 'Extract person info',
    });

    const messages = hoisted.generateCompletion.mock.calls[0][1];
    const systemMsg = messages.find((m: Record<string, unknown>) => m.role === 'system');
    expect(systemMsg?.content).toContain('You are an expert data extractor.');
    expect(systemMsg?.content).toContain('JSON Schema');
  });
});
