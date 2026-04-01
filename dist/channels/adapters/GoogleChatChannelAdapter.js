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
import { BaseChannelAdapter } from './BaseChannelAdapter.js';
// ============================================================================
// GoogleChatChannelAdapter
// ============================================================================
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
export class GoogleChatChannelAdapter extends BaseChannelAdapter {
    constructor() {
        super(...arguments);
        this.platform = 'google-chat';
        this.displayName = 'Google Chat';
        this.capabilities = [
            'text',
            'rich_text',
            'images',
            'buttons',
            'threads',
            'reactions',
            'group_chat',
        ];
    }
    // ── Abstract hook implementations ──
    async doConnect(auth) {
        const params = auth.params ?? {};
        this.defaultSpace = params.defaultSpace;
        // Dynamic import of googleapis
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let google;
        try {
            const googleapis = await import('googleapis');
            google = googleapis.google ?? googleapis.default?.google ?? googleapis;
        }
        catch {
            throw new Error('The "googleapis" package is required for the Google Chat adapter. ' +
                'Install it with: npm install googleapis');
        }
        // Authenticate via service account
        try {
            if (params.credentials) {
                // Inline credentials JSON
                const credentialsObj = JSON.parse(params.credentials);
                this.authClient = new google.auth.GoogleAuth({
                    credentials: credentialsObj,
                    scopes: ['https://www.googleapis.com/auth/chat.bot'],
                });
            }
            else if (auth.credential) {
                // File path to service account key
                this.authClient = new google.auth.GoogleAuth({
                    keyFile: auth.credential,
                    scopes: ['https://www.googleapis.com/auth/chat.bot'],
                });
            }
            else {
                throw new Error('Google Chat authentication requires either a service account ' +
                    'key file path (credential) or inline credentials (params.credentials).');
            }
            // Create the Chat API client
            this.chatClient = google.chat({
                version: 'v1',
                auth: this.authClient,
            });
            // Verify access by listing spaces (limited to 1)
            const spacesResponse = await this.chatClient.spaces.list({
                pageSize: 1,
            });
            // Try to get bot identity
            try {
                const spaces = spacesResponse.data?.spaces ?? [];
                if (spaces.length > 0) {
                    this.botInfo = {
                        name: 'AgentOS Bot',
                        displayName: 'AgentOS Bot',
                    };
                }
            }
            catch {
                // Bot identity fetch is best-effort
            }
        }
        catch (err) {
            if (err instanceof SyntaxError) {
                throw new Error('Invalid JSON in Google Chat credentials. Ensure the credentials ' +
                    'param contains valid service account JSON.');
            }
            const message = err instanceof Error ? err.message : String(err);
            throw new Error(`Google Chat authentication failed: ${message}`);
        }
        this.platformInfo = {
            botName: this.botInfo?.displayName ?? 'AgentOS Bot',
            defaultSpace: this.defaultSpace,
            authMethod: params.credentials ? 'inline-credentials' : 'key-file',
        };
        // Start polling if a default space is configured
        if (this.defaultSpace) {
            this.startPolling();
        }
    }
    async doSendMessage(conversationId, content) {
        if (!this.chatClient) {
            throw new Error('[Google Chat] API client is not initialized.');
        }
        // Resolve the space name
        const spaceName = this.resolveSpaceName(conversationId);
        // Build the message payload
        const messagePayload = this.buildMessagePayload(content);
        // Build request parameters
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const requestParams = {
            parent: spaceName,
            requestBody: messagePayload,
        };
        // Handle threading
        if (content.replyToMessageId) {
            requestParams.requestBody.thread = {
                name: content.replyToMessageId,
            };
            requestParams.messageReplyOption = 'REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD';
        }
        try {
            const response = await this.chatClient.spaces.messages.create(requestParams);
            return {
                messageId: response.data?.name ?? `gchat-${Date.now()}`,
                timestamp: response.data?.createTime ?? new Date().toISOString(),
            };
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            throw new Error(`[Google Chat] Failed to send message to ${spaceName}: ${message}`);
        }
    }
    async doShutdown() {
        this.stopPolling();
        this.chatClient = undefined;
        this.authClient = undefined;
        this.defaultSpace = undefined;
        this.botInfo = undefined;
        this.lastPollTimestamp = undefined;
    }
    // ── IChannelAdapter optional methods ──
    async editMessage(conversationId, messageId, content) {
        if (!this.chatClient) {
            throw new Error('[Google Chat] API client is not initialized.');
        }
        const messagePayload = this.buildMessagePayload(content);
        await this.chatClient.spaces.messages.update({
            name: messageId, // Google Chat uses the full message resource name as ID
            updateMask: 'text,cards',
            requestBody: messagePayload,
        });
    }
    async deleteMessage(_conversationId, messageId) {
        if (!this.chatClient) {
            throw new Error('[Google Chat] API client is not initialized.');
        }
        await this.chatClient.spaces.messages.delete({
            name: messageId,
        });
    }
    async addReaction(_conversationId, messageId, emoji) {
        if (!this.chatClient) {
            throw new Error('[Google Chat] API client is not initialized.');
        }
        try {
            await this.chatClient.spaces.messages.reactions.create({
                parent: messageId,
                requestBody: {
                    emoji: { unicode: emoji },
                },
            });
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.warn(`[Google Chat] Failed to add reaction: ${message}`);
        }
    }
    async getConversationInfo(conversationId) {
        if (!this.chatClient) {
            throw new Error('[Google Chat] API client is not initialized.');
        }
        const spaceName = this.resolveSpaceName(conversationId);
        try {
            const response = await this.chatClient.spaces.get({
                name: spaceName,
            });
            const space = response.data;
            const isGroup = space?.type === 'ROOM' || space?.type === 'GROUP_CHAT';
            let memberCount;
            try {
                const members = await this.chatClient.spaces.members.list({
                    parent: spaceName,
                    pageSize: 1,
                });
                // The API doesn't return total count directly in the list
                // but we can check if there are members
                memberCount = members.data?.memberships?.length;
            }
            catch {
                // Member count is best-effort
            }
            return {
                name: space?.displayName ?? space?.name,
                memberCount,
                isGroup,
                metadata: {
                    spaceType: space?.type,
                    singleUserBotDm: space?.singleUserBotDm,
                    threaded: space?.threaded,
                    spaceThreadingState: space?.spaceThreadingState,
                },
            };
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            throw new Error(`[Google Chat] Failed to get space info: ${message}`);
        }
    }
    // ── Teams-specific public methods ──
    /**
     * Process an incoming Google Chat webhook event.
     * Call this from your HTTP endpoint that receives Google Chat events.
     *
     * Google Chat sends events via HTTP push to configured webhook URLs
     * or Cloud Pub/Sub subscriptions.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async processWebhookEvent(event) {
        if (!event?.type)
            return;
        switch (event.type) {
            case 'MESSAGE':
                this.handleIncomingMessage(event);
                break;
            case 'ADDED_TO_SPACE':
                this.handleAddedToSpace(event);
                break;
            case 'REMOVED_FROM_SPACE':
                this.handleRemovedFromSpace(event);
                break;
            case 'CARD_CLICKED':
                this.handleCardClicked(event);
                break;
            default:
                break;
        }
    }
    /**
     * List spaces the bot is a member of.
     */
    async listSpaces() {
        if (!this.chatClient) {
            throw new Error('[Google Chat] API client is not initialized.');
        }
        const response = await this.chatClient.spaces.list({
            pageSize: 100,
        });
        return (response.data?.spaces ?? []).map((space) => ({
            name: space.name ?? '',
            displayName: space.displayName ?? '',
            type: space.type ?? 'UNKNOWN',
        }));
    }
    // ── Private: message building ──
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    buildMessagePayload(content) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const payload = {};
        const textParts = [];
        const cards = [];
        for (const block of content.blocks) {
            switch (block.type) {
                case 'text':
                    textParts.push(block.text);
                    break;
                case 'embed':
                    // Google Chat supports a subset of HTML-like formatting via embeds
                    if ('text' in block && typeof block.text === 'string') {
                        textParts.push(block.text);
                    }
                    cards.push(this.buildEmbedCard(block));
                    break;
                case 'image':
                    // Images go into card widgets
                    cards.push({
                        sections: [{
                                widgets: [{
                                        image: {
                                            imageUrl: block.url,
                                            ...(block.caption ? { onClick: { openLink: { url: block.url } } } : {}),
                                        },
                                    }],
                            }],
                        ...(block.caption ? { header: { title: block.caption } } : {}),
                    });
                    break;
                case 'button_group':
                    cards.push({
                        sections: [{
                                widgets: [{
                                        buttons: block.buttons.map((btn) => ({
                                            textButton: {
                                                text: btn.label,
                                                onClick: btn.action === 'url'
                                                    ? { openLink: { url: btn.value } }
                                                    : { action: { actionMethodName: btn.id, parameters: [{ key: 'value', value: btn.value }] } },
                                            },
                                        })),
                                    }],
                            }],
                    });
                    break;
                case 'poll':
                    cards.push(this.buildPollCard(block));
                    break;
                default:
                    break;
            }
        }
        if (textParts.length > 0) {
            payload.text = textParts.join('\n\n');
        }
        if (cards.length > 0) {
            // Google Chat API v1 uses "cardsV2" for newer card format
            payload.cardsV2 = cards.map((card, idx) => ({
                cardId: `card-${idx}`,
                card: {
                    header: card.header,
                    sections: card.sections,
                },
            }));
        }
        // Platform options pass-through
        if (content.platformOptions) {
            Object.assign(payload, content.platformOptions);
        }
        return payload;
    }
    buildEmbedCard(block) {
        const widgets = [];
        if (block.description) {
            widgets.push({
                textParagraph: { text: block.description },
            });
        }
        if (block.fields) {
            for (const field of block.fields) {
                widgets.push({
                    decoratedText: {
                        topLabel: field.name,
                        text: field.value,
                    },
                });
            }
        }
        if (block.url) {
            widgets.push({
                buttonList: {
                    buttons: [{
                            text: 'Open Link',
                            onClick: { openLink: { url: block.url } },
                        }],
                },
            });
        }
        return {
            header: {
                title: block.title,
                ...(block.description ? { subtitle: block.description.slice(0, 100) } : {}),
            },
            sections: [{ widgets }],
        };
    }
    buildPollCard(block) {
        const widgets = [];
        widgets.push({
            textParagraph: { text: `<b>${block.question}</b>` },
        });
        // Each option as a button
        widgets.push({
            buttonList: {
                buttons: block.options.map((opt, idx) => ({
                    text: opt,
                    onClick: {
                        action: {
                            actionMethodName: 'pollVote',
                            parameters: [
                                { key: 'option', value: String(idx) },
                                { key: 'question', value: block.question },
                            ],
                        },
                    },
                })),
            },
        });
        return {
            header: { title: 'Poll' },
            sections: [{ widgets }],
        };
    }
    // ── Private: space name resolution ──
    resolveSpaceName(conversationId) {
        // If it already looks like a space name, use it directly
        if (conversationId.startsWith('spaces/')) {
            return conversationId;
        }
        // If it's a bare space ID, prefix it
        if (conversationId && !conversationId.includes('/')) {
            return `spaces/${conversationId}`;
        }
        // Fall back to default space
        if (this.defaultSpace) {
            return this.defaultSpace.startsWith('spaces/')
                ? this.defaultSpace
                : `spaces/${this.defaultSpace}`;
        }
        throw new Error('[Google Chat] Cannot resolve space name from conversation ID. ' +
            'Provide a full space name (e.g., "spaces/AAAA...") or set defaultSpace.');
    }
    // ── Private: incoming event handlers ──
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handleIncomingMessage(event) {
        const msg = event.message;
        if (!msg)
            return;
        const spaceName = event.space?.name ?? 'unknown';
        const isGroup = event.space?.type === 'ROOM' || event.space?.type === 'GROUP_CHAT';
        const contentBlocks = [];
        if (msg.text) {
            contentBlocks.push({ type: 'text', text: msg.text });
        }
        // Handle attachment content
        if (msg.attachment) {
            for (const att of Array.isArray(msg.attachment) ? msg.attachment : [msg.attachment]) {
                if (att.contentType?.startsWith('image/')) {
                    contentBlocks.push({
                        type: 'image',
                        url: att.downloadUri ?? att.attachmentDataRef?.resourceName ?? '',
                        mimeType: att.contentType,
                    });
                }
                else {
                    contentBlocks.push({
                        type: 'document',
                        url: att.downloadUri ?? att.attachmentDataRef?.resourceName ?? '',
                        filename: att.source ?? 'attachment',
                        mimeType: att.contentType,
                    });
                }
            }
        }
        const message = {
            messageId: msg.name ?? `gchat-${Date.now()}`,
            platform: 'google-chat',
            conversationId: spaceName,
            conversationType: isGroup ? 'group' : 'direct',
            sender: {
                id: event.user?.name ?? 'unknown',
                displayName: event.user?.displayName,
                username: event.user?.email,
                avatarUrl: event.user?.avatarUrl,
            },
            content: contentBlocks.length > 0 ? contentBlocks : [{ type: 'text', text: '' }],
            text: msg.text ?? '',
            timestamp: msg.createTime ?? new Date().toISOString(),
            replyToMessageId: msg.thread?.name,
            rawEvent: event,
        };
        this.emit({
            type: 'message',
            platform: 'google-chat',
            conversationId: spaceName,
            timestamp: message.timestamp,
            data: message,
        });
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handleAddedToSpace(event) {
        const spaceName = event.space?.name ?? 'unknown';
        this.emit({
            type: 'member_joined',
            platform: 'google-chat',
            conversationId: spaceName,
            timestamp: new Date().toISOString(),
            data: {
                user: {
                    id: event.user?.name ?? 'bot',
                    displayName: event.user?.displayName ?? 'Bot',
                },
                space: event.space,
            },
        });
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handleRemovedFromSpace(event) {
        const spaceName = event.space?.name ?? 'unknown';
        this.emit({
            type: 'member_left',
            platform: 'google-chat',
            conversationId: spaceName,
            timestamp: new Date().toISOString(),
            data: {
                user: {
                    id: event.user?.name ?? 'bot',
                    displayName: event.user?.displayName ?? 'Bot',
                },
                space: event.space,
            },
        });
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handleCardClicked(event) {
        const spaceName = event.space?.name ?? 'unknown';
        const action = event.action;
        if (!action)
            return;
        this.emit({
            type: 'button_callback',
            platform: 'google-chat',
            conversationId: spaceName,
            timestamp: new Date().toISOString(),
            data: {
                callbackId: action.actionMethodName ?? 'unknown',
                buttonId: action.actionMethodName ?? 'unknown',
                sender: {
                    id: event.user?.name ?? 'unknown',
                    displayName: event.user?.displayName,
                },
                messageId: event.message?.name ?? 'unknown',
                parameters: action.parameters,
            },
        });
    }
    // ── Private: polling ──
    startPolling() {
        if (!this.defaultSpace)
            return;
        // Poll every 30 seconds for new messages in the default space
        this.pollTimer = setInterval(() => {
            this.pollSpace().catch((err) => {
                console.warn('[Google Chat] Space poll error:', err);
            });
        }, 30000);
    }
    stopPolling() {
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = undefined;
        }
    }
    async pollSpace() {
        if (!this.chatClient || !this.defaultSpace)
            return;
        try {
            const spaceName = this.resolveSpaceName(this.defaultSpace);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const params = {
                parent: spaceName,
                pageSize: 25,
                orderBy: 'createTime desc',
            };
            if (this.lastPollTimestamp) {
                params.filter = `createTime > "${this.lastPollTimestamp}"`;
            }
            const response = await this.chatClient.spaces.messages.list(params);
            const messages = response.data?.messages ?? [];
            for (const msg of messages) {
                // Skip bot's own messages
                if (msg.sender?.type === 'BOT')
                    continue;
                // Build a synthetic event matching the webhook format
                const syntheticEvent = {
                    type: 'MESSAGE',
                    message: msg,
                    space: { name: spaceName },
                    user: msg.sender,
                };
                this.handleIncomingMessage(syntheticEvent);
                // Track the latest timestamp
                if (msg.createTime && (!this.lastPollTimestamp || msg.createTime > this.lastPollTimestamp)) {
                    this.lastPollTimestamp = msg.createTime;
                }
            }
        }
        catch {
            // Non-fatal — will retry on next poll
        }
    }
}
//# sourceMappingURL=GoogleChatChannelAdapter.js.map