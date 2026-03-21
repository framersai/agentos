/**
 * @fileoverview Unit tests for `TopicalityGuardrail`.
 *
 * Tests verify:
 *  - Forbidden topic match returns BLOCK with TOPICALITY_FORBIDDEN
 *  - Off-topic message returns FLAG with TOPICALITY_OFF_TOPIC
 *  - On-topic message returns null (pass)
 *  - Drift detection triggers FLAG with TOPICALITY_DRIFT
 *  - scope 'output' disables evaluateInput (returns null)
 *  - scope 'input' disables evaluateOutput (returns null)
 *  - No topics configured returns null (no-op)
 *  - Embedding failure triggers fail-open (returns null)
 *  - Indices are lazily built on first call
 *  - Metadata includes matchedTopic / nearestTopic details
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TopicalityGuardrail } from '../../../../src/extensions/packs/topicality/TopicalityGuardrail';
import { GuardrailAction } from '../../../../src/core/guardrails/IGuardrailService';
import type {
  GuardrailInputPayload,
  GuardrailOutputPayload,
} from '../../../../src/core/guardrails/IGuardrailService';
import type { ISharedServiceRegistry } from '../../../../src/extensions/ISharedServiceRegistry';
import type { TopicalityPackOptions, TopicDescriptor } from '../../../../src/extensions/packs/topicality/types';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

/**
 * Creates a minimal mock of the shared service registry.
 * Not used by tests that supply an explicit embeddingFn.
 */
function createMockRegistry(): ISharedServiceRegistry {
  return {
    getOrCreate: vi.fn(),
    has: vi.fn(() => false),
    release: vi.fn(),
    releaseAll: vi.fn(),
  };
}

/**
 * Builds a mock embedding function that returns controlled vectors.
 *
 * The function maps known text strings to specific embedding vectors
 * so that cosine similarity produces predictable results.
 *
 * Vector strategy:
 *  - Allowed topic vectors point in the +x direction: [1, 0, 0]
 *  - Forbidden topic vectors point in the +y direction: [0, 1, 0]
 *  - On-topic user text aligns with allowed: [0.9, 0.1, 0]
 *  - Forbidden user text aligns with forbidden: [0.1, 0.9, 0]
 *  - Off-topic user text points in the +z direction: [0, 0, 1]
 *  - Drift text is slightly off-topic: [0.2, 0.1, 0.9]
 */
function createMockEmbeddingFn(): (texts: string[]) => Promise<number[][]> {
  return vi.fn(async (texts: string[]): Promise<number[][]> => {
    return texts.map((text) => {
      const lower = text.toLowerCase();

      // Forbidden topic descriptors and examples → +y direction.
      if (lower.includes('violence') || lower.includes('harm') || lower.includes('hurt')) {
        return [0, 1, 0];
      }

      // Allowed topic descriptors and examples → +x direction.
      if (
        lower.includes('billing') ||
        lower.includes('invoice') ||
        lower.includes('charge') ||
        lower.includes('support') ||
        lower.includes('login')
      ) {
        return [1, 0, 0];
      }

      // Forbidden user message → aligns with +y.
      if (lower.includes('forbidden-match')) {
        return [0.1, 0.95, 0];
      }

      // On-topic user message → aligns with +x.
      if (lower.includes('on-topic')) {
        return [0.95, 0.1, 0];
      }

      // Off-topic user message → +z direction (orthogonal to both).
      if (lower.includes('off-topic')) {
        return [0, 0, 1];
      }

      // Drift text — slightly off-topic but not dramatically.
      if (lower.includes('drift')) {
        return [0.2, 0.1, 0.9];
      }

      // Default: neutral vector.
      return [0.33, 0.33, 0.33];
    });
  });
}

/** A simple allowed topic for testing. */
const BILLING_TOPIC: TopicDescriptor = {
  id: 'billing',
  name: 'Billing & Payments',
  description: 'Questions about invoices and charges.',
  examples: ['Why was I charged twice?'],
};

