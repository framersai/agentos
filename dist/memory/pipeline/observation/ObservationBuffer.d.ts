/**
 * @fileoverview Token-counting buffer for the observation system.
 *
 * Accumulates conversation messages and tracks approximate token count.
 * When the configured threshold is reached, signals that observation
 * extraction should be triggered.
 *
 * @module agentos/memory/observation/ObservationBuffer
 */
export interface BufferedMessage {
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string;
    timestamp: number;
    /** Cached token estimate for this message. */
    tokenEstimate: number;
}
export interface ObservationBufferConfig {
    /** Token threshold before observer should be triggered. @default 30_000 */
    activationThresholdTokens: number;
}
export declare class ObservationBuffer {
    private messages;
    private totalTokens;
    private config;
    /** Number of tokens that have been drained (consumed by observer). */
    private drainedTokens;
    constructor(config?: Partial<ObservationBufferConfig>);
    /**
     * Add a message to the buffer.
     * Returns true if the buffer has reached activation threshold.
     */
    push(role: BufferedMessage['role'], content: string): boolean;
    /** Whether accumulated tokens since last drain exceed the threshold. */
    shouldActivate(): boolean;
    /**
     * Drain messages since last drain for observation processing.
     * Returns the messages and marks them as consumed.
     */
    drain(): BufferedMessage[];
    /** Index of next unprocessed message. */
    private drainCursor;
    /** Total accumulated tokens. */
    getTotalTokens(): number;
    /** Unprocessed tokens since last drain. */
    getPendingTokens(): number;
    /** Total message count. */
    getMessageCount(): number;
    /** Clear the buffer entirely. */
    clear(): void;
}
//# sourceMappingURL=ObservationBuffer.d.ts.map