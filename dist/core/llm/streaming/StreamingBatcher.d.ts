/**
 * @fileoverview Backpressure batching wrapper for provider streaming chunks (`ModelCompletionResponse`).
 * Combines small, high-frequency deltas into larger aggregated chunks to reduce downstream
 * dispatch overhead (websocket emissions, DOM updates, etc.) while preserving core invariants:
 *   - Text remains append-only (merged into a single `responseTextDelta` per batch).
 *   - Tool/function argument deltas merged per (choiceIndex, toolCallId) into single consolidated delta.
 *   - Exactly one terminal chunk with `isFinal: true` (forwarded from original final chunk).
 *   - Usage & error surfaced only when FINAL chunk encountered (or if intermediate provider error semantics change).
 *
 * Flush Triggers (any):
 *   1. Latency: maxLatencyMs elapsed since first unflushed chunk arrival.
 *   2. Size: accumulated text delta length >= maxTextDeltaChars.
 *   3. Chunk Count: buffer size >= maxChunksPerBatch.
 *   4. Explicit final provider chunk.
 *   5. Manual tool argument size threshold (maxToolArgumentChars) exceeded.
 *
 * Design Choices:
 *   - Aggregated batch `id` composed from first chunk id + suffix `-batch-{sequence}` for traceability.
 *   - `choices` taken verbatim from first chunk in batch (providers do not mutate choice metadata mid-stream except deltas).
 *   - Non-final batches omit `usage` & `error` to keep semantics consistent. (If provider emits an error chunk mid-stream
 *     with `isFinal: true`, it will be flushed immediately as its own batch.)
 *   - Tool call reconstruction at batch granularity only (full stream reconstruction still delegated to `StreamingReconstructor`).
 *
 * NOTE: This is an optional optimization layer. Consumers requiring raw per-token latency should bypass batching.
 */
import { ModelCompletionResponse } from '../providers/IProvider';
/** Configuration options for StreamingBatcher. */
export interface StreamingBatcherOptions {
    /** Max wall-clock latency before forcing a flush (milliseconds). */
    maxLatencyMs?: number;
    /** Max accumulated text delta characters before flush. */
    maxTextDeltaChars?: number;
    /** Max accumulated tool argument characters (combined per tool call) before flush. */
    maxToolArgumentChars?: number;
    /** Max number of provider chunks to accumulate before flush. */
    maxChunksPerBatch?: number;
    /** If true, include batchSequence on emitted chunk object for diagnostics. */
    annotateBatches?: boolean;
}
/**
 * Batches an async stream of `ModelCompletionResponse` chunks according to `StreamingBatcherOptions`.
 * @param stream Underlying provider async generator.
 * @param options Optional batching thresholds.
 * @returns AsyncGenerator<ModelCompletionResponse>
 */
export declare function batchStream(stream: AsyncGenerator<ModelCompletionResponse, void, undefined>, options?: StreamingBatcherOptions): AsyncGenerator<ModelCompletionResponse, void, undefined>;
/** Convenience OO wrapper for imperative control (mirrors functional batchStream). */
export declare class StreamingBatcher {
    private opts;
    constructor(options?: StreamingBatcherOptions);
    batch(stream: AsyncGenerator<ModelCompletionResponse, void, undefined>): AsyncGenerator<ModelCompletionResponse, void, undefined>;
}
export default StreamingBatcher;
//# sourceMappingURL=StreamingBatcher.d.ts.map