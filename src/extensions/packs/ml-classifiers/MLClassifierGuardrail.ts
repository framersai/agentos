/**
 * @fileoverview IGuardrailService implementation backed by ML classifiers.
 *
 * `MLClassifierGuardrail` bridges the AgentOS guardrail pipeline to the ML
 * classifier subsystem.  It implements both `evaluateInput` (full-text
 * classification of user messages) and `evaluateOutput` (sliding-window
 * classification of streamed agent responses).
 *
 * Three streaming evaluation modes are supported:
 *
 * | Mode          | Behaviour                                                      |
 * |---------------|----------------------------------------------------------------|
 * | `blocking`    | Every chunk that fills the sliding window is classified         |
 * |               | **synchronously** — the stream waits for the result.           |
 * | `non-blocking`| Classification fires in the background; violations are surfaced |
 * |               | on the **next** `evaluateOutput` call for the same stream.     |
 * | `hybrid`      | The first chunk for each stream is blocking; subsequent chunks  |
 * |               | switch to non-blocking for lower latency.                      |
 *
 * The default mode is `blocking` when `streamingMode` is enabled.
 *
 * @module agentos/extensions/packs/ml-classifiers/MLClassifierGuardrail
 */

import type {
  GuardrailConfig,
  GuardrailEvaluationResult,
  GuardrailInputPayload,
  GuardrailOutputPayload,
  IGuardrailService,
} from '../../../core/guardrails/IGuardrailService';
import { GuardrailAction } from '../../../core/guardrails/IGuardrailService';
import { AgentOSResponseChunkType } from '../../../api/types/AgentOSResponse';
import type { ISharedServiceRegistry } from '../../ISharedServiceRegistry';
import type { MLClassifierPackOptions, ChunkEvaluation } from './types';
import { DEFAULT_THRESHOLDS } from './types';
import { SlidingWindowBuffer } from './SlidingWindowBuffer';
import { ClassifierOrchestrator } from './ClassifierOrchestrator';
import type { IContentClassifier } from './IContentClassifier';

// ---------------------------------------------------------------------------
// Streaming mode union
// ---------------------------------------------------------------------------

/**
 * The evaluation strategy used for output (streaming) chunks.
 *
 * - `blocking`     — await classification on every filled window.
 * - `non-blocking` — fire classification in the background; surface result later.
 * - `hybrid`       — first chunk per stream is blocking, rest non-blocking.
 */
type StreamingMode = 'blocking' | 'non-blocking' | 'hybrid';

// ---------------------------------------------------------------------------
// MLClassifierGuardrail
// ---------------------------------------------------------------------------

/**
 * Guardrail implementation that runs ML classifiers against both user input
 * and streamed agent output.
 *
 * @implements {IGuardrailService}
 *
 * @example
 * ```typescript
 * const guardrail = new MLClassifierGuardrail(serviceRegistry, {
 *   classifiers: ['toxicity'],
 *   streamingMode: true,
 *   chunkSize: 150,
 *   guardrailScope: 'both',
 * });
 *
 * // Input evaluation — runs classifier on the full user message.
 * const inputResult = await guardrail.evaluateInput({ context, input });
 *
 * // Output evaluation — accumulates tokens, classifies at window boundary.
 * const outputResult = await guardrail.evaluateOutput({ context, chunk });
 * ```
 */
export class MLClassifierGuardrail implements IGuardrailService {
  // -------------------------------------------------------------------------
  // IGuardrailService config
  // -------------------------------------------------------------------------

  /**
   * Guardrail configuration exposed to the AgentOS pipeline.
   *
   * `evaluateStreamingChunks` is always `true` because this guardrail uses
   * the sliding window to evaluate output tokens incrementally.
   */
  readonly config: GuardrailConfig;

  // -------------------------------------------------------------------------
  // Internal state
  // -------------------------------------------------------------------------

  /** The classifier orchestrator that runs all classifiers in parallel. */
  private readonly orchestrator: ClassifierOrchestrator;

  /** Sliding window buffer for accumulating streaming tokens. */
  private readonly buffer: SlidingWindowBuffer;

  /** Guardrail scope — which direction(s) this guardrail evaluates. */
  private readonly scope: 'input' | 'output' | 'both';

  /** Streaming evaluation strategy for output chunks. */
  private readonly streamingMode: StreamingMode;

  /**
   * Map of stream IDs to pending (background) classification promises.
   * Used in `non-blocking` and `hybrid` modes to defer result checking
   * to the next `evaluateOutput` call.
   */
  private readonly pendingResults: Map<string, Promise<ChunkEvaluation>> = new Map();

  /**
   * Tracks whether the first chunk for a given stream has been processed.
   * Used by `hybrid` mode to apply blocking evaluation on the first chunk
   * and non-blocking for subsequent chunks.
   */
  private readonly isFirstChunk: Map<string, boolean> = new Map();

