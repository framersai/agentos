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
// Telegram Auth Params
// ============================================================================

/** Platform-specific parameters for Telegram connections. */
export interface TelegramAuthParams extends Record<string, string> {
  /** Bot token from BotFather. If provided, overrides credential. */
  botToken?: string;
  /** Webhook URL. If not provided, long polling is used. */
  webhookUrl?: string;
  /** Webhook secret token for verifying incoming updates. */
  webhookSecret?: string;
}

// ============================================================================
// TelegramChannelAdapter
// ============================================================================

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
export class TelegramChannelAdapter extends BaseChannelAdapter<TelegramAuthParams> {
  readonly platform: ChannelPlatform = 'telegram';
  readonly displayName = 'Telegram';
  readonly capabilities: readonly ChannelCapability[] = [
    'text',
    'rich_text',
    'images',
    'video',
    'audio',
    'voice_notes',
    'stickers',
    'reactions',
    'buttons',
    'inline_keyboard',
    'group_chat',
    'channels',
    'editing',
    'deletion',
  ] as const;

  /** Telegraf Bot instance. Typed as `any` because the package is
   *  dynamically imported and may not be installed. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private bot: any | undefined;

  /** SDK module reference for helper access (e.g. Markup). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private sdk: any | undefined;

  /** Whether we are using grammy instead of telegraf. */
  private useGrammy = false;

  /** Track whether bot.launch() was called (for cleanup). */
  private launched = false;

  // ── Abstract hook implementations ──

  protected async doConnect(
    auth: ChannelAuthConfig & { params?: TelegramAuthParams },
  ): Promise<void> {
    const botToken = auth.params?.botToken ?? auth.credential;
    if (!botToken) {
      throw new Error(
        'Telegram bot token is required. Provide it as credential or params.botToken.',
      );
    }

    // Dynamic import — try telegraf first, fall back to grammy
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let TelegrafModule: any;
    try {
      TelegrafModule = await import('telegraf');
      this.useGrammy = false;
    } catch {
      try {
        TelegrafModule = await import('grammy');
        this.useGrammy = true;
      } catch {
        throw new Error(
          'Either "telegraf" or "grammy" package is required for the Telegram adapter. ' +
            'Install one with: npm install telegraf  OR  npm install grammy',
        );
      }
    }

    // Create bot instance
    const BotClass =
      TelegrafModule.Telegraf ??
      TelegrafModule.Bot ??
      TelegrafModule.default?.Telegraf ??
      TelegrafModule.default?.Bot ??
      TelegrafModule.default;

    this.sdk = TelegrafModule;
    this.bot = new BotClass(botToken);

    // Set up inbound message handler
    this.bot.on('message', (ctx: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      this.handleInboundMessage(ctx);
    });

    // Set up callback query handler (inline keyboard buttons)
    this.bot.on('callback_query', (ctx: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      this.handleCallbackQuery(ctx);
    });

    // Launch the bot
    const webhookUrl = auth.params?.webhookUrl;
    if (webhookUrl) {
      // Webhook mode
      const webhookConfig: Record<string, unknown> = {
        domain: new URL(webhookUrl).origin,
        hookPath: new URL(webhookUrl).pathname,
      };
      if (auth.params?.webhookSecret) {
        webhookConfig.secretToken = auth.params.webhookSecret;
      }
      await this.bot.launch({ webhook: webhookConfig });
    } else {
      // Long polling mode
      await this.bot.launch();
    }
    this.launched = true;

    // Fetch bot info for platformInfo
    try {
      const me = this.useGrammy
        ? this.bot.botInfo
        : await this.bot.telegram?.getMe?.();

      this.platformInfo = {
        botId: me?.id,
        botUsername: me?.username,
        botName: me?.first_name,
        mode: webhookUrl ? 'webhook' : 'polling',
      };

      console.log(
        `[Telegram] Connected as @${me?.username ?? 'unknown'} (${webhookUrl ? 'webhook' : 'polling'} mode)`,
      );
    } catch {
      this.platformInfo = { mode: webhookUrl ? 'webhook' : 'polling' };
      console.log(`[Telegram] Connected (${webhookUrl ? 'webhook' : 'polling'} mode)`);
    }
  }

  protected async doSendMessage(
    conversationId: string,
    content: MessageContent,
  ): Promise<ChannelSendResult> {
    if (!this.bot) {
      throw new Error('[Telegram] Bot is not connected.');
    }

    const telegram = this.bot.telegram ?? this.bot.api;
    if (!telegram) {
      throw new Error('[Telegram] Bot API handle not available.');
    }

    const chatId = conversationId;
    const replyParams: Record<string, unknown> = {};
    if (content.replyToMessageId) {
      replyParams.reply_to_message_id = parseInt(content.replyToMessageId, 10);
    }

    let lastMessageId: string | undefined;
    let lastTimestamp: string | undefined;

    for (const block of content.blocks) {
      const result = await this.sendBlock(telegram, chatId, block, replyParams, content);
      if (result) {
        lastMessageId = result.messageId;
        lastTimestamp = result.timestamp;
      }
    }

    if (!lastMessageId) {
      throw new Error('[Telegram] No content blocks produced a sent message.');
    }

    return {
      messageId: lastMessageId,
      timestamp: lastTimestamp,
    };
  }

