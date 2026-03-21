/**
 * @fileoverview Unit tests for `ClassifierOrchestrator`.
 *
 * Tests verify:
 *  - Classifiers run in parallel (total time < sum of individual latencies)
 *  - Worst-wins aggregation: any BLOCK → overall BLOCK
 *  - FLAG > ALLOW in aggregation
 *  - All pass → ALLOW with triggeredBy null
 *  - triggeredBy identifies the classifier that caused escalation
 *  - Single classifier failure does not block others (contributes ALLOW)
 *  - Per-classifier threshold overrides work correctly
 *  - dispose() calls dispose on all classifiers
 */

import { describe, it, expect, vi } from 'vitest';
import { ClassifierOrchestrator } from '../../../../src/extensions/packs/ml-classifiers/ClassifierOrchestrator';
import type { IContentClassifier } from '../../../../src/extensions/packs/ml-classifiers/IContentClassifier';
import type { ClassificationResult } from '../../../../src/core/ai_utilities/IUtilityAI';
import type { ClassifierThresholds } from '../../../../src/extensions/packs/ml-classifiers/types';
import { DEFAULT_THRESHOLDS } from '../../../../src/extensions/packs/ml-classifiers/types';
import { GuardrailAction } from '../../../../src/core/guardrails/IGuardrailService';

// ---------------------------------------------------------------------------
// Mock classifier factory
// ---------------------------------------------------------------------------

/**
 * Create a mock classifier that returns a configurable result after an
 * optional simulated delay.  The `dispose` method is a vitest spy so
 * callers can assert it was invoked.
 *
 * @param id         - Unique classifier ID.
 * @param result     - The classification result to return.
 * @param delayMs    - Simulated inference latency (ms).
 * @param shouldFail - If true, `classify()` rejects with an error.
 */
function createMockClassifier(
  id: string,
  result: ClassificationResult,
  delayMs = 0,
  shouldFail = false,
): IContentClassifier & { dispose: ReturnType<typeof vi.fn> } {
  return {
    id,
    displayName: `Mock ${id}`,
    description: `Mock classifier: ${id}`,
    modelId: `mock/${id}`,
    isLoaded: true,
    classify: async (_text: string): Promise<ClassificationResult> => {
      if (delayMs > 0) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
      if (shouldFail) {
        throw new Error(`${id} inference failed`);
      }
      return result;
    },
    dispose: vi.fn(async () => {}),
  };
}

// ---------------------------------------------------------------------------
// Helpers — pre-built classification results
// ---------------------------------------------------------------------------

/** A benign result with very low confidence. */
const BENIGN_RESULT: ClassificationResult = {
  bestClass: 'benign',
  confidence: 0.1,
  allScores: [{ classLabel: 'benign', score: 0.1 }],
};

/** A toxic result with confidence above the default block threshold (0.9). */
const TOXIC_BLOCK_RESULT: ClassificationResult = {
  bestClass: 'toxic',
  confidence: 0.95,
  allScores: [{ classLabel: 'toxic', score: 0.95 }],
};

/** A flaggable result — confidence between flag (0.7) and block (0.9). */
const FLAG_RESULT: ClassificationResult = {
  bestClass: 'suspicious',
  confidence: 0.75,
  allScores: [{ classLabel: 'suspicious', score: 0.75 }],
};

