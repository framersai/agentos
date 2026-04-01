/**
 * @fileoverview Plivo telephony provider for AgentOS voice calls.
 *
 * Implements {@link IVoiceCallProvider} using the Plivo Voice REST API v1.
 *
 * ## REST API contract
 *
 * | Operation      | Method | Endpoint                                     | Body format |
 * |----------------|--------|----------------------------------------------|-------------|
 * | Initiate call  | POST   | `/v1/Account/{authId}/Call/`                 | JSON        |
 * | Hangup call    | DELETE | `/v1/Account/{authId}/Call/{callUuid}/`       | (none)      |
 * | Play TTS       | POST   | `/v1/Account/{authId}/Call/{callUuid}/Speak/` | JSON       |
 *
 * All requests use HTTP Basic authentication: `Authorization: Basic base64(authId:authToken)`.
 *
 * ### Hangup uses DELETE (not POST)
 *
 * Unlike Twilio (which POSTs `Status=completed`) and Telnyx (which POSTs to
 * an `/actions/hangup` endpoint), Plivo uses the HTTP `DELETE` method on the
 * Call resource to terminate an active call. This is a RESTful design choice
 * where "deleting" the call resource means terminating the call.
 *
 * ## Webhook verification: HMAC-SHA256 + nonce (v3 scheme)
 *
 * Plivo's v3 webhook signature scheme:
 *
 * 1. Plivo generates a random `nonce` and includes it in the
 *    `X-Plivo-Signature-V3-Nonce` header.
 * 2. The signed data is: `{fullRequestURL}{nonce}` (concatenated, no separator).
 * 3. Compute `HMAC-SHA256(authToken, signedData)`.
 * 4. Base64-encode the HMAC digest.
 * 5. Compare the result with the `X-Plivo-Signature-V3` header.
 *
 * Note: Unlike Twilio's scheme, Plivo does NOT include the POST body in the
 * signed data -- only the URL and nonce. The nonce prevents replay attacks.
 *
 * ## DTMF via `<GetDigits>` XML pattern
 *
 * Plivo delivers DTMF input through the `<GetDigits>` XML element callback,
 * not through the media stream WebSocket. When a call executes:
 *
 * ```xml
 * <GetDigits action="https://example.com/dtmf" method="POST" timeout="10">
 *   <Speak>Press 1 to confirm.</Speak>
 * </GetDigits>
 * ```
 *
 * Plivo POSTs the pressed digits to the `action` URL with a `Digits`
 * parameter in the form-encoded body (e.g., `Digits=1&CallUUID=xxx`).
 *
 * ## Event mapping table
 *
 * | Plivo `CallStatus`  | Normalised `kind`    |
 * |---------------------|----------------------|
 * | `ringing`           | `call-ringing`       |
 * | `in-progress`       | `call-answered`      |
 * | `completed`         | `call-completed`     |
 * | `busy`              | `call-busy`          |
 * | `no-answer`         | `call-no-answer`     |
 * | `failed`            | `call-failed`        |
 * | (+ `Digits` param)  | `call-dtmf`          |
 *
 * @module @framers/agentos/voice/providers/plivo
 */
import type { IVoiceCallProvider, InitiateCallInput, InitiateCallResult, HangupCallInput, PlayTtsInput } from '../IVoiceCallProvider.js';
import type { WebhookContext, WebhookVerificationResult, WebhookParseResult } from '../types.js';
/**
 * Configuration for {@link PlivoVoiceProvider}.
 */
export interface PlivoVoiceProviderConfig {
    /** Plivo Auth ID (account identifier, used in API URLs and Basic auth). */
    authId: string;
    /** Plivo Auth Token (used for both API auth and webhook HMAC verification). */
    authToken: string;
    /**
     * Optional fetch implementation override -- inject a mock in tests.
     * Defaults to the global `fetch`.
     */
    fetchImpl?: typeof fetch;
}
/**
 * Plivo voice call provider.
 *
 * Uses the Plivo REST API v1 for outbound call control and HMAC-SHA256
 * for inbound webhook signature verification (v3 signature scheme).
 *
 * @example
 * ```typescript
 * const provider = new PlivoVoiceProvider({
 *   authId:    process.env.PLIVO_AUTH_ID!,
 *   authToken: process.env.PLIVO_AUTH_TOKEN!,
 * });
 * ```
 */
