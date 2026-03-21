/**
 * @fileoverview Unit tests for {@link GroundingGuardrail}.
 *
 * All tests use a fully-mocked {@link ISharedServiceRegistry} and mock NLI
 * pipeline — no real HuggingFace models or ONNX runtime are loaded.
 *
 * Test coverage:
 *  1. evaluateInput always returns null (grounding is output-only)
 *  2. evaluateOutput returns null when no ragSources provided
 *  3. evaluateOutput returns null when ragSources is empty
 *  4. Streaming: contradiction on sentence boundary → FLAG with GROUNDING_CONTRADICTION
 *  5. Final: comprehensive check with aggregate results
 *  6. Final: unverifiable ratio exceeding threshold → FLAG with GROUNDING_UNVERIFIABLE
 *  7. Reason codes in metadata
 *  8. Graceful degradation when NLI unavailable
 *  9. Input scope bypasses output evaluation
 * 10. Block action when contradictionAction is 'block'
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ISharedServiceRegistry } from '../../../../src/extensions/ISharedServiceRegistry';
import { GroundingGuardrail } from '../../../../src/extensions/packs/grounding-guard/GroundingGuardrail';
import type { GroundingGuardOptions } from '../../../../src/extensions/packs/grounding-guard/types';
import type { GuardrailOutputPayload, GuardrailInputPayload } from '../../../../src/core/guardrails/IGuardrailService';
import { GuardrailAction } from '../../../../src/core/guardrails/IGuardrailService';
import { AgentOSResponseChunkType } from '../../../../src/api/types/AgentOSResponse';
import type { RagRetrievedChunk } from '../../../../src/rag/IRetrievalAugmentor';

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

/** NLI output where neither threshold is met — ambiguous neutral. */
const NEUTRAL_RESULT = [
  { label: 'ENTAILMENT', score: 0.35 },
  { label: 'NEUTRAL', score: 0.50 },
  { label: 'CONTRADICTION', score: 0.15 },
];

/**
 * Build a mock {@link ISharedServiceRegistry} with a pre-configured NLI
 * pipeline that returns `nliResult` for every call.
 *
 * @param nliResult - The label array the NLI pipeline should return.
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
 * Build a mock registry whose NLI pipeline load fails.
 */
function createFailingRegistry(): ISharedServiceRegistry {
  return {
    getOrCreate: vi.fn(async () => {
      throw new Error('ONNX runtime not available');
    }),
    has: vi.fn(() => false),
    release: vi.fn(async () => {}),
    releaseAll: vi.fn(async () => {}),
  };
}

/**
 * Build a minimal RAG source chunk fixture.
 */
function makeChunk(id: string, content: string, relevanceScore = 0.9): RagRetrievedChunk {
  return {
    id,
    content,
    originalDocumentId: `doc-${id}`,
    relevanceScore,
  };
}

/**
 * Build a TEXT_DELTA chunk fixture for streaming tests.
 */
