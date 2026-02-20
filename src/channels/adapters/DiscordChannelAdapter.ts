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
// Discord Auth Params
// ============================================================================

/** Platform-specific parameters for Discord connections. */
export interface DiscordAuthParams extends Record<string, string> {
  /** Bot token. If provided, overrides credential. */
  botToken?: string;
  /** Discord application ID. */
  applicationId?: string;
  /** Optional guild (server) ID to scope interactions to a single guild. */
  guildId?: string;
  /** Comma-separated list of additional gateway intents. */
  intents?: string;
}

// ============================================================================
// DiscordChannelAdapter
// ============================================================================

/**
 * Channel adapter for Discord using the discord.js SDK.
 *
 * Uses dynamic import so `discord.js` is only required at runtime when the
 * adapter is actually initialized.
 *
 * Capabilities: text, rich_text, images, video, audio, embeds, reactions,
 * threads, mentions, buttons, group_chat, channels, editing, deletion.
 */
export class DiscordChannelAdapter extends BaseChannelAdapter<DiscordAuthParams> {
  readonly platform: ChannelPlatform = 'discord';
  readonly displayName = 'Discord';
  readonly capabilities: readonly ChannelCapability[] = [
    'text',
    'rich_text',
    'images',
    'video',
    'audio',
    'embeds',
    'reactions',
    'threads',
    'mentions',
    'buttons',
    'group_chat',
    'channels',
    'editing',
    'deletion',
  ] as const;

