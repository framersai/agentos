/**
 * @fileoverview Unit tests for {@link CheckGroundingTool}.
 *
 * All tests use mocked {@link GroundingChecker} and {@link ClaimExtractor}
 * instances backed by a mock NLI pipeline — no real HuggingFace models or
 * ONNX runtime are loaded.
 *
 * Test coverage:
 *  1. Tool metadata properties (id, name, category, hasSideEffects)
 *  2. Execute with supported claims returns grounded=true
 *  3. Execute with contradicted claims returns grounded=false
 *  4. Wraps string sources as synthetic RagRetrievedChunk
 *  5. Handles empty text gracefully
 *  6. Handles empty sources gracefully
 *  7. Returns empty result when no claims are extracted
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ISharedServiceRegistry } from '../../../../src/extensions/ISharedServiceRegistry';
import { CheckGroundingTool } from '../../../../src/extensions/packs/grounding-guard/tools/CheckGroundingTool';
import { GroundingChecker } from '../../../../src/extensions/packs/grounding-guard/GroundingChecker';
import { ClaimExtractor } from '../../../../src/extensions/packs/grounding-guard/ClaimExtractor';
import type { ToolExecutionContext } from '../../../../src/core/tools/ITool';

// ---------------------------------------------------------------------------
// Test fixture helpers
// ---------------------------------------------------------------------------

/** NLI output where ENTAILMENT is clearly above 0.7 threshold. */
const ENTAILMENT_RESULT = [
  { label: 'ENTAILMENT', score: 0.92 },
  { label: 'NEUTRAL', score: 0.05 },
  { label: 'CONTRADICTION', score: 0.03 },
];

/** NLI output where CONTRADICTION is clearly above 0.7 threshold. */
const CONTRADICTION_RESULT = [
  { label: 'ENTAILMENT', score: 0.04 },
  { label: 'NEUTRAL', score: 0.07 },
  { label: 'CONTRADICTION', score: 0.89 },
];

/**
 * Build a mock {@link ISharedServiceRegistry} with a pre-configured NLI
 * pipeline.
 */
function createMockRegistry(
  nliResult: { label: string; score: number }[],
): ISharedServiceRegistry {
  const pipeline = vi.fn(async () => nliResult);
  return {
    getOrCreate: vi.fn(async () => pipeline),
    has: vi.fn(() => false),
    release: vi.fn(async () => {}),
    releaseAll: vi.fn(async () => {}),
  };
}

/**
 * Minimal {@link ToolExecutionContext} for test invocations.
 */
