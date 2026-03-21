/**
 * @fileoverview Core type definitions for the ML Classifier Guardrail Extension Pack.
 *
 * This file defines all configuration shapes, runtime result types, and
 * service-identifier constants used by the ML classifier pipeline. All
 * classifiers in this pack evaluate text content against learned models
 * (toxicity, prompt-injection, jailbreak) and emit structured results that
 * feed into the AgentOS guardrail decision tree.
 *
 * Import hierarchy
 * ----------------
 * ```
 * IUtilityAI  ──── ClassificationResult, ClassificationScore
 * IGuardrailService ── GuardrailAction
 *                   │
 *                   ▼
 *              types.ts  (this file)
 *                   │
 *                   ▼
 *           IContentClassifier.ts  /  SlidingWindowBuffer.ts  /  …
 * ```
 *
 * @module agentos/extensions/packs/ml-classifiers/types
 */

import type { ClassificationResult, ClassificationScore } from '../../../core/ai_utilities/IUtilityAI';
import type { GuardrailAction } from '../../../core/guardrails/IGuardrailService';

// Re-export types used by dependents so they can import from a single source.
export type { ClassificationResult, ClassificationScore };

// ---------------------------------------------------------------------------
// Threshold configuration
// ---------------------------------------------------------------------------

/**
 * Numeric thresholds that map raw classifier confidence scores (0–1) to
 * guardrail actions.
 *
 * The thresholds are applied in descending priority:
 *  1. `score >= blockThreshold` → {@link GuardrailAction.BLOCK}
 *  2. `score >= flagThreshold`  → {@link GuardrailAction.FLAG}
 *  3. `score >= warnThreshold`  → {@link GuardrailAction.SANITIZE}
 *  4. otherwise                 → {@link GuardrailAction.ALLOW}
 */
export interface ClassifierThresholds {
  /**
   * Minimum score at which content is **blocked** (interaction terminated).
   * Must be in the range [0, 1].  Typical default: `0.9`.
   */
  blockThreshold: number;

  /**
   * Minimum score at which content is **flagged** for review while still
   * being allowed through.  Must be in the range [0, 1].  Typical default: `0.7`.
   */
  flagThreshold: number;

  /**
   * Minimum score at which a **warn** action is taken (e.g. the chunk is
   * sanitised or a warning is appended to the response).  Must be in the range
   * [0, 1].  Typical default: `0.4`.
   */
  warnThreshold: number;
}

/**
 * Sensible defaults for {@link ClassifierThresholds}.
 *
 * These values reflect a conservative-but-pragmatic policy:
 * - block at 90 % confidence → very high bar, minimises false positives
 * - flag at 70 % → surfaced for human review, not blocked
 * - warn at 40 % → low-confidence signal, handled with a light touch
 */
export const DEFAULT_THRESHOLDS: ClassifierThresholds = {
  blockThreshold: 0.9,
  flagThreshold: 0.7,
  warnThreshold: 0.4,
} as const;

// ---------------------------------------------------------------------------
// Per-classifier configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for a single ML classifier pipeline.
 *
 * Allows individual classifiers to override the pack-level defaults for the
 * model variant and decision thresholds, and to customise which guardrail
 * action is taken for each classification label.
 */
export interface ClassifierConfig {
  /**
   * Hugging Face model identifier (e.g. `"Xenova/toxic-bert"`) or a local
   * model path to load instead of the pack default.
   * @optional Falls back to the pack-level `MLClassifierPackOptions.modelCacheDir` default.
   */
  modelId?: string;

  /**
   * Per-classifier threshold overrides.
   * @optional Falls back to {@link DEFAULT_THRESHOLDS}.
   */
  thresholds?: Partial<ClassifierThresholds>;

  /**
   * Maps classification labels to the guardrail action that should be taken
   * when that label is the winning class.
   *
   * @example
   * ```typescript
   * // Always block on TOXIC label regardless of threshold.
   * labelActions: { TOXIC: GuardrailAction.BLOCK }
   * ```
   */
  labelActions?: Record<string, GuardrailAction>;
}

// ---------------------------------------------------------------------------
// Browser / web-worker options
// ---------------------------------------------------------------------------

