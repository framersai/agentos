/**
 * @file PiiRedactionGuardrail.ts
 * @description Guardrail service that intercepts agent input and/or output to
 * detect and redact PII (Personally Identifiable Information) in real time.
 *
 * The guardrail integrates with the AgentOS guardrail hook pipeline via the
 * {@link IGuardrailService} interface, providing two evaluation paths:
 *
 * - **Input evaluation** (`evaluateInput`): Scans the user's text input before
 *   it enters the orchestration pipeline and returns a SANITIZE action with
 *   redacted text when PII is found.
 *
 * - **Output evaluation** (`evaluateOutput`): Uses a sentence-boundary buffer
 *   keyed by `streamId` to accumulate streaming text deltas.  When a sentence
 *   boundary is detected (`. `, `? `, `! `, or `\n`) the buffer is scanned
 *   for PII and redacted text is returned as a SANITIZE action.  Entity
 *   offsets are always relative to the buffer, not individual chunks.
 *
 * Which evaluation path(s) are active is controlled by the
 * {@link PiiRedactionPackOptions.guardrailScope} option:
 * - `'input'`  -- only `evaluateInput` is active
 * - `'output'` -- only `evaluateOutput` is active
 * - `'both'`   -- both paths are active (default)
 *
 * @module pii-redaction/PiiRedactionGuardrail
 */

import type { ISharedServiceRegistry } from '../../ISharedServiceRegistry';
import type {
  IGuardrailService,
  GuardrailConfig,
  GuardrailInputPayload,
  GuardrailOutputPayload,
  GuardrailEvaluationResult,
} from '../../../core/guardrails/IGuardrailService';
import { GuardrailAction } from '../../../core/guardrails/IGuardrailService';
import { AgentOSResponseChunkType } from '../../../api/types/AgentOSResponse';
import type { PiiRedactionPackOptions, RedactionStyle } from './types';
import { PiiDetectionPipeline } from './PiiDetectionPipeline';
import { redactText } from './RedactionEngine';

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/**
 * Per-stream state maintained by the output evaluator's sentence-boundary
 * buffer.  Each active `streamId` gets its own {@link StreamState} entry.
 */
interface StreamState {
  /** Accumulated text that has not yet been flushed to a sentence boundary. */
  buffer: string;

  /** Number of evaluations (sentence flushes) performed for this stream. */
  evaluations: number;

  /** Timestamp (epoch ms) of the last chunk received for this stream. */
  lastSeenAt: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Default maximum number of streaming evaluations (sentence flushes) allowed
 * per stream before the guardrail stops scanning.  Prevents unbounded CPU
 * usage on very long streams.
 */
const DEFAULT_MAX_STREAMING_EVALUATIONS = 50;

/**
 * Regex matching sentence-boundary positions in accumulated buffer text.
 *
 * Matches:
 * - `. ` (period + space)
 * - `? ` (question mark + space)
 * - `! ` (exclamation mark + space)
 * - `\n` (newline)
 *
 * The `g` flag is intentional so `lastIndex` tracks all boundaries in a
 * single pass via `matchAll`.
 */
const SENTENCE_BOUNDARY_RE = /[.?!]\s|\n/g;

// ---------------------------------------------------------------------------
// PiiRedactionGuardrail
// ---------------------------------------------------------------------------

/**
 * AgentOS guardrail service that detects and redacts PII from both inbound
 * user messages and outbound agent responses.
 *
 * ### Construction
 * ```ts
 * const guardrail = new PiiRedactionGuardrail(registry, options, getSecret);
 * ```
 *
 * ### Thread safety
 * The guardrail maintains per-stream mutable state for output evaluation.
 * Concurrent calls with **different** `streamId` values are safe.  Concurrent
 * calls with the **same** `streamId` are serialised by the AgentOS streaming
 * pipeline so no additional locking is required.
 *
 * @implements {IGuardrailService}
 */
export class PiiRedactionGuardrail implements IGuardrailService {
  // -----------------------------------------------------------------------
  // Public config (required by IGuardrailService)
  // -----------------------------------------------------------------------

  /**
   * Guardrail configuration exposed to the AgentOS hook pipeline.
   * Controls whether streaming chunks are evaluated and the per-request
   * evaluation cap.
   */
  readonly config: GuardrailConfig;