function makeTextDeltaChunk(streamId: string, textDelta: string): any {
  return {
    type: AgentOSResponseChunkType.TEXT_DELTA,
    streamId,
    textDelta,
    gmiInstanceId: 'gmi-1',
    personaId: 'persona-1',
    isFinal: false,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Build a FINAL_RESPONSE chunk fixture.
 */
function makeFinalChunk(streamId: string, finalResponseText: string): any {
  return {
    type: AgentOSResponseChunkType.FINAL_RESPONSE,
    streamId,
    finalResponseText,
    gmiInstanceId: 'gmi-1',
    personaId: 'persona-1',
    isFinal: true,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Build a minimal GuardrailOutputPayload.
 */
function makeOutputPayload(
  chunk: any,
  ragSources?: RagRetrievedChunk[],
): GuardrailOutputPayload {
  return {
    context: {
      userId: 'user-1',
      sessionId: 'session-1',
    },
    chunk,
    ragSources,
  };
}

/**
 * Build a minimal GuardrailInputPayload.
 */
function makeInputPayload(): GuardrailInputPayload {
  return {
    context: {
      userId: 'user-1',
      sessionId: 'session-1',
    },
    input: { textInput: 'What is the capital of France?' } as any,
  };
}

// Default options for most tests.
const defaultOptions: GroundingGuardOptions = {};

// Default RAG sources for tests.
const defaultSources = [makeChunk('src-1', 'Paris is the capital of France.')];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GroundingGuardrail', () => {
  // -------------------------------------------------------------------------
  // 1. evaluateInput always returns null
  // -------------------------------------------------------------------------

  describe('evaluateInput', () => {
    it('always returns null (grounding is output-only)', async () => {
      const guardrail = new GroundingGuardrail(createMockRegistry(ENTAILMENT_RESULT), defaultOptions);
      const result = await guardrail.evaluateInput!(makeInputPayload());
      expect(result).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // 2-3. No ragSources → null
  // -------------------------------------------------------------------------

  describe('evaluateOutput with missing or empty ragSources', () => {
    it('returns null when ragSources is undefined', async () => {
      const guardrail = new GroundingGuardrail(createMockRegistry(ENTAILMENT_RESULT), defaultOptions);
      const chunk = makeFinalChunk('s1', 'The sky is blue.');
      const payload = makeOutputPayload(chunk, undefined);
      const result = await guardrail.evaluateOutput!(payload);
      expect(result).toBeNull();
    });

    it('returns null when ragSources is empty array', async () => {
      const guardrail = new GroundingGuardrail(createMockRegistry(ENTAILMENT_RESULT), defaultOptions);
      const chunk = makeFinalChunk('s1', 'The sky is blue.');
      const payload = makeOutputPayload(chunk, []);
      const result = await guardrail.evaluateOutput!(payload);
      expect(result).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // 4. Streaming: contradiction on sentence boundary
  // -------------------------------------------------------------------------

  describe('streaming TEXT_DELTA handling', () => {
    it('returns FLAG with GROUNDING_CONTRADICTION when a sentence is contradicted', async () => {
      const guardrail = new GroundingGuardrail(
        createMockRegistry(CONTRADICTION_RESULT),
        defaultOptions,
      );

      // Send text delta that forms a complete sentence ending with ". ".
      const chunk = makeTextDeltaChunk('stream-1', 'The sky is green. ');
      const payload = makeOutputPayload(chunk, defaultSources);
      const result = await guardrail.evaluateOutput!(payload);

      expect(result).not.toBeNull();
      expect(result!.action).toBe(GuardrailAction.FLAG);
      expect(result!.reasonCode).toBe('GROUNDING_CONTRADICTION');
    });

    it('includes claim and verdict in metadata', async () => {
      const guardrail = new GroundingGuardrail(
        createMockRegistry(CONTRADICTION_RESULT),
        defaultOptions,
      );

      const chunk = makeTextDeltaChunk('stream-2', 'The sky is green. ');
      const payload = makeOutputPayload(chunk, defaultSources);
      const result = await guardrail.evaluateOutput!(payload);

      expect(result).not.toBeNull();
      expect(result!.metadata).toBeDefined();
      expect(result!.metadata!.claim).toBe('The sky is green.');
      expect(result!.metadata!.verdict).toBe('contradicted');
      expect(result!.metadata!.phase).toBe('streaming');
    });

    it('returns null for supported sentences during streaming', async () => {
      const guardrail = new GroundingGuardrail(
        createMockRegistry(ENTAILMENT_RESULT),
        defaultOptions,
      );

      const chunk = makeTextDeltaChunk('stream-3', 'Paris is the capital. ');
      const payload = makeOutputPayload(chunk, defaultSources);
      const result = await guardrail.evaluateOutput!(payload);

      // Supported sentences pass through during streaming.
      expect(result).toBeNull();
    });

    it('returns null when no sentence boundary is reached', async () => {
      const guardrail = new GroundingGuardrail(
        createMockRegistry(CONTRADICTION_RESULT),
        defaultOptions,
      );

      // Partial sentence without boundary.
      const chunk = makeTextDeltaChunk('stream-4', 'The sky is');
      const payload = makeOutputPayload(chunk, defaultSources);
      const result = await guardrail.evaluateOutput!(payload);

      expect(result).toBeNull();
    });

    it('skips questions during streaming', async () => {
      const guardrail = new GroundingGuardrail(
        createMockRegistry(CONTRADICTION_RESULT),
        defaultOptions,
      );

      const chunk = makeTextDeltaChunk('stream-5', 'Is the sky blue? ');
      const payload = makeOutputPayload(chunk, defaultSources);
      const result = await guardrail.evaluateOutput!(payload);

      // Questions are filtered out — should not trigger NLI.
      expect(result).toBeNull();
    });

    it('returns BLOCK when contradictionAction is block', async () => {
      const guardrail = new GroundingGuardrail(
        createMockRegistry(CONTRADICTION_RESULT),
        { contradictionAction: 'block' },
      );

      const chunk = makeTextDeltaChunk('stream-6', 'The sky is green. ');
      const payload = makeOutputPayload(chunk, defaultSources);
      const result = await guardrail.evaluateOutput!(payload);

      expect(result).not.toBeNull();
      expect(result!.action).toBe(GuardrailAction.BLOCK);
      expect(result!.reasonCode).toBe('GROUNDING_CONTRADICTION');
    });
  });

  // -------------------------------------------------------------------------
  // 5. Final: comprehensive check
  // -------------------------------------------------------------------------

  describe('final response handling', () => {
    it('performs comprehensive check on FINAL_RESPONSE and returns null when grounded', async () => {
      const guardrail = new GroundingGuardrail(
        createMockRegistry(ENTAILMENT_RESULT),
        defaultOptions,
      );

      const chunk = makeFinalChunk('stream-10', 'Paris is the capital of France.');
      const payload = makeOutputPayload(chunk, defaultSources);
      const result = await guardrail.evaluateOutput!(payload);

      // All claims supported — should pass through.
      expect(result).toBeNull();
    });

    it('returns FLAG with GROUNDING_CONTRADICTION when claims are contradicted in final', async () => {
      const guardrail = new GroundingGuardrail(
        createMockRegistry(CONTRADICTION_RESULT),
        defaultOptions,
      );

      const chunk = makeFinalChunk('stream-11', 'The sky is green.');
      const payload = makeOutputPayload(chunk, defaultSources);
      const result = await guardrail.evaluateOutput!(payload);

      expect(result).not.toBeNull();
      expect(result!.action).toBe(GuardrailAction.FLAG);
      expect(result!.reasonCode).toBe('GROUNDING_CONTRADICTION');
    });

    it('includes groundingResult in metadata for final checks', async () => {
      const guardrail = new GroundingGuardrail(
        createMockRegistry(CONTRADICTION_RESULT),
        defaultOptions,
      );

      const chunk = makeFinalChunk('stream-12', 'The sky is green.');
      const payload = makeOutputPayload(chunk, defaultSources);
      const result = await guardrail.evaluateOutput!(payload);

      expect(result).not.toBeNull();
      expect(result!.metadata).toBeDefined();
      expect(result!.metadata!.groundingResult).toBeDefined();
      expect(result!.metadata!.phase).toBe('final');

      // Verify the grounding result has the expected shape.
      const gr = result!.metadata!.groundingResult as any;
      expect(gr.contradictedCount).toBeGreaterThan(0);
      expect(gr.totalClaims).toBeGreaterThan(0);
    });

    it('returns null for empty finalResponseText', async () => {
      const guardrail = new GroundingGuardrail(
        createMockRegistry(CONTRADICTION_RESULT),
        defaultOptions,
      );

      const chunk = makeFinalChunk('stream-13', '');
      const payload = makeOutputPayload(chunk, defaultSources);
      const result = await guardrail.evaluateOutput!(payload);

      expect(result).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // 6. Unverifiable ratio
  // -------------------------------------------------------------------------

  describe('unverifiable ratio handling', () => {
    it('returns FLAG with GROUNDING_UNVERIFIABLE when ratio exceeds threshold', async () => {
      // All claims will be neutral (unverifiable) with ratio 1.0 > default 0.5.
      const guardrail = new GroundingGuardrail(
        createMockRegistry(NEUTRAL_RESULT),
        { maxUnverifiableRatio: 0.3 },
      );

      const chunk = makeFinalChunk('stream-20', 'The water is warm.');
      const payload = makeOutputPayload(chunk, defaultSources);
      const result = await guardrail.evaluateOutput!(payload);

      expect(result).not.toBeNull();
      expect(result!.reasonCode).toBe('GROUNDING_UNVERIFIABLE');
    });

    it('returns BLOCK when unverifiableAction is block', async () => {
      const guardrail = new GroundingGuardrail(
        createMockRegistry(NEUTRAL_RESULT),
        { maxUnverifiableRatio: 0.3, unverifiableAction: 'block' },
      );

      const chunk = makeFinalChunk('stream-21', 'The water is warm.');
      const payload = makeOutputPayload(chunk, defaultSources);
      const result = await guardrail.evaluateOutput!(payload);

      expect(result).not.toBeNull();
      expect(result!.action).toBe(GuardrailAction.BLOCK);
    });
  });

  // -------------------------------------------------------------------------
  // 7. Reason codes in metadata
  // -------------------------------------------------------------------------

  describe('reason codes', () => {
    it('uses GROUNDING_CONTRADICTION for contradicted claims', async () => {
      const guardrail = new GroundingGuardrail(
        createMockRegistry(CONTRADICTION_RESULT),
        defaultOptions,
      );

      const chunk = makeFinalChunk('stream-30', 'The sky is green.');
      const payload = makeOutputPayload(chunk, defaultSources);
      const result = await guardrail.evaluateOutput!(payload);

      expect(result!.reasonCode).toBe('GROUNDING_CONTRADICTION');
    });

    it('uses GROUNDING_UNVERIFIABLE for high unverifiable ratio', async () => {
      const guardrail = new GroundingGuardrail(
        createMockRegistry(NEUTRAL_RESULT),
        { maxUnverifiableRatio: 0.0 },
      );

      const chunk = makeFinalChunk('stream-31', 'Some obscure fact.');
      const payload = makeOutputPayload(chunk, defaultSources);
      const result = await guardrail.evaluateOutput!(payload);

      expect(result).not.toBeNull();
      expect(result!.reasonCode).toBe('GROUNDING_UNVERIFIABLE');
    });
  });

  // -------------------------------------------------------------------------
  // 8. Graceful degradation when NLI unavailable
  // -------------------------------------------------------------------------

  describe('graceful degradation', () => {
    it('returns null (pass-through) when NLI pipeline fails during streaming', async () => {
      const guardrail = new GroundingGuardrail(
        createFailingRegistry(),
        defaultOptions,
      );

      const chunk = makeTextDeltaChunk('stream-40', 'The sky is green. ');
      const payload = makeOutputPayload(chunk, defaultSources);
      const result = await guardrail.evaluateOutput!(payload);

      // NLI failure should degrade gracefully — pass through.
      expect(result).toBeNull();
    });

    it('returns null (pass-through) when NLI pipeline fails during final check', async () => {
      // When NLI fails, checkClaims returns all unverifiable with confidence 0.
      // With default maxUnverifiableRatio=0.5, ratio 1.0 > 0.5 would normally FLAG.
      // But the checker still produces results (unverifiable), not throw errors.
      // So this test verifies the guardrail still functions (may FLAG for high unverifiable).
      const guardrail = new GroundingGuardrail(
        createFailingRegistry(),
        // Set high ratio so it doesn't trigger on unverifiable.
        { maxUnverifiableRatio: 1.0 },
      );

      const chunk = makeFinalChunk('stream-41', 'The sky is blue.');
      const payload = makeOutputPayload(chunk, defaultSources);
      const result = await guardrail.evaluateOutput!(payload);

      // With maxUnverifiableRatio=1.0, even all-unverifiable passes through.
      expect(result).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // 9. Scope handling
  // -------------------------------------------------------------------------

  describe('guardrail scope', () => {
    it('returns null for output when scope is input-only', async () => {
      const guardrail = new GroundingGuardrail(
        createMockRegistry(CONTRADICTION_RESULT),
        { guardrailScope: 'input' },
      );

      const chunk = makeFinalChunk('stream-50', 'The sky is green.');
      const payload = makeOutputPayload(chunk, defaultSources);
      const result = await guardrail.evaluateOutput!(payload);

      // Scope is input-only, so output evaluation is skipped.
      expect(result).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // 10. Config shape
  // -------------------------------------------------------------------------

  describe('config', () => {
    it('has evaluateStreamingChunks=true and canSanitize=false', () => {
      const guardrail = new GroundingGuardrail(createMockRegistry(ENTAILMENT_RESULT), defaultOptions);
      expect(guardrail.config.evaluateStreamingChunks).toBe(true);
      expect(guardrail.config.canSanitize).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // 11. clearBuffers
  // -------------------------------------------------------------------------

  describe('clearBuffers', () => {
    it('clears per-stream buffers without throwing', () => {
      const guardrail = new GroundingGuardrail(createMockRegistry(ENTAILMENT_RESULT), defaultOptions);
      // Should not throw even when called without prior streaming.
      expect(() => guardrail.clearBuffers()).not.toThrow();
    });
  });
});
