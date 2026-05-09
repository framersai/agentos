/**
 * Full pipeline integration test for the LLM output validation layer.
 * Exercises extractJson + ValidatedLlmInvoker + schema primitives together.
 */

import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { createValidatedInvoker } from '../ValidatedLlmInvoker.js';
import { extractJson } from '../extractJson.js';
import { LlmOutputValidationError } from '../errors.js';
import { ReflectionTraceOutput, ObservationNoteOutput } from '../schema-primitives.js';

describe('Validation Layer — integration', () => {
  it('full pipeline: messy LLM output → extractJson → Zod validation → typed result', async () => {
    const invoker = vi.fn().mockResolvedValue(
      '<thinking>Let me analyze this.</thinking>\n' +
      '```json\n{"type":"semantic","scope":"user","content":"User is an engineer","confidence":0.95}\n```'
    );

    const validated = createValidatedInvoker(invoker, ReflectionTraceOutput);
    const result = await validated('system', 'user');

    expect(result.type).toBe('semantic');
    expect(result.content).toBe('User is an engineer');
    expect(result.confidence).toBe(0.95);
    expect(result.entities).toEqual([]);
    expect(result.sourceType).toBe('reflection');
  });

  it('JSONL batch: multiple observation notes validated as array', async () => {
    const invoker = vi.fn().mockResolvedValue(
      '{"type":"factual","content":"User is an engineer","importance":0.9,"entities":["user"]}\n' +
      '{"type":"commitment","content":"Check back Friday","importance":0.8,"entities":[]}\n' +
      '{"type":"emotional","content":"Feeling stressed","importance":0.7,"entities":["user"]}'
    );

    const BatchSchema = z.array(ObservationNoteOutput);
    const validated = createValidatedInvoker(invoker, BatchSchema);
    const results = await validated('system', 'user');

    expect(results).toHaveLength(3);
    expect(results[0].type).toBe('factual');
    expect(results[1].type).toBe('commitment');
    expect(results[2].type).toBe('emotional');
  });

  it('retry succeeds after initial malformed output', async () => {
    const invoker = vi.fn()
      .mockResolvedValueOnce('I apologize, here are the results... {broken json')
      .mockResolvedValueOnce('{"type":"factual","content":"A fact","importance":0.5,"entities":[]}');

    const validated = createValidatedInvoker(invoker, ObservationNoteOutput, { maxRetries: 1 });
    const result = await validated('system', 'user');

    expect(result.type).toBe('factual');
    expect(result.content).toBe('A fact');
  });

  it('exhausted retries produce descriptive error with history', async () => {
    const invoker = vi.fn().mockResolvedValue('The answer is 42.');
    const validated = createValidatedInvoker(invoker, ObservationNoteOutput, { maxRetries: 2 });

    try {
      await validated('system', 'user');
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(LlmOutputValidationError);
      const ve = err as LlmOutputValidationError;
      expect(ve.retryCount).toBe(2);
      expect(ve.retryHistory).toHaveLength(3);
      expect(ve.rawOutput).toBe('The answer is 42.');
    }
  });

  it('extractJson handles all real-world LLM output patterns', () => {
    expect(extractJson('{"a":1}')).toBe('{"a":1}');
    expect(extractJson('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(extractJson('<thinking>hmm</thinking>{"a":1}')).toBe('{"a":1}');
    expect(extractJson('Result: {"a":1} done')).toBe('{"a":1}');

    const jsonl = extractJson('{"a":1}\n{"b":2}');
    expect(JSON.parse(jsonl!)).toEqual([{ a: 1 }, { b: 2 }]);

    expect(extractJson('just text')).toBeNull();
  });
});
