/**
 * @fileoverview Channel Router — routes messages between external platforms
 * and agent seeds.
 *
 * The ChannelRouter sits between {@link IChannelAdapter} implementations
 * and the agent runtime (e.g., Wunderland's StimulusRouter). It:
 *
 * 1. Manages adapter instances per platform.
 * 2. Maintains binding lookups (platform+conversationId -> seedId).
 * 3. Dispatches inbound messages to registered handlers.
 * 4. Routes outbound agent messages to the correct adapter.
 *
 * @module @framers/agentos/channels/ChannelRouter
 */
import type { IChannelAdapter } from './IChannelAdapter.js';
import type { ChannelBindingConfig, ChannelInfo, ChannelMessage, ChannelPlatform, ChannelSendResult, ChannelSession, MessageContent } from './types.js';
/**
 * Handler invoked when an inbound message is received and matched to a seed.
 */
export type InboundMessageHandler = (message: ChannelMessage, binding: ChannelBindingConfig, session: ChannelSession) => void | Promise<void>;
/**
 * Options for registering an adapter with the router.
 */
export interface RegisterAdapterOptions {
    /** Override the platform key (defaults to adapter.platform). */
    platformKey?: string;
}
/**
 * Central routing hub for all external messaging channels.
 *
 * @example
 * ```typescript
 * const router = new ChannelRouter();
 *
 * // Register adapters
 * router.registerAdapter(telegramAdapter);
 * router.registerAdapter(discordAdapter);
 *
 * // Add bindings
 * router.addBinding({
 *   bindingId: 'b1',
 *   seedId: 'cipher-001',
 *   ownerUserId: 'user-1',
 *   platform: 'telegram',
 *   channelId: '123456789',
 *   conversationType: 'direct',
 *   isActive: true,
 *   autoBroadcast: false,
 * });
 *
 * // Handle inbound messages
 * router.onMessage(async (message, binding, session) => {
 *   // Route to StimulusRouter or agent runtime
 *   await stimulusRouter.ingestChannelMessage(message, binding.seedId);
 * });
 *
 * // Send outbound message
 * await router.sendMessage('cipher-001', 'telegram', '123456789', {
 *   blocks: [{ type: 'text', text: 'Hello from Cipher!' }],
 * });
 * ```
 */
export declare class ChannelRouter {
    /** Registered adapters keyed by platform. */
    private adapters;
    /** Active bindings keyed by bindingId. */
    private bindings;
    /** Active sessions keyed by sessionId. */
    private sessions;
    /** Inbound message handlers. */
    private messageHandlers;
    /** Lookup index: `${platform}:${conversationId}` -> bindingId[]. */
    private bindingIndex;
    /** Unsubscribe functions for adapter event listeners. */
    private adapterUnsubs;
    /**
     * Register a channel adapter. The router will subscribe to its events.
     */
    registerAdapter(adapter: IChannelAdapter, options?: RegisterAdapterOptions): void;
    /**
     * Unregister and shut down an adapter.
     */
    unregisterAdapter(platformKey: string): Promise<void>;
    /**
     * Get a registered adapter by platform.
     */
    getAdapter(platform: string): IChannelAdapter | undefined;
    /**
     * List all registered adapters with their info.
     */
    listAdapters(): ChannelInfo[];
    /**
     * Add or update a channel binding.
     */
    addBinding(binding: ChannelBindingConfig): void;
    /**
     * Remove a channel binding.
     */
    removeBinding(bindingId: string): void;
    /**
     * Get all bindings for a seed.
     */
    getBindingsForSeed(seedId: string): ChannelBindingConfig[];
    /**
     * Get all bindings for a platform + conversation.
     */
    getBindingsForConversation(platform: ChannelPlatform, conversationId: string): ChannelBindingConfig[];
    /**
     * Get all auto-broadcast bindings for a seed (used when agent publishes a post).
     */
    getBroadcastBindings(seedId: string): ChannelBindingConfig[];
    /**
     * Register a handler for inbound messages. Returns unsubscribe function.
     */
    onMessage(handler: InboundMessageHandler): () => void;
    /**
     * Send a message from an agent to a specific conversation.
     */
    sendMessage(seedId: string, platform: ChannelPlatform, conversationId: string, content: MessageContent): Promise<ChannelSendResult>;
    /**
     * Broadcast a message from an agent to all auto-broadcast bindings.
     */
    broadcast(seedId: string, content: MessageContent): Promise<ChannelSendResult[]>;
    /**
     * Send a typing indicator for an agent on a channel.
     */
    sendTypingIndicator(platform: ChannelPlatform, conversationId: string, isTyping: boolean): Promise<void>;
    /**
     * Get or create a session for an agent + conversation.
     */
    getOrCreateSession(seedId: string, platform: ChannelPlatform, conversationId: string): ChannelSession;
    /**
     * Get active sessions for a seed.
     */
    getSessionsForSeed(seedId: string): ChannelSession[];
    getStats(): {
        adapters: number;
        bindings: number;
        activeSessions: number;
        totalSessions: number;
    };
    /**
     * Shut down all adapters and clear state.
     */
    shutdown(): Promise<void>;
    private handleInboundMessage;
    private touchSession;
    private rebuildBindingIndex;
}
//# sourceMappingURL=ChannelRouter.d.ts.map