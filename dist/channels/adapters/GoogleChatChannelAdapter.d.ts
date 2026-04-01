/**
 * @fileoverview Google Chat Channel Adapter for AgentOS.
 *
 * Integrates with Google Chat (formerly Hangouts Chat) via the
 * Google Chat API. Supports sending messages, cards, and handling
 * incoming events from Google Chat spaces.
 *
 * **Dependencies**: Requires `googleapis` (or `@googleapis/chat`)
 * to be installed. Authentication is done via a Google Cloud
 * service account.
 *
 * The adapter supports two authentication methods:
 * 1. **Service account key file**: Path to a JSON key file.
 * 2. **Credentials object**: Inline JSON credentials (for environments
 *    where file access is restricted).
 *
 * @example
 * ```typescript
 * const gchat = new GoogleChatChannelAdapter();
 * await gchat.initialize({
 *   platform: 'google-chat',
 *   credential: '/path/to/service-account-key.json',
 *   params: {
 *     // OR pass inline credentials:
 *     // credentials: '{"type":"service_account",...}',
 *   },
 * });
 * ```
 *
 * @module @framers/agentos/channels/adapters/GoogleChatChannelAdapter
 */
import type { ChannelAuthConfig, ChannelCapability, ChannelPlatform, ChannelSendResult, MessageContent } from '../types.js';
import { BaseChannelAdapter } from './BaseChannelAdapter.js';
/** Platform-specific authentication parameters for Google Chat. */
export interface GoogleChatAuthParams extends Record<string, string | undefined> {
    /**
     * Inline JSON credentials for the service account.
     * Provide this OR use `credential` as a path to the key file.
     */
    credentials?: string;
    /**
     * Space name to listen in (e.g., 'spaces/AAAA...').
     * Optional — the adapter can send to any space when given a conversation ID.
     */
    defaultSpace?: string;
}
/**
 * Channel adapter for Google Chat.
 *
 * Uses the `googleapis` package via dynamic import.
 *
 * Capabilities: `text`, `rich_text`, `images`, `buttons`, `threads`,
 * `reactions`, `group_chat`.
 *
 * Conversation ID format:
 * - Space: `spaces/<spaceId>` (Google Chat space name)
 * - Thread: pass `replyToMessageId` as the thread key
 */
export declare class GoogleChatChannelAdapter extends BaseChannelAdapter<GoogleChatAuthParams> {
    readonly platform: ChannelPlatform;
    readonly displayName = "Google Chat";
    readonly capabilities: readonly ChannelCapability[];
    /** Google Chat API client. */
    private chatClient;
    /** Google Auth client. */
    private authClient;
    /** Default space to operate in. */
    private defaultSpace;
    /** Bot identity info. */
    private botInfo;
    /** Polling for space messages (Google Chat push is webhook-based,
     *  so polling is the fallback for non-webhook setups). */
    private pollTimer;
    private lastPollTimestamp;
    protected doConnect(auth: ChannelAuthConfig & {
        params?: GoogleChatAuthParams;
    }): Promise<void>;
    protected doSendMessage(conversationId: string, content: MessageContent): Promise<ChannelSendResult>;
    protected doShutdown(): Promise<void>;
    editMessage(conversationId: string, messageId: string, content: MessageContent): Promise<void>;
    deleteMessage(_conversationId: string, messageId: string): Promise<void>;
    addReaction(_conversationId: string, messageId: string, emoji: string): Promise<void>;
    getConversationInfo(conversationId: string): Promise<{
        name?: string;
        memberCount?: number;
        isGroup: boolean;
        metadata?: Record<string, unknown>;
    }>;
    /**
     * Process an incoming Google Chat webhook event.
     * Call this from your HTTP endpoint that receives Google Chat events.
     *
     * Google Chat sends events via HTTP push to configured webhook URLs
     * or Cloud Pub/Sub subscriptions.
     */
    processWebhookEvent(event: any): Promise<void>;
    /**
     * List spaces the bot is a member of.
     */
    listSpaces(): Promise<Array<{
        name: string;
        displayName: string;
        type: string;
    }>>;
    private buildMessagePayload;
    private buildEmbedCard;
    private buildPollCard;
    private resolveSpaceName;
    private handleIncomingMessage;
    private handleAddedToSpace;
    private handleRemovedFromSpace;
    private handleCardClicked;
    private startPolling;
    private stopPolling;
    private pollSpace;
}
//# sourceMappingURL=GoogleChatChannelAdapter.d.ts.map