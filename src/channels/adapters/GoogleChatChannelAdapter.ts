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

import type {
  ChannelAuthConfig,
  ChannelCapability,
  ChannelMessage,
  ChannelPlatform,
  ChannelSendResult,
  MessageContent,
  MessageContentBlock,
} from '../types.js';
import { BaseChannelAdapter } from './BaseChannelAdapter.js';

// ============================================================================
// Google Chat Auth Params
// ============================================================================

/** Platform-specific authentication parameters for Google Chat. */
export interface GoogleChatAuthParams extends Record<string, string | undefined> {
  /**
   * Inline JSON credentials for the service account.
   * Provide this OR use `credential` as a path to the key file.
   */
  credentials?: string;
  /**
   * Space name to listen in (e.g., 'spaces/AAAA...').
   * Optional — the adapter can send to any space when given a conversation ID.
   */
  defaultSpace?: string;
}

// ============================================================================
// Google Chat Card Types (simplified)
// ============================================================================

interface GoogleChatCard {
  header?: {
    title: string;
    subtitle?: string;
    imageUrl?: string;
    imageType?: string;
  };
  sections: Array<{
    header?: string;
    widgets: Array<Record<string, unknown>>;
  }>;
}

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
export class GoogleChatChannelAdapter extends BaseChannelAdapter<GoogleChatAuthParams> {
  readonly platform: ChannelPlatform = 'google-chat';
  readonly displayName = 'Google Chat';
  readonly capabilities: readonly ChannelCapability[] = [
    'text',
    'rich_text',
    'images',
    'buttons',
    'threads',
    'reactions',
    'group_chat',
  ] as const;

  /** Google Chat API client. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private chatClient: any | undefined;

  /** Google Auth client. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private authClient: any | undefined;

  /** Default space to operate in. */
  private defaultSpace: string | undefined;

  /** Bot identity info. */
  private botInfo: { name: string; displayName: string } | undefined;

  /** Polling for space messages (Google Chat push is webhook-based,
   *  so polling is the fallback for non-webhook setups). */
  private pollTimer: ReturnType<typeof setInterval> | undefined;
  private lastPollTimestamp: string | undefined;

  // ── Abstract hook implementations ──