/** A simple forbidden topic for testing. */
const VIOLENCE_TOPIC: TopicDescriptor = {
  id: 'violence',
  name: 'Violence & Harm',
  description: 'Content about violence and harm.',
  examples: ['How do I hurt someone?'],
};

/**
 * Helper to create a minimal input payload.
 *
 * @param text      - The user's text message.
 * @param sessionId - Session identifier for drift tracking.
 */
function makeInputPayload(text: string, sessionId = 'session-1'): GuardrailInputPayload {
  return {
    context: {
      userId: 'user-1',
      sessionId,
    },
    input: {
      textInput: text,
    } as any,
  };
}

/**
 * Helper to create a minimal output payload (FINAL_RESPONSE).
 *
 * @param text      - The agent's response text.
 * @param sessionId - Session identifier.
 */
function makeOutputPayload(text: string, sessionId = 'session-1'): GuardrailOutputPayload {
  return {
    context: {
      userId: 'user-1',
      sessionId,
    },
    chunk: {
      finalResponseText: text,
    } as any,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TopicalityGuardrail', () => {
  let mockRegistry: ISharedServiceRegistry;
  let mockEmbeddingFn: ReturnType<typeof createMockEmbeddingFn>;

  beforeEach(() => {
    mockRegistry = createMockRegistry();
    mockEmbeddingFn = createMockEmbeddingFn();
    vi.restoreAllMocks();
  });

  // -----------------------------------------------------------------------
  // Config
  // -----------------------------------------------------------------------

  describe('config', () => {
    it('has evaluateStreamingChunks=false and canSanitize=false', () => {
      const guardrail = new TopicalityGuardrail(mockRegistry, {}, mockEmbeddingFn);

      expect(guardrail.config.evaluateStreamingChunks).toBe(false);
      expect(guardrail.config.canSanitize).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Forbidden topic detection
  // -----------------------------------------------------------------------

  describe('forbidden topic match', () => {
    it('returns BLOCK with TOPICALITY_FORBIDDEN when text matches forbidden topic', async () => {
      const options: TopicalityPackOptions = {
        forbiddenTopics: [VIOLENCE_TOPIC],
        forbiddenThreshold: 0.6,
        enableDriftDetection: false,
      };
      const guardrail = new TopicalityGuardrail(mockRegistry, options, mockEmbeddingFn);

      const result = await guardrail.evaluateInput(
        makeInputPayload('This is a forbidden-match message'),
      );

      expect(result).not.toBeNull();
      expect(result!.action).toBe(GuardrailAction.BLOCK);
      expect(result!.reasonCode).toBe('TOPICALITY_FORBIDDEN');
    });

    it('includes matchedTopic in metadata', async () => {
      const options: TopicalityPackOptions = {
        forbiddenTopics: [VIOLENCE_TOPIC],
        forbiddenThreshold: 0.6,
        enableDriftDetection: false,
      };
      const guardrail = new TopicalityGuardrail(mockRegistry, options, mockEmbeddingFn);

      const result = await guardrail.evaluateInput(
        makeInputPayload('This is a forbidden-match message'),
      );

      expect(result!.metadata).toBeDefined();
      expect(result!.metadata!.matchedTopic).toBe('violence');
      expect(result!.metadata!.matchedTopicName).toBe('Violence & Harm');
    });

    it('returns FLAG when forbiddenAction is "flag"', async () => {
      const options: TopicalityPackOptions = {
        forbiddenTopics: [VIOLENCE_TOPIC],
        forbiddenThreshold: 0.6,
        forbiddenAction: 'flag',
        enableDriftDetection: false,
      };
      const guardrail = new TopicalityGuardrail(mockRegistry, options, mockEmbeddingFn);

      const result = await guardrail.evaluateInput(
        makeInputPayload('This is a forbidden-match message'),
      );

      expect(result).not.toBeNull();
      expect(result!.action).toBe(GuardrailAction.FLAG);
      expect(result!.reasonCode).toBe('TOPICALITY_FORBIDDEN');
    });
  });

  // -----------------------------------------------------------------------
  // Off-topic detection
  // -----------------------------------------------------------------------

  describe('off-topic detection', () => {
    it('returns FLAG with TOPICALITY_OFF_TOPIC when text does not match allowed topics', async () => {
      const options: TopicalityPackOptions = {
        allowedTopics: [BILLING_TOPIC],
        allowedThreshold: 0.35,
        enableDriftDetection: false,
      };
      const guardrail = new TopicalityGuardrail(mockRegistry, options, mockEmbeddingFn);

      const result = await guardrail.evaluateInput(
        makeInputPayload('This is off-topic text'),
      );

      expect(result).not.toBeNull();
      expect(result!.action).toBe(GuardrailAction.FLAG);
      expect(result!.reasonCode).toBe('TOPICALITY_OFF_TOPIC');
    });

    it('includes nearestTopic in metadata', async () => {
      const options: TopicalityPackOptions = {
        allowedTopics: [BILLING_TOPIC],
        allowedThreshold: 0.35,
        enableDriftDetection: false,
      };
      const guardrail = new TopicalityGuardrail(mockRegistry, options, mockEmbeddingFn);

      const result = await guardrail.evaluateInput(
        makeInputPayload('This is off-topic text'),
      );

      expect(result!.metadata).toBeDefined();
      expect(result!.metadata!.nearestTopic).toBe('billing');
    });

    it('returns BLOCK when offTopicAction is "block"', async () => {
      const options: TopicalityPackOptions = {
        allowedTopics: [BILLING_TOPIC],
        allowedThreshold: 0.35,
        offTopicAction: 'block',
        enableDriftDetection: false,
      };
      const guardrail = new TopicalityGuardrail(mockRegistry, options, mockEmbeddingFn);

      const result = await guardrail.evaluateInput(
        makeInputPayload('This is off-topic text'),
      );

      expect(result).not.toBeNull();
      expect(result!.action).toBe(GuardrailAction.BLOCK);
    });
  });

  // -----------------------------------------------------------------------
  // On-topic pass-through
  // -----------------------------------------------------------------------

  describe('on-topic pass-through', () => {
    it('returns null for on-topic text', async () => {
      const options: TopicalityPackOptions = {
        allowedTopics: [BILLING_TOPIC],
        allowedThreshold: 0.35,
        enableDriftDetection: false,
      };
      const guardrail = new TopicalityGuardrail(mockRegistry, options, mockEmbeddingFn);

      const result = await guardrail.evaluateInput(
        makeInputPayload('This is on-topic text about billing'),
      );

      expect(result).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // Drift detection
  // -----------------------------------------------------------------------

  describe('drift detection', () => {
    it('returns FLAG with TOPICALITY_DRIFT after sustained off-topic messages', async () => {
      const options: TopicalityPackOptions = {
        allowedTopics: [BILLING_TOPIC],
        allowedThreshold: 0.35,
        enableDriftDetection: true,
        drift: {
          driftThreshold: 0.35,
          driftStreakLimit: 2, // Trigger after just 2 consecutive off-topic messages.
          alpha: 0.9, // High alpha so each message nearly replaces the running embedding.
        },
      };
      const guardrail = new TopicalityGuardrail(mockRegistry, options, mockEmbeddingFn);

      // First drift message: will trigger off-topic but streak=1, not yet exceeding limit.
      // However, evaluateInput checks off-topic FIRST, so it will return OFF_TOPIC before drift.
      // To test drift specifically, we need messages that are on-topic individually but
      // drift collectively. Let's use messages that are ON-topic by threshold but cause
      // the EMA to drift.

      // Actually, the pipeline checks: forbidden -> off-topic -> drift.
      // If a message is off-topic, it triggers TOPICALITY_OFF_TOPIC before reaching drift check.
      // Drift detection only fires when individual messages pass the off-topic check but
      // the cumulative EMA drifts.
      //
      // For this test, let's configure so single messages pass allowed check but
      // drift accumulates. We'll lower allowedThreshold so drift messages pass individually.
      const driftOptions: TopicalityPackOptions = {
        allowedTopics: [BILLING_TOPIC],
        allowedThreshold: 0.05, // Very permissive for individual messages.
        enableDriftDetection: true,
        drift: {
          driftThreshold: 0.35, // Stricter for EMA.
          driftStreakLimit: 2,
          alpha: 0.9,
        },
      };
      const driftGuardrail = new TopicalityGuardrail(
        mockRegistry,
        driftOptions,
        mockEmbeddingFn,
      );

      // First drift message — passes off-topic check, drift streak=1.
      const r1 = await driftGuardrail.evaluateInput(
        makeInputPayload('drift message one', 'drift-session'),
      );
      // May or may not trigger drift (streak=1, limit=2).
      // Should not trigger drift yet.
      expect(r1).toBeNull();

      // Second drift message — drift streak=2 >= limit.
      const r2 = await driftGuardrail.evaluateInput(
        makeInputPayload('drift message two', 'drift-session'),
      );
      expect(r2).not.toBeNull();
      expect(r2!.action).toBe(GuardrailAction.FLAG);
      expect(r2!.reasonCode).toBe('TOPICALITY_DRIFT');
    });

    it('includes drift metadata', async () => {
      const options: TopicalityPackOptions = {
        allowedTopics: [BILLING_TOPIC],
        allowedThreshold: 0.05,
        enableDriftDetection: true,
        drift: {
          driftThreshold: 0.35,
          driftStreakLimit: 1, // Trigger on first off-topic.
          alpha: 0.9,
        },
      };
      const guardrail = new TopicalityGuardrail(mockRegistry, options, mockEmbeddingFn);

      const result = await guardrail.evaluateInput(
        makeInputPayload('drift message', 'drift-session'),
      );

      expect(result).not.toBeNull();
      expect(result!.metadata).toBeDefined();
      expect(result!.metadata!.driftStreak).toBeGreaterThanOrEqual(1);
      expect(typeof result!.metadata!.currentSimilarity).toBe('number');
    });
  });

  // -----------------------------------------------------------------------
  // Scope control
  // -----------------------------------------------------------------------

  describe('scope control', () => {
    it('returns null from evaluateInput when scope is "output"', async () => {
      const options: TopicalityPackOptions = {
        forbiddenTopics: [VIOLENCE_TOPIC],
        guardrailScope: 'output',
      };
      const guardrail = new TopicalityGuardrail(mockRegistry, options, mockEmbeddingFn);

      const result = await guardrail.evaluateInput(
        makeInputPayload('forbidden-match message'),
      );

      expect(result).toBeNull();
    });

    it('returns null from evaluateOutput when scope is "input"', async () => {
      const options: TopicalityPackOptions = {
        forbiddenTopics: [VIOLENCE_TOPIC],
        guardrailScope: 'input',
      };
      const guardrail = new TopicalityGuardrail(mockRegistry, options, mockEmbeddingFn);

      const result = await guardrail.evaluateOutput(
        makeOutputPayload('forbidden-match message'),
      );

      expect(result).toBeNull();
    });

    it('evaluates both directions when scope is "both"', async () => {
      const options: TopicalityPackOptions = {
        forbiddenTopics: [VIOLENCE_TOPIC],
        forbiddenThreshold: 0.6,
        guardrailScope: 'both',
        enableDriftDetection: false,
      };
      const guardrail = new TopicalityGuardrail(mockRegistry, options, mockEmbeddingFn);

      const inputResult = await guardrail.evaluateInput(
        makeInputPayload('forbidden-match message'),
      );
      const outputResult = await guardrail.evaluateOutput(
        makeOutputPayload('forbidden-match message'),
      );

      // Both should trigger.
      expect(inputResult).not.toBeNull();
      expect(inputResult!.reasonCode).toBe('TOPICALITY_FORBIDDEN');
      expect(outputResult).not.toBeNull();
      expect(outputResult!.reasonCode).toBe('TOPICALITY_FORBIDDEN');
    });
  });

  // -----------------------------------------------------------------------
  // No-op when no topics configured
  // -----------------------------------------------------------------------

  describe('no topics configured', () => {
    it('returns null when no allowed or forbidden topics are set', async () => {
      const guardrail = new TopicalityGuardrail(mockRegistry, {}, mockEmbeddingFn);

      const result = await guardrail.evaluateInput(
        makeInputPayload('any message at all'),
      );

      expect(result).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // Fail-open on embedding failure
  // -----------------------------------------------------------------------

  describe('fail-open on error', () => {
    it('returns null when embeddingFn throws', async () => {
      const brokenEmbeddingFn = vi.fn(async () => {
        throw new Error('Embedding service unavailable');
      });

      const options: TopicalityPackOptions = {
        forbiddenTopics: [VIOLENCE_TOPIC],
      };
      const guardrail = new TopicalityGuardrail(
        mockRegistry,
        options,
        brokenEmbeddingFn,
      );

      // Suppress console.warn during this test.
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await guardrail.evaluateInput(
        makeInputPayload('forbidden-match message'),
      );

      expect(result).toBeNull();
      expect(warnSpy).toHaveBeenCalled();

      warnSpy.mockRestore();
    });

    it('returns null from evaluateOutput when embeddingFn throws', async () => {
      const brokenEmbeddingFn = vi.fn(async () => {
        throw new Error('Embedding service unavailable');
      });

      const options: TopicalityPackOptions = {
        forbiddenTopics: [VIOLENCE_TOPIC],
        guardrailScope: 'both',
      };
      const guardrail = new TopicalityGuardrail(
        mockRegistry,
        options,
        brokenEmbeddingFn,
      );

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await guardrail.evaluateOutput(
        makeOutputPayload('forbidden-match message'),
      );

      expect(result).toBeNull();
      warnSpy.mockRestore();
    });
  });

  // -----------------------------------------------------------------------
  // Lazy index building
  // -----------------------------------------------------------------------

  describe('lazy index building', () => {
    it('does not call embeddingFn until first evaluateInput call', async () => {
      const options: TopicalityPackOptions = {
        allowedTopics: [BILLING_TOPIC],
        enableDriftDetection: false,
      };
      const guardrail = new TopicalityGuardrail(mockRegistry, options, mockEmbeddingFn);

      // No embedding calls should have been made yet.
      expect(mockEmbeddingFn).not.toHaveBeenCalled();

      // First evaluation triggers lazy build + text embedding.
      await guardrail.evaluateInput(makeInputPayload('on-topic billing question'));

      // Now the embedding function should have been called (once for index
      // build, once for the input text).
      expect(mockEmbeddingFn).toHaveBeenCalled();
    });

    it('only builds indices once across multiple calls', async () => {
      const options: TopicalityPackOptions = {
        allowedTopics: [BILLING_TOPIC],
        enableDriftDetection: false,
      };
      const guardrail = new TopicalityGuardrail(mockRegistry, options, mockEmbeddingFn);

      await guardrail.evaluateInput(makeInputPayload('on-topic billing first'));
      const callsAfterFirst = (mockEmbeddingFn as ReturnType<typeof vi.fn>).mock.calls.length;

      await guardrail.evaluateInput(makeInputPayload('on-topic billing second'));
      const callsAfterSecond = (mockEmbeddingFn as ReturnType<typeof vi.fn>).mock.calls.length;

      // Second call should only add 1 more embedding call (for the input text),
      // not rebuild the index.
      expect(callsAfterSecond - callsAfterFirst).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // Empty text handling
  // -----------------------------------------------------------------------

  describe('empty text handling', () => {
    it('returns null for null textInput', async () => {
      const options: TopicalityPackOptions = {
        forbiddenTopics: [VIOLENCE_TOPIC],
      };
      const guardrail = new TopicalityGuardrail(mockRegistry, options, mockEmbeddingFn);

      const result = await guardrail.evaluateInput({
        context: { userId: 'user-1', sessionId: 'session-1' },
        input: { textInput: null } as any,
      });

      expect(result).toBeNull();
    });

    it('returns null for empty string textInput', async () => {
      const options: TopicalityPackOptions = {
        forbiddenTopics: [VIOLENCE_TOPIC],
      };
      const guardrail = new TopicalityGuardrail(mockRegistry, options, mockEmbeddingFn);

      const result = await guardrail.evaluateInput(makeInputPayload(''));

      expect(result).toBeNull();
    });
  });
});