  protected async doShutdown(): Promise<void> {
    if (this.bot && this.launched) {
      try {
        if (typeof this.bot.stop === 'function') {
          this.bot.stop('AgentOS shutting down');
        }
      } catch {
        // Best effort — bot may already be stopped
      }
    }
    this.bot = undefined;
    this.sdk = undefined;
    this.launched = false;
    console.log('[Telegram] Adapter shut down.');
  }

  // ── IChannelAdapter optional methods ──

  async editMessage(
    conversationId: string,
    messageId: string,
    content: MessageContent,
  ): Promise<void> {
    if (!this.bot) throw new Error('[Telegram] Bot is not connected.');

    const telegram = this.bot.telegram ?? this.bot.api;
    const textBlock = content.blocks.find((b: MessageContentBlock) => b.type === 'text');
    if (textBlock && textBlock.type === 'text') {
      await telegram.editMessageText(
        conversationId,
        parseInt(messageId, 10),
        undefined,
        textBlock.text,
        { parse_mode: 'HTML' },
      );
    }
  }

  async deleteMessage(
    conversationId: string,
    messageId: string,
  ): Promise<void> {
    if (!this.bot) throw new Error('[Telegram] Bot is not connected.');

    const telegram = this.bot.telegram ?? this.bot.api;
    await telegram.deleteMessage(conversationId, parseInt(messageId, 10));
  }

  async addReaction(
    conversationId: string,
    messageId: string,
    emoji: string,
  ): Promise<void> {
    if (!this.bot) throw new Error('[Telegram] Bot is not connected.');

    const telegram = this.bot.telegram ?? this.bot.api;
    try {
      await telegram.setMessageReaction(conversationId, parseInt(messageId, 10), [
        { type: 'emoji', emoji },
      ]);
    } catch (err) {
      console.warn(`[Telegram] Failed to set reaction: ${err}`);
    }
  }

  async sendTypingIndicator(
    conversationId: string,
    _isTyping: boolean,
  ): Promise<void> {
    if (!this.bot) return;

    const telegram = this.bot.telegram ?? this.bot.api;
    try {
      await telegram.sendChatAction(conversationId, 'typing');
    } catch {
      // Non-critical — typing indicators are best-effort
    }
  }

  // ── Private helpers ──

