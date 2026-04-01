/**
 * @fileoverview Slack Channel Adapter for AgentOS.
 *
 * Wraps the `@slack/bolt` npm package to connect agents to Slack
 * workspaces. Supports rich messaging including text (mrkdwn), images,
 * documents, Block Kit components, reactions, threads, and mentions.
 *
 * **Dependencies**: Requires `@slack/bolt` to be installed. The adapter
 * uses a dynamic import so the package is only loaded at connection time,
 * avoiding hard failures if it is not present.
 *
 * @example
 * ```typescript
 * const slack = new SlackChannelAdapter();
 * await slack.initialize({
 *   platform: 'slack',
 *   credential: 'xoxb-BOT-TOKEN',
 *   params: {
 *     botToken: 'xoxb-BOT-TOKEN',
 *     signingSecret: 'SIGNING_SECRET',
 *     appToken: 'xapp-APP-TOKEN',  // for Socket Mode
 *   },
 * });
 * ```
 *
 * @module @framers/agentos/channels/adapters/SlackChannelAdapter
 */
import type { ChannelAuthConfig, ChannelCapability, ChannelPlatform, ChannelSendResult, MessageContent } from '../types.js';
import { BaseChannelAdapter } from './BaseChannelAdapter.js';
/** Platform-specific parameters for Slack connections. */
export interface SlackAuthParams extends Record<string, string | undefined> {
    /** Bot token (xoxb-*). If provided, overrides credential. */
    botToken?: string;
    /** Signing secret for verifying Slack requests. */
    signingSecret?: string;
    /** App-level token (xapp-*) for Socket Mode. If omitted, HTTP mode is used. */
    appToken?: string;
    /** Port for HTTP mode (default: '3000'). Ignored when using Socket Mode. */
    port?: string;
}
/**
 * Channel adapter for Slack using the @slack/bolt SDK.
 *
 * Uses dynamic import so `@slack/bolt` is only required at runtime when
 * the adapter is actually initialized.
 *
 * When `appToken` is provided, the adapter uses Socket Mode (no public
 * endpoint required). Otherwise, it starts an HTTP server for receiving
 * Slack events.
 *
 * Capabilities: text, rich_text, images, documents, reactions, threads,
 * mentions, buttons, group_chat, channels, editing, deletion.
 */
export declare class SlackChannelAdapter extends BaseChannelAdapter<SlackAuthParams> {
    readonly platform: ChannelPlatform;
    readonly displayName = "Slack";
    readonly capabilities: readonly ChannelCapability[];
    /** The @slack/bolt App instance. */
    private app;
    /** Bot user ID, resolved after connection. */
    private botUserId;
    /** Whether socket mode is active. */
    private socketMode;
    protected doConnect(auth: ChannelAuthConfig & {
        params?: SlackAuthParams;
    }): Promise<void>;
    protected doSendMessage(conversationId: string, content: MessageContent): Promise<ChannelSendResult>;
    protected doShutdown(): Promise<void>;
    editMessage(conversationId: string, messageId: string, content: MessageContent): Promise<void>;
    deleteMessage(conversationId: string, messageId: string): Promise<void>;
    addReaction(conversationId: string, messageId: string, emoji: string): Promise<void>;
    sendTypingIndicator(_conversationId: string, _isTyping: boolean): Promise<void>;
    getConversationInfo(conversationId: string): Promise<{
        name?: string;
        memberCount?: number;
        isGroup: boolean;
        metadata?: Record<string, unknown>;
    }>;
    /**
     * Wire up @slack/bolt event handlers for inbound messages.
     */
    private wireEventHandlers;
    /**
     * Handle an inbound Slack message and emit a channel event.
     */
    private handleInboundMessage;
    /**
     * Build the full Slack API payload for chat.postMessage.
     */
    private buildSlackPayload;
    /**
     * Build Slack Block Kit blocks from MessageContent.
     */
    private buildBlockKit;
}
//# sourceMappingURL=SlackChannelAdapter.d.ts.map