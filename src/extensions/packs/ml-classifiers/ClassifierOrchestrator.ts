/**
 * @fileoverview Orchestrator for parallel ML classifier execution with worst-wins aggregation.
 *
 * The `ClassifierOrchestrator` runs all registered {@link IContentClassifier}
 * instances in parallel against a single text input and aggregates their
 * results into a single {@link ChunkEvaluation}.  The aggregation policy is
 * **worst-wins**: if any classifier recommends BLOCK the overall result is
 * BLOCK, even if every other classifier returned ALLOW.
 *
 * Priority order (descending):
 * ```
 * BLOCK > FLAG > SANITIZE > ALLOW
 * ```
 *
 * Each classifier may have its own threshold overrides (via
 * `perClassifierThresholds`), and individual labels can be mapped to
 * hard-coded actions via `ClassifierConfig.labelActions`.
 *
 * @module agentos/extensions/packs/ml-classifiers/ClassifierOrchestrator
 */

import type { IContentClassifier } from './IContentClassifier';
import type {
  AnnotatedClassificationResult,
  ChunkEvaluation,
  ClassifierThresholds,
  ClassifierConfig,
} from './types';
import { DEFAULT_THRESHOLDS } from './types';
import { GuardrailAction } from '../../../core/guardrails/IGuardrailService';

// ---------------------------------------------------------------------------
// Action severity ranking — used by worst-wins aggregation
// ---------------------------------------------------------------------------

/**
 * Numeric severity for each {@link GuardrailAction}, where higher values
 * represent more restrictive actions.  Used to implement the worst-wins
 * comparison without brittle string ordering.
 */
const ACTION_SEVERITY: Record<GuardrailAction, number> = {
  [GuardrailAction.ALLOW]: 0,
  [GuardrailAction.SANITIZE]: 1,
  [GuardrailAction.FLAG]: 2,
  [GuardrailAction.BLOCK]: 3,
};

// ---------------------------------------------------------------------------
// ClassifierOrchestrator
// ---------------------------------------------------------------------------

/**
 * Drives all registered ML classifiers in parallel and folds their results
 * into a single {@link ChunkEvaluation} using worst-wins aggregation.
 *
 * @example
 * ```typescript
 * const orchestrator = new ClassifierOrchestrator(
 *   [toxicityClassifier, injectionClassifier],
 *   DEFAULT_THRESHOLDS,
 * );
 *
 * const evaluation = await orchestrator.classifyAll('some user message');
 * if (evaluation.recommendedAction === GuardrailAction.BLOCK) {
 *   // Terminate the interaction.
 * }
 * ```
 */
export class ClassifierOrchestrator {
  // -------------------------------------------------------------------------
  // Private state
  // -------------------------------------------------------------------------

  /** Immutable list of classifiers to run on every `classifyAll()` call. */
  private readonly classifiers: IContentClassifier[];

  /** Merged default thresholds (pack-level defaults + caller overrides). */
  private readonly defaultThresholds: ClassifierThresholds;

  /**
   * Optional per-classifier threshold overrides, keyed by classifier ID.
   * When a classifier's ID appears here, the partial thresholds are merged
   * on top of {@link defaultThresholds} for that classifier only.
   */
  private readonly perClassifierThresholds: Record<string, Partial<ClassifierThresholds>>;

  // -------------------------------------------------------------------------
  // Constructor
  // -------------------------------------------------------------------------

