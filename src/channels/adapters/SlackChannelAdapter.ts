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
// Slack Auth Params
// ============================================================================

/** Platform-specific parameters for Slack connections. */
export interface SlackAuthParams extends Record<string, string> {
  /** Bot token (xoxb-*). If provided, overrides credential. */
  botToken?: string;
  /** Signing secret for verifying Slack requests. */
  signingSecret?: string;
  /** App-level token (xapp-*) for Socket Mode. If omitted, HTTP mode is used. */
  appToken?: string;
  /** Port for HTTP mode (default: '3000'). Ignored when using Socket Mode. */
  port?: string;
}

// ============================================================================
// SlackChannelAdapter
// ============================================================================

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
export class SlackChannelAdapter extends BaseChannelAdapter<SlackAuthParams> {
  readonly platform: ChannelPlatform = 'slack';
  readonly displayName = 'Slack';
  readonly capabilities: readonly ChannelCapability[] = [
    'text',
    'rich_text',
    'images',
    'documents',
    'reactions',
    'threads',
    'mentions',
    'buttons',
    'group_chat',
    'channels',
    'editing',
    'deletion',
  ] as const;

  /** The @slack/bolt App instance. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private app: any | undefined;

  /** Bot user ID, resolved after connection. */
  private botUserId: string | undefined;

  /** Whether socket mode is active. */
  private socketMode = false;

  // ── Abstract hook implementations ──

  protected async doConnect(
    auth: ChannelAuthConfig & { params?: SlackAuthParams },
  ): Promise<void> {
    const botToken = auth.params?.botToken ?? auth.credential;
    if (!botToken) {
      throw new Error(
        'Slack bot token is required. Provide it as credential or params.botToken.',
      );
    }

    const signingSecret = auth.params?.signingSecret;
    const appToken = auth.params?.appToken;

    // Dynamic import
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let BoltModule: any;
    try {
      BoltModule = await import('@slack/bolt');
    } catch {
      throw new Error(
        'The "@slack/bolt" package is required for the Slack adapter. ' +
          'Install it with: npm install @slack/bolt',
      );
    }

    const AppClass = BoltModule.App ?? BoltModule.default?.App ?? BoltModule.default;

    // Build app config
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const appConfig: any = {
      token: botToken,
      signingSecret: signingSecret || undefined,
    };

    // Socket Mode (preferred when appToken is available — no public endpoint needed)
    if (appToken) {
      this.socketMode = true;
      appConfig.socketMode = true;
      appConfig.appToken = appToken;
    } else {
      this.socketMode = false;
      appConfig.port = parseInt(auth.params?.port ?? '3000', 10);
    }

    this.app = new AppClass(appConfig);

    // Wire up event handlers
    this.wireEventHandlers();

    // Start the app
    await this.app.start();

    // Resolve bot identity
    try {
      const authResult = await this.app.client.auth.test({ token: botToken });
      this.botUserId = authResult.user_id;

      this.platformInfo = {
        botId: authResult.user_id,
        botName: authResult.user,
        teamId: authResult.team_id,
        teamName: authResult.team,
        mode: this.socketMode ? 'socket' : 'http',
      };

      console.log(
        `[Slack] Connected as @${authResult.user ?? 'unknown'} in workspace "${authResult.team ?? 'unknown'}" (${this.socketMode ? 'socket' : 'http'} mode)`,
      );
    } catch {
      this.platformInfo = { mode: this.socketMode ? 'socket' : 'http' };
      console.log(`[Slack] Connected (${this.socketMode ? 'socket' : 'http'} mode)`);
    }
  }

  protected async doSendMessage(
    conversationId: string,
    content: MessageContent,
  ): Promise<ChannelSendResult> {
    if (!this.app) {
      throw new Error('[Slack] App is not connected.');
    }

    // Build the message payload
    const payload = this.buildSlackPayload(conversationId, content);

    const result = await this.app.client.chat.postMessage(payload);

    return {
      messageId: result.ts ?? '',
      timestamp: result.ts
        ? new Date(parseFloat(result.ts) * 1000).toISOString()
        : new Date().toISOString(),
    };
  }

  protected async doShutdown(): Promise<void> {
    if (this.app) {
      try {
        await this.app.stop();
      } catch {
        // Best effort
      }
    }
    this.app = undefined;
    this.botUserId = undefined;
    console.log('[Slack] Adapter shut down.');
  }

  // ── IChannelAdapter optional methods ──

  async editMessage(
    conversationId: string,
    messageId: string,
    content: MessageContent,
  ): Promise<void> {
    if (!this.app) throw new Error('[Slack] App is not connected.');

    const textBlock = content.blocks.find((b: MessageContentBlock) => b.type === 'text');
    const text = textBlock && textBlock.type === 'text' ? textBlock.text : '';
    const blocks = this.buildBlockKit(content);

    await this.app.client.chat.update({
      channel: conversationId,
      ts: messageId,
      text,
      blocks: blocks.length > 0 ? blocks : undefined,
    });
  }

