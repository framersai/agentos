import { type GenerateTextOptions, type TokenUsage, type ToolCallRecord } from './generateText.js';
/**
 * A discriminated union representing a single event emitted by the
 * `StreamTextResult.fullStream` iterable.
 *
 * - `"text"` — incremental token delta from the model.
 * - `"tool-call"` — the model requested a tool invocation.
 * - `"tool-result"` — the tool has been executed and the result is available.
 * - `"error"` — an unrecoverable error occurred; the stream ends after this part.
 */
export type StreamPart = {
    type: 'text';
    text: string;
} | {
    type: 'tool-call';
    toolName: string;
    args: unknown;
} | {
    type: 'tool-result';
    toolName: string;
    result: unknown;
} | {
    type: 'error';
    error: Error;
};
/**
 * The object returned immediately by {@link streamText}.
 *
 * Consumers may iterate `textStream` for raw token deltas, `fullStream` for
 * all event types, or simply `await` the promise properties for aggregated
 * results once the stream has drained.
 */
export interface StreamTextResult {
    /** Async iterable that yields only raw text-delta strings (filters out non-text parts). */
    textStream: AsyncIterable<string>;
    /** Async iterable that yields all {@link StreamPart} events in order. */
    fullStream: AsyncIterable<StreamPart>;
    /** Resolves to the fully assembled assistant reply when the stream completes. */
    text: Promise<string>;
    /** Resolves to aggregated {@link TokenUsage} when the stream completes. */
    usage: Promise<TokenUsage>;
    /** Resolves to the ordered list of {@link ToolCallRecord}s when the stream completes. */
    toolCalls: Promise<ToolCallRecord[]>;
}
/**
 * Stateless streaming text generation with optional multi-step tool calling.
 *
 * Returns a {@link StreamTextResult} immediately; the underlying provider call
 * begins lazily when a consumer starts iterating `textStream` or `fullStream`.
 * Awaiting `text`, `usage`, or `toolCalls` will also drain the stream.
 *
 * @param opts - Generation options (same shape as {@link generateText}).
 * @returns A {@link StreamTextResult} with async iterables and awaitable promises.
 *
 * @example
 * ```ts
 * const { textStream } = streamText({ model: 'openai:gpt-4o', prompt: 'Tell me a joke.' });
 * for await (const chunk of textStream) {
 *   process.stdout.write(chunk);
 * }
 * ```
 */
export declare function streamText(opts: GenerateTextOptions): StreamTextResult;
//# sourceMappingURL=streamText.d.ts.map