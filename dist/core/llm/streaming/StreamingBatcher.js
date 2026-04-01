const DEFAULT_BATCHER_OPTIONS = {
    maxLatencyMs: 100,
    maxTextDeltaChars: 800,
    maxToolArgumentChars: 4000,
    maxChunksPerBatch: 50,
    annotateBatches: true,
};
/** Internal helper: merge a new chunk into accumulator state. */
function accumulate(state, chunk) {
    state.chunks.push(chunk);
    if (chunk.responseTextDelta)
        state.textBuffer += chunk.responseTextDelta;
    if (chunk.toolCallsDeltas) {
        for (const d of chunk.toolCallsDeltas) {
            const key = `${d.index}|${d.id || '_'}`;
            const buf = state.toolBuffers[key] || { raw: '' };
            if (d.function?.arguments_delta)
                buf.raw += d.function.arguments_delta;
            if (d.function?.name)
                buf.name = d.function.name;
            if (d.id)
                buf.id = d.id;
            state.toolBuffers[key] = buf;
        }
    }
}
/** Builds a batched chunk from accumulator state and resets state. */
function buildBatch(state, batchSequence, isFinalOverride = false) {
    if (state.chunks.length === 0)
        return undefined;
    const first = state.chunks[0];
    const finalProviderChunk = state.chunks.find(c => c.isFinal);
    // Consolidate tool call deltas into single entries per key.
    const mergedToolCalls = Object.entries(state.toolBuffers).map(([key, data]) => {
        const [indexStr, idMarker] = key.split('|');
        return {
            index: Number(indexStr),
            id: data.id || (idMarker !== '_' ? idMarker : undefined),
            type: 'function',
            function: {
                name: data.name,
                arguments_delta: data.raw, // merged arguments
            },
        };
    });
    const batched = {
        id: `${first.id}-batch-${batchSequence}`,
        object: first.object,
        created: Math.floor(Date.now() / 1000),
        modelId: first.modelId,
        choices: first.choices, // assume stable choice metadata
        responseTextDelta: state.textBuffer.length > 0 ? state.textBuffer : undefined,
        toolCallsDeltas: mergedToolCalls.length > 0 ? mergedToolCalls : undefined,
        // Only propagate usage/error when final provider chunk present.
        usage: finalProviderChunk?.usage,
        error: finalProviderChunk?.error,
        isFinal: isFinalOverride || !!finalProviderChunk?.isFinal,
    };
    // Optional annotation for diagnostics / profiling.
    batched.batchSequence = batchSequence;
    batched.batchedChunkCount = state.chunks.length;
    batched.batchedOriginalIds = state.chunks.map(c => c.id);
    // Reset state for next batch
    state.chunks = [];
    state.textBuffer = '';
    state.toolBuffers = {};
    state.firstChunkAt = 0;
    return batched;
}
/** Determines if flush conditions met (excluding final chunk condition handled upstream). */
function shouldFlush(state, opts) {
    if (state.chunks.length === 0)
        return false;
    const now = Date.now();
    if (state.firstChunkAt && (now - state.firstChunkAt) >= opts.maxLatencyMs)
        return true;
    if (state.textBuffer.length >= opts.maxTextDeltaChars)
        return true;
    if (state.chunks.length >= opts.maxChunksPerBatch)
        return true;
    // Tool argument size check
    const toolArgSize = Object.values(state.toolBuffers).reduce((sum, t) => sum + t.raw.length, 0);
    if (toolArgSize >= opts.maxToolArgumentChars)
        return true;
    return false;
}
/**
 * Batches an async stream of `ModelCompletionResponse` chunks according to `StreamingBatcherOptions`.
 * @param stream Underlying provider async generator.
 * @param options Optional batching thresholds.
 * @returns AsyncGenerator<ModelCompletionResponse>
 */
export async function* batchStream(stream, options = {}) {
    const opts = { ...DEFAULT_BATCHER_OPTIONS, ...options };
    let batchSequence = 0;
    const state = { chunks: [], textBuffer: '', toolBuffers: {}, firstChunkAt: 0 };
    const flush = (isFinal = false) => {
        const chunk = buildBatch(state, batchSequence++, isFinal);
        if (chunk && !opts.annotateBatches) {
            delete chunk.batchSequence;
            delete chunk.batchedChunkCount;
            delete chunk.batchedOriginalIds;
        }
        return chunk;
    };
    // Consumption loop with latency race.
    while (true) {
        const providerResult = await stream.next();
        if (providerResult.done) {
            if (state.chunks.length) {
                const residual = flush(false);
                if (residual) {
                    yield residual;
                }
            }
            return;
        }
        const chunk = providerResult.value;
        if (!chunk) {
            continue;
        }
        // If enough time elapsed since first buffered chunk, flush before adding new chunk
        if (state.chunks.length > 0 && state.firstChunkAt && (Date.now() - state.firstChunkAt) >= opts.maxLatencyMs) {
            const timedOut = flush(false);
            if (timedOut) {
                yield timedOut;
            }
        }
        if (chunk.isFinal) {
            if (state.chunks.length === 0) {
                // No buffered chunks; emit final chunk directly.
                yield chunk;
                return;
            }
            // Flush buffered chunks first, then emit final chunk.
            let preFinal = flush(false);
            if (!preFinal && state.textBuffer) {
                preFinal = {
                    ...state.chunks[0],
                    id: `${state.chunks[0]?.id || 'chunk'}-batch-${batchSequence++}`,
                    responseTextDelta: state.textBuffer || undefined,
                    isFinal: false,
                };
            }
            if (preFinal) {
                yield preFinal;
            }
            yield chunk;
            return;
        }
        if (state.chunks.length === 0)
            state.firstChunkAt = Date.now();
        accumulate(state, chunk);
        // Non-final flush conditions.
        if (shouldFlush(state, opts)) {
            const chunk = flush(false);
            if (chunk) {
                yield chunk;
            }
        }
    }
}
/** Convenience OO wrapper for imperative control (mirrors functional batchStream). */
export class StreamingBatcher {
    constructor(options = {}) {
        this.opts = { ...DEFAULT_BATCHER_OPTIONS, ...options };
    }
    batch(stream) {
        return batchStream(stream, this.opts);
    }
}
export default StreamingBatcher;
//# sourceMappingURL=StreamingBatcher.js.map