/**
 * @fileoverview Telnyx telephony provider for AgentOS voice calls.
 *
 * Implements {@link IVoiceCallProvider} using the Telnyx Call Control v2 API.
 *
 * ## REST API contract
 *
 * | Operation      | Method | Endpoint                                 | Body format |
 * |----------------|--------|------------------------------------------|-------------|
 * | Initiate call  | POST   | `/v2/calls`                              | JSON        |
 * | Hangup call    | POST   | `/v2/calls/{id}/actions/hangup`          | JSON        |
 * | Play TTS       | POST   | `/v2/calls/{id}/actions/speak`           | JSON        |
 * | Start stream   | POST   | `/v2/calls/{id}/actions/streaming_start` | JSON        |
 *
 * All requests use Bearer token authentication: `Authorization: Bearer {apiKey}`.
 * Request bodies are JSON (unlike Twilio's form-encoded convention).
 *
 * ## Streaming after `call.answered`
 *
 * Telnyx requires a two-step flow for media streaming:
 * 1. Initiate the call via `POST /v2/calls` with a `webhook_url`.
 * 2. When the `call.answered` webhook fires, issue a separate
 *    `POST /v2/calls/{id}/actions/streaming_start` request with the
 *    WebSocket URL. This is handled by the CallManager, not by this provider.
 *
 * ## Webhook verification: Ed25519
 *
 * Telnyx signs webhooks using Ed25519 public key cryptography:
 *
 * 1. Telnyx generates a signed payload: `{timestamp}|{rawBody}`.
 * 2. The signature is computed with the account's Ed25519 private key.
 * 3. The public key is provided as a base64-encoded DER SPKI blob.
 * 4. Headers: `X-Telnyx-Timestamp` (the timestamp) and
 *    `X-Telnyx-Signature-Ed25519` (base64-encoded Ed25519 signature).
 * 5. Verification: decode the signature from base64, construct the payload
 *    string `{timestamp}|{body}`, and verify using `crypto.verify()` with
 *    the SPKI public key.
 *
 * When no public key is configured, verification is skipped (returns
 * `valid: true`) to support development environments.
 *
 * ## Event mapping table (hangup_cause)
 *
 * | Telnyx `event_type`              | `hangup_cause`            | Normalised `kind`    |
 * |----------------------------------|---------------------------|----------------------|
 * | `call.initiated`                 | --                        | `call-ringing`       |
 * | `call.answered`                  | --                        | `call-answered`      |
 * | `call.hangup`                    | `normal_clearing`         | `call-hangup-user`   |
 * | `call.hangup`                    | `user_busy`               | `call-hangup-user`   |
 * | `call.hangup`                    | `originator_cancel`       | `call-hangup-user`   |
 * | `call.hangup`                    | (anything else)           | `call-completed`     |
 * | `call.dtmf.received`             | --                        | `call-dtmf`          |
 * | `call.machine.detection.ended`   | result=`machine`          | `call-voicemail`     |
 * | `call.machine.detection.ended`   | result=`human`            | (no event)           |
 *
 * @module @framers/agentos/voice/providers/telnyx
 */
import type { IVoiceCallProvider, InitiateCallInput, InitiateCallResult, HangupCallInput, PlayTtsInput } from '../IVoiceCallProvider.js';
import type { WebhookContext, WebhookVerificationResult, WebhookParseResult } from '../types.js';
/**
 * Configuration for {@link TelnyxVoiceProvider}.
 */
export interface TelnyxVoiceProviderConfig {
    /** Telnyx API key (starts with "KEY"). */
    apiKey: string;
    /** Telnyx connection/application ID for call routing. */
    connectionId: string;
    /**
     * Base64-encoded DER-encoded SPKI Ed25519 public key for webhook verification.
     *
     * When omitted, webhook verification is skipped (always returns `valid: true`).
     * This is acceptable for development but should always be set in production.
     */
    publicKey?: string;
    /**
     * Optional fetch implementation override -- inject a mock in tests.
     * Defaults to the global `fetch`.
     */
    fetchImpl?: typeof fetch;
}
/**
 * Telnyx voice call provider.
 *
 * Uses the Telnyx Call Control v2 API for outbound call initiation and
 * in-call actions (hangup, speak). Webhook verification uses Ed25519 public
 * key signing.
 *
 * @example
 * ```typescript
 * const provider = new TelnyxVoiceProvider({
 *   apiKey:       process.env.TELNYX_API_KEY!,
 *   connectionId: process.env.TELNYX_CONNECTION_ID!,
 *   publicKey:    process.env.TELNYX_PUBLIC_KEY,   // optional
 * });
 * ```
 */
