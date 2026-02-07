/**
 * @fileoverview Barrel exports for the AgentOS Channel System.
 * @module @framers/agentos/channels
 */

export * from './types.js';
export type { IChannelAdapter } from './IChannelAdapter.js';
export { ChannelRouter } from './ChannelRouter.js';
export type { InboundMessageHandler, RegisterAdapterOptions } from './ChannelRouter.js';
