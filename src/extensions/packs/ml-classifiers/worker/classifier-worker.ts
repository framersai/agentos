/**
 * @fileoverview Web Worker entry point for ML content classification.
 *
 * This script is loaded by {@link WorkerClassifierProxy} as a dedicated Web
 * Worker.  It listens for `classify` messages from the main thread, lazily
 * loads the requested model pipeline via `@huggingface/transformers`, runs
 * inference, then posts the result (or an error) back.
 *
 * ## Message protocol
 *
 * **Incoming** (main thread → worker):
 * ```json
 * {
 *   "type": "classify",
 *   "text":      "<string>",
 *   "modelId":   "<HuggingFace model ID or local path>",
 *   "quantized": true | false,
 *   "taskType":  "<transformers.js task string>"
 * }
 * ```
 *
 * **Outgoing** (worker → main thread) on success:
 * ```json
 * { "type": "result", "result": { "bestClass": "...", "confidence": 0.92, "allScores": [...] } }
 * ```
 *
 * **Outgoing** (worker → main thread) on error:
 * ```json
 * { "type": "error", "error": "<error message>" }
 * ```
 *
 * ## Pipeline caching
 * The pipeline is loaded once per `(modelId, taskType)` key and cached in
 * a module-level `Map`.  Subsequent `classify` messages for the same model
 * reuse the cached instance, avoiding repeated expensive model downloads and
 * WASM initialisation.
 *
 * ## Raw label normalisation
 * The worker normalises the raw `@huggingface/transformers` output (an array
 * of `{ label, score }` objects when called with `topk: null`) into the
 * AgentOS {@link ClassificationResult} shape:
 *  - `bestClass`  — label with the highest score
 *  - `confidence` — score of the winning label
 *  - `allScores`  — all labels mapped to `{ classLabel, score }` pairs
 *
 * @module agentos/extensions/packs/ml-classifiers/worker/classifier-worker
 */

import type { ClassificationResult, ClassificationScore } from '../../../core/ai_utilities/IUtilityAI';

// ---------------------------------------------------------------------------
// Internal message shapes (mirrored from WorkerClassifierProxy for clarity)
// ---------------------------------------------------------------------------

/**
 * A classification request message received from the main thread.
 *
 * @internal
 */
interface ClassifyRequest {
  /** Must be `'classify'` — other message types are silently ignored. */
  type: 'classify';

  /** The text to pass to the pipeline. */
  text: string;

  /** Hugging Face model ID (e.g. `'Xenova/toxic-bert'`) or local path. */
  modelId: string;

  /**
   * Whether to request a quantized (8-bit) model variant.
   * Passed to the pipeline constructor's `{ quantized }` option.
   */
  quantized: boolean;

  /**
   * The `@huggingface/transformers` task identifier.
   * Most classifiers use `'text-classification'`.
   */
  taskType: string;
}

/**
 * A single label/score pair as returned by the transformers.js
 * text-classification pipeline when called with `{ topk: null }`.
 *
 * @internal
 */
interface RawLabel {
  /** Classification label name, e.g. `'toxic'`. */
  label: string;

  /** Confidence score in the range [0, 1]. */
  score: number;
}

/**
 * Success response posted to the main thread.
 *
 * @internal
 */
interface ResultMessage {
  type: 'result';
  result: ClassificationResult;
}

/**
 * Error response posted to the main thread.
 *
 * @internal
 */
interface ErrorMessage {
  type: 'error';
  error: string;
}

// ---------------------------------------------------------------------------
// Pipeline cache
// ---------------------------------------------------------------------------

/**
 * Cache key composed of `modelId` and `taskType` so different task types
 * for the same model ID are kept separate.
 *
 * @param modelId  - Hugging Face model ID or local path.
 * @param taskType - transformers.js task string.
 * @returns Cache key string.
 */
function cacheKey(modelId: string, taskType: string): string {
  return `${taskType}::${modelId}`;
}

