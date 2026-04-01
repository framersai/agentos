/**
 * @fileoverview Twilio telephony provider for AgentOS voice calls.
 *
 * Implements {@link IVoiceCallProvider} using the Twilio REST API v2010-04-01.
 *
 * ## REST API contract
 *
 * | Operation      | Method | Endpoint                                          | Body format     |
 * |----------------|--------|---------------------------------------------------|-----------------|
 * | Initiate call  | POST   | `/2010-04-01/Accounts/{sid}/Calls.json`           | form-encoded    |
 * | Hangup call    | POST   | `/2010-04-01/Accounts/{sid}/Calls/{callSid}.json` | form-encoded    |
 * | Play TTS       | POST   | `/2010-04-01/Accounts/{sid}/Calls/{callSid}.json` | form-encoded    |
 *
 * All requests use HTTP Basic authentication: `Authorization: Basic base64(accountSid:authToken)`.
 * Request bodies are `application/x-www-form-urlencoded` (not JSON), which is
 * Twilio's legacy convention for the 2010-04-01 API.
 *
 * ## Webhook verification: HMAC-SHA1
 *
 * Twilio signs every webhook request using HMAC-SHA1. The verification algorithm:
 *
 * 1. Start with the **full request URL** (including scheme, host, path, and any query string).
 * 2. Parse the POST body as form-encoded key-value pairs.
 * 3. Sort the parameters **alphabetically by key name**.
 * 4. Concatenate each key+value pair (no separator) directly to the URL string.
 * 5. Compute `HMAC-SHA1(authToken, concatenatedString)`.
 * 6. Base64-encode the HMAC digest.
 * 7. Compare the result with the `X-Twilio-Signature` request header.
 *
 * If the computed signature matches the header, the request is authentic.
 *
 * ## Event mapping table
 *
 * | Twilio `CallStatus` | Normalised `kind`    |
 * |---------------------|----------------------|
 * | `ringing`           | `call-ringing`       |
 * | `in-progress`       | `call-answered`      |
 * | `completed`         | `call-completed`     |
 * | `failed`            | `call-failed`        |
 * | `busy`              | `call-busy`          |
 * | `no-answer`         | `call-no-answer`     |
 * | `canceled`          | `call-hangup-user`   |
 * | (+ `Digits` param)  | `call-dtmf`          |
 *
 * @module @framers/agentos/voice/providers/twilio
 */
import type { IVoiceCallProvider, InitiateCallInput, InitiateCallResult, HangupCallInput, PlayTtsInput } from '../IVoiceCallProvider.js';
import type { WebhookContext, WebhookVerificationResult, WebhookParseResult } from '../types.js';
/**
 * Configuration for {@link TwilioVoiceProvider}.
 */
export interface TwilioVoiceProviderConfig {
    /** Twilio Account SID (starts with "AC"). */
    accountSid: string;
    /** Twilio Auth Token (used for both API auth and webhook HMAC verification). */
    authToken: string;
    /**
     * Optional fetch implementation override -- inject a mock in tests.
     * Defaults to the global `fetch`.
     */
    fetchImpl?: typeof fetch;
}
/**
 * Twilio voice call provider.
 *
 * Uses the Twilio REST API 2010-04-01 for outbound call control and
 * HMAC-SHA1 for inbound webhook signature verification.
 *
 * @example
 * ```typescript
 * const provider = new TwilioVoiceProvider({
 *   accountSid: process.env.TWILIO_ACCOUNT_SID!,
 *   authToken:  process.env.TWILIO_AUTH_TOKEN!,
 * });
 * ```
 */
export declare class TwilioVoiceProvider implements IVoiceCallProvider {
    /** Provider identifier, always `'twilio'`. */
    readonly name: "twilio";
    /** Immutable configuration snapshot. */
    private readonly config;
    /** Base URL for the Twilio REST API (2010-04-01 version). */
    private readonly baseUrl;
    /** Pre-computed `Authorization: Basic ...` header value. */
    private readonly authHeader;
    /** HTTP fetch implementation (injectable for testing). */
    private readonly fetch;
    /**
     * @param config - Twilio credentials and optional overrides.
     */
    constructor(config: TwilioVoiceProviderConfig);
    /**
     * Verify an incoming Twilio webhook request using HMAC-SHA1.
     *
     * ## Algorithm (step by step)
     *
     * 1. Extract the `X-Twilio-Signature` header from the request.
     * 2. Parse the request body as URL-encoded form data.
     * 3. Sort all key-value pairs alphabetically by key.
     * 4. Build the signed string: start with the full URL, then append each
     *    key + value (no delimiters between pairs).
     * 5. Compute `HMAC-SHA1` of the signed string using the auth token as the key.
     * 6. Base64-encode the digest and compare it to the header value.
     *
     * @param ctx - Raw webhook request context.
     * @returns Verification result with `valid: true` if the signature matches.
     */
    verifyWebhook(ctx: WebhookContext): WebhookVerificationResult;
    /**
     * Parse a Twilio webhook body into normalized {@link NormalizedCallEvent}s.
     *
     * Twilio sends webhooks with a form-encoded body containing `CallSid`,
     * `CallStatus`, and optionally `Digits` (for DTMF input from `<Gather>`).
     * Each webhook may produce one or two events (status + optional DTMF).
     *
     * @param ctx - Raw webhook request context.
     * @returns Parsed result containing zero or more normalized events.
     */
    parseWebhookEvent(ctx: WebhookContext): WebhookParseResult;
    /**
     * Initiate an outbound call via the Twilio Calls API.
     *
     * Posts to `/Accounts/{accountSid}/Calls.json` with a **form-encoded** body
     * (not JSON -- this is Twilio's 2010-era API convention). All four status
     * callback events (`initiated`, `ringing`, `answered`, `completed`) are
     * requested so the {@link CallManager} receives the full state progression.
     *
     * @param input - Call initiation parameters (from/to numbers, webhook URLs).
     * @returns Result containing the Twilio `CallSid` on success.
     * @throws Never throws; returns `{ success: false, error: '...' }` on failure.
     */
    initiateCall(input: InitiateCallInput): Promise<InitiateCallResult>;
    /**
     * Hang up an active call by POSTing `Status=completed`.
     *
     * Twilio uses the same Calls resource endpoint for both querying and
     * modifying a call. Setting `Status=completed` instructs Twilio to
     * immediately terminate the call.
     *
     * @param input - Contains the Twilio `CallSid` to hang up.
     */
    hangupCall(input: HangupCallInput): Promise<void>;
    /**
     * Inject TTS into a live call using a TwiML `<Say>` verb.
     *
     * Sends a `Twiml` form parameter containing a minimal `<Response><Say>`
     * document. Twilio will parse the TwiML, synthesise the speech, and play
     * it to the caller in real-time.
     *
     * The optional `voice` attribute maps to Twilio's built-in voice names
     * (e.g., `alice`, `Polly.Joanna`).
     *
     * @param input - TTS parameters (text, voice, call ID).
     */
    playTts(input: PlayTtsInput): Promise<void>;
}
//# sourceMappingURL=twilio.d.ts.map