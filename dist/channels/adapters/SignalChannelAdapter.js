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
import { BaseChannelAdapter } from './BaseChannelAdapter.js';
// ============================================================================
// SignalChannelAdapter
// ============================================================================
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
export class SignalChannelAdapter extends BaseChannelAdapter {
    constructor() {
        super(...arguments);
        this.platform = 'signal';
        this.displayName = 'Signal';
        this.capabilities = [
            'text',
            'images',
            'audio',
            'voice_notes',
            'documents',
            'reactions',
            'group_chat',
        ];
        /** Path to signal-cli binary. */
        this.signalCliPath = 'signal-cli';
        /** Trust mode for unknown identities. */
        this.trustMode = 'on-first-use';
    }
    // ── Abstract hook implementations ──
    async doConnect(auth) {
        const params = auth.params ?? {};
        this.phoneNumber = auth.credential;
        if (!this.phoneNumber) {
            throw new Error('Signal credential (phone number) is required.');
        }
        // Validate phone number format (basic check)
        if (!this.phoneNumber.startsWith('+')) {
            throw new Error('Signal phone number must be in international format starting with "+" (e.g., +1234567890).');
        }
        this.signalCliPath = params.signalCliPath ?? 'signal-cli';
        this.configDir = params.configDir;
        this.trustMode = params.trustMode ?? 'on-first-use';
        this.daemonSocket = params.daemonSocket;
        // Verify signal-cli is available
        await this.verifySignalCli();
        // Verify the account is registered / linked
        await this.verifyAccount();
        // Set up message receiving
        if (this.daemonSocket) {
            await this.connectDaemon();
        }
        else {
            this.startReceivePolling();
        }
        this.platformInfo = {
            phoneNumber: this.phoneNumber,
            signalCliPath: this.signalCliPath,
            mode: this.daemonSocket ? 'daemon' : 'subprocess',
            trustMode: this.trustMode,
        };
    }
    async doSendMessage(conversationId, content) {
        const text = this.extractText(content.blocks);
        const attachments = this.extractAttachmentPaths(content.blocks);
        const isGroup = conversationId.startsWith('group:');
        const target = isGroup ? conversationId.slice(6) : conversationId;
        // Build signal-cli send command
        const args = ['send'];
        if (text) {
            args.push('-m', text);
        }
        // Add attachments
        for (const attachment of attachments) {
            args.push('-a', attachment);
        }
        if (isGroup) {
            args.push('-g', target);
        }
        else {
            args.push(target);
        }
        // Handle reply-to
        if (content.replyToMessageId) {
            // signal-cli supports --quote-timestamp and --quote-author for replies
            const [quoteTimestamp, quoteAuthor] = content.replyToMessageId.split(':');
            if (quoteTimestamp) {
                args.push('--quote-timestamp', quoteTimestamp);
            }
            if (quoteAuthor) {
                args.push('--quote-author', quoteAuthor);
            }
        }
        await this.execSignalCli(args);
        const messageId = `signal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        return {
            messageId,
            timestamp: new Date().toISOString(),
        };
    }
    async doShutdown() {
        // Stop polling
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = undefined;
        }
        // Kill receive process
        if (this.receiveProcess) {
            try {
                this.receiveProcess.kill('SIGTERM');
            }
            catch {
                // Best effort
            }
            this.receiveProcess = undefined;
        }
        // Close daemon connection
        if (this.daemonConnection) {
            try {
                this.daemonConnection.destroy?.();
            }
            catch {
                // Best effort
            }
            this.daemonConnection = undefined;
        }
        this.phoneNumber = undefined;
        this.configDir = undefined;
        this.daemonSocket = undefined;
    }
    // ── Signal-specific public methods ──
    /**
     * Send a reaction to a message.
     *
     * @param conversationId - Target conversation (phone number or group:id).
     * @param targetAuthor - Phone number of the message author being reacted to.
     * @param targetTimestamp - Timestamp of the target message (Signal's message ID).
     * @param emoji - The reaction emoji.
     */
    async sendReaction(conversationId, targetAuthor, targetTimestamp, emoji) {
        const isGroup = conversationId.startsWith('group:');
        const target = isGroup ? conversationId.slice(6) : conversationId;
        const args = [
            'sendReaction',
            '-a', targetAuthor,
            '-t', targetTimestamp,
            '-e', emoji,
        ];
        if (isGroup) {
            args.push('-g', target);
        }
        else {
            args.push(target);
        }
        await this.execSignalCli(args);
    }
    /**
     * List groups the account is a member of.
     */
    async listGroups() {
        const output = await this.execSignalCli(['listGroups', '-d']);
        try {
            const groups = JSON.parse(output);
            return Array.isArray(groups)
                ? groups.map((g) => ({
                    id: g.id ?? g.groupId ?? '',
                    name: g.name ?? '',
                    members: g.members ?? [],
                }))
                : [];
        }
        catch {
            // Parse line-based output as fallback
            return [];
        }
    }
    /**
     * Mark messages as read (send read receipt).
     */
    async markAsRead(senderNumber, timestamps) {
        const args = ['sendReceipt', '-t'];
        args.push(...timestamps);
        args.push('--type', 'read');
        args.push(senderNumber);
        await this.execSignalCli(args);
    }
    // ── Private: signal-cli execution ──
    async verifySignalCli() {
        try {
            const output = await this.execSignalCli(['--version']);
            console.log(`[Signal] signal-cli version: ${output.trim()}`);
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            throw new Error(`signal-cli not found or not executable at "${this.signalCliPath}". ` +
                `Ensure it is installed: ${message}`);
        }
    }
    async verifyAccount() {
        try {
            // List accounts to verify our number is registered
            const output = await this.execSignalCli(['listAccounts']);
            if (output && !output.includes(this.phoneNumber)) {
                console.warn(`[Signal] Phone number ${this.phoneNumber} may not be registered. ` +
                    'Attempting to proceed anyway.');
            }
        }
        catch {
            // listAccounts may not be available in all signal-cli versions
            // Proceed and let the first send/receive reveal issues
            console.warn('[Signal] Could not verify account registration. Proceeding.');
        }
    }
    /**
     * Execute a signal-cli command and return stdout.
     */
    async execSignalCli(args) {
        const { execFile } = await import('node:child_process');
        const { promisify } = await import('node:util');
        const execFileAsync = promisify(execFile);
        const fullArgs = [];
        // Add account flag
        if (this.phoneNumber) {
            fullArgs.push('-a', this.phoneNumber);
        }
        // Add config directory
        if (this.configDir) {
            fullArgs.push('--config', this.configDir);
        }
        // Add trust mode
        if (this.trustMode === 'always') {
            fullArgs.push('--trust-new-identities', 'always');
        }
        // Request JSON output where applicable
        fullArgs.push('--output', 'json');
        // Add the command args
        fullArgs.push(...args);
        try {
            const { stdout, stderr } = await execFileAsync(this.signalCliPath, fullArgs, {
                timeout: 30000,
                maxBuffer: 10 * 1024 * 1024, // 10MB
            });
            if (stderr) {
                console.warn(`[Signal] stderr: ${stderr}`);
            }
            return stdout;
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            throw new Error(`signal-cli command failed: ${message}`);
        }
    }
    // ── Private: daemon mode ──
    async connectDaemon() {
        if (!this.daemonSocket)
            return;
        try {
            const net = await import('node:net');
            await new Promise((resolve, reject) => {
                const socket = net.createConnection(this.daemonSocket, () => {
                    this.daemonConnection = socket;
                    resolve();
                });
                socket.on('error', (err) => {
                    reject(new Error(`Failed to connect to signal-cli daemon at ${this.daemonSocket}: ${err.message}`));
                });
                socket.on('data', (data) => {
                    this.handleDaemonData(data.toString());
                });
                socket.on('close', () => {
                    if (this.status === 'connected') {
                        console.warn('[Signal] Daemon connection closed unexpectedly.');
                        this.setStatus('reconnecting', 'Daemon connection closed');
                        this.reconnect().catch((e) => {
                            console.error('[Signal] Daemon reconnect failed:', e);
                        });
                    }
                });
                // Timeout after 10s
                setTimeout(() => reject(new Error('Daemon connection timeout')), 10000);
            });
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            throw new Error(`Signal daemon connection failed: ${message}`);
        }
    }
    handleDaemonData(data) {
        // signal-cli daemon sends newline-delimited JSON
        const lines = data.split('\n').filter(Boolean);
        for (const line of lines) {
            try {
                const event = JSON.parse(line);
                this.processSignalEvent(event);
            }
            catch {
                // Malformed JSON — skip
            }
        }
    }
    // ── Private: subprocess polling ──
    startReceivePolling() {
        // Poll for new messages every 15 seconds
        this.pollTimer = setInterval(() => {
            this.receiveMessages().catch((err) => {
                console.warn('[Signal] Receive poll error:', err);
            });
        }, 15000);
        // Also do an immediate receive
        this.receiveMessages().catch(() => { });
    }
    async receiveMessages() {
        try {
            const output = await this.execSignalCli(['receive', '--timeout', '5']);
            if (!output.trim())
                return;
            // Parse JSON output (may be array or newline-delimited objects)
            let events; // eslint-disable-line @typescript-eslint/no-explicit-any
            try {
                const parsed = JSON.parse(output);
                events = Array.isArray(parsed) ? parsed : [parsed];
            }
            catch {
                // Try newline-delimited JSON
                events = output
                    .split('\n')
                    .filter(Boolean)
                    .map((line) => {
                    try {
                        return JSON.parse(line);
                    }
                    catch {
                        return null;
                    }
                })
                    .filter(Boolean);
            }
            for (const event of events) {
                this.processSignalEvent(event);
            }
        }
        catch {
            // Non-fatal — will retry on next poll
        }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    processSignalEvent(event) {
        if (!event)
            return;
        // signal-cli JSON output wraps messages in an envelope
        const envelope = event.envelope ?? event;
        const dataMessage = envelope.dataMessage ?? envelope.syncMessage?.sentMessage;
        if (!dataMessage)
            return;
        const senderNumber = envelope.source ?? envelope.sourceNumber ?? 'unknown';
        const timestamp = envelope.timestamp ?? Date.now();
        // Determine conversation type and ID
        const groupInfo = dataMessage.groupInfo ?? dataMessage.group;
        const isGroup = !!groupInfo;
        const conversationId = isGroup
            ? `group:${groupInfo.groupId ?? groupInfo.id ?? 'unknown'}`
            : senderNumber;
        // Build content blocks
        const contentBlocks = [];
        if (dataMessage.message || dataMessage.body) {
            contentBlocks.push({
                type: 'text',
                text: dataMessage.message ?? dataMessage.body ?? '',
            });
        }
        // Handle attachments
        if (dataMessage.attachments) {
            for (const att of dataMessage.attachments) {
                const mimeType = att.contentType ?? att.mimeType ?? '';
                if (mimeType.startsWith('image/')) {
                    contentBlocks.push({
                        type: 'image',
                        url: att.filename ?? att.file ?? '',
                        mimeType,
                    });
                }
                else if (mimeType.startsWith('audio/')) {
                    contentBlocks.push({
                        type: 'audio',
                        url: att.filename ?? att.file ?? '',
                        mimeType,
                    });
                }
                else if (mimeType.startsWith('video/')) {
                    contentBlocks.push({
                        type: 'video',
                        url: att.filename ?? att.file ?? '',
                        mimeType,
                    });
                }
                else {
                    contentBlocks.push({
                        type: 'document',
                        url: att.filename ?? att.file ?? '',
                        filename: att.filename ?? 'attachment',
                        mimeType,
                    });
                }
            }
        }
        const textContent = contentBlocks
            .filter((b) => b.type === 'text')
            .map((b) => b.text)
            .join('\n');
        const message = {
            messageId: `${timestamp}:${senderNumber}`,
            platform: 'signal',
            conversationId,
            conversationType: isGroup ? 'group' : 'direct',
            sender: {
                id: senderNumber,
                username: senderNumber,
                displayName: envelope.sourceName ?? senderNumber,
            },
            content: contentBlocks.length > 0 ? contentBlocks : [{ type: 'text', text: '' }],
            text: textContent,
            timestamp: new Date(timestamp).toISOString(),
            rawEvent: event,
        };
        this.emit({
            type: 'message',
            platform: 'signal',
            conversationId,
            timestamp: message.timestamp,
            data: message,
        });
        // Handle reactions
        if (dataMessage.reaction) {
            this.emit({
                type: 'reaction_added',
                platform: 'signal',
                conversationId,
                timestamp: new Date(timestamp).toISOString(),
                data: {
                    emoji: dataMessage.reaction.emoji,
                    targetAuthor: dataMessage.reaction.targetAuthor,
                    targetTimestamp: dataMessage.reaction.targetSentTimestamp,
                    sender: {
                        id: senderNumber,
                        username: senderNumber,
                    },
                },
            });
        }
    }
    // ── Text/Attachment helpers ──
    extractText(blocks) {
        return blocks
            .filter((b) => b.type === 'text')
            .map((b) => b.text)
            .join('\n');
    }
    /**
     * Extract file paths from attachment blocks. For Signal, URLs
     * must be local file paths (signal-cli does not support remote URLs
     * directly — the caller must download first).
     */
    extractAttachmentPaths(blocks) {
        const paths = [];
        for (const block of blocks) {
            if (block.type === 'image' ||
                block.type === 'audio' ||
                block.type === 'video' ||
                block.type === 'document') {
                const url = 'url' in block ? block.url : undefined;
                if (url && !url.startsWith('http://') && !url.startsWith('https://')) {
                    // Local file path — usable by signal-cli
                    paths.push(url);
                }
                else if (url) {
                    console.warn(`[Signal] Skipping remote URL attachment "${url}". ` +
                        'Signal requires local file paths. Download the file first.');
                }
            }
        }
        return paths;
    }
}
//# sourceMappingURL=SignalChannelAdapter.js.map