export declare class PlivoVoiceProvider implements IVoiceCallProvider {
    /** Provider identifier, always `'plivo'`. */
    readonly name: "plivo";
    /** Immutable configuration snapshot. */
    private readonly config;
    /** Base URL for the Plivo REST API v1. */
    private readonly baseUrl;
    /** Pre-computed `Authorization: Basic ...` header value. */
    private readonly authHeader;
    /** HTTP fetch implementation (injectable for testing). */
    private readonly fetch;
    /**
     * @param config - Plivo credentials and optional overrides.
     */
    constructor(config: PlivoVoiceProviderConfig);
    /**
     * Verify an incoming Plivo webhook request using HMAC-SHA256 (v3 scheme).
     *
     * ## Algorithm (step by step)
     *
     * 1. Extract the `X-Plivo-Signature-V3-Nonce` and `X-Plivo-Signature-V3` headers.
     * 2. Build the signed data string: `{fullRequestURL}{nonce}`.
     *    Note: the POST body is NOT included in the signed data (unlike Twilio).
     * 3. Compute `HMAC-SHA256(authToken, signedData)`.
     * 4. Base64-encode the digest.
     * 5. Compare with the `X-Plivo-Signature-V3` header.
     *
     * @param ctx - Raw webhook request context.
     * @returns Verification result with `valid: true` if the signature matches.
     */
    verifyWebhook(ctx: WebhookContext): WebhookVerificationResult;
    /**
     * Parse a Plivo webhook body into normalized {@link NormalizedCallEvent}s.
     *
     * Plivo sends most webhooks with URL-encoded bodies, but some callbacks
     * may arrive as JSON. This parser handles both formats by inspecting
     * whether the body starts with `{` (JSON) or not (form-encoded).
     *
     * Plivo uses two naming conventions for the same fields:
     * - PascalCase (`CallUUID`, `CallStatus`, `Digits`) in URL callbacks.
     * - snake_case (`call_uuid`, `call_status`) in some API responses.
     * Both are checked for maximum compatibility.
     *
     * @param ctx - Raw webhook request context.
     * @returns Parsed result containing zero or more normalized events.
     */
    parseWebhookEvent(ctx: WebhookContext): WebhookParseResult;
    /**
     * Initiate an outbound call via the Plivo Call API.
     *
     * POSTs a JSON body to `/v1/Account/{authId}/Call/` with the caller, callee,
     * and answer URL. Returns the `request_uuid` as the provider call ID.
     *
     * @param input - Call initiation parameters (from/to numbers, webhook URL).
     * @returns Result containing the Plivo `request_uuid` on success.
     * @throws Never throws; returns `{ success: false, error: '...' }` on failure.
     */
    initiateCall(input: InitiateCallInput): Promise<InitiateCallResult>;
    /**
     * Hang up an active call using the Plivo Call DELETE endpoint.
     *
     * Plivo uses HTTP `DELETE` to terminate a call (unlike Twilio's POST with
     * `Status=completed` or Telnyx's POST to `/actions/hangup`). This is a
     * RESTful convention where deleting the call resource ends the call.
     *
     * @param input - Contains the Plivo `call_uuid` to hang up.
     */
    hangupCall(input: HangupCallInput): Promise<void>;
    /**
     * Speak text into a live call using the Plivo Speak API.
     *
     * POSTs a JSON body to `/v1/Account/{authId}/Call/{callUuid}/Speak/`
     * with the text, voice (default `'WOMAN'`), and language (default `'en-US'`).
     *
     * @param input - TTS parameters (text, optional voice, call ID).
     */
    playTts(input: PlayTtsInput): Promise<void>;
}
//# sourceMappingURL=plivo.d.ts.map