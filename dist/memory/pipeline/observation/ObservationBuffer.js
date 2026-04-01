/**
 * @fileoverview Token-counting buffer for the observation system.
 *
 * Accumulates conversation messages and tracks approximate token count.
 * When the configured threshold is reached, signals that observation
 * extraction should be triggered.
 *
 * @module agentos/memory/observation/ObservationBuffer
 */
// ---------------------------------------------------------------------------
// Token estimation
// ---------------------------------------------------------------------------
/** Rough token estimate: ~4 chars per token for English text. */
function estimateTokens(text) {
    return Math.ceil(text.length / 4);
}
// ---------------------------------------------------------------------------
// ObservationBuffer
// ---------------------------------------------------------------------------
export class ObservationBuffer {
    constructor(config) {
        this.messages = [];
        this.totalTokens = 0;
        /** Number of tokens that have been drained (consumed by observer). */
        this.drainedTokens = 0;
        /** Index of next unprocessed message. */
        this.drainCursor = 0;
        this.config = {
            activationThresholdTokens: config?.activationThresholdTokens ?? 30000,
        };
    }
    /**
     * Add a message to the buffer.
     * Returns true if the buffer has reached activation threshold.
     */
    push(role, content) {
        const tokenEstimate = estimateTokens(content);
        this.messages.push({
            role,
            content,
            timestamp: Date.now(),
            tokenEstimate,
        });
        this.totalTokens += tokenEstimate;
        return this.shouldActivate();
    }
    /** Whether accumulated tokens since last drain exceed the threshold. */
    shouldActivate() {
        return (this.totalTokens - this.drainedTokens) >= this.config.activationThresholdTokens;
    }
    /**
     * Drain messages since last drain for observation processing.
     * Returns the messages and marks them as consumed.
     */
    drain() {
        const unprocessed = this.messages.slice(this.drainCursor);
        this.drainedTokens = this.totalTokens;
        this.drainCursor = this.messages.length;
        return unprocessed;
    }
    /** Total accumulated tokens. */
    getTotalTokens() {
        return this.totalTokens;
    }
    /** Unprocessed tokens since last drain. */
    getPendingTokens() {
        return this.totalTokens - this.drainedTokens;
    }
    /** Total message count. */
    getMessageCount() {
        return this.messages.length;
    }
    /** Clear the buffer entirely. */
    clear() {
        this.messages = [];
        this.totalTokens = 0;
        this.drainedTokens = 0;
        this.drainCursor = 0;
    }
}
//# sourceMappingURL=ObservationBuffer.js.map