/**
 * Configuration for browser-side model execution.
 *
 * When the ML classifier pack is loaded in a browser context (e.g. a chat
 * widget), models run inside a Web Worker to avoid blocking the main thread.
 * This interface controls worker lifecycle and cache management.
 */
export interface BrowserConfig {
  /**
   * Run model inference in a Web Worker.
   * @default true
   */
  useWebWorker?: boolean;

  /**
   * Caching strategy for downloaded model weights.
   * - `'memory'`  — keep weights in memory only (lost on page unload)
   * - `'indexeddb'` — persist weights to IndexedDB (survives reloads)
   * - `'none'` — no caching; re-download on every page load
   * @default 'indexeddb'
   */
  cacheStrategy?: 'memory' | 'indexeddb' | 'none';

  /**
   * Maximum number of model shards to keep in the in-memory cache when
   * `cacheStrategy === 'memory'`.  Oldest entries are evicted LRU-style.
   * @default 3
   */
  maxCacheSize?: number;

  /**
   * Callback invoked with download progress as model weights are fetched.
   * Useful for showing a progress bar in the UI.
   *
   * @param progress - Current progress state.
   */
  onProgress?: (progress: ModelDownloadProgress) => void;
}

// ---------------------------------------------------------------------------
// Model download progress
// ---------------------------------------------------------------------------

/**
 * Progress report emitted during model weight downloads.
 *
 * @example
 * ```typescript
 * onProgress({ modelId: 'Xenova/toxic-bert', loaded: 50_000, total: 200_000, percent: 25 })
 * ```
 */
export interface ModelDownloadProgress {
  /** Identifier of the model being downloaded (Hugging Face ID or path). */
  modelId: string;

  /** Number of bytes downloaded so far. */
  loaded: number;

  /** Total number of bytes to download (`0` if unknown). */
  total: number;

  /** Download progress as a percentage in the range [0, 100]. */
  percent: number;
}

// ---------------------------------------------------------------------------
// Pack-level options
// ---------------------------------------------------------------------------

/**
 * Top-level configuration for the ML Classifier Extension Pack.
 *
 * Passed to `createMLClassifierPack()` (or the NestJS module factory) to
 * control which classifiers are active, how models are loaded, and how the
 * sliding-window streaming evaluation behaves.
 *
 * @example
 * ```typescript
 * const packOptions: MLClassifierPackOptions = {
 *   classifiers: ['toxicity', 'jailbreak'],
 *   quantized: true,
 *   runtime: 'node',
 *   thresholds: { blockThreshold: 0.95, flagThreshold: 0.75, warnThreshold: 0.5 },
 *   streamingMode: true,
 *   chunkSize: 150,
 *   contextSize: 50,
 * };
 * ```
 */
export interface MLClassifierPackOptions {
  /**
   * Subset of built-in classifiers to activate.
   * Omit or pass an empty array to activate all built-in classifiers.
   *
   * @example `['toxicity', 'injection']`
   */
  classifiers?: Array<'toxicity' | 'injection' | 'jailbreak'>;

  /**
   * Fully-qualified `IContentClassifier` instances to add alongside the
   * built-in classifiers (e.g. domain-specific harm classifiers).
   */
  customClassifiers?: import('./IContentClassifier').IContentClassifier[];

  /**
   * Local filesystem path where downloaded model weights are cached.
   * Defaults to `~/.cache/agentos/ml-classifiers`.
   */
  modelCacheDir?: string;

  /**
   * Use 8-bit quantised model variants when available.
   * Reduces VRAM/RAM footprint and increases inference speed at a small
   * accuracy cost.
   * @default false
   */
  quantized?: boolean;

  /**
   * Execution runtime for model inference.
   * - `'node'`    — Runs via `@xenova/transformers` in the Node.js process.
   * - `'browser'` — Runs via `@xenova/transformers` in a Web Worker.
   * - `'wasm'`    — Explicit WebAssembly fallback (Node.js or browser).
   * @default 'node'
   */
  runtime?: 'node' | 'browser' | 'wasm';

  /**
   * Browser-specific options.  Only applicable when `runtime === 'browser'`.
   */
  browser?: BrowserConfig;

  /**
   * Number of tokens per evaluation window when streaming mode is enabled.
   * Smaller values detect issues earlier but increase evaluation frequency.
   * @default 200
   */
  chunkSize?: number;

