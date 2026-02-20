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
import type {
  ChannelAuthConfig,
  ChannelCapability,
  ChannelConnectionInfo,
  ChannelConnectionStatus,
  ChannelEvent,
  ChannelEventHandler,
  ChannelEventType,
  ChannelPlatform,
  ChannelSendResult,
  MessageContent,
} from '../types.js';

// ============================================================================
// Retry Configuration
// ============================================================================

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

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 5,
  baseDelayMs: 1_000,
  maxDelayMs: 30_000,
  jitterFactor: 0.25,
};

// ============================================================================
// Event Subscription Bookkeeping
// ============================================================================

interface EventSubscription {
  handler: ChannelEventHandler;
  /** When undefined the handler receives all event types. */
  eventTypes?: ChannelEventType[];
}

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
export abstract class BaseChannelAdapter<
  TAuthParams extends Record<string, string | undefined> = Record<string, string>,
> implements IChannelAdapter
{
  // ── Identity (must be set by subclass constructor) ──

  abstract readonly platform: ChannelPlatform;
  abstract readonly displayName: string;
  abstract readonly capabilities: readonly ChannelCapability[];

  // ── Connection state ──

  protected status: ChannelConnectionStatus = 'disconnected';
  protected connectedSince: string | undefined;
  protected errorMessage: string | undefined;
  protected platformInfo: Record<string, unknown> = {};

  /** Stored auth config so `reconnect()` can re-use it. */
  protected auth: (ChannelAuthConfig & { params?: TAuthParams }) | undefined;

  // ── Retry state ──

  protected readonly retryConfig: RetryConfig;
  private retryCount = 0;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;

  // ── Event subscriptions ──

  private subscriptions: Set<EventSubscription> = new Set();

  // ── Constructor ──

  constructor(retryConfig?: Partial<RetryConfig>) {
    this.retryConfig = { ...DEFAULT_RETRY_CONFIG, ...retryConfig };
  }

  // ════════════════════════════════════════════════════════════════════════
  // Abstract hooks — subclasses MUST implement
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Establish the platform connection using the supplied credentials.
   * Called by {@link initialize} after state has been set to `connecting`.
   * Must throw on failure — the base class handles retry and state changes.
   */
  protected abstract doConnect(
    auth: ChannelAuthConfig & { params?: TAuthParams },
  ): Promise<void>;

  /**
   * Deliver a message to the external platform.
   * Called by {@link sendMessage} only when the adapter is `connected`.
   */
  protected abstract doSendMessage(
    conversationId: string,
    content: MessageContent,
  ): Promise<ChannelSendResult>;

  /**
   * Release platform resources (close WebSocket, stop polling, etc.).
   * Called by {@link shutdown} before the state transitions to `disconnected`.
   */
  protected abstract doShutdown(): Promise<void>;

  // ════════════════════════════════════════════════════════════════════════
  // IChannelAdapter — Lifecycle
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Initialize the adapter with auth credentials. If already connected this
   * will shut down the existing connection first (idempotent).
   */
  async initialize(auth: ChannelAuthConfig): Promise<void> {
    // Idempotency: tear down any previous connection
    if (this.status === 'connected' || this.status === 'reconnecting') {
      await this.shutdown();
    }

    this.auth = auth as ChannelAuthConfig & { params?: TAuthParams };
    this.clearRetryState();

    await this.attemptConnect();
  }

  /**
   * Gracefully shut down the adapter and release all resources.
   */
  async shutdown(): Promise<void> {
    this.clearRetryState();

    if (this.status === 'disconnected') return;

    try {
      await this.doShutdown();
    } catch (err) {
      // Best-effort shutdown — log and continue
      console.error(`[${this.displayName}] Error during shutdown:`, err);
    } finally {
      this.setStatus('disconnected');
      this.connectedSince = undefined;
    }
  }

  /**
   * Manually trigger a reconnection attempt using stored credentials.
   * Useful for UI-driven "reconnect" buttons.
   */
  async reconnect(): Promise<void> {
    if (!this.auth) {
      throw new Error(
        `[${this.displayName}] Cannot reconnect — adapter has never been initialized.`,
      );
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

  getConnectionInfo(): ChannelConnectionInfo {
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

  async sendMessage(
    conversationId: string,
    content: MessageContent,
  ): Promise<ChannelSendResult> {
    if (this.status !== 'connected') {
      throw new Error(
        `[${this.displayName}] Cannot send message — adapter is ${this.status}, not connected.`,
      );
    }

    return this.doSendMessage(conversationId, content);
  }

  /**
   * Default stub — platforms that support typing indicators should override.
   */
  async sendTypingIndicator(
    _conversationId: string,
    _isTyping: boolean,
  ): Promise<void> {
    // No-op by default. Subclasses override if capability is declared.
  }

  // ════════════════════════════════════════════════════════════════════════
  // IChannelAdapter — Event Handling
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Register an event handler. Returns an unsubscribe function.
   */
  on(handler: ChannelEventHandler, eventTypes?: ChannelEventType[]): () => void {
    const sub: EventSubscription = { handler, eventTypes };
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
  protected emit(event: ChannelEvent): void {
    for (const sub of this.subscriptions) {
      // Filter by event types if the subscription specified a filter
      if (sub.eventTypes && !sub.eventTypes.includes(event.type)) {
        continue;
      }

      try {
        // Fire-and-forget; errors in handlers should not crash the adapter
        const result = sub.handler(event);
        if (result && typeof (result as Promise<void>).catch === 'function') {
          (result as Promise<void>).catch((err) => {
            console.error(
              `[${this.displayName}] Unhandled error in event handler:`,
              err,
            );
          });
        }
      } catch (err) {
        console.error(
          `[${this.displayName}] Synchronous error in event handler:`,
          err,
        );
      }
    }
  }

  /**
   * Convenience helper: emit a `connection_change` event with the current
   * status. Called automatically by {@link setStatus}.
   */
  protected emitConnectionChange(): void {
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
  protected hasCapability(cap: ChannelCapability): boolean {
    return this.capabilities.includes(cap);
  }

  /**
   * Transition to a new connection status and emit an event.
   */
  protected setStatus(newStatus: ChannelConnectionStatus, error?: string): void {
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
  private async attemptConnect(): Promise<void> {
    if (!this.auth) return;

    this.setStatus(
      this.retryCount === 0 ? 'connecting' : 'reconnecting',
    );

    try {
      await this.doConnect(this.auth);
      // Success
      this.retryCount = 0;
      this.setStatus('connected');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `[${this.displayName}] Connection attempt ${this.retryCount + 1} failed: ${message}`,
      );

      this.retryCount++;

      if (this.retryCount > this.retryConfig.maxRetries) {
        // Exhausted all retries
        this.setStatus(
          'error',
          `Failed after ${this.retryConfig.maxRetries} retries: ${message}`,
        );
        return;
      }

      // Schedule retry with exponential back-off + jitter
      const delay = this.calculateBackoff();
      console.warn(
        `[${this.displayName}] Retrying in ${delay}ms (attempt ${this.retryCount}/${this.retryConfig.maxRetries})...`,
      );

      await this.sleep(delay);

      // Guard: shutdown may have been called while we were sleeping
      if (this.status === 'disconnected') return;

      await this.attemptConnect();
    }
  }

  /**
   * Calculate next retry delay using exponential back-off with jitter.
   *
   * delay = min(baseDelay * 2^(retryCount-1), maxDelay) * (1 +/- jitter)
   */
  private calculateBackoff(): number {
    const { baseDelayMs, maxDelayMs, jitterFactor } = this.retryConfig;
    const exponential = baseDelayMs * Math.pow(2, this.retryCount - 1);
    const clamped = Math.min(exponential, maxDelayMs);

    // Apply jitter: uniformly between (1-j)*clamped and (1+j)*clamped
    const jitter = 1 + (Math.random() * 2 - 1) * jitterFactor;
    return Math.round(clamped * jitter);
  }

  private clearRetryState(): void {
    this.retryCount = 0;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = undefined;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.retryTimer = setTimeout(resolve, ms);
    });
  }
}