/** A warn-level result — confidence between warn (0.4) and flag (0.7). */
const WARN_RESULT: ClassificationResult = {
  bestClass: 'mildly_suspicious',
  confidence: 0.5,
  allScores: [{ classLabel: 'mildly_suspicious', score: 0.5 }],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ClassifierOrchestrator', () => {
  // -----------------------------------------------------------------------
  // Parallel execution
  // -----------------------------------------------------------------------

  it('runs classifiers in parallel (total time < sum of individual latencies)', async () => {
    // Each classifier takes 50ms.  If run sequentially total would be ~150ms.
    const classifiers = [
      createMockClassifier('a', BENIGN_RESULT, 50),
      createMockClassifier('b', BENIGN_RESULT, 50),
      createMockClassifier('c', BENIGN_RESULT, 50),
    ];

    const orchestrator = new ClassifierOrchestrator(classifiers, DEFAULT_THRESHOLDS);

    const start = performance.now();
    await orchestrator.classifyAll('hello');
    const elapsed = performance.now() - start;

    // Parallel execution should complete in roughly 50ms + overhead,
    // well under the sequential total of 150ms.
    expect(elapsed).toBeLessThan(130);
  });

  // -----------------------------------------------------------------------
  // Worst-wins aggregation
  // -----------------------------------------------------------------------

  it('worst-wins: any BLOCK → result is BLOCK', async () => {
    const classifiers = [
      createMockClassifier('clean', BENIGN_RESULT),
      createMockClassifier('toxic', TOXIC_BLOCK_RESULT),
    ];

    const orchestrator = new ClassifierOrchestrator(classifiers, DEFAULT_THRESHOLDS);
    const result = await orchestrator.classifyAll('bad text');

    expect(result.recommendedAction).toBe(GuardrailAction.BLOCK);
    expect(result.triggeredBy).toBe('toxic');
  });

  it('FLAG > ALLOW in aggregation', async () => {
    const classifiers = [
      createMockClassifier('clean', BENIGN_RESULT),
      createMockClassifier('flagger', FLAG_RESULT),
    ];

    const orchestrator = new ClassifierOrchestrator(classifiers, DEFAULT_THRESHOLDS);
    const result = await orchestrator.classifyAll('some text');

    expect(result.recommendedAction).toBe(GuardrailAction.FLAG);
    expect(result.triggeredBy).toBe('flagger');
  });

  it('BLOCK wins over FLAG in aggregation', async () => {
    const classifiers = [
      createMockClassifier('flagger', FLAG_RESULT),
      createMockClassifier('blocker', TOXIC_BLOCK_RESULT),
    ];

    const orchestrator = new ClassifierOrchestrator(classifiers, DEFAULT_THRESHOLDS);
    const result = await orchestrator.classifyAll('bad text');

    expect(result.recommendedAction).toBe(GuardrailAction.BLOCK);
    expect(result.triggeredBy).toBe('blocker');
  });

  // -----------------------------------------------------------------------
  // All pass → ALLOW
  // -----------------------------------------------------------------------

  it('all pass → ALLOW with triggeredBy null', async () => {
    const classifiers = [
      createMockClassifier('a', BENIGN_RESULT),
      createMockClassifier('b', BENIGN_RESULT),
    ];

    const orchestrator = new ClassifierOrchestrator(classifiers, DEFAULT_THRESHOLDS);
    const result = await orchestrator.classifyAll('hello world');

    expect(result.recommendedAction).toBe(GuardrailAction.ALLOW);
    expect(result.triggeredBy).toBeNull();
    expect(result.results).toHaveLength(2);
  });

  // -----------------------------------------------------------------------
  // triggeredBy identification
  // -----------------------------------------------------------------------

  it('triggeredBy identifies which classifier triggered the action', async () => {
    const classifiers = [
      createMockClassifier('safe', BENIGN_RESULT),
      createMockClassifier('injection-detector', TOXIC_BLOCK_RESULT),
      createMockClassifier('also-safe', BENIGN_RESULT),
    ];

    const orchestrator = new ClassifierOrchestrator(classifiers, DEFAULT_THRESHOLDS);
    const result = await orchestrator.classifyAll('inject this');

    expect(result.triggeredBy).toBe('injection-detector');
  });

  // -----------------------------------------------------------------------
  // Classifier failure handling
  // -----------------------------------------------------------------------

  it('single classifier failure does not block others (contributes ALLOW)', async () => {
    const classifiers = [
      createMockClassifier('broken', BENIGN_RESULT, 0, /* shouldFail */ true),
      createMockClassifier('working', BENIGN_RESULT),
    ];

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const orchestrator = new ClassifierOrchestrator(classifiers, DEFAULT_THRESHOLDS);
    const result = await orchestrator.classifyAll('test');

    // Only the working classifier's result should appear.
    expect(result.results).toHaveLength(1);
    expect(result.results[0].classifierId).toBe('working');
    expect(result.recommendedAction).toBe(GuardrailAction.ALLOW);

    // A warning should have been logged for the broken classifier.
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Classifier "broken" failed'),
    );

    warnSpy.mockRestore();
  });

  it('failure of one classifier does not suppress BLOCK from another', async () => {
    const classifiers = [
      createMockClassifier('broken', BENIGN_RESULT, 0, true),
      createMockClassifier('blocker', TOXIC_BLOCK_RESULT),
    ];

    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const orchestrator = new ClassifierOrchestrator(classifiers, DEFAULT_THRESHOLDS);
    const result = await orchestrator.classifyAll('toxic input');

    expect(result.recommendedAction).toBe(GuardrailAction.BLOCK);
    expect(result.triggeredBy).toBe('blocker');

    vi.restoreAllMocks();
  });

  // -----------------------------------------------------------------------
  // Per-classifier threshold overrides
  // -----------------------------------------------------------------------

  it('per-classifier threshold overrides work', async () => {
    // Create a classifier whose confidence (0.75) would normally be FLAG
    // with default thresholds, but we lower the block threshold to 0.6
    // for this specific classifier.
    const classifiers = [createMockClassifier('custom', FLAG_RESULT)];

    const perClassifierThresholds: Record<string, Partial<ClassifierThresholds>> = {
      custom: { blockThreshold: 0.6 },
    };

    const orchestrator = new ClassifierOrchestrator(
      classifiers,
      DEFAULT_THRESHOLDS,
      perClassifierThresholds,
    );

    const result = await orchestrator.classifyAll('test');

    // With block threshold at 0.6 and confidence at 0.75, this should BLOCK.
    expect(result.recommendedAction).toBe(GuardrailAction.BLOCK);
    expect(result.triggeredBy).toBe('custom');
  });

  it('per-classifier overrides do not affect other classifiers', async () => {
    const classifiers = [
      createMockClassifier('overridden', WARN_RESULT),
      createMockClassifier('default', WARN_RESULT),
    ];

    const perClassifierThresholds: Record<string, Partial<ClassifierThresholds>> = {
      // Lower warn threshold for 'overridden' so 0.5 becomes FLAG-level
      overridden: { flagThreshold: 0.45 },
    };

    const orchestrator = new ClassifierOrchestrator(
      classifiers,
      DEFAULT_THRESHOLDS,
      perClassifierThresholds,
    );

    const result = await orchestrator.classifyAll('test');

    // 'overridden' at 0.5 with flagThreshold=0.45 → FLAG.
    // 'default' at 0.5 with flagThreshold=0.7 → SANITIZE (warn).
    // Worst wins: FLAG > SANITIZE → FLAG.
    expect(result.recommendedAction).toBe(GuardrailAction.FLAG);
    expect(result.triggeredBy).toBe('overridden');
  });

  // -----------------------------------------------------------------------
  // Result metadata
  // -----------------------------------------------------------------------

  it('includes totalLatencyMs as wall time', async () => {
    const classifiers = [createMockClassifier('a', BENIGN_RESULT, 20)];
    const orchestrator = new ClassifierOrchestrator(classifiers, DEFAULT_THRESHOLDS);
    const result = await orchestrator.classifyAll('text');

    expect(result.totalLatencyMs).toBeGreaterThanOrEqual(0);
  });

  it('annotates each result with classifierId and latencyMs', async () => {
    const classifiers = [
      createMockClassifier('alpha', BENIGN_RESULT),
      createMockClassifier('beta', FLAG_RESULT),
    ];

    const orchestrator = new ClassifierOrchestrator(classifiers, DEFAULT_THRESHOLDS);
    const result = await orchestrator.classifyAll('text');

    expect(result.results).toHaveLength(2);
    expect(result.results[0].classifierId).toBe('alpha');
    expect(result.results[1].classifierId).toBe('beta');

    for (const r of result.results) {
      expect(r.latencyMs).toBeGreaterThanOrEqual(0);
      expect(r.bestClass).toBeDefined();
      expect(r.confidence).toBeDefined();
    }
  });

  // -----------------------------------------------------------------------
  // dispose
  // -----------------------------------------------------------------------

  it('dispose calls dispose on all classifiers', async () => {
    const classifiers = [
      createMockClassifier('a', BENIGN_RESULT),
      createMockClassifier('b', BENIGN_RESULT),
      createMockClassifier('c', BENIGN_RESULT),
    ];

    const orchestrator = new ClassifierOrchestrator(classifiers, DEFAULT_THRESHOLDS);
    await orchestrator.dispose();

    for (const c of classifiers) {
      expect(c.dispose).toHaveBeenCalledOnce();
    }
  });

  it('dispose handles classifiers without dispose method', async () => {
    const classifier: IContentClassifier = {
      id: 'no-dispose',
      displayName: 'No Dispose',
      description: 'Test',
      modelId: 'test',
      isLoaded: true,
      classify: async () => BENIGN_RESULT,
      // No dispose method.
    };

    const orchestrator = new ClassifierOrchestrator([classifier], DEFAULT_THRESHOLDS);

    // Should not throw.
    await expect(orchestrator.dispose()).resolves.toBeUndefined();
  });
});
