/**
 * @fileoverview Signal Channel Adapter for AgentOS.
 *
 * Integrates with the Signal messaging protocol via `signal-cli`, a
 * command-line tool for Signal. The adapter invokes signal-cli as a
 * subprocess for sending/receiving messages, providing end-to-end
 * encrypted communication for agents.
 *
 * **Dependencies**: Requires `signal-cli` to be installed and
 * configured on the system (either registered or linked to an
 * existing device). See https://github.com/AsamK/signal-cli
 *
 * The adapter supports two operation modes:
 * 1. **Subprocess mode** (default): Invokes signal-cli per command.
 * 2. **JSON-RPC daemon mode**: Connects to a running signal-cli
 *    daemon for lower latency. Enabled when `daemonSocket` param
 *    is provided.
 *
 * @example
 * ```typescript
 * const signal = new SignalChannelAdapter();
 * await signal.initialize({
 *   platform: 'signal',
 *   credential: '+1234567890',       // registered phone number
 *   params: {
 *     signalCliPath: '/usr/local/bin/signal-cli',
 *     configDir: '/home/agent/.local/share/signal-cli',
 *   },
 * });
 * ```
 *
 * @module @framers/agentos/channels/adapters/SignalChannelAdapter
 */
import type { ChannelAuthConfig, ChannelCapability, ChannelPlatform, ChannelSendResult, MessageContent } from '../types.js';
import { BaseChannelAdapter } from './BaseChannelAdapter.js';
/** Platform-specific authentication parameters for Signal. */
export interface SignalAuthParams extends Record<string, string | undefined> {
    /** Path to the signal-cli binary. Default: 'signal-cli'. */
    signalCliPath?: string;
    /** Path to signal-cli config/data directory. */
    configDir?: string;
    /** Unix socket or TCP address of signal-cli JSON-RPC daemon. */
    daemonSocket?: string;
    /** Trust mode for new identities: 'always', 'on-first-use', 'never'. Default: 'on-first-use'. */
    trustMode?: string;
}
/**
 * Channel adapter for the Signal messaging protocol via signal-cli.
 *
 * Capabilities: `text`, `images`, `audio`, `voice_notes`,
 * `documents`, `reactions`, `group_chat`.
 *
 * Conversation ID mapping:
 * - Direct message: phone number (e.g., '+1234567890')
 * - Group: group ID in base64 format, prefixed with 'group:'
 */
export declare class SignalChannelAdapter extends BaseChannelAdapter<SignalAuthParams> {
    readonly platform: ChannelPlatform;
    readonly displayName = "Signal";
    readonly capabilities: readonly ChannelCapability[];
    /** Path to signal-cli binary. */
    private signalCliPath;
    /** Registered phone number (account identifier). */
    private phoneNumber;
    /** Config directory for signal-cli. */
    private configDir;
    /** Trust mode for unknown identities. */
    private trustMode;
    /** JSON-RPC daemon connection (if using daemon mode). */
    private daemonSocket;
    private daemonConnection;
    /** Polling process for receiving messages. */
    private receiveProcess;
    private pollTimer;
    protected doConnect(auth: ChannelAuthConfig & {
        params?: SignalAuthParams;
    }): Promise<void>;
    protected doSendMessage(conversationId: string, content: MessageContent): Promise<ChannelSendResult>;
    protected doShutdown(): Promise<void>;
    /**
     * Send a reaction to a message.
     *
     * @param conversationId - Target conversation (phone number or group:id).
     * @param targetAuthor - Phone number of the message author being reacted to.
     * @param targetTimestamp - Timestamp of the target message (Signal's message ID).
     * @param emoji - The reaction emoji.
     */
    sendReaction(conversationId: string, targetAuthor: string, targetTimestamp: string, emoji: string): Promise<void>;
    /**
     * List groups the account is a member of.
     */
    listGroups(): Promise<Array<{
        id: string;
        name: string;
        members: string[];
    }>>;
    /**
     * Mark messages as read (send read receipt).
     */
    markAsRead(senderNumber: string, timestamps: string[]): Promise<void>;
    private verifySignalCli;
    private verifyAccount;
    /**
     * Execute a signal-cli command and return stdout.
     */
    private execSignalCli;
    private connectDaemon;
    private handleDaemonData;
    private startReceivePolling;
    private receiveMessages;
    private processSignalEvent;
    private extractText;
    /**
     * Extract file paths from attachment blocks. For Signal, URLs
     * must be local file paths (signal-cli does not support remote URLs
     * directly — the caller must download first).
     */
    private extractAttachmentPaths;
}
//# sourceMappingURL=SignalChannelAdapter.d.ts.map