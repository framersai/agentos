/**
 * @fileoverview Discord Channel Adapter for AgentOS.
 *
 * Wraps the `discord.js` npm package to connect agents to Discord servers.
 * Supports rich messaging including text, embeds, images, video, audio,
 * reactions, threads, mentions, buttons, and message management.
 *
 * **Dependencies**: Requires `discord.js` to be installed. The adapter
 * uses a dynamic import so the package is only loaded at connection time,
 * avoiding hard failures if it is not present.
 *
 * @example
 * ```typescript
 * const discord = new DiscordChannelAdapter();
 * await discord.initialize({
 *   platform: 'discord',
 *   credential: 'DISCORD_BOT_TOKEN',
 *   params: {
 *     botToken: 'DISCORD_BOT_TOKEN',
 *     applicationId: 'APP_ID',
 *     guildId: 'OPTIONAL_GUILD_ID',
 *   },
 * });
 * ```
 *
 * @module @framers/agentos/channels/adapters/DiscordChannelAdapter
 */
import type { ChannelAuthConfig, ChannelCapability, ChannelPlatform, ChannelSendResult, MessageContent } from '../types.js';
import { BaseChannelAdapter } from './BaseChannelAdapter.js';
/** Platform-specific parameters for Discord connections. */
export interface DiscordAuthParams extends Record<string, string | undefined> {
    /** Bot token. If provided, overrides credential. */
    botToken?: string;
    /** Discord application ID. */
    applicationId?: string;
    /** Optional guild (server) ID to scope interactions to a single guild. */
    guildId?: string;
    /** Comma-separated list of additional gateway intents. */
    intents?: string;
}
/**
 * Channel adapter for Discord using the discord.js SDK.
 *
 * Uses dynamic import so `discord.js` is only required at runtime when the
 * adapter is actually initialized.
 *
 * Capabilities: text, rich_text, images, video, audio, embeds, reactions,
 * threads, mentions, buttons, group_chat, channels, editing, deletion.
 */
export declare class DiscordChannelAdapter extends BaseChannelAdapter<DiscordAuthParams> {
    readonly platform: ChannelPlatform;
    readonly displayName = "Discord";
    readonly capabilities: readonly ChannelCapability[];
    /** The discord.js Client instance. */
    private client;
    /** discord.js module reference for building embeds, buttons, etc. */
    private djs;
    protected doConnect(auth: ChannelAuthConfig & {
        params?: DiscordAuthParams;
    }): Promise<void>;
    protected doSendMessage(conversationId: string, content: MessageContent): Promise<ChannelSendResult>;
    protected doShutdown(): Promise<void>;
    editMessage(conversationId: string, messageId: string, content: MessageContent): Promise<void>;
    deleteMessage(conversationId: string, messageId: string): Promise<void>;
    addReaction(conversationId: string, messageId: string, emoji: string): Promise<void>;
    sendTypingIndicator(conversationId: string, _isTyping: boolean): Promise<void>;
    getConversationInfo(conversationId: string): Promise<{
        name?: string;
        memberCount?: number;
        isGroup: boolean;
        metadata?: Record<string, unknown>;
    }>;
    /**
     * Wire up discord.js event handlers for inbound messages and interactions.
     */
    private wireEventHandlers;
    /**
     * Handle an inbound discord.js Message and emit a channel event.
     */
    private handleInboundMessage;
    /**
     * Build a discord.js message payload from MessageContent.
     */
    private buildMessagePayload;
}
//# sourceMappingURL=DiscordChannelAdapter.d.ts.map