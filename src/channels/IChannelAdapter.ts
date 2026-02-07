/**
 * @fileoverview Interface for external messaging channel adapters.
 *
 * Each supported platform (Telegram, WhatsApp, Discord, etc.) implements
 * this interface. Adapters handle:
 * - Authentication and connection lifecycle
 * - Inbound message reception (platform -> agent)
 * - Outbound message delivery (agent -> platform)
 * - Platform-specific features (typing, reactions, buttons, etc.)
 *
 * Adapters are registered as `messaging-channel` extension descriptors
 * and managed by the {@link ChannelRouter}.
 *
 * @module @framers/agentos/channels/IChannelAdapter
 */

import type {
  ChannelAuthConfig,
  ChannelCapability,
  ChannelConnectionInfo,
  ChannelEventHandler,
  ChannelEventType,
  ChannelMessage,
  ChannelPlatform,
  ChannelSendResult,
  MessageContent,
} from './types.js';

/**
 * Core adapter interface for external messaging channels.
 *
 * Implementors wrap a platform SDK (e.g., grammY for Telegram, discord.js for
 * Discord) and normalize all interactions to this common contract.
 *
 * @example
 * ```typescript
 * class TelegramAdapter implements IChannelAdapter {
 *   readonly platform = 'telegram';
 *   readonly displayName = 'Telegram';
 *   readonly capabilities = ['text', 'images', 'inline_keyboard', 'typing_indicator'];
 *
 *   async initialize(auth: ChannelAuthConfig): Promise<void> {
 *     this.bot = new Bot(auth.credential);
 *     await this.bot.start();
 *   }
 *
 *   async sendMessage(conversationId, content): Promise<ChannelSendResult> {
 *     const textBlock = content.blocks.find(b => b.type === 'text');
 *     const msg = await this.bot.api.sendMessage(conversationId, textBlock.text);
 *     return { messageId: String(msg.message_id) };
 *   }
 *   // ...
 * }
 * ```
 */
export interface IChannelAdapter {
  // ── Identity ──

  /** Platform this adapter serves. */
  readonly platform: ChannelPlatform;

  /** Human-readable display name (e.g., "WhatsApp Business"). */
  readonly displayName: string;

  /** Declared capabilities of this adapter. */
  readonly capabilities: readonly ChannelCapability[];

  // ── Lifecycle ──

  /**
   * Initialize the adapter with authentication credentials.
   * Called once when the extension is activated. Must be idempotent —
   * calling initialize on an already-initialized adapter should reconnect.
   */
  initialize(auth: ChannelAuthConfig): Promise<void>;

  /**
   * Gracefully shut down the adapter, closing connections and releasing
   * resources. Called during extension deactivation or application shutdown.
   */
  shutdown(): Promise<void>;

  /**
   * Get the current connection status and metadata.
   */
  getConnectionInfo(): ChannelConnectionInfo;

  // ── Outbound (Agent -> Platform) ──

  /**
   * Send a message to a conversation on the external platform.
   *
   * @param conversationId - Platform-native conversation/chat ID.
   * @param content - Message content to send.
   * @returns The platform-assigned message ID.
   */
  sendMessage(conversationId: string, content: MessageContent): Promise<ChannelSendResult>;

  /**
   * Send a typing indicator to a conversation. Not all platforms support
   * this — check `capabilities` for `'typing_indicator'`.
   */
  sendTypingIndicator(conversationId: string, isTyping: boolean): Promise<void>;

  // ── Inbound (Platform -> Agent) ──

  /**
   * Register a handler for channel events. Multiple handlers can be
   * registered. Use `eventTypes` to filter which events to receive.
   *
   * @param handler - Callback invoked when an event occurs.
   * @param eventTypes - Optional filter. If omitted, handler receives all events.
   * @returns Unsubscribe function.
   */
  on(handler: ChannelEventHandler, eventTypes?: ChannelEventType[]): () => void;

  // ── Optional Platform Features ──

  /**
   * Edit a previously sent message. Only available if adapter declares
   * the `'editing'` capability.
   */
  editMessage?(conversationId: string, messageId: string, content: MessageContent): Promise<void>;

  /**
   * Delete a previously sent message. Only available if adapter declares
   * the `'deletion'` capability.
   */
  deleteMessage?(conversationId: string, messageId: string): Promise<void>;

  /**
   * Add a reaction to a message. Only available if adapter declares
   * the `'reactions'` capability.
   */
  addReaction?(conversationId: string, messageId: string, emoji: string): Promise<void>;

  /**
   * Get conversation metadata (name, members, etc.). Useful for group chats.
   */
  getConversationInfo?(conversationId: string): Promise<{
    name?: string;
    memberCount?: number;
    isGroup: boolean;
    metadata?: Record<string, unknown>;
  }>;
}
