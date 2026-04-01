/**
 * @fileoverview Abstract base class for channel adapters.
 *
 * Provides common infrastructure that all concrete adapters share:
 * - Connection state machine (disconnected -> connecting -> connected)
 * - Retry logic with exponential back-off
 * - Event handler registration and dispatch
 * - Lifecycle management (initialize, shutdown, reconnect)
 *
 * Subclasses implement three abstract methods:
 *   `doConnect()`, `doSendMessage()`, `doShutdown()`
 *
 * @module @framers/agentos/channels/adapters/BaseChannelAdapter
 */
const DEFAULT_RETRY_CONFIG = {
    maxRetries: 5,
    baseDelayMs: 1000,
    maxDelayMs: 30000,
    jitterFactor: 0.25,
};
// ============================================================================
// BaseChannelAdapter
// ============================================================================
/**
 * Abstract base class that implements common {@link IChannelAdapter}
 * behaviour. Concrete adapters (Telegram, Discord, IRC, ...) extend this
 * class and implement the three abstract hooks:
 *
 * - `doConnect(auth)` -- establish the platform connection.
 * - `doSendMessage(conversationId, content)` -- deliver a message.
 * - `doShutdown()` -- tear down the platform connection.
 *
 * @typeParam TAuthParams - Shape of the platform-specific `params` object
 *   inside {@link ChannelAuthConfig}. Defaults to `Record<string, string>`.
 */
