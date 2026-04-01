/**
 * Incrementally applies a streaming chunk to the accumulator.
 * @param acc Current accumulator.
 * @param chunk Incoming streaming `ModelCompletionResponse` piece.
 */
function applyChunk(acc, chunk) {
    if (chunk.responseTextDelta)
        acc.textBuffer += chunk.responseTextDelta;
    if (chunk.toolCallsDeltas) {
        for (const d of chunk.toolCallsDeltas) {
            const buf = acc.toolBuffers[d.index] || { raw: '' };
            if (d.function?.arguments_delta)
                buf.raw += d.function.arguments_delta;
            if (d.id)
                buf.id = d.id;
            if (d.function?.name)
                buf.name = d.function.name;
            acc.toolBuffers[d.index] = buf;
        }
    }
    if (chunk.isFinal)
        acc.finalChunk = chunk;
}
/**
 * Safely parses a JSON string, returning either the parsed object or recording an error.
 */
function safeParseJson(raw) {
    try {
        return { value: raw.trim() === '' ? {} : JSON.parse(raw) };
    }
    catch (e) {
        return { error: e?.message || 'JSON parse failed' };
    }
}
/**
 * Reconstructs full assistant text and tool calls from an async stream of `ModelCompletionResponse` chunks.
 * The generator is consumed entirely before returning.
 *
 * @param stream Async generator from `generateCompletionStream`.
 * @returns StreamingReconstructionResult summarizing concatenated text, parsed tool calls, final chunk & usage.
 */
export async function reconstructStream(stream) {
    const acc = { textBuffer: '', toolBuffers: {}, finalChunk: undefined };
    let count = 0;
    for await (const chunk of stream) {
        applyChunk(acc, chunk);
        count++;
    }
    const toolCalls = Object.entries(acc.toolBuffers).map(([indexStr, data]) => {
        const { value, error } = safeParseJson(data.raw);
        return {
            index: Number(indexStr),
            id: data.id,
            name: data.name,
            rawArguments: data.raw,
            arguments: error ? undefined : value,
            parseError: error,
        };
    });
    return {
        fullText: acc.textBuffer,
        toolCalls,
        finalChunk: acc.finalChunk,
        error: acc.finalChunk?.error,
        usage: acc.finalChunk?.usage,
        chunks: count,
    };
}
/**
 * Incremental (online) reconstruction API: pass each chunk in sequence and query state at any time.
 * Useful for UI rendering that wants interim merged tool arguments without waiting for completion.
 */
export class StreamingReconstructor {
    constructor() {
        this.acc = { textBuffer: '', toolBuffers: {}, finalChunk: undefined };
        this.chunkCount = 0;
    }
    /** Apply next chunk. */
    push(chunk) {
        applyChunk(this.acc, chunk);
        this.chunkCount++;
    }
    /** Current full text (all deltas concatenated). */
    getFullText() { return this.acc.textBuffer; }
    /** Returns current reconstructed tool calls (raw + parsed if possible). */
    getToolCalls() {
        return Object.entries(this.acc.toolBuffers).map(([idx, data]) => {
            const { value, error } = safeParseJson(data.raw);
            return { index: Number(idx), id: data.id, name: data.name, rawArguments: data.raw, arguments: error ? undefined : value, parseError: error };
        });
    }
    /** Final chunk if received. */
    getFinalChunk() { return this.acc.finalChunk; }
    /** Aggregate usage only reliable after final chunk. */
    getUsage() { return this.acc.finalChunk?.usage; }
    /** Error if surfaced on final chunk. */
    getError() { return this.acc.finalChunk?.error; }
    /** Total chunks processed so far. */
    getChunkCount() { return this.chunkCount; }
}
export default StreamingReconstructor;
//# sourceMappingURL=StreamingReconstructor.js.map