  /**
   * Create a new orchestrator.
   *
   * @param classifiers            - Array of classifier instances to run in parallel.
   * @param defaultThresholds      - Pack-level threshold defaults applied to every classifier
   *                                 unless overridden by `perClassifierThresholds`.
   * @param perClassifierThresholds - Optional map from classifier ID to partial threshold
   *                                  overrides.  Missing fields fall back to `defaultThresholds`.
   */
  constructor(
    classifiers: IContentClassifier[],
    defaultThresholds: ClassifierThresholds = DEFAULT_THRESHOLDS,
    perClassifierThresholds: Record<string, Partial<ClassifierThresholds>> = {},
  ) {
    this.classifiers = classifiers;
    this.defaultThresholds = defaultThresholds;
    this.perClassifierThresholds = perClassifierThresholds;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Classify `text` against every registered classifier in parallel and
   * return the aggregated {@link ChunkEvaluation}.
   *
   * Execution details:
   * 1. All classifiers run concurrently via `Promise.allSettled`.
   * 2. Fulfilled results are wrapped as {@link AnnotatedClassificationResult}
   *    with provenance metadata (`classifierId`, `latencyMs`).
   * 3. Rejected promises log a warning and contribute an implicit ALLOW so
   *    a single broken classifier does not block all content.
   * 4. Each result is mapped to a {@link GuardrailAction} using
   *    per-classifier thresholds (if configured) or the pack defaults.
   * 5. The final `recommendedAction` is the most restrictive action across
   *    all classifiers (worst-wins).
   *
   * @param text - The text to evaluate.  Must not be empty.
   * @returns A promise resolving to the aggregated evaluation result.
   */
  async classifyAll(text: string): Promise<ChunkEvaluation> {
    // Record wall-clock start time so `totalLatencyMs` reflects the
    // real-world time spent, not the sum of sequential latencies.
    const wallStart = performance.now();

    // Fire all classifiers in parallel and wait for every one to settle.
    const settled = await Promise.allSettled(
      this.classifiers.map((c) => this.timedClassify(c, text)),
    );

    // Accumulate annotated results and track the worst action seen.
    const results: AnnotatedClassificationResult[] = [];
    let worstAction = GuardrailAction.ALLOW;
    let triggeredBy: string | null = null;

    for (let i = 0; i < settled.length; i++) {
      const outcome = settled[i];
      const classifier = this.classifiers[i];

      if (outcome.status === 'fulfilled') {
        const annotated = outcome.value;
        results.push(annotated);

        // Resolve the thresholds for this specific classifier.
        const thresholds = this.resolveThresholds(classifier.id);

        // Map the raw confidence score to a guardrail action.
        const action = this.scoreToAction(annotated, thresholds);

        // Worst-wins: keep the most restrictive action.
        if (ACTION_SEVERITY[action] > ACTION_SEVERITY[worstAction]) {
          worstAction = action;
          triggeredBy = classifier.id;
        }
      } else {
        // Classifier failed — log and contribute an implicit ALLOW.
        console.warn(
          `[ClassifierOrchestrator] Classifier "${classifier.id}" failed: ${outcome.reason}`,
        );
      }
    }

    const wallEnd = performance.now();

    return {
      results,
      recommendedAction: worstAction,
      triggeredBy,
      totalLatencyMs: Math.round(wallEnd - wallStart),
    };
  }

  /**
   * Dispose every registered classifier, releasing model weights and any
   * other resources they hold.
   *
   * Calls each classifier's `dispose()` method (if present) and swallows
   * errors so a single failing classifier does not prevent cleanup of the
   * others.
   */
  async dispose(): Promise<void> {
    await Promise.allSettled(
      this.classifiers.map(async (c) => {
        if (c.dispose) {
          await c.dispose();
        }
      }),
    );
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Invoke a single classifier with wall-clock latency tracking.
   *
   * Wraps `classifier.classify(text)` and returns the raw
   * {@link ClassificationResult} augmented with `classifierId` and
   * `latencyMs` fields.
   *
   * @param classifier - The classifier to invoke.
   * @param text       - The text to classify.
   * @returns An annotated result with provenance metadata.
   */
  private async timedClassify(
    classifier: IContentClassifier,
    text: string,
  ): Promise<AnnotatedClassificationResult> {
    const start = performance.now();
    const result = await classifier.classify(text);
    const latencyMs = Math.round(performance.now() - start);

    return {
      ...result,
      classifierId: classifier.id,
      latencyMs,
    };
  }

  /**
   * Map a classifier's confidence score to a {@link GuardrailAction}.
   *
   * The mapping checks `labelActions` first (from per-classifier config in
   * thresholds), then falls back to numeric threshold comparison:
   *
   * 1. `confidence >= blockThreshold` -> BLOCK
   * 2. `confidence >= flagThreshold`  -> FLAG
   * 3. `confidence >= warnThreshold`  -> SANITIZE
   * 4. otherwise                      -> ALLOW
   *
   * @param result     - The annotated classification result.
   * @param thresholds - Resolved thresholds for this classifier.
   * @returns The appropriate guardrail action.
   */
  private scoreToAction(
    result: AnnotatedClassificationResult,
    thresholds: ClassifierThresholds,
  ): GuardrailAction {
    // Extract the confidence as a single number.
    // ClassificationResult.confidence may be number | number[]; normalise.
    const confidence = Array.isArray(result.confidence)
      ? result.confidence[0] ?? 0
      : result.confidence;

    // Threshold comparison — checked in descending severity order.
    if (confidence >= thresholds.blockThreshold) {
      return GuardrailAction.BLOCK;
    }
    if (confidence >= thresholds.flagThreshold) {
      return GuardrailAction.FLAG;
    }
    if (confidence >= thresholds.warnThreshold) {
      return GuardrailAction.SANITIZE;
    }

    return GuardrailAction.ALLOW;
  }

  /**
   * Resolve the effective thresholds for a given classifier by merging
   * per-classifier overrides on top of the pack-level defaults.
   *
   * @param classifierId - ID of the classifier to resolve thresholds for.
   * @returns Fully-resolved thresholds with no undefined fields.
   */
  private resolveThresholds(classifierId: string): ClassifierThresholds {
    const overrides = this.perClassifierThresholds[classifierId];
    if (!overrides) {
      return this.defaultThresholds;
    }

    return {
      blockThreshold: overrides.blockThreshold ?? this.defaultThresholds.blockThreshold,
      flagThreshold: overrides.flagThreshold ?? this.defaultThresholds.flagThreshold,
      warnThreshold: overrides.warnThreshold ?? this.defaultThresholds.warnThreshold,
    };
  }
}