  async deleteMessage(
    conversationId: string,
    messageId: string,
  ): Promise<void> {
    if (!this.app) throw new Error('[Slack] App is not connected.');

    await this.app.client.chat.delete({
      channel: conversationId,
      ts: messageId,
    });
  }

  async addReaction(
    conversationId: string,
    messageId: string,
    emoji: string,
  ): Promise<void> {
    if (!this.app) throw new Error('[Slack] App is not connected.');

    // Slack emoji names don't include colons
    const name = emoji.replace(/^:|:$/g, '');
    await this.app.client.reactions.add({
      channel: conversationId,
      timestamp: messageId,
      name,
    });
  }

  async sendTypingIndicator(
    _conversationId: string,
    _isTyping: boolean,
  ): Promise<void> {
    // Slack does not have a native typing indicator API for bots.
    // No-op.
  }

  async getConversationInfo(
    conversationId: string,
  ): Promise<{ name?: string; memberCount?: number; isGroup: boolean; metadata?: Record<string, unknown> }> {
    if (!this.app) throw new Error('[Slack] App is not connected.');

    const result = await this.app.client.conversations.info({
      channel: conversationId,
    });

    const channel = result.channel;
    return {
      name: channel?.name ?? undefined,
      memberCount: channel?.num_members ?? undefined,
      isGroup: channel?.is_group || channel?.is_mpim || channel?.is_channel || false,
      metadata: {
        isChannel: channel?.is_channel,
        isPrivate: channel?.is_private,
        isArchived: channel?.is_archived,
        topic: channel?.topic?.value,
        purpose: channel?.purpose?.value,
      },
    };
  }

  // ── Private helpers ──

  /**
   * Wire up @slack/bolt event handlers for inbound messages.
   */
  private wireEventHandlers(): void {
    if (!this.app) return;

    // Inbound messages
    this.app.message(async (args: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      const { message, event } = args;
      const msg = message ?? event;
      if (!msg) return;

      // Ignore bot's own messages
      if (msg.bot_id || msg.user === this.botUserId) return;

      // Ignore message subtypes that are not actual user messages
      // (e.g., message_changed, message_deleted are handled separately)
      if (msg.subtype && msg.subtype !== 'file_share') return;

      this.handleInboundMessage(msg);
    });

    // Reactions
    this.app.event?.('reaction_added', async (args: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      const { event } = args;
      this.emit({
        type: 'reaction_added',
        platform: 'slack',
        conversationId: event.item?.channel ?? '',
        timestamp: new Date().toISOString(),
        data: {
          messageId: event.item?.ts,
          emoji: event.reaction,
          userId: event.user,
        },
      });
    });

    this.app.event?.('reaction_removed', async (args: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      const { event } = args;
      this.emit({
        type: 'reaction_removed',
        platform: 'slack',
        conversationId: event.item?.channel ?? '',
        timestamp: new Date().toISOString(),
        data: {
          messageId: event.item?.ts,
          emoji: event.reaction,
          userId: event.user,
        },
      });
    });

    // Member join/leave
    this.app.event?.('member_joined_channel', async (args: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      const { event } = args;
      this.emit({
        type: 'member_joined',
        platform: 'slack',
        conversationId: event.channel ?? '',
        timestamp: new Date().toISOString(),
        data: { userId: event.user },
      });
    });

    this.app.event?.('member_left_channel', async (args: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      const { event } = args;
      this.emit({
        type: 'member_left',
        platform: 'slack',
        conversationId: event.channel ?? '',
        timestamp: new Date().toISOString(),
        data: { userId: event.user },
      });
    });

    // Button actions (Block Kit interactive elements)
    this.app.action?.(/.*/, async (args: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      const { action, body } = args;

      this.emit({
        type: 'button_callback',
        platform: 'slack',
        conversationId: body.channel?.id ?? '',
        timestamp: new Date().toISOString(),
        data: {
          callbackId: action.action_id ?? '',
          buttonId: action.value ?? action.action_id ?? '',
          sender: {
            id: body.user?.id ?? '',
            displayName: body.user?.name ?? undefined,
            username: body.user?.username ?? undefined,
          },
          messageId: body.message?.ts ?? '',
        },
      });

      // Acknowledge the action
      try {
        await args.ack?.();
      } catch {
        // Non-critical
      }
    });
  }