  /** The discord.js Client instance. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private client: any | undefined;

  /** discord.js module reference for building embeds, buttons, etc. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private djs: any | undefined;

  // ── Abstract hook implementations ──

  protected async doConnect(
    auth: ChannelAuthConfig & { params?: DiscordAuthParams },
  ): Promise<void> {
    const botToken = auth.params?.botToken ?? auth.credential;
    if (!botToken) {
      throw new Error(
        'Discord bot token is required. Provide it as credential or params.botToken.',
      );
    }

    // Dynamic import
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let discordJs: any;
    try {
      discordJs = await import('discord.js');
    } catch {
      throw new Error(
        'The "discord.js" package is required for the Discord adapter. ' +
          'Install it with: npm install discord.js',
      );
    }
    this.djs = discordJs;

    // Build intents — we need at minimum Guilds, GuildMessages, MessageContent, DirectMessages
    const {
      GatewayIntentBits,
      Client,
      Partials,
    } = discordJs;

    const intentFlags = [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.GuildMessageReactions,
    ];

    // Parse any additional intents from params
    if (auth.params?.intents) {
      const extraIntents = auth.params.intents.split(',').map((i) => i.trim());
      for (const intentName of extraIntents) {
        if (GatewayIntentBits[intentName] !== undefined) {
          intentFlags.push(GatewayIntentBits[intentName]);
        }
      }
    }

    this.client = new Client({
      intents: intentFlags,
      partials: [Partials?.Channel, Partials?.Message, Partials?.Reaction].filter(Boolean),
    });

    // Set up event handlers before login
    this.wireEventHandlers();

    // Login and await the ready event
    await new Promise<void>((resolve, reject) => {
      const readyTimeout = setTimeout(() => {
        reject(new Error('Discord client ready timeout after 30s'));
      }, 30_000);

      this.client.once('ready', () => {
        clearTimeout(readyTimeout);
        resolve();
      });

      this.client.once('error', (err: Error) => {
        clearTimeout(readyTimeout);
        reject(err);
      });

      this.client.login(botToken).catch((err: Error) => {
        clearTimeout(readyTimeout);
        reject(err);
      });
    });

    // Populate platform info
    const user = this.client.user;
    this.platformInfo = {
      botId: user?.id,
      botUsername: user?.username,
      botTag: user?.tag,
      applicationId: auth.params?.applicationId,
      guildId: auth.params?.guildId,
      guildCount: this.client.guilds?.cache?.size,
    };

    console.log(
      `[Discord] Connected as ${user?.tag ?? 'unknown'} (${this.client.guilds?.cache?.size ?? 0} guilds)`,
    );
  }

  protected async doSendMessage(
    conversationId: string,
    content: MessageContent,
  ): Promise<ChannelSendResult> {
    if (!this.client || !this.djs) {
      throw new Error('[Discord] Client is not connected.');
    }

    // Resolve channel
    const channel = await this.client.channels.fetch(conversationId).catch(() => null);
    if (!channel) {
      throw new Error(`[Discord] Channel ${conversationId} not found.`);
    }

    if (typeof channel.send !== 'function') {
      throw new Error(`[Discord] Channel ${conversationId} is not a text channel.`);
    }

    // Build message payload
    const payload = this.buildMessagePayload(content);

    // If replying to a message, set the reply reference
    if (content.replyToMessageId) {
      payload.reply = { messageReference: content.replyToMessageId };
    }

    const msg = await channel.send(payload);

    return {
      messageId: msg.id,
      timestamp: msg.createdAt?.toISOString() ?? new Date().toISOString(),
    };
  }

  protected async doShutdown(): Promise<void> {
    if (this.client) {
      try {
        this.client.destroy();
      } catch {
        // Best effort
      }
    }
    this.client = undefined;
    this.djs = undefined;
    console.log('[Discord] Adapter shut down.');
  }

  // ── IChannelAdapter optional methods ──

  async editMessage(
    conversationId: string,
    messageId: string,
    content: MessageContent,
  ): Promise<void> {
    if (!this.client) throw new Error('[Discord] Client is not connected.');

    const channel = await this.client.channels.fetch(conversationId).catch(() => null);
    if (!channel || typeof channel.messages?.fetch !== 'function') {
      throw new Error(`[Discord] Channel ${conversationId} not found or not a text channel.`);
    }

    const msg = await channel.messages.fetch(messageId);
    if (!msg) throw new Error(`[Discord] Message ${messageId} not found.`);

    const payload = this.buildMessagePayload(content);
    await msg.edit(payload);
  }

  async deleteMessage(
    conversationId: string,
    messageId: string,
  ): Promise<void> {
    if (!this.client) throw new Error('[Discord] Client is not connected.');

    const channel = await this.client.channels.fetch(conversationId).catch(() => null);
    if (!channel || typeof channel.messages?.fetch !== 'function') {
      throw new Error(`[Discord] Channel ${conversationId} not found or not a text channel.`);
    }

    const msg = await channel.messages.fetch(messageId);
    if (msg) await msg.delete();
  }

  async addReaction(
    conversationId: string,
    messageId: string,
    emoji: string,
  ): Promise<void> {
    if (!this.client) throw new Error('[Discord] Client is not connected.');

    const channel = await this.client.channels.fetch(conversationId).catch(() => null);
    if (!channel || typeof channel.messages?.fetch !== 'function') return;

    const msg = await channel.messages.fetch(messageId);
    if (msg) await msg.react(emoji);
  }

  async sendTypingIndicator(
    conversationId: string,
    _isTyping: boolean,
  ): Promise<void> {
    if (!this.client) return;

    try {
      const channel = await this.client.channels.fetch(conversationId).catch(() => null);
      if (channel && typeof channel.sendTyping === 'function') {
        await channel.sendTyping();
      }
    } catch {
      // Non-critical
    }
  }

  async getConversationInfo(
    conversationId: string,
  ): Promise<{ name?: string; memberCount?: number; isGroup: boolean; metadata?: Record<string, unknown> }> {
    if (!this.client) throw new Error('[Discord] Client is not connected.');

    const channel = await this.client.channels.fetch(conversationId).catch(() => null);
    if (!channel) {
      throw new Error(`[Discord] Channel ${conversationId} not found.`);
    }

    return {
      name: channel.name ?? undefined,
      memberCount: channel.members?.size ?? channel.guild?.memberCount,
      isGroup: channel.type !== 1, // DM channel type is 1
      metadata: {
        type: channel.type,
        guildId: channel.guildId ?? undefined,
        guildName: channel.guild?.name ?? undefined,
        topic: channel.topic ?? undefined,
      },
    };
  }

  // ── Private helpers ──

  /**
   * Wire up discord.js event handlers for inbound messages and interactions.
   */
  private wireEventHandlers(): void {
    if (!this.client) return;

    // Inbound messages
    this.client.on('messageCreate', (msg: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      // Ignore messages from self
      if (msg.author?.bot && msg.author?.id === this.client?.user?.id) return;

      this.handleInboundMessage(msg);
    });

    // Message edits
    this.client.on('messageUpdate', (_old: any, updated: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      if (updated.author?.bot && updated.author?.id === this.client?.user?.id) return;

      this.emit({
        type: 'message_edited',
        platform: 'discord',
        conversationId: updated.channelId ?? '',
        timestamp: updated.editedAt?.toISOString() ?? new Date().toISOString(),
        data: {
          messageId: updated.id,
          newContent: updated.content,
        },
      });
    });

    // Message deletions
    this.client.on('messageDelete', (msg: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      this.emit({
        type: 'message_deleted',
        platform: 'discord',
        conversationId: msg.channelId ?? '',
        timestamp: new Date().toISOString(),
        data: { messageId: msg.id },
      });
    });

    // Reaction add
    this.client.on('messageReactionAdd', (reaction: any, user: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      this.emit({
        type: 'reaction_added',
        platform: 'discord',
        conversationId: reaction.message?.channelId ?? '',
        timestamp: new Date().toISOString(),
        data: {
          messageId: reaction.message?.id,
          emoji: reaction.emoji?.name ?? reaction.emoji?.toString(),
          userId: user?.id,
        },
      });
    });

    // Reaction remove
    this.client.on('messageReactionRemove', (reaction: any, user: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      this.emit({
        type: 'reaction_removed',
        platform: 'discord',
        conversationId: reaction.message?.channelId ?? '',
        timestamp: new Date().toISOString(),
        data: {
          messageId: reaction.message?.id,
          emoji: reaction.emoji?.name ?? reaction.emoji?.toString(),
          userId: user?.id,
        },
      });
    });

    // Interaction (button clicks, etc.)
    this.client.on('interactionCreate', (interaction: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      if (interaction.isButton?.()) {
        this.emit({
          type: 'button_callback',
          platform: 'discord',
          conversationId: interaction.channelId ?? '',
          timestamp: new Date().toISOString(),
          data: {
            callbackId: interaction.id,
            buttonId: interaction.customId,
            sender: {
              id: interaction.user?.id ?? '',
              displayName: interaction.user?.displayName ?? interaction.user?.username,
              username: interaction.user?.username,
            },
            messageId: interaction.message?.id ?? '',
          },
        });

        // Acknowledge the interaction
        try {
          interaction.deferUpdate?.();
        } catch {
          // Non-critical
        }
      }
    });

    // Connection events
    this.client.on('disconnect', () => {
      if (this.status === 'connected') {
        this.setStatus('reconnecting', 'Connection lost');
        this.reconnect().catch((e) => {
          console.error('[Discord] Reconnect failed:', e);
        });
      }
    });
  }

