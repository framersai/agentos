/**
 * @fileoverview Tests for validateForgeShape.
 *
 * The validator is the gate that catches cheap-tier forges emitting
 * `additionalProperties: true` schemas with no declared fields and
 * empty-input testCases. Every rule is pinned with a targeted case so
 * later tweaks cannot silently weaken the pre-judge filter.
 */

import { describe, it, expect } from 'vitest';
import { validateForgeShape } from '../ForgeShapeValidator.js';

describe('validateForgeShape', () => {
  it('accepts a well-formed forge', () => {
    const errors = validateForgeShape({
      inputSchema: {
        type: 'object',
        properties: { dose: { type: 'number' }, age: { type: 'number' } },
        required: ['dose'],
        additionalProperties: false,
      },
      outputSchema: {
        type: 'object',
        properties: { risk_score: { type: 'number' } },
        additionalProperties: false,
      },
      testCases: [
        { input: { dose: 10, age: 30 }, expectedOutput: { risk_score: 1 } },
        { input: { dose: 0, age: 25 }, expectedOutput: { risk_score: 0 } },
        { input: { dose: 1000, age: 80 }, expectedOutput: { risk_score: 99 } },
      ],
    });
    expect(errors).toEqual([]);
  });

  it('rejects empty inputSchema properties', () => {
    const errors = validateForgeShape({
      inputSchema: { type: 'object', additionalProperties: true },
      outputSchema: { type: 'object', properties: { x: { type: 'number' } } },
      testCases: [
        { input: { a: 1 }, expectedOutput: {} },
        { input: { a: 2 }, expectedOutput: {} },
      ],
    });
    expect(errors.some(e => e.includes('inputSchema has no declared properties'))).toBe(true);
  });

  it('rejects missing outputSchema properties', () => {
    const errors = validateForgeShape({
      inputSchema: { type: 'object', properties: { a: { type: 'number' } } },
      outputSchema: { type: 'object' },
      testCases: [
        { input: { a: 1 }, expectedOutput: {} },
        { input: { a: 2 }, expectedOutput: {} },
      ],
    });
    expect(errors.some(e => e.includes('outputSchema has no declared properties'))).toBe(true);
  });

  it('rejects fewer than two testCases', () => {
    const errors = validateForgeShape({
      inputSchema: { type: 'object', properties: { a: { type: 'number' } } },
      outputSchema: { type: 'object', properties: { x: { type: 'number' } } },
      testCases: [{ input: { a: 1 }, expectedOutput: {} }],
    });
    expect(errors.some(e => e.includes('need at least 2 testCases'))).toBe(true);
  });

  it('rejects empty-input testCases', () => {
    const errors = validateForgeShape({
      inputSchema: { type: 'object', properties: { a: { type: 'number' } } },
      outputSchema: { type: 'object', properties: { x: { type: 'number' } } },
      testCases: [
        { input: {}, expectedOutput: {} },
        { input: {}, expectedOutput: {} },
      ],
    });
    expect(
      errors.some(e => e.includes('testCases use empty input') || e.includes('testCase use empty input')),
    ).toBe(true);
  });

  it('reports every violation at once (no short-circuit)', () => {
    const errors = validateForgeShape({
      inputSchema: { type: 'object', additionalProperties: true },
      outputSchema: { type: 'object' },
      testCases: [{ input: {}, expectedOutput: {} }],
    });
    expect(errors.length).toBeGreaterThanOrEqual(3);
  });

  it('tolerates non-array testCases gracefully', () => {
    const errors = validateForgeShape({
      inputSchema: { type: 'object', properties: { a: { type: 'number' } } },
      outputSchema: { type: 'object', properties: { x: { type: 'number' } } },
      testCases: 'not an array' as unknown as unknown[],
    });
    expect(errors.some(e => e.includes('need at least 2 testCases, got 0'))).toBe(true);
  });

  it('tolerates missing fields entirely', () => {
    const errors = validateForgeShape({});
    expect(errors.length).toBeGreaterThanOrEqual(2);
  });
});