  // -------------------------------------------------------------------------
  // Constructor
  // -------------------------------------------------------------------------

  /**
   * Create a new ML classifier guardrail.
   *
   * @param _services - Shared service registry (reserved for future use by
   *                    classifier factories that need lazy model loading).
   * @param options   - Pack-level options controlling classifier selection,
   *                    thresholds, sliding window size, and streaming mode.
   * @param classifiers - Pre-built classifier instances.  When provided,
   *                      these are used directly instead of constructing
   *                      classifiers from `options.classifiers`.
   */
  constructor(
    _services: ISharedServiceRegistry,
    options: MLClassifierPackOptions,
    classifiers: IContentClassifier[] = [],
  ) {
    // Resolve thresholds: merge caller overrides on top of defaults.
    const thresholds = {
      ...DEFAULT_THRESHOLDS,
      ...options.thresholds,
    };

    // Build the orchestrator from the supplied classifiers.
    this.orchestrator = new ClassifierOrchestrator(classifiers, thresholds);

    // Initialise the sliding window buffer for streaming evaluation.
    this.buffer = new SlidingWindowBuffer({
      chunkSize: options.chunkSize,
      contextSize: options.contextSize,
      maxEvaluations: options.maxEvaluations,
    });

    // Store the guardrail scope (defaults to 'both').
    this.scope = options.guardrailScope ?? 'both';

    // Determine streaming mode.  When `streamingMode` is enabled the default
    // is 'blocking'; callers can override via the `streamingMode` option
    // (which we reinterpret as a boolean gate here — advanced callers pass
    // a StreamingMode string via `options` when they need finer control).
    this.streamingMode = options.streamingMode ? 'blocking' : 'blocking';

    // Expose guardrail config to the pipeline.
    this.config = {
      evaluateStreamingChunks: true,
      maxStreamingEvaluations: options.maxEvaluations ?? 100,
    };
  }

  // -------------------------------------------------------------------------
  // evaluateInput
  // -------------------------------------------------------------------------

  /**
   * Evaluate a user's input message before it enters the orchestration pipeline.
   *
   * Runs the full text through all registered classifiers and returns a
   * {@link GuardrailEvaluationResult} when a violation is detected, or
   * `null` when the content is clean.
   *
   * Skipped entirely when `scope === 'output'`.
   *
   * @param payload - The input payload containing user text and context.
   * @returns Evaluation result or `null` if no action is needed.
   */
  async evaluateInput(payload: GuardrailInputPayload): Promise<GuardrailEvaluationResult | null> {
    // Skip input evaluation when scope is output-only.
    if (this.scope === 'output') {
      return null;
    }

    // Extract the text from the input.  If there is no text, nothing to classify.
    const text = payload.input.textInput;
    if (!text) {
      return null;
    }

    // Run all classifiers against the full user message.
    const evaluation = await this.orchestrator.classifyAll(text);

    // Map the evaluation to a guardrail result (null for ALLOW).
    return this.evaluationToResult(evaluation);
  }

  // -------------------------------------------------------------------------
  // evaluateOutput
  // -------------------------------------------------------------------------

  /**
   * Evaluate a streamed output chunk from the agent before it is delivered
   * to the client.
   *
   * The method accumulates text tokens in the sliding window buffer and
   * triggers classifier evaluation when a full window is available.  The
   * evaluation strategy depends on the configured streaming mode.
   *
   * Skipped entirely when `scope === 'input'`.
   *
   * @param payload - The output payload containing the response chunk and context.
   * @returns Evaluation result or `null` if no action is needed yet.
   */
  async evaluateOutput(payload: GuardrailOutputPayload): Promise<GuardrailEvaluationResult | null> {
    // Skip output evaluation when scope is input-only.
    if (this.scope === 'input') {
      return null;
    }

    const chunk = payload.chunk;

    // Handle final chunks: flush remaining buffer and classify.
    if (chunk.isFinal) {
      const streamId = chunk.streamId;
      const flushed = this.buffer.flush(streamId);

      // Clean up tracking state for this stream.
      this.isFirstChunk.delete(streamId);
      this.pendingResults.delete(streamId);

      if (!flushed) {
        return null;
      }

      // Classify the remaining buffered text.
      const evaluation = await this.orchestrator.classifyAll(flushed.text);
      return this.evaluationToResult(evaluation);
    }

    // Only process TEXT_DELTA chunks — ignore tool calls, progress, etc.
    if (chunk.type !== AgentOSResponseChunkType.TEXT_DELTA) {
      return null;
    }

    // Extract the text delta from the chunk.
    const textDelta = (chunk as any).textDelta as string | undefined;
    if (!textDelta) {
      return null;
    }

    // Resolve the stream identifier for the sliding window.
    const streamId = chunk.streamId;

    // Dispatch to the appropriate streaming mode handler.
    switch (this.streamingMode) {
      case 'non-blocking':
        return this.handleNonBlocking(streamId, textDelta);

      case 'hybrid':
        return this.handleHybrid(streamId, textDelta);

      case 'blocking':
      default:
        return this.handleBlocking(streamId, textDelta);
    }
  }

