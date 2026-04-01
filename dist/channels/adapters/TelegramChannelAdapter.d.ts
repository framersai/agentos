/**
 * @fileoverview Telegram Channel Adapter for AgentOS.
 *
 * Wraps the `telegraf` (or `grammy`) npm package to connect agents to
 * Telegram bots. Supports rich messaging including text, images, video,
 * audio, voice notes, stickers, reactions, inline keyboards, and more.
 *
 * **Dependencies**: Requires `telegraf` to be installed. The adapter uses
 * a dynamic import so the package is only loaded at connection time,
 * avoiding hard failures if it is not present.
 *
 * @example
 * ```typescript
 * const telegram = new TelegramChannelAdapter();
 * await telegram.initialize({
 *   platform: 'telegram',
 *   credential: 'BOT_TOKEN_FROM_BOTFATHER',
 *   params: {
 *     botToken: 'BOT_TOKEN_FROM_BOTFATHER',
 *   },
 * });
 * ```
 *
 * @module @framers/agentos/channels/adapters/TelegramChannelAdapter
 */
import type { ChannelAuthConfig, ChannelCapability, ChannelPlatform, ChannelSendResult, MessageContent } from '../types.js';
import { BaseChannelAdapter } from './BaseChannelAdapter.js';
/** Platform-specific parameters for Telegram connections. */
export interface TelegramAuthParams extends Record<string, string | undefined> {
    /** Bot token from BotFather. If provided, overrides credential. */
    botToken?: string;
    /** Webhook URL. If not provided, long polling is used. */
    webhookUrl?: string;
    /** Webhook secret token for verifying incoming updates. */
    webhookSecret?: string;
}
/**
 * Channel adapter for Telegram using the Telegraf SDK.
 *
 * Uses dynamic import so `telegraf` is only required at runtime when the
 * adapter is actually initialized. Falls back to `grammy` if `telegraf`
 * is not available.
 *
 * Capabilities: text, rich_text, images, video, audio, voice_notes,
 * stickers, reactions, buttons, inline_keyboard, group_chat, channels,
 * editing, deletion.
 */
export declare class TelegramChannelAdapter extends BaseChannelAdapter<TelegramAuthParams> {
    readonly platform: ChannelPlatform;
    readonly displayName = "Telegram";
    readonly capabilities: readonly ChannelCapability[];
    /** Telegraf Bot instance. Typed as `any` because the package is
     *  dynamically imported and may not be installed. */
    private bot;
    /** SDK module reference for helper access (e.g. Markup). */
    private sdk;
    /** Whether we are using grammy instead of telegraf. */
    private useGrammy;
    /** Track whether bot.launch() was called (for cleanup). */
    private launched;
    protected doConnect(auth: ChannelAuthConfig & {
        params?: TelegramAuthParams;
    }): Promise<void>;
    protected doSendMessage(conversationId: string, content: MessageContent): Promise<ChannelSendResult>;
    /**
     * Launch polling with retry logic to handle 409 Conflict errors.
     *
     * The 409 occurs when Telegram sees two getUpdates long-polls for the same token.
     * This happens during restarts — the old session lingers ~30s on Telegram's side.
     *
     * Strategy:
     * 1. Delete any stale webhook (webhook + polling = instant 409)
     * 2. Launch with dropPendingUpdates to skip queued messages
     * 3. On 409, wait and retry up to 3 times with increasing backoff
     */
    private launchPollingWithRetry;
    protected doShutdown(): Promise<void>;
    editMessage(conversationId: string, messageId: string, content: MessageContent): Promise<void>;
    deleteMessage(conversationId: string, messageId: string): Promise<void>;
    addReaction(conversationId: string, messageId: string, emoji: string): Promise<void>;
    sendTypingIndicator(conversationId: string, _isTyping: boolean): Promise<void>;
    /**
     * Send a single content block to a Telegram chat.
     */
    private sendBlock;
    /**
     * Handle inbound messages from Telegram and emit channel events.
     */
    private handleInboundMessage;
    /**
     * Handle inline keyboard callback queries.
     */
    private handleCallbackQuery;
}
//# sourceMappingURL=TelegramChannelAdapter.d.ts.map