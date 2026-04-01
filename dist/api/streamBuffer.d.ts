/**
 * @file streamBuffer.ts
 * Small helper for replayable async streams.
 *
 * Some AgentOS streaming surfaces need to support:
 * - live iteration of an underlying async iterable
 * - multiple consumers (`fullStream`, `textStream`, promises)
 * - post-run aggregation after the stream completes
 *
 * This helper drains the source exactly once, buffers yielded parts, and lets
 * any number of iterators replay buffered items while still receiving new items
 * as they arrive.
 */
export type BufferedAsyncReplay<T> = {
    iterable: AsyncIterable<T>;
    ensureDraining: () => Promise<void>;
    getBuffered: () => readonly T[];
};
export declare function createBufferedAsyncReplay<T>(source: AsyncIterable<T>): BufferedAsyncReplay<T>;
//# sourceMappingURL=streamBuffer.d.ts.map