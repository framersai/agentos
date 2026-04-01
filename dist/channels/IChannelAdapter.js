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
export {};
//# sourceMappingURL=IChannelAdapter.js.map