  /**
   * Send a single content block to a Telegram chat.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async sendBlock(
    telegram: any, // eslint-disable-line @typescript-eslint/no-explicit-any
    chatId: string,
    block: MessageContentBlock,
    replyParams: Record<string, unknown>,
    content: MessageContent,
  ): Promise<{ messageId: string; timestamp: string } | undefined> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let msg: any;
    const extra = { ...replyParams, ...(content.platformOptions ?? {}) };

    switch (block.type) {
      case 'text': {
        msg = await telegram.sendMessage(chatId, block.text, {
          ...extra,
          parse_mode: 'HTML',
        });
        break;
      }

      case 'image': {
        msg = await telegram.sendPhoto(chatId, block.url, {
          ...extra,
          caption: block.caption,
        });
        break;
      }

      case 'video': {
        msg = await telegram.sendVideo(chatId, block.url, {
          ...extra,
          caption: block.caption,
        });
        break;
      }

      case 'audio': {
        msg = await telegram.sendAudio(chatId, block.url, {
          ...extra,
          duration: block.duration,
        });
        break;
      }

      case 'document': {
        msg = await telegram.sendDocument(chatId, block.url, {
          ...extra,
          caption: block.filename,
        });
        break;
      }

      case 'sticker': {
        msg = await telegram.sendSticker(chatId, block.stickerId, extra);
        break;
      }

      case 'location': {
        msg = await telegram.sendLocation(
          chatId,
          block.latitude,
          block.longitude,
          extra,
        );
        break;
      }

      case 'button_group': {
        // Build inline keyboard from buttons
        const inlineKeyboard = block.buttons.map((btn) => {
          if (btn.action === 'url') {
            return [{ text: btn.label, url: btn.value }];
          }
          return [{ text: btn.label, callback_data: btn.id }];
        });

        msg = await telegram.sendMessage(
          chatId,
          content.blocks.find((b) => b.type === 'text')?.type === 'text'
            ? (content.blocks.find((b) => b.type === 'text') as { text: string }).text
            : 'Choose an option:',
          {
            ...extra,
            reply_markup: { inline_keyboard: inlineKeyboard },
          },
        );
        break;
      }

      case 'poll': {
        msg = await telegram.sendPoll(chatId, block.question, block.options, extra);
        break;
      }

      default: {
        // Unsupported block type — skip silently
        console.warn(`[Telegram] Unsupported content block type: ${(block as any).type}`); // eslint-disable-line @typescript-eslint/no-explicit-any
        return undefined;
      }
    }

    if (msg) {
      return {
        messageId: String(msg.message_id),
        timestamp: msg.date
          ? new Date(msg.date * 1000).toISOString()
          : new Date().toISOString(),
      };
    }

    return undefined;
  }

  /**
   * Handle inbound messages from Telegram and emit channel events.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private handleInboundMessage(ctx: any): void {
    const msg = ctx.message ?? ctx.update?.message;
    if (!msg) return;

    const chatId = String(msg.chat?.id ?? '');
    const isGroup =
      msg.chat?.type === 'group' ||
      msg.chat?.type === 'supergroup';
    const isChannel = msg.chat?.type === 'channel';

    // Build content blocks from the Telegram message
    const contentBlocks: MessageContentBlock[] = [];

    if (msg.text) {
      contentBlocks.push({ type: 'text', text: msg.text });
    }
    if (msg.caption) {
      contentBlocks.push({ type: 'text', text: msg.caption });
    }
    if (msg.photo && msg.photo.length > 0) {
      // Use largest photo
      const photo = msg.photo[msg.photo.length - 1];
      contentBlocks.push({
        type: 'image',
        url: photo.file_id,
        caption: msg.caption,
      });
    }
    if (msg.video) {
      contentBlocks.push({
        type: 'video',
        url: msg.video.file_id,
        caption: msg.caption,
      });
    }
    if (msg.audio) {
      contentBlocks.push({
        type: 'audio',
        url: msg.audio.file_id,
        duration: msg.audio.duration,
      });
    }
    if (msg.voice) {
      contentBlocks.push({
        type: 'audio',
        url: msg.voice.file_id,
        duration: msg.voice.duration,
      });
    }
    if (msg.document) {
      contentBlocks.push({
        type: 'document',
        url: msg.document.file_id,
        filename: msg.document.file_name ?? 'document',
      });
    }
    if (msg.sticker) {
      contentBlocks.push({
        type: 'sticker',
        stickerId: msg.sticker.file_id,
      });
    }
    if (msg.location) {
      contentBlocks.push({
        type: 'location',
        latitude: msg.location.latitude,
        longitude: msg.location.longitude,
      });
    }

    // Fallback to empty text if no content blocks were extracted
    if (contentBlocks.length === 0) {
      contentBlocks.push({ type: 'text', text: '' });
    }

    const channelMessage: ChannelMessage = {
      messageId: String(msg.message_id),
      platform: 'telegram',
      conversationId: chatId,
      conversationType: isChannel ? 'channel' : isGroup ? 'group' : 'direct',
      sender: {
        id: String(msg.from?.id ?? ''),
        displayName: [msg.from?.first_name, msg.from?.last_name]
          .filter(Boolean)
          .join(' ') || undefined,
        username: msg.from?.username,
      },
      content: contentBlocks,
      text: msg.text ?? msg.caption ?? '',
      timestamp: msg.date
        ? new Date(msg.date * 1000).toISOString()
        : new Date().toISOString(),
      replyToMessageId: msg.reply_to_message
        ? String(msg.reply_to_message.message_id)
        : undefined,
      rawEvent: msg,
    };

    this.emit({
      type: 'message',
      platform: 'telegram',
      conversationId: chatId,
      timestamp: channelMessage.timestamp,
      data: channelMessage,
    });
  }

  /**
   * Handle inline keyboard callback queries.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private handleCallbackQuery(ctx: any): void {
    const query = ctx.callbackQuery ?? ctx.update?.callback_query;
    if (!query) return;

    const chatId = String(query.message?.chat?.id ?? '');

    this.emit({
      type: 'button_callback',
      platform: 'telegram',
      conversationId: chatId,
      timestamp: new Date().toISOString(),
      data: {
        callbackId: query.id,
        buttonId: query.data ?? '',
        sender: {
          id: String(query.from?.id ?? ''),
          displayName: [query.from?.first_name, query.from?.last_name]
            .filter(Boolean)
            .join(' ') || undefined,
          username: query.from?.username,
        },
        messageId: String(query.message?.message_id ?? ''),
      },
    });

    // Answer the callback query to dismiss the loading spinner
    try {
      if (typeof ctx.answerCbQuery === 'function') {
        ctx.answerCbQuery();
      } else if (typeof ctx.answerCallbackQuery === 'function') {
        ctx.answerCallbackQuery();
      }
    } catch {
      // Non-critical
    }
  }
}