/**
 * Module-level pipeline cache.
 *
 * Maps cache keys (see {@link cacheKey}) to loaded pipeline functions.
 * Populated lazily on the first `classify` message for each unique
 * `(modelId, taskType)` combination.
 */
const pipelineCache = new Map<string, (text: string, opts: { topk: null }) => Promise<RawLabel[]>>();

// ---------------------------------------------------------------------------
// Classification logic
// ---------------------------------------------------------------------------

/**
 * Load (or retrieve from cache) the text-classification pipeline for the
 * given model and run inference on `text`.
 *
 * @param request - The incoming classify request.
 * @returns A promise resolving with the raw label array from the pipeline.
 * @throws If the pipeline fails to load or inference throws.
 */
async function runPipeline(request: ClassifyRequest): Promise<RawLabel[]> {
  const key = cacheKey(request.modelId, request.taskType);

  // Check the cache first to avoid re-loading on every message.
  let pipe = pipelineCache.get(key);

  if (!pipe) {
    // Lazy-load the @huggingface/transformers package.
    // Dynamic import is used so this module can be evaluated in environments
    // where the package is optional (the Worker is only instantiated when
    // browser runtime is active and the package is present).
    const { pipeline: createPipeline } = await import('@huggingface/transformers');

    // Create the pipeline with quantisation option from the request.
    const newPipe = await createPipeline(request.taskType, request.modelId, {
      quantized: request.quantized,
    });

    // Store in cache and narrow the type.
    pipe = newPipe as (text: string, opts: { topk: null }) => Promise<RawLabel[]>;
    pipelineCache.set(key, pipe);
  }

  // Run inference — request all label scores (topk: null).
  return pipe(request.text, { topk: null });
}

/**
 * Normalise raw pipeline output into an AgentOS {@link ClassificationResult}.
 *
 * @param raw - Array of `{ label, score }` objects from the pipeline.
 * @returns A fully-populated `ClassificationResult`.
 */
function normaliseResult(raw: RawLabel[]): ClassificationResult {
  if (!raw || raw.length === 0) {
    // No output — return a benign pass result so the orchestrator treats this
    // as ALLOW rather than an error.
    return { bestClass: 'benign', confidence: 0, allScores: [] };
  }

  // Find the label with the highest confidence score.
  let best = raw[0];
  for (const item of raw) {
    if (item.score > best.score) {
      best = item;
    }
  }

  // Map every label to the AgentOS ClassificationScore shape.
  const allScores: ClassificationScore[] = raw.map((item) => ({
    classLabel: item.label,
    score: item.score,
  }));

  return {
    bestClass: best.label,
    confidence: best.score,
    allScores,
  };
}

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

/**
 * Handle a `classify` message from the main thread.
 *
 * Runs the pipeline and posts either a {@link ResultMessage} or an
 * {@link ErrorMessage} back to the main thread.
 *
 * @param request - The incoming classify request.
 */
async function handleClassify(request: ClassifyRequest): Promise<void> {
  try {
    const raw = await runPipeline(request);
    const result = normaliseResult(raw);

    const response: ResultMessage = { type: 'result', result };
    self.postMessage(response);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const response: ErrorMessage = { type: 'error', error: message };
    self.postMessage(response);
  }
}

// ---------------------------------------------------------------------------
// Worker bootstrap — listen for messages from the main thread
// ---------------------------------------------------------------------------

/**
 * The primary message listener for this Worker.
 *
 * Dispatches incoming messages to {@link handleClassify} when the message
 * type is `'classify'`.  All other message types are ignored with a warning
 * logged to the Worker console (useful for debugging unexpected messages
 * during development).
 */
self.onmessage = (event: MessageEvent) => {
  const data = event.data as ClassifyRequest;

  if (data?.type === 'classify') {
    // Kick off async classification.  Errors are caught inside handleClassify
    // and posted back as ErrorMessage, so we do not need a top-level catch here.
    void handleClassify(data);
  } else {
    // Unknown message type — log and ignore.
    console.warn(
      '[classifier-worker] Received unexpected message type:',
      data?.type ?? data,
    );
  }
};
