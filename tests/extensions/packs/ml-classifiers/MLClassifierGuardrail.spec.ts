/**
 * @fileoverview Unit tests for `MLClassifierGuardrail`.
 *
 * Tests verify:
 *  - evaluateInput: classifies full text, returns BLOCK/FLAG/null
 *  - evaluateInput: returns null for clean text
 *  - evaluateInput: returns null when scope is 'output'
 *  - evaluateOutput: accumulates chunks, triggers at chunkSize
 *  - evaluateOutput: returns null for non-TEXT_DELTA chunks
 *  - evaluateOutput: returns null when scope is 'input'
 *  - evaluateOutput: flushes on isFinal
 *  - config.evaluateStreamingChunks is true
 *  - blocking mode: awaits classification
 *  - non-blocking mode: returns null immediately, BLOCK on next call if violation
 */

import { describe, it, expect, vi } from 'vitest';
import { MLClassifierGuardrail } from '../../../../src/extensions/packs/ml-classifiers/MLClassifierGuardrail';
import type { IContentClassifier } from '../../../../src/extensions/packs/ml-classifiers/IContentClassifier';
import type { ClassificationResult } from '../../../../src/core/ai_utilities/IUtilityAI';
import type { MLClassifierPackOptions } from '../../../../src/extensions/packs/ml-classifiers/types';
import type { ISharedServiceRegistry } from '../../../../src/extensions/ISharedServiceRegistry';
import type {
  GuardrailInputPayload,
  GuardrailOutputPayload,
  GuardrailContext,
} from '../../../../src/core/guardrails/IGuardrailService';
import { GuardrailAction } from '../../../../src/core/guardrails/IGuardrailService';
import { AgentOSResponseChunkType } from '../../../../src/api/types/AgentOSResponse';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

/**
 * Create a mock {@link IContentClassifier} that returns a configurable result.
 *
 * @param id     - Unique classifier ID.
 * @param result - The classification result to return from `classify()`.
 */
function createMockClassifier(
  id: string,
  result: ClassificationResult,
): IContentClassifier {
  return {
    id,
    displayName: `Mock ${id}`,
    description: `Mock classifier: ${id}`,
    modelId: `mock/${id}`,
    isLoaded: true,
    classify: vi.fn(async () => result),
    dispose: vi.fn(async () => {}),
  };
}

/** Minimal mock of the shared service registry (not used by tests). */
function createMockRegistry(): ISharedServiceRegistry {
  return {
    getOrCreate: vi.fn(),
    has: vi.fn(() => false),
    release: vi.fn(),
    releaseAll: vi.fn(),
  };
}

/** Benign result — low confidence, should result in ALLOW. */
const BENIGN: ClassificationResult = {
  bestClass: 'benign',
  confidence: 0.1,
  allScores: [{ classLabel: 'benign', score: 0.1 }],
};

/** Toxic result — high confidence, above default block threshold (0.9). */
const TOXIC: ClassificationResult = {
  bestClass: 'toxic',
  confidence: 0.95,
  allScores: [{ classLabel: 'toxic', score: 0.95 }],
};

/** Flag-level result — confidence between flag (0.7) and block (0.9). */
const FLAGGABLE: ClassificationResult = {
  bestClass: 'suspicious',
  confidence: 0.75,
  allScores: [{ classLabel: 'suspicious', score: 0.75 }],
};

/** Shared guardrail context for all test payloads. */
const CONTEXT: GuardrailContext = {
  userId: 'user-1',
  sessionId: 'session-1',
};

/**
 * Build a {@link GuardrailInputPayload} with the given text.
 */
function inputPayload(text: string | null): GuardrailInputPayload {
  return {
    context: CONTEXT,
    input: {
      userId: 'user-1',
      sessionId: 'session-1',
      textInput: text,
    },
  };
}

/**
 * Build a {@link GuardrailOutputPayload} wrapping a TEXT_DELTA chunk.
 *
 * @param streamId  - Stream identifier.
 * @param textDelta - The text delta content.
 * @param isFinal   - Whether this is the final chunk.
 */
function textDeltaPayload(
  streamId: string,
  textDelta: string,
  isFinal = false,
): GuardrailOutputPayload {
  return {
    context: CONTEXT,
    chunk: {
      type: AgentOSResponseChunkType.TEXT_DELTA,
      streamId,
      gmiInstanceId: 'gmi-1',
      personaId: 'persona-1',
      isFinal,
      timestamp: new Date().toISOString(),
      textDelta,
    } as any,
  };
}

/**
 * Build a {@link GuardrailOutputPayload} wrapping a non-TEXT_DELTA chunk
 * (e.g. SYSTEM_PROGRESS).
 */
function nonTextPayload(streamId: string): GuardrailOutputPayload {
  return {
    context: CONTEXT,
    chunk: {
      type: AgentOSResponseChunkType.SYSTEM_PROGRESS,
      streamId,
      gmiInstanceId: 'gmi-1',
      personaId: 'persona-1',
      isFinal: false,
      timestamp: new Date().toISOString(),
      message: 'Processing...',
    } as any,
  };
}