  /**
   * Number of tokens from the previous chunk to carry forward as context into
   * the next window, preventing boundary effects.
   * @default 50
   */
  contextSize?: number;

  /**
   * Maximum number of classifier evaluations per stream.  The sliding window
   * stops advancing after this many evaluations, allowing the stream to
   * complete without further overhead.
   * @default 100
   */
  maxEvaluations?: number;

  /**
   * Enable sliding-window evaluation for streamed (token-by-token) output.
   * When `false`, classifiers only run on the completed final response.
   * @default false
   */
  streamingMode?: boolean;

  /**
   * Pack-level threshold defaults applied to every classifier unless
   * overridden by a per-classifier {@link ClassifierConfig}.
   */
  thresholds?: Partial<ClassifierThresholds>;

  /**
   * Scope of guardrail enforcement.
   * - `'input'`  — Evaluate user messages before orchestration.
   * - `'output'` — Evaluate agent responses before delivery.
   * - `'both'`   — Evaluate at both stages.
   * @default 'both'
   */
  guardrailScope?: 'input' | 'output' | 'both';
}

// ---------------------------------------------------------------------------
// Service identifiers
// ---------------------------------------------------------------------------

/**
 * Well-known service identifier strings for the three built-in ML classifier
 * pipelines.
 *
 * These IDs follow the `agentos:<domain>:<name>` naming convention used
 * throughout the AgentOS extension ecosystem.  Use them to retrieve specific
 * classifier services from the shared service registry.
 *
 * @example
 * ```typescript
 * const toxicity = serviceRegistry.get(ML_CLASSIFIER_SERVICE_IDS.TOXICITY_PIPELINE);
 * ```
 */
export const ML_CLASSIFIER_SERVICE_IDS = {
  /** Classifier that detects toxic, hateful, or abusive language. */
  TOXICITY_PIPELINE: 'agentos:ml-classifiers:toxicity-pipeline',

  /** Classifier that detects prompt-injection attempts. */
  INJECTION_PIPELINE: 'agentos:ml-classifiers:injection-pipeline',

  /** Classifier that detects jailbreak / system-override attempts. */
  JAILBREAK_PIPELINE: 'agentos:ml-classifiers:jailbreak-pipeline',
} as const;

/** Union type of all ML classifier service ID strings. */
export type MLClassifierServiceId =
  (typeof ML_CLASSIFIER_SERVICE_IDS)[keyof typeof ML_CLASSIFIER_SERVICE_IDS];

// ---------------------------------------------------------------------------
// Annotated & aggregated result types
// ---------------------------------------------------------------------------

/**
 * A {@link ClassificationResult} augmented with provenance metadata.
 *
 * Produced when a classifier evaluates a chunk of text.  Carries the
 * classifier's identity and the wall-clock latency so callers can build
 * audit trails and SLO dashboards.
 */
export interface AnnotatedClassificationResult extends ClassificationResult {
  /**
   * The {@link IContentClassifier.id} of the classifier that produced this
   * result (e.g. `ML_CLASSIFIER_SERVICE_IDS.TOXICITY_PIPELINE`).
   */
  classifierId: string;

  /**
   * Wall-clock time in milliseconds from when `classify()` was called to when
   * it resolved.
   */
  latencyMs: number;
}

/**
 * Aggregated evaluation outcome for a single sliding-window chunk.
 *
 * Produced by running all active classifiers against one text window and
 * collating their results into a single action recommendation.
 *
 * The `recommendedAction` is the most restrictive action across all
 * classifiers (BLOCK > FLAG > SANITIZE > ALLOW).
 */
export interface ChunkEvaluation {
  /**
   * Individual results from every classifier that evaluated this chunk,
   * in the order the classifiers were invoked.
   */
  results: AnnotatedClassificationResult[];

  /**
   * The most restrictive guardrail action recommended across all results.
   * The pipeline should act on this value rather than iterating `results`
   * manually.
   */
  recommendedAction: GuardrailAction;

  /**
   * ID of the classifier that triggered the `recommendedAction`, or `null`
   * if the action is {@link GuardrailAction.ALLOW} (no classifier triggered).
   */
  triggeredBy: string | null;

  /**
   * Sum of all classifier `latencyMs` values — useful for profiling the
   * total evaluation overhead per chunk.
   */
  totalLatencyMs: number;
}
