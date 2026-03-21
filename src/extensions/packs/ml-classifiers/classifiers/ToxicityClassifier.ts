/**
 * @fileoverview Toxicity content classifier using the `unitary/toxic-bert` model.
 *
 * This classifier uses a multi-label BERT-based model trained on the Jigsaw
 * Toxic Comment dataset.  It assigns independent confidence scores to six
 * toxicity categories and surfaces the highest-scoring label as `bestClass`.
 *
 * The model is loaded lazily the first time `classify()` is called and
 * cached in the shared service registry so it is only initialised once even
 * if multiple parts of the system hold a reference to this classifier.
 *
 * Graceful degradation
 * --------------------
 * If the model fails to load (e.g. network unavailable, ONNX runtime missing)
 * the classifier sets `unavailable = true` and returns a **pass result**
 * `{ bestClass: 'benign', confidence: 0, allScores: [] }` on every subsequent
 * call instead of throwing.  This ensures the guardrail pipeline degrades
 * gracefully rather than crashing the agent.
 *
 * @module agentos/extensions/packs/ml-classifiers/classifiers/ToxicityClassifier
 */

import type { ClassificationResult } from '../../../../core/ai_utilities/IUtilityAI';
import type { ISharedServiceRegistry } from '../../../ISharedServiceRegistry';
import type { IContentClassifier } from '../IContentClassifier';
import type { ClassifierConfig } from '../types';
import { ML_CLASSIFIER_SERVICE_IDS } from '../types';

// ---------------------------------------------------------------------------
// Internal raw pipeline output type
// ---------------------------------------------------------------------------

/**
 * A single label/score pair as returned by the `@huggingface/transformers`
 * text-classification pipeline when called with `{ topk: null }`.
 */
interface RawLabel {
  /** Label name, e.g. `'toxic'`, `'insult'`. */
  label: string;
  /** Confidence score in the range [0, 1]. */
  score: number;
}

// ---------------------------------------------------------------------------
// ToxicityClassifier
// ---------------------------------------------------------------------------

/**
 * Multi-label toxicity classifier backed by `unitary/toxic-bert`.
 *
 * Evaluates text against six toxicity categories:
 *  - `toxic`
 *  - `severe_toxic`
 *  - `obscene`
 *  - `threat`
 *  - `insult`
 *  - `identity_hate`
 *
 * Each category receives an independent confidence score.  The label with
 * the highest score is reported as `bestClass` and its score as `confidence`.
 * All six scores are included in `allScores` so the pack orchestrator can
 * apply per-label thresholds.
 *
 * @implements {IContentClassifier}
 *
 * @example
 * ```typescript
 * const classifier = new ToxicityClassifier(serviceRegistry);
 * const result = await classifier.classify('You are terrible!');
 * // result.bestClass === 'insult', result.confidence ≈ 0.87
 * ```
 */
export class ToxicityClassifier implements IContentClassifier {
  // -------------------------------------------------------------------------
  // IContentClassifier identity fields
  // -------------------------------------------------------------------------

  /** Unique service identifier for this classifier. */
  readonly id = 'toxicity';

  /** Human-readable name for dashboards and log output. */
  readonly displayName = 'Toxicity Classifier';

  /** Short description of what this classifier detects. */
  readonly description =
    'Detects toxic, hateful, or abusive language across six categories: ' +
    'toxic, severe_toxic, obscene, threat, insult, and identity_hate.';

  /**
   * Default Hugging Face model ID.
   * Overridable via {@link ClassifierConfig.modelId}.
   */
  readonly modelId = 'unitary/toxic-bert';

  // -------------------------------------------------------------------------
  // Internal state
  // -------------------------------------------------------------------------

  /**
   * Whether the model weights are fully loaded and the classifier is ready
   * to accept `classify()` calls.
   */
  private _isLoaded = false;

  /**
   * Set to `true` when the model fails to load.  Once `unavailable`, every
   * subsequent `classify()` call immediately returns the pass result rather
   * than retrying the expensive model load.
   */
  private unavailable = false;

  // -------------------------------------------------------------------------
  // Constructor
  // -------------------------------------------------------------------------

  /**
   * @param services - Shared service registry used to lazily create and cache
   *   the underlying HuggingFace pipeline instance.
   * @param config - Optional per-classifier configuration.  When
   *   `config.modelId` is provided it overrides the default `modelId` when
   *   loading the model.
   */
  constructor(
    private readonly services: ISharedServiceRegistry,
    private readonly config?: ClassifierConfig,
  ) {}

