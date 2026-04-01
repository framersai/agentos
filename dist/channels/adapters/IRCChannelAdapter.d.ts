/**
 * @fileoverview IRC Channel Adapter for AgentOS.
 *
 * Wraps the `irc-framework` npm package to connect agents to IRC servers.
 * IRC was recently added to OpenClaw upstream — this adapter provides
 * first-class support for the protocol within the channel system.
 *
 * **Dependencies**: Requires `irc-framework` to be installed. The adapter
 * uses a dynamic import so the package is only loaded at connection time,
 * avoiding hard failures if it is not present.
 *
 * @example
 * ```typescript
 * const irc = new IRCChannelAdapter();
 * await irc.initialize({
 *   platform: 'irc',
 *   credential: 'AgentNick',          // used as nickname
 *   params: {
 *     host: 'irc.libera.chat',
 *     port: '6697',                    // TLS by default
 *     channels: '#agentos,#wunderland',
 *     realname: 'Wunderland Agent',
 *     password: '',                     // server password (optional)
 *   },
 * });
 * ```
 *
 * @module @framers/agentos/channels/adapters/IRCChannelAdapter
 */
import type { ChannelAuthConfig, ChannelCapability, ChannelPlatform, ChannelSendResult, MessageContent } from '../types.js';
import { BaseChannelAdapter } from './BaseChannelAdapter.js';
/** Platform-specific parameters for IRC connections. */
export interface IRCAuthParams extends Record<string, string | undefined> {
    /** IRC server hostname. */
    host: string;
    /** Server port (default: '6697' for TLS). */
    port?: string;
    /** Comma-separated list of channels to auto-join. */
    channels?: string;
    /** GECOS / real-name field. */
    realname?: string;
    /** Server password (not NickServ — use credential for that). */
    password?: string;
    /** Whether to use TLS. Default: 'true'. */
    tls?: string;
}
/**
 * Channel adapter for Internet Relay Chat (IRC).
 *
 * Uses the `irc-framework` package via dynamic import so that the
 * dependency is optional — it is only required at runtime when the
 * adapter is actually initialized.
 *
 * Capabilities: `text`, `group_chat`, `channels`, `mentions`.
 * IRC does not natively support rich text, images, reactions, threads,
 * typing indicators, or message editing/deletion.
 */
export declare class IRCChannelAdapter extends BaseChannelAdapter<IRCAuthParams> {
    readonly platform: ChannelPlatform;
    readonly displayName = "IRC";
    readonly capabilities: readonly ChannelCapability[];
    /** The irc-framework Client instance. Typed as `any` because the
     *  package is dynamically imported and may not be installed. */
    private client;
    /** Channels the bot has joined, keyed by lowercase name. */
    private joinedChannels;
    protected doConnect(auth: ChannelAuthConfig & {
        params?: IRCAuthParams;
    }): Promise<void>;
    protected doSendMessage(conversationId: string, content: MessageContent): Promise<ChannelSendResult>;
    protected doShutdown(): Promise<void>;
    /**
     * Join an additional IRC channel at runtime.
     */
    joinChannel(channel: string): void;
    /**
     * Part (leave) an IRC channel.
     */
    partChannel(channel: string, reason?: string): void;
    /**
     * Get the set of channels the bot is currently in.
     */
    getJoinedChannels(): string[];
    private handleIrcMessage;
}
//# sourceMappingURL=IRCChannelAdapter.d.ts.map