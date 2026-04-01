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
import { BaseChannelAdapter } from './BaseChannelAdapter.js';
// ============================================================================
// TeamsChannelAdapter
// ============================================================================
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
export class TeamsChannelAdapter extends BaseChannelAdapter {
    constructor() {
        super(...arguments);
        this.platform = 'teams';
        this.displayName = 'Microsoft Teams';
        this.capabilities = [
            'text',
            'rich_text',
            'images',
            'documents',
            'buttons',
            'threads',
            'mentions',
            'reactions',
            'group_chat',
            'channels',
        ];
        /** Service URL for the Teams tenant. */
        this.serviceUrl = 'https://smba.trafficmanager.net/teams/';
        /** Conversation references for proactive messaging, keyed by conversation ID. */
        this.conversationReferences = new Map();
    }
    // ── Abstract hook implementations ──
    async doConnect(auth) {
        const params = auth.params ?? {};
        this.appId = auth.credential;
        if (!this.appId) {
            throw new Error('Teams auth credential (appId) is required.');
        }
        if (!params.appPassword) {
            throw new Error('Teams auth params must include "appPassword".');
        }
        this.serviceUrl = params.serviceUrl ?? this.serviceUrl;
        this.tenantId = params.tenantId;
        // Dynamic imports
        let MicrosoftAppCredentials; // eslint-disable-line @typescript-eslint/no-explicit-any
        let ConnectorClient; // eslint-disable-line @typescript-eslint/no-explicit-any
        let BotFrameworkAdapter; // eslint-disable-line @typescript-eslint/no-explicit-any
        try {
            const connector = await import('botframework-connector');
            MicrosoftAppCredentials =
                connector.MicrosoftAppCredentials ??
                    connector.default?.MicrosoftAppCredentials;
            ConnectorClient =
                connector.ConnectorClient ??
                    connector.default?.ConnectorClient;
        }
        catch {
            throw new Error('The "botframework-connector" package is required for the Teams adapter. ' +
                'Install it with: npm install botframework-connector');
        }
        try {
            const botbuilder = await import('botbuilder');
            BotFrameworkAdapter =
                botbuilder.BotFrameworkAdapter ??
                    botbuilder.default?.BotFrameworkAdapter;
        }
        catch {
            // botbuilder is optional — needed only for incoming webhook processing
            console.warn('[Teams] "botbuilder" package not found. Incoming message processing ' +
                'will not be available. Install it with: npm install botbuilder');
        }
        // Create credentials
        this.credentials = new MicrosoftAppCredentials(this.appId, params.appPassword);
        if (this.tenantId) {
            this.credentials.oAuthEndpoint = `https://login.microsoftonline.com/${this.tenantId}`;
        }
        // Create connector client
        this.connectorClient = new ConnectorClient(this.credentials, {
            baseUri: this.serviceUrl,
        });
        // Verify credentials by fetching the token
        try {
            await this.credentials.getToken(true);
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            throw new Error(`Teams credential verification failed: ${message}`);
        }
        // Create bot adapter for incoming messages (if botbuilder is available)
        if (BotFrameworkAdapter) {
            this.botAdapter = new BotFrameworkAdapter({
                appId: this.appId,
                appPassword: params.appPassword,
                ...(this.tenantId ? { channelAuthTenant: this.tenantId } : {}),
            });
            // Set up error handler
            this.botAdapter.onTurnError = async (_context, error) => {
                console.error('[Teams] Bot adapter turn error:', error);
                this.emit({
                    type: 'error',
                    platform: 'teams',
                    conversationId: '',
                    timestamp: new Date().toISOString(),
                    data: { error: error.message },
                });
            };
        }
        this.platformInfo = {
            appId: this.appId,
            serviceUrl: this.serviceUrl,
            tenantId: this.tenantId ?? 'multi-tenant',
            hasBotAdapter: !!this.botAdapter,
        };
    }
    async doSendMessage(conversationId, content) {
        if (!this.connectorClient) {
            throw new Error('[Teams] Connector client is not initialized.');
        }
        // Build the activity
        const activity = this.buildActivity(content);
        // Handle threading
        if (content.replyToMessageId) {
            activity.replyToId = content.replyToMessageId;
        }
        try {
            // Send the activity to the conversation
            const response = await this.connectorClient.conversations.sendToConversation(conversationId, activity);
            return {
                messageId: response?.id ?? `teams-${Date.now()}`,
                timestamp: new Date().toISOString(),
            };
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            // Check if we need to use a conversation reference for proactive messaging
            const ref = this.conversationReferences.get(conversationId);
            if (ref && this.botAdapter) {
                return this.sendProactiveMessage(ref, activity);
            }
            throw new Error(`[Teams] Failed to send message: ${message}`);
        }
    }
    async doShutdown() {
        this.connectorClient = undefined;
        this.botAdapter = undefined;
        this.credentials = undefined;
        this.appId = undefined;
        this.conversationReferences.clear();
    }
    // ── IChannelAdapter optional methods ──
    async sendTypingIndicator(conversationId, _isTyping) {
        if (!this.connectorClient)
            return;
        try {
            await this.connectorClient.conversations.sendToConversation(conversationId, { type: 'typing' });
        }
        catch {
            // Non-fatal — typing indicators are best-effort
        }
    }
    async editMessage(conversationId, messageId, content) {
        if (!this.connectorClient) {
            throw new Error('[Teams] Connector client is not initialized.');
        }
        const activity = this.buildActivity(content);
        activity.id = messageId;
        await this.connectorClient.conversations.updateActivity(conversationId, messageId, activity);
    }
    async deleteMessage(conversationId, messageId) {
        if (!this.connectorClient) {
            throw new Error('[Teams] Connector client is not initialized.');
        }
        await this.connectorClient.conversations.deleteActivity(conversationId, messageId);
    }
    // ── Teams-specific public methods ──
    /**
     * Process an incoming Bot Framework request (webhook handler).
     * Call this from your HTTP endpoint that receives Teams webhook POSTs.
     *
     * @param req - HTTP request object.
     * @param res - HTTP response object.
     */
    async processIncomingActivity(req, res) {
        if (!this.botAdapter) {
            throw new Error('[Teams] Bot adapter not available. Install "botbuilder" package.');
        }
        await this.botAdapter.process(req, res, async (context) => {
            await this.handleTurnContext(context);
        });
    }
    /**
     * Store a conversation reference for later proactive messaging.
     * Typically called when first receiving a message from a conversation.
     */
    storeConversationReference(conversationId, reference) {
        this.conversationReferences.set(conversationId, reference);
    }
    /**
     * Create a new conversation with a Teams user (proactive outreach).
     *
     * @param userId - The Teams user ID to start a conversation with.
     * @returns The new conversation ID.
     */
    async createConversation(userId) {
        if (!this.connectorClient || !this.appId) {
            throw new Error('[Teams] Connector client is not initialized.');
        }
        const conversationParams = {
            bot: { id: this.appId },
            members: [{ id: userId }],
            isGroup: false,
            tenantId: this.tenantId,
        };
        const response = await this.connectorClient.conversations.createConversation(conversationParams);
        return response?.id ?? '';
    }
    /**
     * Get the Bot Framework adapter for advanced use cases.
     * Returns undefined if botbuilder is not installed.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getBotAdapter() {
        return this.botAdapter;
    }
    // ── Private: Activity building ──
    buildActivity(content) {
        const activity = {
            type: 'message',
        };
        const textParts = [];
        const attachments = [];
        const entities = [];
        for (const block of content.blocks) {
            switch (block.type) {
                case 'text':
                    textParts.push(block.text);
                    break;
                case 'embed':
                    // Rich text / embeds sent as HTML in Teams
                    if ('text' in block && typeof block.text === 'string') {
                        textParts.push(block.text);
                    }
                    attachments.push(this.buildAdaptiveCardEmbed(block));
                    break;
                case 'image':
                    attachments.push({
                        contentType: block.mimeType ?? 'image/png',
                        contentUrl: block.url,
                        name: block.caption ?? 'image',
                    });
                    if (block.caption) {
                        textParts.push(block.caption);
                    }
                    break;
                case 'document':
                    attachments.push({
                        contentType: block.mimeType ?? 'application/octet-stream',
                        contentUrl: block.url,
                        name: block.filename,
                    });
                    break;
                case 'video':
                    attachments.push({
                        contentType: block.mimeType ?? 'video/mp4',
                        contentUrl: block.url,
                        name: block.caption ?? 'video',
                    });
                    break;
                case 'button_group':
                    // Build an Adaptive Card with actions
                    attachments.push(this.buildAdaptiveCardWithButtons(block.buttons));
                    break;
                case 'poll':
                    attachments.push(this.buildAdaptiveCardPoll(block));
                    break;
                default:
                    // Unsupported block type — skip
                    break;
            }
        }
        if (textParts.length > 0) {
            activity.text = textParts.join('\n\n');
        }
        if (attachments.length > 0) {
            activity.attachments = attachments;
        }
        if (entities.length > 0) {
            activity.entities = entities;
        }
        // Platform options pass-through
        if (content.platformOptions) {
            Object.assign(activity, content.platformOptions);
        }
        return activity;
    }
    /**
     * Build an Adaptive Card attachment containing action buttons.
     */
    buildAdaptiveCardWithButtons(buttons) {
        return {
            contentType: 'application/vnd.microsoft.card.adaptive',
            content: {
                type: 'AdaptiveCard',
                version: '1.4',
                body: [],
                actions: buttons.map((btn) => {
                    if (btn.action === 'url') {
                        return {
                            type: 'Action.OpenUrl',
                            title: btn.label,
                            url: btn.value,
                        };
                    }
                    return {
                        type: 'Action.Submit',
                        title: btn.label,
                        data: { actionId: btn.id, value: btn.value },
                    };
                }),
            },
        };
    }
    /**
     * Build an Adaptive Card for embed-style content.
     */
    buildAdaptiveCardEmbed(block) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const body = [];
        body.push({
            type: 'TextBlock',
            text: block.title,
            weight: 'bolder',
            size: 'medium',
        });
        if (block.description) {
            body.push({
                type: 'TextBlock',
                text: block.description,
                wrap: true,
            });
        }
        if (block.fields) {
            const columns = block.fields.map((f) => ({
                type: 'Column',
                width: f.inline ? 'auto' : 'stretch',
                items: [
                    { type: 'TextBlock', text: f.name, weight: 'bolder', size: 'small' },
                    { type: 'TextBlock', text: f.value, wrap: true },
                ],
            }));
            body.push({
                type: 'ColumnSet',
                columns,
            });
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const actions = [];
        if (block.url) {
            actions.push({
                type: 'Action.OpenUrl',
                title: 'Open Link',
                url: block.url,
            });
        }
        return {
            contentType: 'application/vnd.microsoft.card.adaptive',
            content: {
                type: 'AdaptiveCard',
                version: '1.4',
                body,
                ...(actions.length > 0 ? { actions } : {}),
            },
        };
    }
    /**
     * Build an Adaptive Card for poll content.
     */
    buildAdaptiveCardPoll(block) {
        return {
            contentType: 'application/vnd.microsoft.card.adaptive',
            content: {
                type: 'AdaptiveCard',
                version: '1.4',
                body: [
                    {
                        type: 'TextBlock',
                        text: block.question,
                        weight: 'bolder',
                        size: 'medium',
                        wrap: true,
                    },
                    {
                        type: 'Input.ChoiceSet',
                        id: 'pollChoice',
                        style: 'expanded',
                        choices: block.options.map((opt, idx) => ({
                            title: opt,
                            value: String(idx),
                        })),
                    },
                ],
                actions: [
                    {
                        type: 'Action.Submit',
                        title: 'Vote',
                        data: { action: 'pollVote' },
                    },
                ],
            },
        };
    }
    // ── Private: proactive messaging ──
    async sendProactiveMessage(reference, activity) {
        if (!this.botAdapter) {
            throw new Error('[Teams] Bot adapter required for proactive messaging.');
        }
        return new Promise((resolve, reject) => {
            this.botAdapter.continueConversation(reference, async (context) => {
                try {
                    const response = await context.sendActivity(activity);
                    resolve({
                        messageId: response?.id ?? `teams-${Date.now()}`,
                        timestamp: new Date().toISOString(),
                    });
                }
                catch (err) {
                    reject(err);
                }
            });
        });
    }
    // ── Private: incoming activity processing ──
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async handleTurnContext(context) {
        const activity = context.activity;
        if (!activity)
            return;
        // Store conversation reference for proactive messaging
        const ref = {
            activityId: activity.id,
            user: activity.from,
            bot: activity.recipient,
            conversation: activity.conversation,
            channelId: activity.channelId,
            serviceUrl: activity.serviceUrl,
        };
        this.conversationReferences.set(activity.conversation?.id, ref);
        switch (activity.type) {
            case 'message':
                this.handleIncomingMessage(activity);
                break;
            case 'messageReaction':
                this.handleReaction(activity);
                break;
            case 'conversationUpdate':
                this.handleConversationUpdate(activity);
                break;
            default:
                break;
        }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handleIncomingMessage(activity) {
        const conversationId = activity.conversation?.id ?? 'unknown';
        const isGroup = activity.conversation?.conversationType === 'groupChat' ||
            activity.conversation?.conversationType === 'channel';
        const contentBlocks = [];
        if (activity.text) {
            contentBlocks.push({ type: 'text', text: activity.text });
        }
        // Process attachments
        if (activity.attachments) {
            for (const att of activity.attachments) {
                if (att.contentType?.startsWith('image/')) {
                    contentBlocks.push({
                        type: 'image',
                        url: att.contentUrl ?? '',
                        mimeType: att.contentType,
                        caption: att.name,
                    });
                }
                else if (att.contentUrl) {
                    contentBlocks.push({
                        type: 'document',
                        url: att.contentUrl,
                        filename: att.name ?? 'attachment',
                        mimeType: att.contentType,
                    });
                }
            }
        }
        const message = {
            messageId: activity.id ?? `teams-${Date.now()}`,
            platform: 'teams',
            conversationId,
            conversationType: isGroup ? 'group' : 'direct',
            sender: {
                id: activity.from?.id ?? 'unknown',
                displayName: activity.from?.name,
                username: activity.from?.aadObjectId,
            },
            content: contentBlocks.length > 0 ? contentBlocks : [{ type: 'text', text: '' }],
            text: activity.text ?? '',
            timestamp: activity.timestamp ?? new Date().toISOString(),
            replyToMessageId: activity.replyToId,
            rawEvent: activity,
        };
        this.emit({
            type: 'message',
            platform: 'teams',
            conversationId,
            timestamp: message.timestamp,
            data: message,
        });
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handleReaction(activity) {
        const conversationId = activity.conversation?.id ?? 'unknown';
        if (activity.reactionsAdded) {
            for (const reaction of activity.reactionsAdded) {
                this.emit({
                    type: 'reaction_added',
                    platform: 'teams',
                    conversationId,
                    timestamp: new Date().toISOString(),
                    data: {
                        emoji: reaction.type,
                        messageId: activity.replyToId,
                        sender: {
                            id: activity.from?.id ?? 'unknown',
                            displayName: activity.from?.name,
                        },
                    },
                });
            }
        }
        if (activity.reactionsRemoved) {
            for (const reaction of activity.reactionsRemoved) {
                this.emit({
                    type: 'reaction_removed',
                    platform: 'teams',
                    conversationId,
                    timestamp: new Date().toISOString(),
                    data: {
                        emoji: reaction.type,
                        messageId: activity.replyToId,
                        sender: {
                            id: activity.from?.id ?? 'unknown',
                            displayName: activity.from?.name,
                        },
                    },
                });
            }
        }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handleConversationUpdate(activity) {
        const conversationId = activity.conversation?.id ?? 'unknown';
        if (activity.membersAdded) {
            for (const member of activity.membersAdded) {
                this.emit({
                    type: 'member_joined',
                    platform: 'teams',
                    conversationId,
                    timestamp: new Date().toISOString(),
                    data: {
                        user: {
                            id: member.id,
                            displayName: member.name,
                        },
                    },
                });
            }
        }
        if (activity.membersRemoved) {
            for (const member of activity.membersRemoved) {
                this.emit({
                    type: 'member_left',
                    platform: 'teams',
                    conversationId,
                    timestamp: new Date().toISOString(),
                    data: {
                        user: {
                            id: member.id,
                            displayName: member.name,
                        },
                    },
                });
            }
        }
    }
}
//# sourceMappingURL=TeamsChannelAdapter.js.map