export declare class TelnyxVoiceProvider implements IVoiceCallProvider {
    /** Provider identifier, always `'telnyx'`. */
    readonly name: "telnyx";
    /** Immutable configuration snapshot. */
    private readonly config;
    /** Base URL for the Telnyx v2 API. */
    private readonly baseUrl;
    /** Pre-computed `Authorization: Bearer ...` header value. */
    private readonly authHeader;
    /** HTTP fetch implementation (injectable for testing). */
    private readonly fetch;
    /**
     * @param config - Telnyx credentials and optional overrides.
     */
    constructor(config: TelnyxVoiceProviderConfig);
    /**
     * Verify an incoming Telnyx webhook using Ed25519 signature verification.
     *
     * ## Algorithm (step by step)
     *
     * 1. If no public key is configured, skip verification (return `valid: true`).
     *    This supports development environments without cryptographic setup.
     * 2. Extract `X-Telnyx-Timestamp` and `X-Telnyx-Signature-Ed25519` headers.
     * 3. Decode the signature from base64 into a raw byte Buffer.
     * 4. Construct the signed payload: `"{timestamp}|{rawBody}"`.
     * 5. Decode the SPKI public key from base64.
     * 6. Call `crypto.verify(null, payload, { key, format: 'der', type: 'spki' }, signature)`.
     * 7. Return the verification result.
     *
     * @param ctx - Raw webhook request context.
     * @returns Verification result. Returns `{ valid: true }` when no public key
     *   is configured (development mode).
     */
    verifyWebhook(ctx: WebhookContext): WebhookVerificationResult;
    /**
     * Parse a Telnyx webhook JSON body into normalized {@link NormalizedCallEvent}s.
     *
     * Telnyx sends all webhook payloads as JSON with a `data.event_type`
     * discriminant field. The `data.payload` object contains call-specific
     * fields like `call_control_id`, `hangup_cause`, `digit`, and `result`.
     *
     * ## Hangup cause mapping
     *
     * Telnyx's `call.hangup` event includes a `hangup_cause` field that must
     * be inspected to determine whether the user or the system terminated
     * the call:
     * - `normal_clearing` / `user_busy` / `originator_cancel` -> `call-hangup-user`
     * - All other causes (e.g., `call_rejected`, `unallocated_number`) -> `call-completed`
     *
     * @param ctx - Raw webhook request context.
     * @returns Parsed result containing zero or more normalized events.
     */
    parseWebhookEvent(ctx: WebhookContext): WebhookParseResult;
    /**
     * Initiate an outbound call via the Telnyx Call Control v2 API.
     *
     * POSTs to `/v2/calls` with a JSON body containing the `connection_id`,
     * phone numbers, and webhook URL. The `mediaStreamUrl` (if provided) is
     * stored internally for use after the call is answered -- it is NOT sent
     * in the initial call creation request because Telnyx requires
     * `streaming_start` to be issued as a separate action after `call.answered`.
     *
     * @param input - Call initiation parameters (from/to numbers, webhook URL).
     * @returns Result containing the Telnyx `call_control_id` on success.
     * @throws Never throws; returns `{ success: false, error: '...' }` on failure.
     */
    initiateCall(input: InitiateCallInput): Promise<InitiateCallResult>;
    /**
     * Hang up an active call via the Telnyx Call Control hangup action.
     *
     * POSTs an empty JSON body to `/v2/calls/{call_control_id}/actions/hangup`.
     * Telnyx will terminate the call and fire a `call.hangup` webhook.
     *
     * @param input - Contains the Telnyx `call_control_id` to hang up.
     */
    hangupCall(input: HangupCallInput): Promise<void>;
    /**
     * Speak text into a live call using Telnyx's text-to-speech speak action.
     *
     * POSTs a JSON body to `/v2/calls/{id}/actions/speak` with the text
     * `payload`, `voice` (default `'female'`), and `language` (default `'en-US'`).
     *
     * @param input - TTS parameters (text, optional voice, call ID).
     */
    playTts(input: PlayTtsInput): Promise<void>;
}
//# sourceMappingURL=telnyx.d.ts.map