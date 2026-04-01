/**
 * @fileoverview Barrel exports for channel adapter implementations.
 *
 * Provides the abstract {@link BaseChannelAdapter} that all concrete
 * adapters extend, plus all first-party adapter implementations for
 * the P0 core messaging platforms, social media, and extended platforms.
 *
 * @module @framers/agentos/channels/adapters
 */
export { BaseChannelAdapter } from './BaseChannelAdapter.js';
export { IRCChannelAdapter } from './IRCChannelAdapter.js';
// P0: Core messaging platforms
export { TelegramChannelAdapter } from './TelegramChannelAdapter.js';
export { DiscordChannelAdapter } from './DiscordChannelAdapter.js';
export { SlackChannelAdapter } from './SlackChannelAdapter.js';
export { WhatsAppChannelAdapter } from './WhatsAppChannelAdapter.js';
export { WebChatChannelAdapter } from './WebChatChannelAdapter.js';
// P0: Social media platforms
export { TwitterChannelAdapter } from './TwitterChannelAdapter.js';
export { RedditChannelAdapter } from './RedditChannelAdapter.js';
// P1: Extended messaging platforms
export { SignalChannelAdapter } from './SignalChannelAdapter.js';
export { TeamsChannelAdapter } from './TeamsChannelAdapter.js';
export { GoogleChatChannelAdapter } from './GoogleChatChannelAdapter.js';
//# sourceMappingURL=index.js.map