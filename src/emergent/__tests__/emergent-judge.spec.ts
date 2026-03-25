/**
 * @fileoverview Tests for EmergentJudge.
 *
 * Covers:
 *  1. reviewCreation() approves when LLM returns all-passed verdict
 *  2. reviewCreation() rejects when LLM says safety failed
 *  3. reviewCreation() rejects when LLM says correctness failed
 *  4. reviewCreation() handles malformed LLM JSON gracefully (returns rejected)
 *  5. reviewCreation() includes source code and test results in prompt
 *  6. validateReuse() passes when output matches schema type 'object'
 *  7. validateReuse() passes when output matches schema type 'string'
 *  8. validateReuse() fails when output type mismatches schema
 *  9. validateReuse() fails when required properties missing
 * 10. reviewPromotion() approves when both judges approve
 * 11. reviewPromotion() rejects when safety judge rejects
 * 12. reviewPromotion() rejects when correctness judge rejects
 * 13. reviewPromotion() makes two separate LLM calls (verify mock called twice)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EmergentJudge } from '../EmergentJudge.js';
import type { ToolCandidate } from '../EmergentJudge.js';
import type { EmergentTool } from '../types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal ToolCandidate for creation review tests.
 * Override any field by passing a partial override object.
 */
function makeCandidate(overrides?: Partial<ToolCandidate>): ToolCandidate {
  return {
    name: 'add_numbers',
    description: 'Adds two numbers together.',
    inputSchema: {
      type: 'object',
      properties: {
        a: { type: 'number' },
        b: { type: 'number' },
      },
      required: ['a', 'b'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        sum: { type: 'number' },
      },
    },
    source: 'function execute(input) { return { sum: input.a + input.b }; }',
    implementationMode: 'sandbox',
    allowlist: [],
    testResults: [
      { input: { a: 2, b: 3 }, output: { sum: 5 }, success: true },
      { input: { a: 0, b: 0 }, output: { sum: 0 }, success: true },
    ],
    ...overrides,
  };
}

/**
 * Build a minimal EmergentTool for promotion review tests.
 */
function makeTool(overrides?: Partial<EmergentTool>): EmergentTool {
  return {
    id: 'emergent:test-001',
    name: 'add_numbers',
    description: 'Adds two numbers together.',
    inputSchema: {
      type: 'object',
      properties: { a: { type: 'number' }, b: { type: 'number' } },
    },
    outputSchema: {
      type: 'object',
      properties: { sum: { type: 'number' } },
    },
    implementation: {
      mode: 'sandbox',
      code: 'function execute(input) { return { sum: input.a + input.b }; }',
      allowlist: [],
    },
    tier: 'session',
    createdBy: 'agent-42',
    createdAt: new Date().toISOString(),
    judgeVerdicts: [],
    usageStats: {
      totalUses: 10,
      successCount: 9,
      failureCount: 1,
      avgExecutionTimeMs: 12,
      lastUsedAt: new Date().toISOString(),
      confidenceScore: 0.9,
    },
    source: 'forged by agent-42 during session sess-abc',
    ...overrides,
  };
}

/**
 * Build a JSON string that mimics a successful creation review LLM response.
 */
function approvedCreationResponse(): string {
  return JSON.stringify({
    safety: { passed: true, concerns: [] },
    correctness: { passed: true, failedTests: [] },
    determinism: { likely: true, reasoning: 'Pure arithmetic, fully deterministic.' },
    bounded: { likely: true, reasoning: 'Single addition, O(1) time and space.' },
    confidence: 0.95,
    approved: true,
    reasoning: 'Simple arithmetic tool. No security concerns.',
  });
}

/**
 * Build a JSON string for a creation review where safety failed.
 */
function safetyFailedResponse(): string {
  return JSON.stringify({
    safety: { passed: false, concerns: ['Accesses network without allowlist.'] },
    correctness: { passed: true, failedTests: [] },
    determinism: { likely: true, reasoning: 'Deterministic.' },
    bounded: { likely: true, reasoning: 'Bounded.' },
    confidence: 0.8,
    approved: false,
    reasoning: 'Tool accesses network APIs not declared in allowlist.',
  });
}