const mockContext: ToolExecutionContext = {
  gmiId: 'gmi-test',
  personaId: 'persona-test',
  userContext: { id: 'user-test' } as any,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CheckGroundingTool', () => {
  // -------------------------------------------------------------------------
  // 1. Tool metadata
  // -------------------------------------------------------------------------

  describe('tool metadata', () => {
    it('has correct id', () => {
      const registry = createMockRegistry(ENTAILMENT_RESULT);
      const checker = new GroundingChecker(registry);
      const extractor = new ClaimExtractor();
      const tool = new CheckGroundingTool(checker, extractor);

      expect(tool.id).toBe('check_grounding');
    });

    it('has correct name', () => {
      const registry = createMockRegistry(ENTAILMENT_RESULT);
      const checker = new GroundingChecker(registry);
      const extractor = new ClaimExtractor();
      const tool = new CheckGroundingTool(checker, extractor);

      expect(tool.name).toBe('check_grounding');
    });

    it('has category "security"', () => {
      const registry = createMockRegistry(ENTAILMENT_RESULT);
      const checker = new GroundingChecker(registry);
      const extractor = new ClaimExtractor();
      const tool = new CheckGroundingTool(checker, extractor);

      expect(tool.category).toBe('security');
    });

    it('has hasSideEffects=false', () => {
      const registry = createMockRegistry(ENTAILMENT_RESULT);
      const checker = new GroundingChecker(registry);
      const extractor = new ClaimExtractor();
      const tool = new CheckGroundingTool(checker, extractor);

      expect(tool.hasSideEffects).toBe(false);
    });

    it('has version "1.0.0"', () => {
      const registry = createMockRegistry(ENTAILMENT_RESULT);
      const checker = new GroundingChecker(registry);
      const extractor = new ClaimExtractor();
      const tool = new CheckGroundingTool(checker, extractor);

      expect(tool.version).toBe('1.0.0');
    });

    it('has inputSchema with required text and sources', () => {
      const registry = createMockRegistry(ENTAILMENT_RESULT);
      const checker = new GroundingChecker(registry);
      const extractor = new ClaimExtractor();
      const tool = new CheckGroundingTool(checker, extractor);

      expect(tool.inputSchema.required).toContain('text');
      expect(tool.inputSchema.required).toContain('sources');
    });
  });

  // -------------------------------------------------------------------------
  // 2. Execute with supported claims
  // -------------------------------------------------------------------------

  describe('execute with supported claims', () => {
    it('returns grounded=true when all claims are supported', async () => {
      const registry = createMockRegistry(ENTAILMENT_RESULT);
      const checker = new GroundingChecker(registry);
      const extractor = new ClaimExtractor();
      const tool = new CheckGroundingTool(checker, extractor);

      const result = await tool.execute(
        {
          text: 'Paris is the capital of France.',
          sources: ['Paris is the capital city of France.'],
        },
        mockContext,
      );

      expect(result.success).toBe(true);
      expect(result.output).toBeDefined();
      expect(result.output!.grounded).toBe(true);
      expect(result.output!.supportedCount).toBeGreaterThan(0);
      expect(result.output!.contradictedCount).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // 3. Execute with contradicted claims
  // -------------------------------------------------------------------------

  describe('execute with contradicted claims', () => {
    it('returns grounded=false when claims are contradicted', async () => {
      const registry = createMockRegistry(CONTRADICTION_RESULT);
      const checker = new GroundingChecker(registry);
      const extractor = new ClaimExtractor();
      const tool = new CheckGroundingTool(checker, extractor);

      const result = await tool.execute(
        {
          text: 'The sky is green.',
          sources: ['The sky is blue during a clear day.'],
        },
        mockContext,
      );

      expect(result.success).toBe(true);
      expect(result.output).toBeDefined();
      expect(result.output!.grounded).toBe(false);
      expect(result.output!.contradictedCount).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------------
  // 4. Wraps string sources as synthetic RagRetrievedChunk
  // -------------------------------------------------------------------------

  describe('synthetic source wrapping', () => {
    it('wraps string sources with relevanceScore 1.0', async () => {
      // Use entailment to verify the tool successfully processes the sources.
      const registry = createMockRegistry(ENTAILMENT_RESULT);

      // Track what the NLI pipeline receives to verify source content.
      const receivedPairs: string[] = [];
      const pipeline = vi.fn(async (input: { text: string; text_pair: string }) => {
        receivedPairs.push(input.text_pair);
        return ENTAILMENT_RESULT;
      });
      (registry.getOrCreate as any).mockResolvedValue(pipeline);

      const checker = new GroundingChecker(registry);
      const extractor = new ClaimExtractor();
      const tool = new CheckGroundingTool(checker, extractor);

      await tool.execute(
        {
          text: 'The capital is Paris.',
          sources: ['Source document one.', 'Source document two.'],
        },
        mockContext,
      );

      // Verify the NLI pipeline received the source texts as text_pair.
      expect(receivedPairs).toContain('Source document one.');
      expect(receivedPairs).toContain('Source document two.');
    });
  });

  // -------------------------------------------------------------------------
  // 5. Empty text handling
  // -------------------------------------------------------------------------

  describe('edge cases', () => {
    it('returns error for empty text', async () => {
      const registry = createMockRegistry(ENTAILMENT_RESULT);
      const checker = new GroundingChecker(registry);
      const extractor = new ClaimExtractor();
      const tool = new CheckGroundingTool(checker, extractor);

      const result = await tool.execute(
        { text: '', sources: ['Some source.'] },
        mockContext,
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('returns error for empty sources array', async () => {
      const registry = createMockRegistry(ENTAILMENT_RESULT);
      const checker = new GroundingChecker(registry);
      const extractor = new ClaimExtractor();
      const tool = new CheckGroundingTool(checker, extractor);

      const result = await tool.execute(
        { text: 'Some claim.', sources: [] },
        mockContext,
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('returns grounded=true with 0 claims when text has no verifiable claims', async () => {
      const registry = createMockRegistry(ENTAILMENT_RESULT);
      const checker = new GroundingChecker(registry);
      const extractor = new ClaimExtractor();
      const tool = new CheckGroundingTool(checker, extractor);

      // Questions are not verifiable claims.
      const result = await tool.execute(
        { text: 'Is this a question?', sources: ['Some source.'] },
        mockContext,
      );

      expect(result.success).toBe(true);
      expect(result.output).toBeDefined();
      expect(result.output!.totalClaims).toBe(0);
      expect(result.output!.grounded).toBe(true);
    });
  });
});
