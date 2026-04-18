/**
 * @fileoverview Tests for classifyForgeRejection.
 *
 * Fixtures are real production rejection-reason strings sampled from
 * operational logs. Each case pins what category the classifier must
 * produce so future tweaks to the pattern lists do not silently
 * reclassify existing failures.
 */

import { describe, it, expect } from 'vitest';
import {
  classifyForgeRejection,
  type ForgeRejectionCategory,
} from '../ForgeRejectionClassifier.js';

const CASES: Array<{ input: string; expected: ForgeRejectionCategory; label: string }> = [
  {
    label: 'real #1 — "additional properties not allowed by additionalProperties:false"',
    input:
      'The implementation is safe and deterministic, but it violates the declared output schema by returning additional properties not allowed by additionalProperties:false.',
    expected: 'schema_extra_field',
  },
  {
    label: 'real #2 — "returning an extra field not allowed"',
    input:
      'The implementation is deterministic and bounded, but it violates the declared output schema by returning an extra field not allowed by additionalProperties:false.',
    expected: 'schema_extra_field',
  },
  {
    label: 'real #3 — "emits extra properties beyond the allowed fields"',
    input:
      'The code is safe and deterministic, and it terminates quickly, but it does not conform to the declared output schema because it emits extra properties beyond the allowed fields.',
    expected: 'schema_extra_field',
  },
  {
    label: 'real #4 — "returns an additional undeclared field"',
    input:
      'The code appears safe, deterministic, and bounded, but it does not conform to the declared output schema because it emits an additional undeclared field.',
    expected: 'schema_extra_field',
  },
  {
    label: 'shape check — "Shape check failed: need at least 2 testCases"',
    input:
      'Shape check failed: need at least 2 testCases, got 1; 1 testCase use empty input; every test needs real field values',
    expected: 'shape_check',
  },
  {
    label: 'shape check — no declared properties',
    input: 'Shape check failed: inputSchema has no declared properties; add at least two typed fields',
    expected: 'shape_check',
  },
  {
    label: 'parse error — judge LLM malformed JSON',
    input: 'Failed to parse LLM response as JSON during creation review.',
    expected: 'parse_error',
  },
  {
    label: 'judge correctness — threshold ordering logic error',
    input:
      'Fails output schema contract due to extra recommendations field, and includes a logic error in riskLevel threshold ordering that could misclassify risk.',
    // The regex /\bextra\s+\w+\s+field\b/ matches "extra recommendations field"
    // so schema_extra_field wins over judge_correctness. The more specific +
    // actionable signal takes precedence per the documented ordering.
    expected: 'schema_extra_field',
  },
  {
    label: 'judge correctness — clamping inconsistency (no schema complaint)',
    input:
      'While it is safe and deterministic, correctness is questionable: riskLevel is determined using the unclamped stressScore, while stressScore returned is clamped to 5. This can produce inconsistent risk grading relative to the displayed stressScore.',
    expected: 'judge_correctness',
  },
  {
    label: 'empty string → other',
    input: '',
    expected: 'other',
  },
  {
    label: 'unrelated error → other',
    input: 'Sandbox timeout exceeded after 10000ms',
    expected: 'other',
  },
];

describe('classifyForgeRejection', () => {
  for (const c of CASES) {
    it(c.label, () => {
      expect(classifyForgeRejection(c.input)).toBe(c.expected);
    });
  }

  it('handles undefined gracefully', () => {
    expect(classifyForgeRejection(undefined)).toBe('other');
  });

  it('is case-insensitive', () => {
    expect(
      classifyForgeRejection(
        'VIOLATES THE DECLARED OUTPUT SCHEMA BY RETURNING ADDITIONAL PROPERTIES',
      ),
    ).toBe('schema_extra_field');
  });
});
