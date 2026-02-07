/**
 * @fileoverview Payload type for `messaging-channel` extension descriptors.
 *
 * This is the contract that extension packs provide when registering a
 * messaging channel. It's a subset of {@link IChannelAdapter} — the full
 * adapter interface includes lifecycle hooks managed by the extension
 * system itself.
 *
 * @module @framers/agentos/extensions/MessagingChannelPayload
 */
import type { ChannelAuthConfig, ChannelCapability, ChannelConnectionInfo, ChannelEventHandler, ChannelEventType, ChannelPlatform, ChannelSendResult, MessageContent } from '../channels/types.js';
/**
 * Payload shape for `messaging-channel` extension descriptors.
 *
 * Extension packs register this as the `payload` of an
 * `ExtensionDescriptor<MessagingChannelPayload>` with
 * `kind: 'messaging-channel'`.
 */
export interface MessagingChannelPayload {
    /** Platform identifier (e.g., 'telegram', 'discord'). */
    platform: ChannelPlatform;
    /** Human-friendly display name. */
    displayName: string;
    /** Capabilities this channel supports. */
    capabilities: ChannelCapability[];
    /** Initialize with credentials. */
    initialize(auth: ChannelAuthConfig): Promise<void>;
    /** Graceful shutdown. */
    shutdown(): Promise<void>;
    /** Send a message to a conversation. */
    sendMessage(conversationId: string, content: MessageContent): Promise<ChannelSendResult>;
    /** Show/hide typing indicator. */
    sendTypingIndicator(conversationId: string, isTyping: boolean): Promise<void>;
    /** Subscribe to events. Returns unsubscribe function. */
    on(handler: ChannelEventHandler, eventTypes?: ChannelEventType[]): () => void;
    /** Get current connection status. */
    getConnectionInfo(): ChannelConnectionInfo;
}
//# sourceMappingURL=MessagingChannelPayload.d.ts.map