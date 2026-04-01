/**
 * @fileoverview WhatsApp Channel Adapter for AgentOS.
 *
 * Supports two connection modes:
 *
 * 1. **Twilio WhatsApp API** — Uses the `twilio` npm package. Messages are
 *    sent via the Twilio REST API and inbound messages arrive via webhooks.
 * 2. **WhatsApp Business API (Cloud API)** — Uses direct HTTP calls to the
 *    Meta Graph API. No third-party SDK required.
 *
 * In both modes, the adapter requires a webhook endpoint to be configured
 * externally (e.g., an Express/Fastify route) that forwards incoming HTTP
 * requests to {@link handleIncomingWebhook}.
 *
 * **Dependencies**: For Twilio mode, requires the `twilio` package. For
 * Cloud API mode, no external dependencies are needed (uses native fetch).
 *
 * @example
 * ```typescript
 * // Twilio mode
 * const wa = new WhatsAppChannelAdapter();
 * await wa.initialize({
 *   platform: 'whatsapp',
 *   credential: 'TWILIO_AUTH_TOKEN',
 *   params: {
 *     provider: 'twilio',
 *     accountSid: 'ACXXXXXXX',
 *     authToken: 'TWILIO_AUTH_TOKEN',
 *     phoneNumber: '+14155238886',
 *   },
 * });
 *
 * // Cloud API mode
 * await wa.initialize({
 *   platform: 'whatsapp',
 *   credential: 'WHATSAPP_BUSINESS_TOKEN',
 *   params: {
 *     provider: 'cloud-api',
 *     businessApiToken: 'WHATSAPP_BUSINESS_TOKEN',
 *     phoneNumberId: '1234567890',
 *     verifyToken: 'MY_VERIFY_TOKEN',
 *   },
 * });
 * ```
 *
 * @module @framers/agentos/channels/adapters/WhatsAppChannelAdapter
 */
import type { ChannelAuthConfig, ChannelCapability, ChannelPlatform, ChannelSendResult, MessageContent } from '../types.js';
import { BaseChannelAdapter } from './BaseChannelAdapter.js';
/** Platform-specific parameters for WhatsApp connections. */
export interface WhatsAppAuthParams extends Record<string, string | undefined> {
    /** Provider backend: 'twilio' or 'cloud-api'. Defaults to 'twilio'. */
    provider?: string;
    /** Twilio Account SID. */
    accountSid?: string;
    /** Twilio Auth Token. If provided, overrides credential. */
    authToken?: string;
    /** Twilio WhatsApp-enabled phone number (e.g., 'whatsapp:+14155238886'). */
    phoneNumber?: string;
    /** WhatsApp Business API access token. If provided, overrides credential. */
    businessApiToken?: string;
    /** Phone Number ID from the WhatsApp Business Platform. */
    phoneNumberId?: string;
    /** Graph API version (default: 'v21.0'). */
    apiVersion?: string;
    /** Verify token for webhook validation. */
    verifyToken?: string;
}
/**
 * Channel adapter for WhatsApp supporting both Twilio and Meta Cloud API.
 *
 * This adapter does NOT start its own HTTP server. Instead, the host
 * application must configure a webhook route and call
 * {@link handleIncomingWebhook} with the raw request body.
 *
 * Capabilities: text, images, video, audio, voice_notes, documents,
 * reactions, buttons, group_chat.
 */
export declare class WhatsAppChannelAdapter extends BaseChannelAdapter<WhatsAppAuthParams> {
    readonly platform: ChannelPlatform;
    readonly displayName = "WhatsApp";
    readonly capabilities: readonly ChannelCapability[];
    /** Twilio client instance (when using Twilio provider). */
    private twilioClient;
    /** Provider mode. */
    private provider;
    /** Stored credentials for API calls. */
    private phoneNumber;
    private phoneNumberId;
    private businessApiToken;
    private graphApiVersion;
    private verifyToken;
    protected doConnect(auth: ChannelAuthConfig & {
        params?: WhatsAppAuthParams;
    }): Promise<void>;
    protected doSendMessage(conversationId: string, content: MessageContent): Promise<ChannelSendResult>;
    protected doShutdown(): Promise<void>;
    addReaction(conversationId: string, messageId: string, emoji: string): Promise<void>;
    /**
     * Handle an incoming webhook request from WhatsApp (Twilio or Cloud API).
     *
     * The host application should forward the raw request body to this method.
     * For Cloud API, this also handles webhook verification (GET requests
     * with `hub.mode=subscribe`).
     *
     * @param body - Parsed JSON body of the webhook request.
     * @param queryParams - Query parameters (for Cloud API verification).
     * @returns Verification challenge string for GET requests, or void.
     */
    handleIncomingWebhook(body: Record<string, unknown>, queryParams?: Record<string, string>): string | void;
    private connectTwilio;
    private sendViaTwilio;
    private handleTwilioWebhook;
    private connectCloudApi;
    private sendViaCloudApi;
    /**
     * Build a Cloud API message payload for a single content block.
     */
    private buildCloudApiPayload;
    private handleCloudApiWebhook;
}
//# sourceMappingURL=WhatsAppChannelAdapter.d.ts.map