  // -----------------------------------------------------------------------
  // Private state
  // -----------------------------------------------------------------------

  /** Detection pipeline shared across all evaluations. */
  private readonly pipeline: PiiDetectionPipeline;

  /** Redaction style applied when replacing detected PII spans. */
  private readonly redactionStyle: RedactionStyle;

  /** Which evaluation paths are active: 'input', 'output', or 'both'. */
  private readonly scope: 'input' | 'output' | 'both';

  /** Maximum sentence-boundary evaluations per stream. */
  private readonly maxStreamingEvaluations: number;

  /**
   * Per-stream sentence-boundary buffers for output evaluation.
   * Keys are `AgentOSResponseChunk.streamId` strings.
   */
  private readonly streamBuffers = new Map<string, StreamState>();

  // -----------------------------------------------------------------------
  // Constructor
  // -----------------------------------------------------------------------

  /**
   * Construct a new PiiRedactionGuardrail.
   *
   * @param services  - Shared service registry forwarded to the detection
   *                    pipeline for lazy-loading NLP/NER models.
   * @param options   - Pack-level configuration controlling entity types,
   *                    confidence threshold, redaction style, guardrail scope,
   *                    and streaming behaviour.
   * @param getSecret - Optional secret resolver for the LLM judge API key.
   */
  constructor(
    services: ISharedServiceRegistry,
    options: PiiRedactionPackOptions,
    getSecret?: (id: string) => string | undefined,
  ) {
    // Build the detection pipeline with the provided options.
    this.pipeline = new PiiDetectionPipeline(services, options, getSecret);

    // Resolve configuration with sensible defaults.
    this.redactionStyle = options.redactionStyle ?? 'placeholder';
    this.scope = options.guardrailScope ?? 'both';
    this.maxStreamingEvaluations =
      options.maxStreamingEvaluations ?? DEFAULT_MAX_STREAMING_EVALUATIONS;

    // Build the GuardrailConfig from pack options.
    this.config = {
      evaluateStreamingChunks: options.evaluateStreamingChunks ?? false,
      maxStreamingEvaluations: this.maxStreamingEvaluations,
    };
  }

  // -----------------------------------------------------------------------
  // IGuardrailService — evaluateInput
  // -----------------------------------------------------------------------

  /**
   * Evaluate inbound user text for PII before the orchestration pipeline
   * processes it.
   *
   * When PII is found the method returns a {@link GuardrailAction.SANITIZE}
   * result containing the redacted text.  When no PII is found (or the
   * input has no text) it returns `null` to signal the content should pass
   * through unchanged.
   *
   * This method is a no-op (returns `null`) when `guardrailScope` is set
   * to `'output'`.
   *
   * @param payload - Input payload containing the user's text and context.
   * @returns Evaluation result with redacted text, or `null` if clean.
   */
  async evaluateInput(
    payload: GuardrailInputPayload,
  ): Promise<GuardrailEvaluationResult | null> {
    // Skip input evaluation when scope is output-only.
    if (this.scope === 'output') {
      return null;
    }

    // Extract the text input from the payload.
    const text = payload.input.textInput;

    // Nothing to scan if the input has no text content.
    if (!text) {
      return null;
    }

    // Run the full detection pipeline over the input text.
    const detectionResult = await this.pipeline.detect(text);

    // No PII found — allow the input through unchanged.
    if (detectionResult.entities.length === 0) {
      return null;
    }

    // PII was found — redact the input text and return a SANITIZE action.
    const redacted = redactText(text, detectionResult.entities, this.redactionStyle);

    return {
      action: GuardrailAction.SANITIZE,
      modifiedText: redacted,
      reason: detectionResult.summary,
      reasonCode: 'PII_REDACTED',
      metadata: {
        entityCount: detectionResult.entities.length,
        tiersExecuted: detectionResult.tiersExecuted,
        processingTimeMs: detectionResult.processingTimeMs,
      },
    };
  }

  // -----------------------------------------------------------------------
  // IGuardrailService — evaluateOutput
  // -----------------------------------------------------------------------