export class BaseChannelAdapter {
    // ── Constructor ──
    constructor(retryConfig) {
        // ── Connection state ──
        this.status = 'disconnected';
        this.platformInfo = {};
        this.retryCount = 0;
        // ── Event subscriptions ──
        this.subscriptions = new Set();
        this.retryConfig = { ...DEFAULT_RETRY_CONFIG, ...retryConfig };
    }
    // ════════════════════════════════════════════════════════════════════════
    // IChannelAdapter — Lifecycle
    // ════════════════════════════════════════════════════════════════════════
    /**
     * Initialize the adapter with auth credentials. If already connected this
     * will shut down the existing connection first (idempotent).
     */
    async initialize(auth) {
        // Idempotency: tear down any previous connection
        if (this.status === 'connected' || this.status === 'reconnecting') {
            await this.shutdown();
        }
        this.auth = auth;
        this.clearRetryState();
        await this.attemptConnect();
    }
    /**
     * Gracefully shut down the adapter and release all resources.
     */
    async shutdown() {
        this.clearRetryState();
        if (this.status === 'disconnected')
            return;
        try {
            await this.doShutdown();
        }
        catch (err) {
            // Best-effort shutdown — log and continue
            console.error(`[${this.displayName}] Error during shutdown:`, err);
        }
        finally {
            this.setStatus('disconnected');
            this.connectedSince = undefined;
        }
    }
    /**
     * Manually trigger a reconnection attempt using stored credentials.
     * Useful for UI-driven "reconnect" buttons.
     */
    async reconnect() {
        if (!this.auth) {
            throw new Error(`[${this.displayName}] Cannot reconnect — adapter has never been initialized.`);
        }
        if (this.status === 'connected') {
            await this.shutdown();
        }
        this.clearRetryState();
        await this.attemptConnect();
    }
    // ════════════════════════════════════════════════════════════════════════
    // IChannelAdapter — Connection Info
    // ════════════════════════════════════════════════════════════════════════
    getConnectionInfo() {
        return {
            status: this.status,
            connectedSince: this.connectedSince,
            errorMessage: this.errorMessage,
            platformInfo: { ...this.platformInfo },
        };
    }
    // ════════════════════════════════════════════════════════════════════════
    // IChannelAdapter — Outbound Messaging
    // ════════════════════════════════════════════════════════════════════════
    async sendMessage(conversationId, content) {
        if (this.status !== 'connected') {
            throw new Error(`[${this.displayName}] Cannot send message — adapter is ${this.status}, not connected.`);
        }
        return this.doSendMessage(conversationId, content);
    }
    /**
     * Default stub — platforms that support typing indicators should override.
     */
    async sendTypingIndicator(_conversationId, _isTyping) {
        // No-op by default. Subclasses override if capability is declared.
    }
    // ════════════════════════════════════════════════════════════════════════
    // IChannelAdapter — Event Handling
    // ════════════════════════════════════════════════════════════════════════
    /**
     * Register an event handler. Returns an unsubscribe function.
     */
    on(handler, eventTypes) {
        const sub = { handler, eventTypes };
        this.subscriptions.add(sub);
        return () => {
            this.subscriptions.delete(sub);
        };
    }
    // ════════════════════════════════════════════════════════════════════════
    // Protected helpers for subclasses
    // ════════════════════════════════════════════════════════════════════════
    /**
     * Emit an event to all matching subscribers.
     * Subclasses call this when the platform SDK receives an inbound event.
     */
    emit(event) {
        for (const sub of this.subscriptions) {
            // Filter by event types if the subscription specified a filter
            if (sub.eventTypes && !sub.eventTypes.includes(event.type)) {
                continue;
            }
            try {
                // Fire-and-forget; errors in handlers should not crash the adapter
                const result = sub.handler(event);
                if (result && typeof result.catch === 'function') {
                    result.catch((err) => {
                        console.error(`[${this.displayName}] Unhandled error in event handler:`, err);
                    });
                }
            }
            catch (err) {
                console.error(`[${this.displayName}] Synchronous error in event handler:`, err);
            }
        }
    }
    /**
     * Convenience helper: emit a `connection_change` event with the current
     * status. Called automatically by {@link setStatus}.
     */
    emitConnectionChange() {
        this.emit({
            type: 'connection_change',
            platform: this.platform,
            conversationId: '',
            timestamp: new Date().toISOString(),
            data: {
                status: this.status,
                errorMessage: this.errorMessage,
            },
        });
    }
    /**
     * Check whether this adapter declares a specific capability.
     */
    hasCapability(cap) {
        return this.capabilities.includes(cap);
    }
    /**
     * Transition to a new connection status and emit an event.
     */
    setStatus(newStatus, error) {
        const prev = this.status;
        this.status = newStatus;
        this.errorMessage = error;
        if (newStatus === 'connected' && prev !== 'connected') {
            this.connectedSince = new Date().toISOString();
        }
        this.emitConnectionChange();
    }
    // ════════════════════════════════════════════════════════════════════════
    // Private — Connection and Retry Logic
    // ════════════════════════════════════════════════════════════════════════
    /**
     * Single connection attempt with automatic retry on failure.
     */
    async attemptConnect() {
        if (!this.auth)
            return;
        this.setStatus(this.retryCount === 0 ? 'connecting' : 'reconnecting');
        try {
            await this.doConnect(this.auth);
            // Success
            this.retryCount = 0;
            this.setStatus('connected');
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`[${this.displayName}] Connection attempt ${this.retryCount + 1} failed: ${message}`);
            this.retryCount++;
            if (this.retryCount > this.retryConfig.maxRetries) {
                // Exhausted all retries
                this.setStatus('error', `Failed after ${this.retryConfig.maxRetries} retries: ${message}`);
                return;
            }
            // Schedule retry with exponential back-off + jitter
            const delay = this.calculateBackoff();
            console.warn(`[${this.displayName}] Retrying in ${delay}ms (attempt ${this.retryCount}/${this.retryConfig.maxRetries})...`);
            await this.sleep(delay);
            // Guard: shutdown may have been called while we were sleeping
            if (this.status === 'disconnected')
                return;
            await this.attemptConnect();
        }
    }
    /**
     * Calculate next retry delay using exponential back-off with jitter.
     *
     * delay = min(baseDelay * 2^(retryCount-1), maxDelay) * (1 +/- jitter)
     */
    calculateBackoff() {
        const { baseDelayMs, maxDelayMs, jitterFactor } = this.retryConfig;
        const exponential = baseDelayMs * Math.pow(2, this.retryCount - 1);
        const clamped = Math.min(exponential, maxDelayMs);
        // Apply jitter: uniformly between (1-j)*clamped and (1+j)*clamped
        const jitter = 1 + (Math.random() * 2 - 1) * jitterFactor;
        return Math.round(clamped * jitter);
    }
    clearRetryState() {
        this.retryCount = 0;
        if (this.retryTimer) {
            clearTimeout(this.retryTimer);
            this.retryTimer = undefined;
        }
    }
    sleep(ms) {
        return new Promise((resolve) => {
            this.retryTimer = setTimeout(resolve, ms);
        });
    }
}
//# sourceMappingURL=BaseChannelAdapter.js.map