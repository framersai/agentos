/**
 * @fileoverview Microsoft Teams Channel Adapter for AgentOS.
 *
 * Integrates with Microsoft Teams via the Bot Framework SDK
 * (`botbuilder` / `botframework-connector`). The adapter creates
 * a Bot Framework connector client and sends proactive messages
 * and activities to Teams conversations.
 *
 * **Dependencies**: Requires `botbuilder` and `botframework-connector`
 * to be installed.
 *
 * The adapter supports:
 * - Personal (1:1) chat messages
 * - Group chat messages
 * - Channel messages (with threading)
 * - Adaptive Cards (via buttons / rich text)
 * - File attachments
 * - Typing indicators
 * - Reactions
 * - Mentions
 *
 * @example
 * ```typescript
 * const teams = new TeamsChannelAdapter();
 * await teams.initialize({
 *   platform: 'teams',
 *   credential: '<app_id>',
 *   params: {
 *     appPassword: 'your-app-password',
 *     tenantId: 'your-tenant-id',         // optional, for single-tenant
 *     serviceUrl: 'https://smba.trafficmanager.net/teams/',
 *   },
 * });
 * ```
 *
 * @module @framers/agentos/channels/adapters/TeamsChannelAdapter
 */
import type { ChannelAuthConfig, ChannelCapability, ChannelPlatform, ChannelSendResult, MessageContent } from '../types.js';
import { BaseChannelAdapter } from './BaseChannelAdapter.js';
/** Platform-specific authentication parameters for Microsoft Teams. */
export interface TeamsAuthParams extends Record<string, string | undefined> {
    /** Bot application password (client secret). */
    appPassword: string;
    /** Azure AD tenant ID. Optional for multi-tenant bots. */
    tenantId?: string;
    /** Bot Framework service URL. Default: 'https://smba.trafficmanager.net/teams/'. */
    serviceUrl?: string;
}
/**
 * Channel adapter for Microsoft Teams via Bot Framework.
 *
 * Uses `botbuilder` and `botframework-connector` via dynamic imports.
 *
 * Capabilities: `text`, `rich_text`, `images`, `documents`, `buttons`,
 * `threads`, `mentions`, `reactions`, `group_chat`, `channels`.
 *
 * Conversation ID format:
 * - Direct: the conversation ID from Teams (opaque string)
 * - Channel: `<channelId>` with optional `replyToMessageId` for threading
 */
export declare class TeamsChannelAdapter extends BaseChannelAdapter<TeamsAuthParams> {
    readonly platform: ChannelPlatform;
    readonly displayName = "Microsoft Teams";
    readonly capabilities: readonly ChannelCapability[];
    /** Bot Framework connector client. */
    private connectorClient;
    /** Bot Framework adapter (for processing incoming activities). */
    private botAdapter;
    /** Microsoft App credentials. */
    private credentials;
    /** Bot application ID. */
    private appId;
    /** Service URL for the Teams tenant. */
    private serviceUrl;
    /** Tenant ID (optional). */
    private tenantId;
    /** Conversation references for proactive messaging, keyed by conversation ID. */
    private conversationReferences;
    protected doConnect(auth: ChannelAuthConfig & {
        params?: TeamsAuthParams;
    }): Promise<void>;
    protected doSendMessage(conversationId: string, content: MessageContent): Promise<ChannelSendResult>;
    protected doShutdown(): Promise<void>;
    sendTypingIndicator(conversationId: string, _isTyping: boolean): Promise<void>;
    editMessage(conversationId: string, messageId: string, content: MessageContent): Promise<void>;
    deleteMessage(conversationId: string, messageId: string): Promise<void>;
    /**
     * Process an incoming Bot Framework request (webhook handler).
     * Call this from your HTTP endpoint that receives Teams webhook POSTs.
     *
     * @param req - HTTP request object.
     * @param res - HTTP response object.
     */
    processIncomingActivity(req: {
        body: unknown;
        headers: Record<string, string>;
    }, res: {
        status: (code: number) => {
            send: (body?: unknown) => void;
        };
    }): Promise<void>;
    /**
     * Store a conversation reference for later proactive messaging.
     * Typically called when first receiving a message from a conversation.
     */
    storeConversationReference(conversationId: string, reference: Record<string, unknown>): void;
    /**
     * Create a new conversation with a Teams user (proactive outreach).
     *
     * @param userId - The Teams user ID to start a conversation with.
     * @returns The new conversation ID.
     */
    createConversation(userId: string): Promise<string>;
    /**
     * Get the Bot Framework adapter for advanced use cases.
     * Returns undefined if botbuilder is not installed.
     */
    getBotAdapter(): any | undefined;
    private buildActivity;
    /**
     * Build an Adaptive Card attachment containing action buttons.
     */
    private buildAdaptiveCardWithButtons;
    /**
     * Build an Adaptive Card for embed-style content.
     */
    private buildAdaptiveCardEmbed;
    /**
     * Build an Adaptive Card for poll content.
     */
    private buildAdaptiveCardPoll;
    private sendProactiveMessage;
    private handleTurnContext;
    private handleIncomingMessage;
    private handleReaction;
    private handleConversationUpdate;
}
//# sourceMappingURL=TeamsChannelAdapter.d.ts.map