  /**
   * Evaluate outbound agent response chunks for PII using a sentence-boundary
   * buffer.
   *
   * ### Buffering strategy
   *
   * Text deltas are accumulated per-stream in an internal buffer.  The buffer
   * is scanned for PII only when a sentence boundary is detected (`. `, `? `,
   * `! `, or `\n`) or when the stream ends (`isFinal === true` or chunk type
   * is `FINAL_RESPONSE`).
   *
   * Entity offsets from the detection pipeline are relative to the **buffer**
   * text, not individual chunk deltas, so redaction replacement is always
   * positionally correct.
   *
   * An internal evaluation counter enforces {@link maxStreamingEvaluations}
   * per stream.  Once the limit is reached subsequent chunks pass through
   * unevaluated.
   *
   * This method is a no-op (returns `null`) when `guardrailScope` is set
   * to `'input'`.
   *
   * @param payload - Output payload containing the response chunk and context.
   * @returns Evaluation result with redacted buffer text, or `null` if clean.
   */
  async evaluateOutput(
    payload: GuardrailOutputPayload,
  ): Promise<GuardrailEvaluationResult | null> {
    // Skip output evaluation when scope is input-only.
    if (this.scope === 'input') {
      return null;
    }

    const { chunk } = payload;

    // Determine the text content to buffer based on chunk type.
    let textToBuffer: string | null = null;
    let isStreamEnd = false;

    if (chunk.type === AgentOSResponseChunkType.TEXT_DELTA) {
      // TEXT_DELTA chunks carry incremental text in `textDelta`.
      textToBuffer = (chunk as { textDelta?: string }).textDelta ?? null;
    } else if (chunk.type === AgentOSResponseChunkType.FINAL_RESPONSE) {
      // FINAL_RESPONSE may carry the complete response text.
      textToBuffer =
        (chunk as { finalResponseText?: string | null }).finalResponseText ?? null;
      isStreamEnd = true;
    }

    // Mark stream end when isFinal is set regardless of chunk type.
    if (chunk.isFinal) {
      isStreamEnd = true;
    }

    // Nothing to evaluate if there is no text content and stream is not ending.
    if (!textToBuffer && !isStreamEnd) {
      return null;
    }

    // Retrieve or create the per-stream buffer state.
    const streamId = chunk.streamId;
    let state = this.streamBuffers.get(streamId);

    if (!state) {
      state = { buffer: '', evaluations: 0, lastSeenAt: Date.now() };
      this.streamBuffers.set(streamId, state);
    }

    // Update the last-seen timestamp.
    state.lastSeenAt = Date.now();

    // Append new text to the buffer.
    if (textToBuffer) {
      state.buffer += textToBuffer;
    }

    // Check whether the evaluation limit has been reached.
    if (state.evaluations >= this.maxStreamingEvaluations && !isStreamEnd) {
      // Limit reached — pass through without evaluation.
      return null;
    }

    // Determine whether a sentence boundary exists in the buffer.
    const hasSentenceBoundary = SENTENCE_BOUNDARY_RE.test(state.buffer);

    // Reset the regex lastIndex since we used `test()` which advances it.
    SENTENCE_BOUNDARY_RE.lastIndex = 0;

    // Only evaluate when we have a sentence boundary or the stream is ending.
    if (!hasSentenceBoundary && !isStreamEnd) {
      return null;
    }

    // Increment the evaluation counter.
    state.evaluations++;

    // Run detection against the full buffer text.
    const detectionResult = await this.pipeline.detect(state.buffer);

    // Clean up buffer on stream end.
    if (isStreamEnd) {
      this.streamBuffers.delete(streamId);
    }

    // No PII found — allow the chunk through unchanged.
    if (detectionResult.entities.length === 0) {
      return null;
    }

    // PII was found — redact against the BUFFER text (not the individual
    // chunk delta) since entity offsets are buffer-relative.
    const redacted = redactText(
      state.buffer,
      detectionResult.entities,
      this.redactionStyle,
    );

    // Reset the buffer to empty after redaction since the sanitised text
    // replaces the entire accumulated buffer.
    if (!isStreamEnd) {
      state.buffer = '';
    }

    return {
      action: GuardrailAction.SANITIZE,
      modifiedText: redacted,
      reason: detectionResult.summary,
      reasonCode: 'PII_REDACTED',
      metadata: {
        entityCount: detectionResult.entities.length,
        tiersExecuted: detectionResult.tiersExecuted,
        processingTimeMs: detectionResult.processingTimeMs,
        streamId,
        evaluationNumber: state?.evaluations,
      },
    };
  }
}
