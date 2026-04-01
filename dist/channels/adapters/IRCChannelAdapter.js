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
import { BaseChannelAdapter } from './BaseChannelAdapter.js';
// ============================================================================
// IRCChannelAdapter
// ============================================================================
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
export class IRCChannelAdapter extends BaseChannelAdapter {
    constructor() {
        super(...arguments);
        this.platform = 'irc';
        this.displayName = 'IRC';
        this.capabilities = [
            'text',
            'group_chat',
            'channels',
            'mentions',
        ];
        /** Channels the bot has joined, keyed by lowercase name. */
        this.joinedChannels = new Set();
    }
    // ── Abstract hook implementations ──
    async doConnect(auth) {
        // Dynamic import — fails gracefully if irc-framework is not installed
        let IrcFramework; // eslint-disable-line @typescript-eslint/no-explicit-any
        try {
            IrcFramework = await import('irc-framework');
        }
        catch {
            throw new Error('The "irc-framework" package is required for the IRC adapter. ' +
                'Install it with: npm install irc-framework');
        }
        const params = auth.params ?? {};
        const host = params.host;
        if (!host) {
            throw new Error('IRC auth params must include "host".');
        }
        const nick = auth.credential;
        if (!nick) {
            throw new Error('IRC credential (nickname) is required.');
        }
        const port = parseInt(params.port ?? '6697', 10);
        const useTls = (params.tls ?? 'true') !== 'false';
        const channelsToJoin = (params.channels ?? '')
            .split(',')
            .map((c) => c.trim())
            .filter(Boolean);
        // Create the IRC client
        const Client = IrcFramework.Client ?? IrcFramework.default?.Client ?? IrcFramework;
        this.client = new Client();
        // Wrap the connection in a promise so we can await it
        await new Promise((resolve, reject) => {
            const connectTimeout = setTimeout(() => {
                reject(new Error(`IRC connection to ${host}:${port} timed out after 30s`));
            }, 30000);
            this.client.on('registered', () => {
                clearTimeout(connectTimeout);
                // Auto-join requested channels
                for (const channel of channelsToJoin) {
                    this.client.join(channel);
                }
                resolve();
            });
            this.client.on('error', (err) => {
                clearTimeout(connectTimeout);
                reject(err);
            });
            this.client.on('close', () => {
                if (this.status === 'connected') {
                    // Unexpected disconnect — trigger reconnect via base class
                    this.setStatus('reconnecting', 'Connection closed unexpectedly');
                    this.reconnect().catch((e) => {
                        console.error(`[IRC] Reconnect failed:`, e);
                    });
                }
            });
            // Wire up inbound message events
            this.client.on('privmsg', (event) => {
                this.handleIrcMessage(event);
            });
            // Track channel joins
            this.client.on('join', (event) => {
                if (event.nick === nick) {
                    this.joinedChannels.add(event.channel.toLowerCase());
                }
            });
            // Track channel parts
            this.client.on('part', (event) => {
                if (event.nick === nick) {
                    this.joinedChannels.delete(event.channel.toLowerCase());
                }
            });
            this.client.connect({
                host,
                port,
                nick,
                gecos: params.realname ?? `AgentOS IRC (${nick})`,
                password: params.password || undefined,
                tls: useTls,
                auto_reconnect: false, // We handle reconnection in BaseChannelAdapter
            });
        });
        // Populate platform info
        this.platformInfo = {
            nick,
            host,
            port,
            tls: useTls,
            channels: channelsToJoin,
        };
    }
    async doSendMessage(conversationId, content) {
        if (!this.client) {
            throw new Error('[IRC] Client is not connected.');
        }
        // Extract text from content blocks (IRC only supports plain text)
        const textParts = [];
        for (const block of content.blocks) {
            if (block.type === 'text') {
                textParts.push(block.text);
            }
            else if (block.type === 'image' || block.type === 'video' || block.type === 'document') {
                // For media blocks, send the URL as a fallback
                const url = 'url' in block ? block.url : undefined;
                if (url) {
                    const caption = 'caption' in block && block.caption ? `${block.caption}: ` : '';
                    textParts.push(`${caption}${url}`);
                }
            }
        }
        const fullText = textParts.join('\n');
        if (!fullText) {
            throw new Error('[IRC] Cannot send empty message.');
        }
        // IRC messages have a ~512-byte line limit; split into multiple lines
        const lines = fullText.split('\n');
        for (const line of lines) {
            if (line.trim()) {
                this.client.say(conversationId, line);
            }
        }
        // IRC does not provide message IDs; generate a synthetic one
        const syntheticId = `irc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        return {
            messageId: syntheticId,
            timestamp: new Date().toISOString(),
        };
    }
    async doShutdown() {
        if (this.client) {
            try {
                this.client.quit('AgentOS shutting down');
            }
            catch {
                // Best effort — connection may already be dead
            }
            this.client = undefined;
        }
        this.joinedChannels.clear();
    }
    // ── IRC-specific helpers ──
    /**
     * Join an additional IRC channel at runtime.
     */
    joinChannel(channel) {
        if (!this.client || this.status !== 'connected') {
            throw new Error('[IRC] Cannot join channel — not connected.');
        }
        this.client.join(channel);
    }
    /**
     * Part (leave) an IRC channel.
     */
    partChannel(channel, reason) {
        if (!this.client || this.status !== 'connected') {
            throw new Error('[IRC] Cannot part channel — not connected.');
        }
        this.client.part(channel, reason ?? '');
        this.joinedChannels.delete(channel.toLowerCase());
    }
    /**
     * Get the set of channels the bot is currently in.
     */
    getJoinedChannels() {
        return [...this.joinedChannels];
    }
    // ── Private ──
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handleIrcMessage(event) {
        const isChannel = event.target?.startsWith('#') || event.target?.startsWith('&');
        const conversationId = event.target ?? event.nick ?? 'unknown';
        const message = {
            messageId: `irc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            platform: 'irc',
            conversationId,
            conversationType: isChannel ? 'channel' : 'direct',
            sender: {
                id: event.nick ?? 'unknown',
                displayName: event.nick,
                username: event.nick,
            },
            content: [{ type: 'text', text: event.message ?? '' }],
            text: event.message ?? '',
            timestamp: new Date().toISOString(),
            rawEvent: event,
        };
        this.emit({
            type: 'message',
            platform: 'irc',
            conversationId,
            timestamp: message.timestamp,
            data: message,
        });
    }
}
//# sourceMappingURL=IRCChannelAdapter.js.map