/**
 * Build a JSON string for a creation review where correctness failed.
 */
function correctnessFailedResponse(): string {
  return JSON.stringify({
    safety: { passed: true, concerns: [] },
    correctness: { passed: false, failedTests: [1] },
    determinism: { likely: true, reasoning: 'Deterministic.' },
    bounded: { likely: true, reasoning: 'Bounded.' },
    confidence: 0.7,
    approved: false,
    reasoning: 'Test case 1 produced incorrect output.',
  });
}

/**
 * Build a JSON string for a promotion reviewer that approves.
 */
function approvedPromotionResponse(): string {
  return JSON.stringify({
    approved: true,
    confidence: 0.9,
    reasoning: 'Tool is safe and correct.',
  });
}

/**
 * Build a JSON string for a promotion reviewer that rejects.
 */
function rejectedPromotionResponse(): string {
  return JSON.stringify({
    approved: false,
    confidence: 0.6,
    reasoning: 'Concerns about resource usage patterns.',
  });
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('EmergentJudge', () => {
  let generateText: ReturnType<typeof vi.fn>;
  let judge: EmergentJudge;

  beforeEach(() => {
    generateText = vi.fn();
    judge = new EmergentJudge({
      judgeModel: 'gpt-4o-mini',
      promotionModel: 'gpt-4o',
      generateText,
    });
  });

  // =========================================================================
  // reviewCreation
  // =========================================================================

  describe('reviewCreation()', () => {
    it('approves when LLM returns all-passed verdict', async () => {
      generateText.mockResolvedValueOnce(approvedCreationResponse());

      const verdict = await judge.reviewCreation(makeCandidate());

      expect(verdict.approved).toBe(true);
      expect(verdict.confidence).toBe(0.95);
      expect(verdict.safety).toBe(1.0);
      expect(verdict.correctness).toBe(1.0);
      expect(verdict.determinism).toBe(1.0);
      expect(verdict.bounded).toBe(1.0);
      expect(verdict.reasoning).toBe('Simple arithmetic tool. No security concerns.');
    });

    it('rejects when LLM says safety failed', async () => {
      generateText.mockResolvedValueOnce(safetyFailedResponse());

      const verdict = await judge.reviewCreation(makeCandidate());

      expect(verdict.approved).toBe(false);
      expect(verdict.safety).toBe(0.0);
      expect(verdict.correctness).toBe(1.0);
      expect(verdict.reasoning).toContain('network APIs');
    });

    it('rejects when LLM says correctness failed', async () => {
      generateText.mockResolvedValueOnce(correctnessFailedResponse());

      const verdict = await judge.reviewCreation(makeCandidate());

      expect(verdict.approved).toBe(false);
      expect(verdict.safety).toBe(1.0);
      expect(verdict.correctness).toBe(0.0);
      expect(verdict.reasoning).toContain('incorrect output');
    });

    it('handles malformed LLM JSON gracefully (returns rejected)', async () => {
      generateText.mockResolvedValueOnce('This is not valid JSON at all!');

      const verdict = await judge.reviewCreation(makeCandidate());

      expect(verdict.approved).toBe(false);
      expect(verdict.confidence).toBe(0);
      expect(verdict.reasoning).toContain('Failed to parse');
    });

    it('includes source code and test results in prompt', async () => {
      generateText.mockResolvedValueOnce(approvedCreationResponse());

      const candidate = makeCandidate({
        source: 'function execute(input) { return { doubled: input.x * 2 }; }',
        testResults: [
          { input: { x: 5 }, output: { doubled: 10 }, success: true },
        ],
      });

      await judge.reviewCreation(candidate);

      // Verify the prompt sent to generateText includes the source and test results.
      expect(generateText).toHaveBeenCalledTimes(1);
      const prompt = generateText.mock.calls[0][1] as string;

      expect(prompt).toContain('function execute(input) { return { doubled: input.x * 2 }; }');
      expect(prompt).toContain('"x":5');
      expect(prompt).toContain('"doubled":10');
      expect(prompt).toContain('success=true');
    });

    it('uses the judgeModel for creation reviews', async () => {
      generateText.mockResolvedValueOnce(approvedCreationResponse());

      await judge.reviewCreation(makeCandidate());

      expect(generateText).toHaveBeenCalledTimes(1);
      expect(generateText.mock.calls[0][0]).toBe('gpt-4o-mini');
    });

    it('rejects when LLM call throws', async () => {
      generateText.mockRejectedValueOnce(new Error('network error'));

      const verdict = await judge.reviewCreation(makeCandidate());

      expect(verdict.approved).toBe(false);
      expect(verdict.confidence).toBe(0);
      expect(verdict.reasoning).toContain('LLM call failed');
    });

    it('extracts JSON from markdown code fences', async () => {
      const wrapped = '```json\n' + approvedCreationResponse() + '\n```';
      generateText.mockResolvedValueOnce(wrapped);

      const verdict = await judge.reviewCreation(makeCandidate());

      expect(verdict.approved).toBe(true);
      expect(verdict.confidence).toBe(0.95);
    });
  });

  // =========================================================================
  // validateReuse
  // =========================================================================

  describe('validateReuse()', () => {
    it('passes when output matches schema type "object"', () => {
      const schema = {
        type: 'object',
        properties: { sum: { type: 'number' } },
      };
      const output = { sum: 42 };

      const verdict = judge.validateReuse('tool-1', output, schema);

      expect(verdict.valid).toBe(true);
      expect(verdict.schemaErrors).toEqual([]);
      expect(verdict.anomaly).toBe(false);
    });

    it('passes when output matches schema type "string"', () => {
      const schema = { type: 'string' };
      const output = 'hello world';

      const verdict = judge.validateReuse('tool-1', output, schema);

      expect(verdict.valid).toBe(true);
      expect(verdict.schemaErrors).toEqual([]);
    });

    it('fails when output type mismatches schema', () => {
      const schema = { type: 'string' };
      const output = 42;

      const verdict = judge.validateReuse('tool-1', output, schema);

      expect(verdict.valid).toBe(false);
      expect(verdict.schemaErrors.length).toBeGreaterThan(0);
      expect(verdict.schemaErrors[0]).toContain('Expected type "string"');
      expect(verdict.schemaErrors[0]).toContain('number');
    });

    it('fails when required properties missing', () => {
      const schema = {
        type: 'object',
        properties: { a: { type: 'number' }, b: { type: 'number' } },
        required: ['a', 'b'],
      };
      const output = { a: 1 }; // missing 'b'

      const verdict = judge.validateReuse('tool-1', output, schema);

      expect(verdict.valid).toBe(false);
      expect(verdict.schemaErrors).toContain('Missing required property "b".');
    });

    it('passes for schema type "number"', () => {
      const schema = { type: 'number' };
      const verdict = judge.validateReuse('tool-1', 3.14, schema);

      expect(verdict.valid).toBe(true);
      expect(verdict.schemaErrors).toEqual([]);
    });

    it('fails for schema type "number" when output is string', () => {
      const schema = { type: 'number' };
      const verdict = judge.validateReuse('tool-1', 'not a number', schema);

      expect(verdict.valid).toBe(false);
      expect(verdict.schemaErrors[0]).toContain('Expected type "number"');
    });

    it('passes for schema type "boolean"', () => {
      const schema = { type: 'boolean' };
      const verdict = judge.validateReuse('tool-1', true, schema);

      expect(verdict.valid).toBe(true);
    });

    it('passes for schema type "array"', () => {
      const schema = { type: 'array' };
      const verdict = judge.validateReuse('tool-1', [1, 2, 3], schema);

      expect(verdict.valid).toBe(true);
    });

    it('fails for schema type "array" when output is object', () => {
      const schema = { type: 'array' };
      const verdict = judge.validateReuse('tool-1', { a: 1 }, schema);

      expect(verdict.valid).toBe(false);
      expect(verdict.schemaErrors[0]).toContain('Expected type "array"');
    });

    it('fails for schema type "object" when output is null', () => {
      const schema = { type: 'object' };
      const verdict = judge.validateReuse('tool-1', null, schema);

      expect(verdict.valid).toBe(false);
      expect(verdict.schemaErrors[0]).toContain('Expected type "object"');
    });

    it('reports missing declared properties as errors', () => {
      const schema = {
        type: 'object',
        properties: { x: { type: 'number' }, y: { type: 'number' } },
      };
      const output = { x: 1 }; // missing 'y'

      const verdict = judge.validateReuse('tool-1', output, schema);

      expect(verdict.valid).toBe(false);
      expect(verdict.schemaErrors).toContain('Missing property "y" declared in schema.');
    });
  });

  // =========================================================================
  // reviewPromotion
  // =========================================================================

  describe('reviewPromotion()', () => {
    it('approves when both judges approve', async () => {
      generateText
        .mockResolvedValueOnce(approvedPromotionResponse())
        .mockResolvedValueOnce(approvedPromotionResponse());

      const verdict = await judge.reviewPromotion(makeTool());

      expect(verdict.approved).toBe(true);
      expect(verdict.safetyAuditor.approved).toBe(true);
      expect(verdict.correctnessReviewer.approved).toBe(true);
      expect(verdict.confidence).toBe(0.9);
    });

    it('rejects when safety judge rejects', async () => {
      generateText
        .mockResolvedValueOnce(rejectedPromotionResponse())
        .mockResolvedValueOnce(approvedPromotionResponse());

      const verdict = await judge.reviewPromotion(makeTool());

      expect(verdict.approved).toBe(false);
      expect(verdict.safetyAuditor.approved).toBe(false);
      expect(verdict.correctnessReviewer.approved).toBe(true);
    });

    it('rejects when correctness judge rejects', async () => {
      generateText
        .mockResolvedValueOnce(approvedPromotionResponse())
        .mockResolvedValueOnce(rejectedPromotionResponse());

      const verdict = await judge.reviewPromotion(makeTool());

      expect(verdict.approved).toBe(false);
      expect(verdict.safetyAuditor.approved).toBe(true);
      expect(verdict.correctnessReviewer.approved).toBe(false);
    });

    it('makes two separate LLM calls (verify mock called twice)', async () => {
      generateText
        .mockResolvedValueOnce(approvedPromotionResponse())
        .mockResolvedValueOnce(approvedPromotionResponse());

      await judge.reviewPromotion(makeTool());

      expect(generateText).toHaveBeenCalledTimes(2);

      // Both calls should use the promotion model.
      expect(generateText.mock.calls[0][0]).toBe('gpt-4o');
      expect(generateText.mock.calls[1][0]).toBe('gpt-4o');

      // The two prompts should be different (safety vs correctness).
      const prompt1 = generateText.mock.calls[0][1] as string;
      const prompt2 = generateText.mock.calls[1][1] as string;
      expect(prompt1).not.toBe(prompt2);
      expect(prompt1).toContain('security auditor');
      expect(prompt2).toContain('correctness reviewer');
    });

    it('rejects when both LLM calls return malformed JSON', async () => {
      generateText
        .mockResolvedValueOnce('not json')
        .mockResolvedValueOnce('also not json');

      const verdict = await judge.reviewPromotion(makeTool());

      expect(verdict.approved).toBe(false);
      expect(verdict.safetyAuditor.approved).toBe(false);
      expect(verdict.correctnessReviewer.approved).toBe(false);
      expect(verdict.confidence).toBe(0);
    });

    it('rejects when LLM calls throw errors', async () => {
      generateText
        .mockRejectedValueOnce(new Error('timeout'))
        .mockRejectedValueOnce(new Error('timeout'));

      const verdict = await judge.reviewPromotion(makeTool());

      expect(verdict.approved).toBe(false);
      expect(verdict.safetyAuditor.approved).toBe(false);
      expect(verdict.correctnessReviewer.approved).toBe(false);
    });

    it('computes combined confidence as minimum of both sub-scores', async () => {
      generateText
        .mockResolvedValueOnce(JSON.stringify({ approved: true, confidence: 0.95, reasoning: 'Safe.' }))
        .mockResolvedValueOnce(JSON.stringify({ approved: true, confidence: 0.75, reasoning: 'Correct.' }));

      const verdict = await judge.reviewPromotion(makeTool());

      expect(verdict.approved).toBe(true);
      expect(verdict.confidence).toBe(0.75); // min(0.95, 0.75)
    });
  });
});