  /**
   * Handle an inbound discord.js Message and emit a channel event.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private handleInboundMessage(msg: any): void {
    const contentBlocks: MessageContentBlock[] = [];

    // Text content
    if (msg.content) {
      contentBlocks.push({ type: 'text', text: msg.content });
    }

    // Attachments (images, video, audio, documents)
    if (msg.attachments?.size > 0) {
      for (const [, attachment] of msg.attachments) {
        const contentType: string = attachment.contentType ?? '';
        if (contentType.startsWith('image/')) {
          contentBlocks.push({
            type: 'image',
            url: attachment.url,
            caption: attachment.description ?? undefined,
            mimeType: contentType,
          });
        } else if (contentType.startsWith('video/')) {
          contentBlocks.push({
            type: 'video',
            url: attachment.url,
            mimeType: contentType,
          });
        } else if (contentType.startsWith('audio/')) {
          contentBlocks.push({
            type: 'audio',
            url: attachment.url,
            mimeType: contentType,
          });
        } else {
          contentBlocks.push({
            type: 'document',
            url: attachment.url,
            filename: attachment.name ?? 'attachment',
            mimeType: contentType || undefined,
          });
        }
      }
    }

    // Embeds (pass through as text summaries)
    if (msg.embeds?.length > 0) {
      for (const embed of msg.embeds) {
        if (embed.description) {
          contentBlocks.push({ type: 'text', text: embed.description });
        }
      }
    }

    // Stickers
    if (msg.stickers?.size > 0) {
      for (const [, sticker] of msg.stickers) {
        contentBlocks.push({
          type: 'sticker',
          stickerId: sticker.id,
          url: sticker.url,
        });
      }
    }

    if (contentBlocks.length === 0) {
      contentBlocks.push({ type: 'text', text: '' });
    }

    // Determine conversation type
    // discord.js channel types: 0=GuildText, 1=DM, 2=GuildVoice, 5=GuildAnnouncement, 11=PublicThread, etc.
    const channelType = msg.channel?.type;
    const isDM = channelType === 1;
    const isThread = channelType === 11 || channelType === 12;

    const channelMessage: ChannelMessage = {
      messageId: msg.id,
      platform: 'discord',
      conversationId: msg.channelId ?? '',
      conversationType: isDM ? 'direct' : isThread ? 'thread' : 'group',
      sender: {
        id: msg.author?.id ?? '',
        displayName: msg.member?.displayName ?? msg.author?.displayName ?? msg.author?.username,
        username: msg.author?.username,
        avatarUrl: msg.author?.displayAvatarURL?.() ?? undefined,
      },
      content: contentBlocks,
      text: msg.content ?? '',
      timestamp: msg.createdAt?.toISOString() ?? new Date().toISOString(),
      replyToMessageId: msg.reference?.messageId ?? undefined,
      rawEvent: msg,
    };

    this.emit({
      type: 'message',
      platform: 'discord',
      conversationId: msg.channelId ?? '',
      timestamp: channelMessage.timestamp,
      data: channelMessage,
    });
  }

  /**
   * Build a discord.js message payload from MessageContent.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private buildMessagePayload(content: MessageContent): any {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payload: any = {};
    const embeds: any[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any
    const files: any[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any
    const components: any[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any

    for (const block of content.blocks) {
      switch (block.type) {
        case 'text': {
          // Append to content string (discord.js uses a single `content` field)
          payload.content = payload.content
            ? `${payload.content}\n${block.text}`
            : block.text;
          break;
        }

        case 'embed': {
          const embed: Record<string, unknown> = {
            title: block.title,
            description: block.description,
            url: block.url,
          };
          if (block.color) {
            embed.color = parseInt(block.color.replace('#', ''), 16);
          }
          if (block.fields) {
            embed.fields = block.fields.map((f) => ({
              name: f.name,
              value: f.value,
              inline: f.inline ?? false,
            }));
          }
          embeds.push(embed);
          break;
        }

        case 'image': {
          if (block.url.startsWith('http')) {
            embeds.push({
              image: { url: block.url },
              description: block.caption,
            });
          } else {
            files.push({ attachment: block.url, name: 'image.png' });
          }
          break;
        }

        case 'video':
        case 'audio':
        case 'document': {
          files.push({
            attachment: block.url,
            name: block.type === 'document'
              ? (block as any).filename ?? 'file' // eslint-disable-line @typescript-eslint/no-explicit-any
              : `${block.type}.${block.url.split('.').pop() ?? 'bin'}`,
          });
          break;
        }

        case 'button_group': {
          if (this.djs) {
            try {
              const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = this.djs;
              const row = new ActionRowBuilder();

              for (const btn of block.buttons) {
                const button = new ButtonBuilder()
                  .setLabel(btn.label);

                if (btn.action === 'url') {
                  button.setStyle(ButtonStyle.Link).setURL(btn.value);
                } else {
                  button.setStyle(ButtonStyle.Primary).setCustomId(btn.id);
                }

                row.addComponents(button);
              }

              components.push(row);
            } catch {
              // Fall back to text representation if button builders fail
              const buttonText = block.buttons
                .map((b) => `[${b.label}](${b.value})`)
                .join(' | ');
              payload.content = payload.content
                ? `${payload.content}\n${buttonText}`
                : buttonText;
            }
          }
          break;
        }

        default:
          // Unsupported block type
          console.warn(`[Discord] Unsupported content block type: ${(block as any).type}`); // eslint-disable-line @typescript-eslint/no-explicit-any
          break;
      }
    }

    if (embeds.length > 0) payload.embeds = embeds;
    if (files.length > 0) payload.files = files;
    if (components.length > 0) payload.components = components;

    // Apply any platform-specific options
    if (content.platformOptions) {
      Object.assign(payload, content.platformOptions);
    }

    return payload;
  }
}