  protected async doConnect(
    auth: ChannelAuthConfig & { params?: GoogleChatAuthParams },
  ): Promise<void> {
    const params = auth.params ?? ({} as GoogleChatAuthParams);
    this.defaultSpace = params.defaultSpace;

    // Dynamic import of googleapis
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let google: any;
    try {
      const googleapis = await import('googleapis');
      google = googleapis.google ?? googleapis.default?.google ?? googleapis;
    } catch {
      throw new Error(
        'The "googleapis" package is required for the Google Chat adapter. ' +
          'Install it with: npm install googleapis',
      );
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
      } else if (auth.credential) {
        // File path to service account key
        this.authClient = new google.auth.GoogleAuth({
          keyFile: auth.credential,
          scopes: ['https://www.googleapis.com/auth/chat.bot'],
        });
      } else {
        throw new Error(
          'Google Chat authentication requires either a service account ' +
            'key file path (credential) or inline credentials (params.credentials).',
        );
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
      } catch {
        // Bot identity fetch is best-effort
      }
    } catch (err: unknown) {
      if (err instanceof SyntaxError) {
        throw new Error(
          'Invalid JSON in Google Chat credentials. Ensure the credentials ' +
            'param contains valid service account JSON.',
        );
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

  protected async doSendMessage(
    conversationId: string,
    content: MessageContent,
  ): Promise<ChannelSendResult> {
    if (!this.chatClient) {
      throw new Error('[Google Chat] API client is not initialized.');
    }

    // Resolve the space name
    const spaceName = this.resolveSpaceName(conversationId);

    // Build the message payload
    const messagePayload = this.buildMessagePayload(content);

    // Build request parameters
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const requestParams: any = {
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
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`[Google Chat] Failed to send message to ${spaceName}: ${message}`);
    }
  }

  protected async doShutdown(): Promise<void> {
    this.stopPolling();
    this.chatClient = undefined;
    this.authClient = undefined;
    this.defaultSpace = undefined;
    this.botInfo = undefined;
    this.lastPollTimestamp = undefined;
  }

  // ── IChannelAdapter optional methods ──

  async editMessage(
    conversationId: string,
    messageId: string,
    content: MessageContent,
  ): Promise<void> {
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

  async deleteMessage(_conversationId: string, messageId: string): Promise<void> {
    if (!this.chatClient) {
      throw new Error('[Google Chat] API client is not initialized.');
    }

    await this.chatClient.spaces.messages.delete({
      name: messageId,
    });
  }

  async addReaction(
    _conversationId: string,
    messageId: string,
    emoji: string,
  ): Promise<void> {
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
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[Google Chat] Failed to add reaction: ${message}`);
    }
  }

  async getConversationInfo(
    conversationId: string,
  ): Promise<{ name?: string; memberCount?: number; isGroup: boolean; metadata?: Record<string, unknown> }> {
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

      let memberCount: number | undefined;
      try {
        const members = await this.chatClient.spaces.members.list({
          parent: spaceName,
          pageSize: 1,
        });
        // The API doesn't return total count directly in the list
        // but we can check if there are members
        memberCount = members.data?.memberships?.length;
      } catch {
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
    } catch (err: unknown) {
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
  async processWebhookEvent(event: any): Promise<void> {
    if (!event?.type) return;

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
  async listSpaces(): Promise<Array<{ name: string; displayName: string; type: string }>> {
    if (!this.chatClient) {
      throw new Error('[Google Chat] API client is not initialized.');
    }

    const response = await this.chatClient.spaces.list({
      pageSize: 100,
    });

    return (response.data?.spaces ?? []).map((space: any) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
      name: space.name ?? '',
      displayName: space.displayName ?? '',
      type: space.type ?? 'UNKNOWN',
    }));
  }

  // ── Private: message building ──

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private buildMessagePayload(content: MessageContent): any {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payload: any = {};

    const textParts: string[] = [];
    const cards: GoogleChatCard[] = [];

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

        case 'embed':
          cards.push(this.buildEmbedCard(block));
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

  private buildEmbedCard(
    block: Extract<MessageContentBlock, { type: 'embed' }>,
  ): GoogleChatCard {
    const widgets: Array<Record<string, unknown>> = [];

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

  private buildPollCard(
    block: Extract<MessageContentBlock, { type: 'poll' }>,
  ): GoogleChatCard {
    const widgets: Array<Record<string, unknown>> = [];

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

  private resolveSpaceName(conversationId: string): string {
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

    throw new Error(
      '[Google Chat] Cannot resolve space name from conversation ID. ' +
        'Provide a full space name (e.g., "spaces/AAAA...") or set defaultSpace.',
    );
  }

  // ── Private: incoming event handlers ──

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private handleIncomingMessage(event: any): void {
    const msg = event.message;
    if (!msg) return;

    const spaceName = event.space?.name ?? 'unknown';
    const isGroup = event.space?.type === 'ROOM' || event.space?.type === 'GROUP_CHAT';

    const contentBlocks: MessageContentBlock[] = [];

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
        } else {
          contentBlocks.push({
            type: 'document',
            url: att.downloadUri ?? att.attachmentDataRef?.resourceName ?? '',
            filename: att.source ?? 'attachment',
            mimeType: att.contentType,
          });
        }
      }
    }

    const message: ChannelMessage = {
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
  private handleAddedToSpace(event: any): void {
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
  private handleRemovedFromSpace(event: any): void {
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
  private handleCardClicked(event: any): void {
    const spaceName = event.space?.name ?? 'unknown';
    const action = event.action;

    if (!action) return;

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

  private startPolling(): void {
    if (!this.defaultSpace) return;

    // Poll every 30 seconds for new messages in the default space
    this.pollTimer = setInterval(() => {
      this.pollSpace().catch((err) => {
        console.warn('[Google Chat] Space poll error:', err);
      });
    }, 30_000);
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
  }

  private async pollSpace(): Promise<void> {
    if (!this.chatClient || !this.defaultSpace) return;

    try {
      const spaceName = this.resolveSpaceName(this.defaultSpace);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const params: any = {
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
        if (msg.sender?.type === 'BOT') continue;

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
    } catch {
      // Non-fatal — will retry on next poll
    }
  }
}
