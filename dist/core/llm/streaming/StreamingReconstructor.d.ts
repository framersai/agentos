/**
 * @fileoverview Utility helpers to reconstruct full model output and tool/function calls
 * from incremental streaming `ModelCompletionResponse` chunks emitted by `IProvider.generateCompletionStream`.
 *
 * Invariants enforced by provider layer (see IProvider.ts):
 *  - `responseTextDelta` values are append-only fragments of assistant text.
 *  - `toolCallsDeltas` supply incremental JSON argument substrings via `arguments_delta` per choice index.
 *  - Exactly one chunk per stream has `isFinal: true` (terminal chunk; may contain error and usage).
 *
 * This module centralizes reconstruction logic so UI code, tests, and higher-level orchestration
 * avoid duplicating fragile merge routines.
 */
import { ModelCompletionResponse } from '../providers/IProvider';
/** Reconstructed tool call structure after merging streamed argument deltas. */
export interface ReconstructedToolCall {
    index: number;
    id?: string;
    name?: string;
    /** Parsed arguments object if JSON parse succeeded, else original concatenated string in rawArguments. */
    arguments?: any;
    rawArguments: string;
    parseError?: string;
}
/** Aggregate reconstruction result for a full streamed completion. */
export interface StreamingReconstructionResult {
    fullText: string;
    toolCalls: ReconstructedToolCall[];
    finalChunk?: ModelCompletionResponse;
    error?: ModelCompletionResponse['error'];
    usage?: ModelCompletionResponse['usage'];
    chunks: number;
}
/**
 * Reconstructs full assistant text and tool calls from an async stream of `ModelCompletionResponse` chunks.
 * The generator is consumed entirely before returning.
 *
 * @param stream Async generator from `generateCompletionStream`.
 * @returns StreamingReconstructionResult summarizing concatenated text, parsed tool calls, final chunk & usage.
 */
export declare function reconstructStream(stream: AsyncGenerator<ModelCompletionResponse, void, undefined>): Promise<StreamingReconstructionResult>;
/**
 * Incremental (online) reconstruction API: pass each chunk in sequence and query state at any time.
 * Useful for UI rendering that wants interim merged tool arguments without waiting for completion.
 */
export declare class StreamingReconstructor {
    private acc;
    private chunkCount;
    /** Apply next chunk. */
    push(chunk: ModelCompletionResponse): void;
    /** Current full text (all deltas concatenated). */
    getFullText(): string;
    /** Returns current reconstructed tool calls (raw + parsed if possible). */
    getToolCalls(): ReconstructedToolCall[];
    /** Final chunk if received. */
    getFinalChunk(): ModelCompletionResponse | undefined;
    /** Aggregate usage only reliable after final chunk. */
    getUsage(): import("../providers/IProvider").ModelUsage | undefined;
    /** Error if surfaced on final chunk. */
    getError(): {
        message: string;
        type?: string;
        code?: string | number;
        details?: unknown;
    } | undefined;
    /** Total chunks processed so far. */
    getChunkCount(): number;
}
export default StreamingReconstructor;
//# sourceMappingURL=StreamingReconstructor.d.ts.map