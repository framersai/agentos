import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { createValidatedInvoker } from '../ValidatedLlmInvoker.js';
import { LlmOutputValidationError } from '../errors.js';

const TestSchema = z.object({
  type: z.string(),
  value: z.number(),
});

describe('createValidatedInvoker', () => {
  it('returns typed result when LLM output is valid JSON matching schema', async () => {
    const invoker = vi.fn().mockResolvedValue('{"type":"test","value":42}');
    const validated = createValidatedInvoker(invoker, TestSchema);

    const result = await validated('system', 'user');
    expect(result).toEqual({ type: 'test', value: 42 });
  });

  it('extracts JSON from markdown fenced output', async () => {
    const invoker = vi.fn().mockResolvedValue('Here:\n```json\n{"type":"a","value":1}\n```');
    const validated = createValidatedInvoker(invoker, TestSchema);

    const result = await validated('system', 'user');
    expect(result).toEqual({ type: 'a', value: 1 });
  });

  it('retries with error feedback on malformed JSON', async () => {
    const invoker = vi.fn()
      .mockResolvedValueOnce('not valid json at all')
      .mockResolvedValueOnce('{"type":"retry","value":2}');

    const validated = createValidatedInvoker(invoker, TestSchema, { maxRetries: 1 });
    const result = await validated('system', 'user');

    expect(result).toEqual({ type: 'retry', value: 2 });
    expect(invoker).toHaveBeenCalledTimes(2);
    // Retry prompt should contain error context
    const retrySystem = invoker.mock.calls[1][0] as string;
    expect(retrySystem).toContain('not valid');
  });

  it('retries with schema description when injectSchemaOnRetry is true', async () => {
    const invoker = vi.fn()
      .mockResolvedValueOnce('{"type":"a"}') // missing required "value"
      .mockResolvedValueOnce('{"type":"a","value":1}');

    const validated = createValidatedInvoker(invoker, TestSchema, {
      maxRetries: 1,
      injectSchemaOnRetry: true,
    });
    const result = await validated('system', 'user');

    expect(result).toEqual({ type: 'a', value: 1 });
    const retrySystem = invoker.mock.calls[1][0] as string;
    // Schema description should mention the required fields
    expect(retrySystem).toContain('type');
    expect(retrySystem).toContain('value');
  });

  it('throws LlmOutputValidationError when all retries fail', async () => {
    const invoker = vi.fn().mockResolvedValue('garbage');
    const validated = createValidatedInvoker(invoker, TestSchema, { maxRetries: 2 });

    await expect(validated('system', 'user')).rejects.toThrow(LlmOutputValidationError);
    // 1 initial + 2 retries = 3 total calls
    expect(invoker).toHaveBeenCalledTimes(3);
  });

  it('throws LlmOutputValidationError with retry history', async () => {
    const invoker = vi.fn().mockResolvedValue('bad');
    const validated = createValidatedInvoker(invoker, TestSchema, { maxRetries: 1 });

    try {
      await validated('sys', 'usr');
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(LlmOutputValidationError);
      const ve = err as LlmOutputValidationError;
      expect(ve.retryCount).toBe(1);
      expect(ve.retryHistory).toHaveLength(2);
      expect(ve.retryHistory[0].attempt).toBe(0);
      expect(ve.retryHistory[1].attempt).toBe(1);
    }
  });

  it('applies Zod defaults on valid partial input', async () => {
    const SchemaWithDefaults = z.object({
      type: z.string(),
      tags: z.array(z.string()).default([]),
    });
    const invoker = vi.fn().mockResolvedValue('{"type":"a"}');
    const validated = createValidatedInvoker(invoker, SchemaWithDefaults);

    const result = await validated('sys', 'usr');
    expect(result).toEqual({ type: 'a', tags: [] });
  });

  it('handles JSONL batch validation (array of objects)', async () => {
    const ArraySchema = z.array(TestSchema);
    const invoker = vi.fn().mockResolvedValue(
      '{"type":"a","value":1}\n{"type":"b","value":2}'
    );
    const validated = createValidatedInvoker(invoker, ArraySchema);

    const result = await validated('sys', 'usr');
    expect(result).toEqual([
      { type: 'a', value: 1 },
      { type: 'b', value: 2 },
    ]);
  });

  it('does not retry when first attempt succeeds', async () => {
    const invoker = vi.fn().mockResolvedValue('{"type":"ok","value":1}');
    const validated = createValidatedInvoker(invoker, TestSchema, { maxRetries: 3 });

    await validated('sys', 'usr');
    expect(invoker).toHaveBeenCalledTimes(1);
  });
});