  // -------------------------------------------------------------------------
  // IContentClassifier.isLoaded (getter)
  // -------------------------------------------------------------------------

  /**
   * Whether the underlying model pipeline has been successfully initialised.
   * The flag is set to `true` after the first successful `classify()` call.
   */
  get isLoaded(): boolean {
    return this._isLoaded;
  }

  // -------------------------------------------------------------------------
  // classify
  // -------------------------------------------------------------------------

  /**
   * Run toxicity inference on `text`.
   *
   * Lazily loads the pipeline on the first call via the shared service
   * registry, then calls it with `{ topk: null }` to retrieve scores for
   * every label.
   *
   * @param text - The text to evaluate.
   * @returns A promise that resolves with the classification result.  If the
   *   model is unavailable the pass result is returned instead of throwing.
   */
  async classify(text: string): Promise<ClassificationResult> {
    // Return the pass result immediately if the model previously failed to load.
    if (this.unavailable) {
      return this.passResult();
    }

    // Lazily obtain (or create) the HuggingFace pipeline instance from the
    // shared service registry.  The registry ensures the model is only loaded
    // once even under concurrent calls.
    let pipeline: (text: string, opts: { topk: null }) => Promise<RawLabel[]>;
    try {
      pipeline = await this.services.getOrCreate(
        ML_CLASSIFIER_SERVICE_IDS.TOXICITY_PIPELINE,
        async () => {
          // Dynamic import keeps the heavy ONNX runtime out of the initial
          // bundle and allows environments without the package to skip loading.
          const { pipeline: createPipeline } = await import(
            '@huggingface/transformers'
          );
          return createPipeline(
            'text-classification',
            // Honour a caller-supplied model override; fall back to the default.
            this.config?.modelId ?? this.modelId,
            { quantized: true },
          );
        },
        {
          /** Release ONNX/WASM resources when the registry entry is evicted. */
          dispose: async (p: any) => p?.dispose?.(),
          /** Tags used for diagnostics and capability discovery. */
          tags: ['ml', 'classifier', 'toxicity', 'onnx'],
        },
      );

      // Mark the classifier as ready now that the pipeline is available.
      this._isLoaded = true;
    } catch {
      // Model failed to load — mark as unavailable and return the pass result
      // so the guardrail pipeline can continue operating.
      this.unavailable = true;
      return this.passResult();
    }

    // Run inference — request scores for ALL labels (topk: null).
    const raw = await pipeline(text, { topk: null });
    return this.mapResult(raw);
  }

  // -------------------------------------------------------------------------
  // dispose (optional IContentClassifier lifecycle hook)
  // -------------------------------------------------------------------------

  /**
   * Release the pipeline instance from the shared service registry.
   *
   * Idempotent — safe to call multiple times.
   */
  async dispose(): Promise<void> {
    await this.services.release(ML_CLASSIFIER_SERVICE_IDS.TOXICITY_PIPELINE);
    this._isLoaded = false;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Returns a "pass" result used when the model is unavailable.
   *
   * A pass result reports `bestClass: 'benign'` with zero confidence so the
   * guardrail orchestrator will always choose {@link GuardrailAction.ALLOW}.
   */
  private passResult(): ClassificationResult {
    return { bestClass: 'benign', confidence: 0, allScores: [] };
  }

  /**
   * Map the raw pipeline output (array of `{ label, score }` objects) to a
   * {@link ClassificationResult}.
   *
   * The label with the highest score becomes `bestClass` / `confidence`.
   * Every label is included in `allScores` for downstream threshold logic.
   *
   * @param raw - Array returned by the pipeline when called with `topk: null`.
   */
  private mapResult(raw: RawLabel[]): ClassificationResult {
    if (!raw || raw.length === 0) {
      // No output from the model — treat as benign.
      return this.passResult();
    }

    // Find the label with the maximum confidence score.
    let best = raw[0];
    for (const item of raw) {
      if (item.score > best.score) {
        best = item;
      }
    }

    return {
      bestClass: best.label,
      confidence: best.score,
      allScores: raw.map((item) => ({
        classLabel: item.label,
        score: item.score,
      })),
    };
  }
}