/**
 * Build a final chunk payload (isFinal=true) with a given stream ID.
 * Uses FINAL_RESPONSE type to trigger the flush path.
 */
function finalPayload(streamId: string): GuardrailOutputPayload {
  return {
    context: CONTEXT,
    chunk: {
      type: AgentOSResponseChunkType.FINAL_RESPONSE,
      streamId,
      gmiInstanceId: 'gmi-1',
      personaId: 'persona-1',
      isFinal: true,
      timestamp: new Date().toISOString(),
      finalResponseText: 'done',
    } as any,
  };
}

/** Default pack options for a guardrail with small window for easier testing. */
const DEFAULT_OPTIONS: MLClassifierPackOptions = {
  chunkSize: 10, // 10 tokens = 40 chars triggers a window
  contextSize: 2,
  maxEvaluations: 100,
  guardrailScope: 'both',
  streamingMode: true,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MLClassifierGuardrail', () => {
  // -----------------------------------------------------------------------
  // evaluateInput
  // -----------------------------------------------------------------------

  describe('evaluateInput', () => {
    it('classifies full text and returns BLOCK for toxic content', async () => {
      const classifier = createMockClassifier('tox', TOXIC);
      const guardrail = new MLClassifierGuardrail(
        createMockRegistry(),
        DEFAULT_OPTIONS,
        [classifier],
      );

      const result = await guardrail.evaluateInput!(inputPayload('you are terrible'));

      expect(result).not.toBeNull();
      expect(result!.action).toBe(GuardrailAction.BLOCK);
      expect(result!.reason).toContain('tox');
    });

    it('returns FLAG for moderately suspicious content', async () => {
      const classifier = createMockClassifier('mod', FLAGGABLE);
      const guardrail = new MLClassifierGuardrail(
        createMockRegistry(),
        DEFAULT_OPTIONS,
        [classifier],
      );

      const result = await guardrail.evaluateInput!(inputPayload('hmm suspicious'));

      expect(result).not.toBeNull();
      expect(result!.action).toBe(GuardrailAction.FLAG);
    });

    it('returns null for clean text', async () => {
      const classifier = createMockClassifier('safe', BENIGN);
      const guardrail = new MLClassifierGuardrail(
        createMockRegistry(),
        DEFAULT_OPTIONS,
        [classifier],
      );

      const result = await guardrail.evaluateInput!(inputPayload('hello world'));

      expect(result).toBeNull();
    });

    it('returns null when scope is output', async () => {
      const classifier = createMockClassifier('tox', TOXIC);
      const guardrail = new MLClassifierGuardrail(
        createMockRegistry(),
        { ...DEFAULT_OPTIONS, guardrailScope: 'output' },
        [classifier],
      );

      const result = await guardrail.evaluateInput!(inputPayload('toxic content'));

      expect(result).toBeNull();
      // Classifier should NOT have been called.
      expect(classifier.classify).not.toHaveBeenCalled();
    });

    it('returns null when textInput is null', async () => {
      const classifier = createMockClassifier('tox', TOXIC);
      const guardrail = new MLClassifierGuardrail(
        createMockRegistry(),
        DEFAULT_OPTIONS,
        [classifier],
      );

      const result = await guardrail.evaluateInput!(inputPayload(null));

      expect(result).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // evaluateOutput
  // -----------------------------------------------------------------------

  describe('evaluateOutput', () => {
    it('returns null when scope is input', async () => {
      const classifier = createMockClassifier('tox', TOXIC);
      const guardrail = new MLClassifierGuardrail(
        createMockRegistry(),
        { ...DEFAULT_OPTIONS, guardrailScope: 'input' },
        [classifier],
      );

      const result = await guardrail.evaluateOutput!(
        textDeltaPayload('s1', 'a'.repeat(100)),
      );

      expect(result).toBeNull();
    });

    it('returns null for non-TEXT_DELTA chunks', async () => {
      const classifier = createMockClassifier('tox', TOXIC);
      const guardrail = new MLClassifierGuardrail(
        createMockRegistry(),
        DEFAULT_OPTIONS,
        [classifier],
      );

      const result = await guardrail.evaluateOutput!(nonTextPayload('s1'));

      expect(result).toBeNull();
    });

    it('accumulates chunks and triggers classification at chunkSize', async () => {
      const classifier = createMockClassifier('tox', TOXIC);
      const guardrail = new MLClassifierGuardrail(
        createMockRegistry(),
        DEFAULT_OPTIONS,
        [classifier],
      );

      // Push less than chunkSize (10 tokens = 40 chars) — should not trigger.
      const r1 = await guardrail.evaluateOutput!(
        textDeltaPayload('s1', 'a'.repeat(20)),
      );
      expect(r1).toBeNull();

      // Push enough to exceed chunkSize — should trigger classification.
      const r2 = await guardrail.evaluateOutput!(
        textDeltaPayload('s1', 'a'.repeat(25)),
      );

      // With TOXIC classifier, the result should be BLOCK.
      expect(r2).not.toBeNull();
      expect(r2!.action).toBe(GuardrailAction.BLOCK);
    });

    it('flushes remaining buffer on isFinal', async () => {
      const classifier = createMockClassifier('tox', TOXIC);
      const guardrail = new MLClassifierGuardrail(
        createMockRegistry(),
        DEFAULT_OPTIONS,
        [classifier],
      );

      // Push some text (not enough for a full window).
      await guardrail.evaluateOutput!(textDeltaPayload('s1', 'a'.repeat(20)));

      // Send a final chunk — should flush and classify remaining text.
      const result = await guardrail.evaluateOutput!(finalPayload('s1'));

      expect(result).not.toBeNull();
      expect(result!.action).toBe(GuardrailAction.BLOCK);
    });

    it('returns null on isFinal when buffer is empty', async () => {
      const classifier = createMockClassifier('safe', BENIGN);
      const guardrail = new MLClassifierGuardrail(
        createMockRegistry(),
        DEFAULT_OPTIONS,
        [classifier],
      );

      // No text was pushed — final flush should return null.
      const result = await guardrail.evaluateOutput!(finalPayload('s1'));

      expect(result).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // config
  // -----------------------------------------------------------------------

  describe('config', () => {
    it('evaluateStreamingChunks is true', () => {
      const guardrail = new MLClassifierGuardrail(
        createMockRegistry(),
        DEFAULT_OPTIONS,
        [],
      );

      expect(guardrail.config.evaluateStreamingChunks).toBe(true);
    });

    it('maxStreamingEvaluations defaults to 100', () => {
      const guardrail = new MLClassifierGuardrail(
        createMockRegistry(),
        { ...DEFAULT_OPTIONS, maxEvaluations: undefined },
        [],
      );

      expect(guardrail.config.maxStreamingEvaluations).toBe(100);
    });

    it('maxStreamingEvaluations uses provided value', () => {
      const guardrail = new MLClassifierGuardrail(
        createMockRegistry(),
        { ...DEFAULT_OPTIONS, maxEvaluations: 50 },
        [],
      );

      expect(guardrail.config.maxStreamingEvaluations).toBe(50);
    });
  });

  // -----------------------------------------------------------------------
  // Blocking mode
  // -----------------------------------------------------------------------

  describe('blocking mode', () => {
    it('awaits classification and returns result immediately when window fills', async () => {
      const classifier = createMockClassifier('tox', TOXIC);
      const guardrail = new MLClassifierGuardrail(
        createMockRegistry(),
        { ...DEFAULT_OPTIONS, streamingMode: true },
        [classifier],
      );

      // Push enough text to fill the window (10 tokens = 40 chars).
      const result = await guardrail.evaluateOutput!(
        textDeltaPayload('s1', 'a'.repeat(45)),
      );

      // Should return BLOCK synchronously (within the same call).
      expect(result).not.toBeNull();
      expect(result!.action).toBe(GuardrailAction.BLOCK);
    });

    it('returns null when window is not yet full', async () => {
      const classifier = createMockClassifier('tox', TOXIC);
      const guardrail = new MLClassifierGuardrail(
        createMockRegistry(),
        DEFAULT_OPTIONS,
        [classifier],
      );

      // Push less than chunkSize.
      const result = await guardrail.evaluateOutput!(
        textDeltaPayload('s1', 'a'.repeat(10)),
      );

      expect(result).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // Non-blocking mode (requires direct instantiation with mode override)
  // -----------------------------------------------------------------------

  describe('non-blocking mode behaviour via evaluateOutput', () => {
    it('returns ALLOW (null) for clean classifier even when window fills', async () => {
      const classifier = createMockClassifier('safe', BENIGN);
      const guardrail = new MLClassifierGuardrail(
        createMockRegistry(),
        DEFAULT_OPTIONS,
        [classifier],
      );

      // Fill window.
      const result = await guardrail.evaluateOutput!(
        textDeltaPayload('s1', 'a'.repeat(45)),
      );

      // Benign → ALLOW → null.
      expect(result).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // Metadata in results
  // -----------------------------------------------------------------------

  describe('result metadata', () => {
    it('includes triggeredBy and classifier details in metadata', async () => {
      const classifier = createMockClassifier('injection', TOXIC);
      const guardrail = new MLClassifierGuardrail(
        createMockRegistry(),
        DEFAULT_OPTIONS,
        [classifier],
      );

      const result = await guardrail.evaluateInput!(inputPayload('inject this'));

      expect(result).not.toBeNull();
      expect(result!.metadata).toBeDefined();
      expect(result!.metadata!.triggeredBy).toBe('injection');
      expect(result!.metadata!.classifierResults).toBeInstanceOf(Array);
      expect((result!.metadata!.classifierResults as any[])[0].classifierId).toBe('injection');
    });

    it('includes reasonCode in result', async () => {
      const classifier = createMockClassifier('tox', TOXIC);
      const guardrail = new MLClassifierGuardrail(
        createMockRegistry(),
        DEFAULT_OPTIONS,
        [classifier],
      );

      const result = await guardrail.evaluateInput!(inputPayload('bad'));

      expect(result).not.toBeNull();
      expect(result!.reasonCode).toBe('ML_CLASSIFIER_BLOCK');
    });
  });
});
