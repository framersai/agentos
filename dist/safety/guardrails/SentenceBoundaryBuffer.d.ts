/**
 * Buffers streaming TEXT_DELTA chunks and flushes at sentence boundaries.
 * Includes the previous sentence as overlap context for safety evaluation.
 */
export declare class SentenceBoundaryBuffer {
    private buffer;
    private previousSentence;
    /** Push a chunk. Returns evaluation payload if sentence boundary detected, null otherwise. */
    push(chunk: string): string | null;
    /** Flush remaining buffer content (call on stream end). */
    flush(): string | null;
    /** Reset all state. */
    reset(): void;
    private findBoundary;
}
//# sourceMappingURL=SentenceBoundaryBuffer.d.ts.map