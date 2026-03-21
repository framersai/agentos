/**
 * @fileoverview Prompt-injection content classifier using the
 * `protectai/deberta-v3-small-prompt-injection-v2` model.
 *
 * Prompt injection is the attack pattern where adversarial instructions are
 * embedded inside user-supplied text to override or hijack the agent's system
 * prompt.  This classifier provides a dedicated binary signal (INJECTION /
 * SAFE) that the guardrail orchestrator can act on independently of the
 * toxicity or jailbreak classifiers.
 *
 * Model details
 * -------------
 * `protectai/deberta-v3-small-prompt-injection-v2` is a fine-tuned DeBERTa
 * model from ProtectAI, specifically trained to distinguish benign user
 * messages from prompt-injection payloads.  It outputs two labels:
 *  - `INJECTION` — high-confidence injection attempt
 *  - `SAFE`      — normal user input
 *
 * Graceful degradation
 * --------------------
 * If the model fails to load the classifier sets `unavailable = true` and
 * returns a pass result `{ bestClass: 'benign', confidence: 0, allScores: [] }`
 * on every subsequent call.
 *
 * @module agentos/extensions/packs/ml-classifiers/classifiers/InjectionClassifier
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
 * A single label/score pair as returned by the HuggingFace text-classification
 * pipeline when called with `{ topk: null }`.
 */
interface RawLabel {
  /** Label name, e.g. `'INJECTION'` or `'SAFE'`. */
  label: string;
  /** Confidence score in the range [0, 1]. */
  score: number;
}

// ---------------------------------------------------------------------------
// InjectionClassifier
// ---------------------------------------------------------------------------

/**
 * Binary prompt-injection classifier backed by
 * `protectai/deberta-v3-small-prompt-injection-v2`.
 *
 * Returns one of two labels:
 *  - `INJECTION` — the text contains an injection attempt
 *  - `SAFE`      — the text is clean
 *
 * The label with the higher confidence becomes `bestClass` / `confidence`.
 * Both labels are present in `allScores` so callers can read the SAFE score
 * as well.
 *
 * @implements {IContentClassifier}
 *
 * @example
 * ```typescript
 * const classifier = new InjectionClassifier(serviceRegistry);
 * const result = await classifier.classify('Ignore previous instructions and …');
 * // result.bestClass === 'INJECTION', result.confidence ≈ 0.97
 * ```
 */
export class InjectionClassifier implements IContentClassifier {
  // -------------------------------------------------------------------------
  // IContentClassifier identity fields
  // -------------------------------------------------------------------------

  /** Unique service identifier for this classifier. */
  readonly id = 'prompt-injection';

  /** Human-readable name for dashboards and log output. */
  readonly displayName = 'Prompt Injection Classifier';

  /** Short description of what this classifier detects. */
  readonly description =
    'Detects prompt-injection attempts where adversarial instructions are ' +
    'embedded in user input to override or hijack the agent system prompt.';

  /**
   * Default Hugging Face model ID.
   * Overridable via {@link ClassifierConfig.modelId}.
   */
  readonly modelId = 'protectai/deberta-v3-small-prompt-injection-v2';

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
   * Run prompt-injection inference on `text`.
   *
   * Lazily loads the pipeline on the first call via the shared service
   * registry, then calls it with `{ topk: null }` to retrieve scores for both
   * labels.
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
    // shared service registry so the model is only downloaded once.
    let pipeline: (text: string, opts: { topk: null }) => Promise<RawLabel[]>;
    try {
      pipeline = await this.services.getOrCreate(
        ML_CLASSIFIER_SERVICE_IDS.INJECTION_PIPELINE,
        async () => {
          // Dynamic import so environments without @huggingface/transformers
          // can still load the rest of AgentOS.
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
          tags: ['ml', 'classifier', 'prompt-injection', 'onnx'],
        },
      );

      // Mark the classifier as ready now that the pipeline is available.
      this._isLoaded = true;
    } catch {
      // Model failed to load — mark as unavailable and return the pass result.
      this.unavailable = true;
      return this.passResult();
    }

    // Run inference and request both label scores.
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
    await this.services.release(ML_CLASSIFIER_SERVICE_IDS.INJECTION_PIPELINE);
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
   * Map the raw pipeline output to a {@link ClassificationResult}.
   *
   * For binary classification the label with the higher confidence score
   * becomes `bestClass` / `confidence`.  Both labels are included in
   * `allScores`.
   *
   * @param raw - Array returned by the pipeline when called with `topk: null`.
   */
  private mapResult(raw: RawLabel[]): ClassificationResult {
    if (!raw || raw.length === 0) {
      return this.passResult();
    }

    // Find the label with the highest score (should be one of INJECTION / SAFE).
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
