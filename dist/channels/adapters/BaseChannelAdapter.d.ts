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
import type { IChannelAdapter } from '../IChannelAdapter.js';
import type { ChannelAuthConfig, ChannelCapability, ChannelConnectionInfo, ChannelConnectionStatus, ChannelEvent, ChannelEventHandler, ChannelEventType, ChannelPlatform, ChannelSendResult, MessageContent } from '../types.js';
/** Options governing connection retry behaviour. */
export interface RetryConfig {
    /** Maximum number of retry attempts before giving up. Default: 5. */
    maxRetries: number;
    /** Initial delay in milliseconds before the first retry. Default: 1000. */
    baseDelayMs: number;
    /** Upper-bound delay in milliseconds. Default: 30_000. */
    maxDelayMs: number;
    /** Jitter factor (0-1) applied to each delay. Default: 0.25. */
    jitterFactor: number;
}
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
export declare abstract class BaseChannelAdapter<TAuthParams extends Record<string, string | undefined> = Record<string, string>> implements IChannelAdapter {
    abstract readonly platform: ChannelPlatform;
    abstract readonly displayName: string;
    abstract readonly capabilities: readonly ChannelCapability[];
    protected status: ChannelConnectionStatus;
    protected connectedSince: string | undefined;
    protected errorMessage: string | undefined;
    protected platformInfo: Record<string, unknown>;
    /** Stored auth config so `reconnect()` can re-use it. */
    protected auth: (ChannelAuthConfig & {
        params?: TAuthParams;
    }) | undefined;
    protected readonly retryConfig: RetryConfig;
    private retryCount;
    private retryTimer;
    private subscriptions;
    constructor(retryConfig?: Partial<RetryConfig>);
    /**
     * Establish the platform connection using the supplied credentials.
     * Called by {@link initialize} after state has been set to `connecting`.
     * Must throw on failure — the base class handles retry and state changes.
     */
    protected abstract doConnect(auth: ChannelAuthConfig & {
        params?: TAuthParams;
    }): Promise<void>;
    /**
     * Deliver a message to the external platform.
     * Called by {@link sendMessage} only when the adapter is `connected`.
     */
    protected abstract doSendMessage(conversationId: string, content: MessageContent): Promise<ChannelSendResult>;
    /**
     * Release platform resources (close WebSocket, stop polling, etc.).
     * Called by {@link shutdown} before the state transitions to `disconnected`.
     */
    protected abstract doShutdown(): Promise<void>;
    /**
     * Initialize the adapter with auth credentials. If already connected this
     * will shut down the existing connection first (idempotent).
     */
    initialize(auth: ChannelAuthConfig): Promise<void>;
    /**
     * Gracefully shut down the adapter and release all resources.
     */
    shutdown(): Promise<void>;
    /**
     * Manually trigger a reconnection attempt using stored credentials.
     * Useful for UI-driven "reconnect" buttons.
     */
    reconnect(): Promise<void>;
    getConnectionInfo(): ChannelConnectionInfo;
    sendMessage(conversationId: string, content: MessageContent): Promise<ChannelSendResult>;
    /**
     * Default stub — platforms that support typing indicators should override.
     */
    sendTypingIndicator(_conversationId: string, _isTyping: boolean): Promise<void>;
    /**
     * Register an event handler. Returns an unsubscribe function.
     */
    on(handler: ChannelEventHandler, eventTypes?: ChannelEventType[]): () => void;
    /**
     * Emit an event to all matching subscribers.
     * Subclasses call this when the platform SDK receives an inbound event.
     */
    protected emit(event: ChannelEvent): void;
    /**
     * Convenience helper: emit a `connection_change` event with the current
     * status. Called automatically by {@link setStatus}.
     */
    protected emitConnectionChange(): void;
    /**
     * Check whether this adapter declares a specific capability.
     */
    protected hasCapability(cap: ChannelCapability): boolean;
    /**
     * Transition to a new connection status and emit an event.
     */
    protected setStatus(newStatus: ChannelConnectionStatus, error?: string): void;
    /**
     * Single connection attempt with automatic retry on failure.
     */
    private attemptConnect;
    /**
     * Calculate next retry delay using exponential back-off with jitter.
     *
     * delay = min(baseDelay * 2^(retryCount-1), maxDelay) * (1 +/- jitter)
     */
    private calculateBackoff;
    private clearRetryState;
    private sleep;
}
//# sourceMappingURL=BaseChannelAdapter.d.ts.map