  /**
   * Handle an inbound Slack message and emit a channel event.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private handleInboundMessage(msg: any): void {
    const contentBlocks: MessageContentBlock[] = [];

    // Text content
    if (msg.text) {
      contentBlocks.push({ type: 'text', text: msg.text });
    }

    // File attachments
    if (msg.files && Array.isArray(msg.files)) {
      for (const file of msg.files) {
        const mimeType: string = file.mimetype ?? '';
        const url = file.url_private ?? file.permalink ?? '';

        if (mimeType.startsWith('image/')) {
          contentBlocks.push({
            type: 'image',
            url,
            caption: file.title ?? undefined,
            mimeType,
          });
        } else if (mimeType.startsWith('video/')) {
          contentBlocks.push({
            type: 'video',
            url,
            caption: file.title ?? undefined,
            mimeType,
          });
        } else if (mimeType.startsWith('audio/')) {
          contentBlocks.push({
            type: 'audio',
            url,
            mimeType,
          });
        } else {
          contentBlocks.push({
            type: 'document',
            url,
            filename: file.name ?? 'file',
            mimeType: mimeType || undefined,
          });
        }
      }
    }

    if (contentBlocks.length === 0) {
      contentBlocks.push({ type: 'text', text: '' });
    }

    // Determine conversation type
    const isThread = !!msg.thread_ts && msg.thread_ts !== msg.ts;
    const channelType = msg.channel_type;
    const isDM = channelType === 'im';

    const channelMessage: ChannelMessage = {
      messageId: msg.ts ?? '',
      platform: 'slack',
      conversationId: msg.channel ?? '',
      conversationType: isDM
        ? 'direct'
        : isThread
          ? 'thread'
          : 'group',
      sender: {
        id: msg.user ?? '',
        displayName: msg.user_profile?.display_name ?? undefined,
        username: msg.user_profile?.name ?? undefined,
        avatarUrl: msg.user_profile?.image_72 ?? undefined,
      },
      content: contentBlocks,
      text: msg.text ?? '',
      timestamp: msg.ts
        ? new Date(parseFloat(msg.ts) * 1000).toISOString()
        : new Date().toISOString(),
      replyToMessageId: isThread ? msg.thread_ts : undefined,
      rawEvent: msg,
    };

    this.emit({
      type: 'message',
      platform: 'slack',
      conversationId: msg.channel ?? '',
      timestamp: channelMessage.timestamp,
      data: channelMessage,
    });
  }

  /**
   * Build the full Slack API payload for chat.postMessage.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private buildSlackPayload(conversationId: string, content: MessageContent): any {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payload: any = {
      channel: conversationId,
    };

    // Extract plain text for the required `text` fallback field
    const textParts: string[] = [];
    for (const block of content.blocks) {
      if (block.type === 'text') textParts.push(block.text);
    }
    payload.text = textParts.join('\n') || ' ';

    // Build Block Kit blocks
    const blocks = this.buildBlockKit(content);
    if (blocks.length > 0) {
      payload.blocks = blocks;
    }

    // Thread reply
    if (content.replyToMessageId) {
      payload.thread_ts = content.replyToMessageId;
    }

    // Platform options pass-through
    if (content.platformOptions) {
      Object.assign(payload, content.platformOptions);
    }

    return payload;
  }

  /**
   * Build Slack Block Kit blocks from MessageContent.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private buildBlockKit(content: MessageContent): any[] {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const blocks: any[] = [];

    for (const block of content.blocks) {
      switch (block.type) {
        case 'text': {
          blocks.push({
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: block.text,
            },
          });
          break;
        }

        case 'image': {
          blocks.push({
            type: 'image',
            image_url: block.url,
            alt_text: block.caption ?? 'Image',
            ...(block.caption ? { title: { type: 'plain_text', text: block.caption } } : {}),
          });
          break;
        }

        case 'document': {
          // Slack doesn't have a native document block — use a section with a link
          blocks.push({
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `<${block.url}|${block.filename}>`,
            },
          });
          break;
        }

        case 'button_group': {
          const elements = block.buttons.map((btn) => {
            if (btn.action === 'url') {
              return {
                type: 'button',
                text: { type: 'plain_text', text: btn.label },
                url: btn.value,
                action_id: btn.id,
              };
            }
            return {
              type: 'button',
              text: { type: 'plain_text', text: btn.label },
              value: btn.value,
              action_id: btn.id,
            };
          });

          blocks.push({
            type: 'actions',
            elements,
          });
          break;
        }

        case 'embed': {
          // Render embed as a rich section
          const parts: string[] = [];
          if (block.title) {
            parts.push(block.url ? `*<${block.url}|${block.title}>*` : `*${block.title}*`);
          }
          if (block.description) {
            parts.push(block.description);
          }
          if (block.fields) {
            for (const field of block.fields) {
              parts.push(`*${field.name}*: ${field.value}`);
            }
          }

          if (parts.length > 0) {
            blocks.push({
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: parts.join('\n'),
              },
            });
          }
          break;
        }

        case 'poll': {
          // Slack doesn't have native polls — render as a section with options
          const optionLines = block.options
            .map((opt, i) => `:${i + 1}: ${opt}`)
            .join('\n');
          blocks.push({
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*${block.question}*\n${optionLines}`,
            },
          });
          break;
        }

        default:
          // Skip unsupported block types
          break;
      }
    }

    return blocks;
  }
}
