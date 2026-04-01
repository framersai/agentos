/**
 * Barrel exports for the AgentOS Channel System.
 *
 * @module @framers/agentos/channels
 */
export * from './types.js';
export { ChannelRouter } from './ChannelRouter.js';
// Phase 4: Adapter implementations — base class + 13 platform adapters
export { BaseChannelAdapter } from './adapters/BaseChannelAdapter.js';
// P0 Core Messaging
export { TelegramChannelAdapter } from './adapters/TelegramChannelAdapter.js';
export { DiscordChannelAdapter } from './adapters/DiscordChannelAdapter.js';
export { SlackChannelAdapter } from './adapters/SlackChannelAdapter.js';
export { WhatsAppChannelAdapter } from './adapters/WhatsAppChannelAdapter.js';
export { WebChatChannelAdapter } from './adapters/WebChatChannelAdapter.js';
// P0 Social Media
export { TwitterChannelAdapter } from './adapters/TwitterChannelAdapter.js';
export { RedditChannelAdapter } from './adapters/RedditChannelAdapter.js';
// P1 Extended Messaging
export { IRCChannelAdapter } from './adapters/IRCChannelAdapter.js';
export { SignalChannelAdapter } from './adapters/SignalChannelAdapter.js';
export { TeamsChannelAdapter } from './adapters/TeamsChannelAdapter.js';
export { GoogleChatChannelAdapter } from './adapters/GoogleChatChannelAdapter.js';
//# sourceMappingURL=index.js.map