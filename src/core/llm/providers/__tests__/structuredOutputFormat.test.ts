/**
 * @file structuredOutputFormat.test.ts
 * @description Tests for the provider-format adapter that maps a Zod schema
 *              + provider id to the per-provider structured-output payload.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { buildResponseFormat } from '../structuredOutputFormat.js';

const schema = z.object({
  verdict: z.enum(['yes', 'no']),
  confidence: z.number().min(0).max(1),
});

describe('buildResponseFormat', () => {
  it('openai returns json_schema with strict=true and a sanitized name', () => {
    const r = buildResponseFormat({ provider: 'openai', schema, schemaName: 'My.Schema' });
    assert.equal((r as any).type, 'json_schema');
    assert.equal((r as any).json_schema.name, 'My_Schema');
    assert.equal((r as any).json_schema.strict, true);
    assert.equal(typeof (r as any).json_schema.schema, 'object');
  });

  it('anthropic returns the _agentosUseToolForStructuredOutput marker plus tool shape', () => {
    const r = buildResponseFormat({ provider: 'anthropic', schema, schemaName: 'X' });
    assert.equal((r as any)._agentosUseToolForStructuredOutput, true);
    assert.equal((r as any).tool.name, 'X');
    assert.equal(typeof (r as any).tool.input_schema, 'object');
  });

  it('gemini returns json_object with _gemini.responseSchema populated', () => {
    const r = buildResponseFormat({ provider: 'gemini', schema, schemaName: 'X' });
    assert.equal((r as any).type, 'json_object');
    assert.equal(typeof (r as any)._gemini.responseSchema, 'object');
  });

  it('gemini-cli is treated like gemini', () => {
    const r = buildResponseFormat({ provider: 'gemini-cli', schema, schemaName: 'X' });
    assert.equal((r as any).type, 'json_object');
    assert.equal(typeof (r as any)._gemini.responseSchema, 'object');
  });

  it('openrouter degrades to bare json_object (no enforcement available)', () => {
    const r = buildResponseFormat({ provider: 'openrouter', schema, schemaName: 'X' });
    assert.deepEqual(r, { type: 'json_object' });
  });

  it('unknown provider degrades to bare json_object', () => {
    const r = buildResponseFormat({ provider: 'fictional', schema, schemaName: 'X' });
    assert.deepEqual(r, { type: 'json_object' });
  });

  it('schemaName: replaces non-word chars with underscore', () => {
    const r = buildResponseFormat({ provider: 'openai', schema, schemaName: 'a.b/c d!' });
    assert.equal((r as any).json_schema.name, 'a_b_c_d_');
  });

  it('schemaName: truncates to 64 chars', () => {
    const long = 'a'.repeat(80);
    const r = buildResponseFormat({ provider: 'openai', schema, schemaName: long });
    assert.equal(((r as any).json_schema.name as string).length, 64);
  });

  it('schemaName: empty after sanitization falls back to "response"', () => {
    const r = buildResponseFormat({ provider: 'openai', schema, schemaName: '!!!' });
    assert.equal((r as any).json_schema.name, 'response');
  });
});