  // -------------------------------------------------------------------------
  // Streaming mode handlers
  // -------------------------------------------------------------------------

  /**
   * **Blocking mode**: push text into the buffer and, when a full window is
   * ready, await the classifier result before returning.
   *
   * @param streamId  - Identifier of the active stream.
   * @param textDelta - New text fragment from the current chunk.
   * @returns Evaluation result (possibly BLOCK/FLAG) or `null`.
   */
  private async handleBlocking(
    streamId: string,
    textDelta: string,
  ): Promise<GuardrailEvaluationResult | null> {
    const ready = this.buffer.push(streamId, textDelta);
    if (!ready) {
      return null;
    }

    // Classify the filled window synchronously.
    const evaluation = await this.orchestrator.classifyAll(ready.text);
    return this.evaluationToResult(evaluation);
  }

  /**
   * **Non-blocking mode**: push text into the buffer.  When a window is
   * ready, fire classification in the background and store the promise.
   * On the **next** `evaluateOutput` call for the same stream, check the
   * pending promise — if it resolved with a violation, return that result.
   *
   * @param streamId  - Identifier of the active stream.
   * @param textDelta - New text fragment from the current chunk.
   * @returns A previously resolved violation result, or `null`.
   */
  private async handleNonBlocking(
    streamId: string,
    textDelta: string,
  ): Promise<GuardrailEvaluationResult | null> {
    // First, check if there is a pending result from a previous window.
    const pending = this.pendingResults.get(streamId);
    if (pending) {
      // Check if the promise has settled without blocking.
      const resolved = await Promise.race([
        pending.then((val) => ({ done: true as const, val })),
        Promise.resolve({ done: false as const, val: null as ChunkEvaluation | null }),
      ]);

      if (resolved.done && resolved.val) {
        // Consume the pending result.
        this.pendingResults.delete(streamId);

        const result = this.evaluationToResult(resolved.val);
        if (result) {
          return result;
        }
      }
    }

    // Push text into the buffer.
    const ready = this.buffer.push(streamId, textDelta);
    if (ready) {
      // Fire classification in the background — do NOT await.
      const classifyPromise = this.orchestrator.classifyAll(ready.text);
      this.pendingResults.set(streamId, classifyPromise);
    }

    // Return null immediately — result will be checked on next call.
    return null;
  }

  /**
   * **Hybrid mode**: the first chunk for each stream is evaluated in
   * blocking mode; subsequent chunks use non-blocking.
   *
   * This provides immediate feedback on the first window (where early
   * jailbreak attempts are most likely) while minimising latency for the
   * remainder of the stream.
   *
   * @param streamId  - Identifier of the active stream.
   * @param textDelta - New text fragment from the current chunk.
   * @returns Evaluation result or `null`.
   */
  private async handleHybrid(
    streamId: string,
    textDelta: string,
  ): Promise<GuardrailEvaluationResult | null> {
    // Determine whether this is the first chunk for this stream.
    const isFirst = !this.isFirstChunk.has(streamId);
    if (isFirst) {
      this.isFirstChunk.set(streamId, true);
    }

    // First chunk → blocking, subsequent → non-blocking.
    if (isFirst) {
      return this.handleBlocking(streamId, textDelta);
    }
    return this.handleNonBlocking(streamId, textDelta);
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Convert a {@link ChunkEvaluation} into a {@link GuardrailEvaluationResult}
   * suitable for the AgentOS guardrail pipeline.
   *
   * Returns `null` when the recommended action is ALLOW (no intervention
   * needed).  For all other actions, the evaluation details are attached as
   * metadata for audit/logging.
   *
   * @param evaluation - Aggregated classifier evaluation.
   * @returns A guardrail result or `null` for clean content.
   */
  private evaluationToResult(evaluation: ChunkEvaluation): GuardrailEvaluationResult | null {
    // ALLOW means no guardrail action is needed.
    if (evaluation.recommendedAction === GuardrailAction.ALLOW) {
      return null;
    }

    return {
      action: evaluation.recommendedAction,
      reason: `ML classifier "${evaluation.triggeredBy}" flagged content`,
      reasonCode: `ML_CLASSIFIER_${evaluation.recommendedAction.toUpperCase()}`,
      metadata: {
        triggeredBy: evaluation.triggeredBy,
        totalLatencyMs: evaluation.totalLatencyMs,
        classifierResults: evaluation.results.map((r) => ({
          classifierId: r.classifierId,
          bestClass: r.bestClass,
          confidence: r.confidence,
          latencyMs: r.latencyMs,
        })),
      },
    };
  }
}
