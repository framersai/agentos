/**
 * @fileoverview Interface contract for ML-backed content classifiers.
 *
 * An `IContentClassifier` represents a single model pipeline that accepts
 * arbitrary text and returns a {@link ClassificationResult} containing the
 * winning label and confidence scores for all candidate classes.
 *
 * Built-in implementations (toxicity, injection, jailbreak) each implement
 * this interface.  Third-party classifiers may be registered via the
 * `customClassifiers` option of {@link MLClassifierPackOptions}.
 *
 * Lifecycle
 * ---------
 * 1. The pack initialises each classifier (model loading, warm-up).
 * 2. The guardrail pipeline calls `classify()` for every text chunk.
 * 3. On pack teardown, `dispose()` is called (if present) to release GPU/
 *    WASM memory.
 *
 * @module agentos/extensions/packs/ml-classifiers/IContentClassifier
 */

import type { ClassificationResult } from '../../../core/ai_utilities/IUtilityAI';

/**
 * Contract for a single ML content classifier.
 *
 * Implementations back one model pipeline and expose a narrow classify/dispose
 * API so the guardrail orchestrator can drive them uniformly regardless of the
 * underlying runtime (Node.js ONNX, browser WASM, remote inference endpoint).
 *
 * @example Minimal custom classifier
 * ```typescript
 * class SarcasmClassifier implements IContentClassifier {
 *   readonly id = 'custom:sarcasm-detector';
 *   readonly displayName = 'Sarcasm Detector';
 *   readonly description = 'Detects sarcastic or ironic statements.';
 *   readonly modelId = 'my-org/sarcasm-bert';
 *   isLoaded = false;
 *
 *   async classify(text: string): Promise<ClassificationResult> {
 *     // … run inference …
 *     return { bestClass: 'NOT_SARCASTIC', confidence: 0.8, allScores: [] };
 *   }
 *
 *   async dispose(): Promise<void> {
 *     // Free resources.
 *   }
 * }
 * ```
 */
export interface IContentClassifier {
  /**
   * Unique service identifier for this classifier.
   *
   * Must follow the `agentos:<domain>:<name>` convention so it can be
   * registered with the AgentOS shared service registry.
   *
   * @example `'agentos:ml-classifiers:toxicity-pipeline'`
   */
  readonly id: string;

  /**
   * Human-readable name displayed in logs and dashboards.
   *
   * @example `'Toxicity Pipeline'`
   */
  readonly displayName: string;

  /**
   * Short prose description of what this classifier detects.
   *
   * @example `'Detects toxic, hateful, or abusive language in text.'`
   */
  readonly description: string;

  /**
   * Identifier of the underlying model being used, typically a Hugging Face
   * model ID or a local filesystem path.
   *
   * @example `'Xenova/toxic-bert'`
   */
  readonly modelId: string;

  /**
   * Whether the model weights have been fully loaded into memory and the
   * classifier is ready to accept `classify()` calls.
   *
   * The pack initialiser sets this to `true` after the warm-up inference
   * succeeds.  Callers can check this flag before calling `classify()` to
   * avoid queueing calls during a slow model download.
   */
  isLoaded: boolean;

  /**
   * Classify the provided text and return confidence scores for all candidate
   * labels.
   *
   * The classifier is responsible for mapping raw model output to the
   * {@link ClassificationResult} shape.  It should NOT apply thresholds or
   * guardrail actions — that is the responsibility of the pack orchestrator.
   *
   * @param text - The text to classify.  May be a short chunk from a streaming
   *   response or a complete message.  Must not be empty.
   * @returns A promise that resolves with the classification result, including
   *   the winning label (`bestClass`), its `confidence`, and `allScores` for
   *   every label the model evaluated.
   * @throws {Error} If the model is not loaded (`isLoaded === false`) or if
   *   inference fails for an unrecoverable reason.
   */
  classify(text: string): Promise<ClassificationResult>;

  /**
   * Release all resources held by this classifier (model weights, WASM
   * module, GPU buffers, worker threads, etc.).
   *
   * Called by the pack orchestrator during AgentOS shutdown or when the pack
   * is unloaded.  Implementations should be idempotent — calling `dispose()`
   * multiple times must not throw.
   *
   * @optional Classifiers that hold no persistent resources may omit this
   *   method.
   */
  dispose?(): Promise<void>;
}
