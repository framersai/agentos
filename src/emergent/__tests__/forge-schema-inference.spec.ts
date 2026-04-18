/**
 * @fileoverview Tests for inferSchemaFromTestCases.
 *
 * Pins behavior that keeps the shape validator tight (don't infer into
 * already-populated schemas) while also rescuing the LLM's common
 * "concrete examples without formal schema" pattern.
 */

import { describe, it, expect } from 'vitest';
import { inferSchemaFromTestCases } from '../ForgeSchemaInference.js';

describe('inferSchemaFromTestCases', () => {
  it('synthesizes inputSchema.properties from testCase inputs', () => {
    const req: Parameters<typeof inferSchemaFromTestCases>[0] = {
      inputSchema: { type: 'object', additionalProperties: false },
      outputSchema: { type: 'object', properties: { risk: { type: 'number' } } },
      testCases: [
        { input: { dose: 10, age: 30 }, expectedOutput: { risk: 1 } },
        { input: { dose: 5, age: 50 }, expectedOutput: { risk: 2 } },
      ],
    };
    inferSchemaFromTestCases(req);
    expect(req.inputSchema).toEqual({
      type: 'object',
      properties: { dose: { type: 'number' }, age: { type: 'number' } },
      required: ['dose', 'age'],
      additionalProperties: false,
    });
  });

  it('synthesizes outputSchema.properties from testCase expectedOutputs', () => {
    const req: Parameters<typeof inferSchemaFromTestCases>[0] = {
      inputSchema: { type: 'object', properties: { a: { type: 'number' } } },
      outputSchema: { type: 'object' },
      testCases: [
        { input: { a: 1 }, expectedOutput: { risk: 1, flag: true } },
        { input: { a: 2 }, expectedOutput: { risk: 2, flag: false } },
      ],
    };
    inferSchemaFromTestCases(req);
    expect(req.outputSchema).toEqual({
      type: 'object',
      properties: { risk: { type: 'number' }, flag: { type: 'boolean' } },
      required: ['risk', 'flag'],
      additionalProperties: false,
    });
  });

  it('leaves already-populated schemas alone', () => {
    const original = {
      type: 'object',
      properties: { preserved: { type: 'string' } },
      additionalProperties: false,
    };
    const req: Parameters<typeof inferSchemaFromTestCases>[0] = {
      inputSchema: { ...original },
      outputSchema: { ...original },
      testCases: [
        { input: { different: 1 }, expectedOutput: { alsoDifferent: 2 } },
        { input: { different: 3 }, expectedOutput: { alsoDifferent: 4 } },
      ],
    };
    inferSchemaFromTestCases(req);
    expect(req.inputSchema).toEqual(original);
    expect(req.outputSchema).toEqual(original);
  });

  it('unions fields across testCases (no single case narrows the schema)', () => {
    const req: Parameters<typeof inferSchemaFromTestCases>[0] = {
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object', properties: { r: { type: 'number' } } },
      testCases: [
        { input: { a: 1 }, expectedOutput: { r: 1 } },
        { input: { b: 'hello' }, expectedOutput: { r: 2 } },
      ],
    };
    inferSchemaFromTestCases(req);
    const inputSchema = req.inputSchema as { properties: Record<string, unknown> };
    expect(Object.keys(inputSchema.properties).sort()).toEqual(['a', 'b']);
  });

  it('covers all primitive types returned by inferTypeFromValue', () => {
    const req: Parameters<typeof inferSchemaFromTestCases>[0] = {
      inputSchema: {},
      outputSchema: { type: 'object', properties: { r: { type: 'number' } } },
      testCases: [
        {
          input: {
            num: 1,
            str: 'x',
            bool: true,
            arr: [1, 2],
            obj: { nested: 1 },
            nul: null,
          },
          expectedOutput: { r: 1 },
        },
        {
          input: {
            num: 2,
            str: 'y',
            bool: false,
            arr: [3],
            obj: { nested: 2 },
            nul: null,
          },
          expectedOutput: { r: 2 },
        },
      ],
    };
    inferSchemaFromTestCases(req);
    const props = (req.inputSchema as { properties: Record<string, { type: string }> }).properties;
    expect(props.num.type).toBe('number');
    expect(props.str.type).toBe('string');
    expect(props.bool.type).toBe('boolean');
    expect(props.arr.type).toBe('array');
    expect(props.obj.type).toBe('object');
    // `null` is neither an object we want to expand nor a primitive; falls back to string.
    expect(props.nul.type).toBe('string');
  });

  it('skips inference when no testCases are present', () => {
    const req: Parameters<typeof inferSchemaFromTestCases>[0] = {
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object' },
      testCases: [],
    };
    inferSchemaFromTestCases(req);
    expect(req.inputSchema).toEqual({ type: 'object' });
    expect(req.outputSchema).toEqual({ type: 'object' });
  });

  it('skips inference when testCases field is non-array', () => {
    const req: Parameters<typeof inferSchemaFromTestCases>[0] = {
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object' },
      testCases: 'nope' as unknown as unknown[],
    };
    inferSchemaFromTestCases(req);
    expect(req.inputSchema).toEqual({ type: 'object' });
    expect(req.outputSchema).toEqual({ type: 'object' });
  });

  it('tolerates testCases with missing input or expectedOutput', () => {
    const req: Parameters<typeof inferSchemaFromTestCases>[0] = {
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object' },
      testCases: [
        { input: { a: 1 } },
        { expectedOutput: { r: 2 } },
      ] as unknown as unknown[],
    };
    inferSchemaFromTestCases(req);
    const inSchema = req.inputSchema as { properties?: Record<string, unknown> };
    const outSchema = req.outputSchema as { properties?: Record<string, unknown> };
    expect(inSchema.properties).toEqual({ a: { type: 'number' } });
    expect(outSchema.properties).toEqual({ r: { type: 'number' } });
  });
});
