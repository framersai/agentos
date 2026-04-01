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
import { createHmac } from 'node:crypto';
import { randomUUID } from 'node:crypto';
// ============================================================================
// TwilioVoiceProvider
// ============================================================================
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
export class TwilioVoiceProvider {
    /**
     * @param config - Twilio credentials and optional overrides.
     */
    constructor(config) {
        /** Provider identifier, always `'twilio'`. */
        this.name = 'twilio';
        this.config = config;
        this.baseUrl = 'https://api.twilio.com/2010-04-01';
        // Twilio uses HTTP Basic auth with accountSid:authToken.
        this.authHeader =
            'Basic ' +
                Buffer.from(`${config.accountSid}:${config.authToken}`).toString('base64');
        this.fetch = config.fetchImpl ?? globalThis.fetch;
    }
    // ── Webhook ───────────────────────────────────────────────────────────────
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
    verifyWebhook(ctx) {
        const signature = ctx.headers['x-twilio-signature'];
        if (!signature || Array.isArray(signature)) {
            return { valid: false, error: 'Missing x-twilio-signature header' };
        }
        // Step 2-4: Parse form body, sort params, build signed data string.
        const bodyParams = new URLSearchParams(ctx.body.toString());
        const sorted = [...bodyParams.entries()].sort(([a], [b]) => a.localeCompare(b));
        let data = ctx.url;
        for (const [key, value] of sorted) {
            data += key + value;
        }
        // Step 5-6: HMAC-SHA1 with auth token, compare base64 digest.
        const expected = createHmac('sha1', this.config.authToken)
            .update(data)
            .digest('base64');
        const valid = expected === signature;
        return {
            valid,
            ...(valid ? {} : { error: 'Signature mismatch' }),
        };
    }
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
    parseWebhookEvent(ctx) {
        const params = new URLSearchParams(ctx.body.toString());
        const callSid = params.get('CallSid') ?? '';
        const callStatus = params.get('CallStatus') ?? '';
        const digits = params.get('Digits');
        const timestamp = Date.now();
        const events = [];
        /** Helper: shared base fields with a unique event ID for idempotency. */
        const base = () => ({
            eventId: randomUUID(),
            providerCallId: callSid,
            timestamp,
        });
        // Map Twilio CallStatus values to normalized event kinds.
        switch (callStatus) {
            case 'ringing':
                events.push({ ...base(), kind: 'call-ringing' });
                break;
            case 'in-progress':
                events.push({ ...base(), kind: 'call-answered' });
                break;
            case 'completed':
                events.push({ ...base(), kind: 'call-completed' });
                break;
            case 'failed':
                events.push({ ...base(), kind: 'call-failed' });
                break;
            case 'busy':
                events.push({ ...base(), kind: 'call-busy' });
                break;
            case 'no-answer':
                events.push({ ...base(), kind: 'call-no-answer' });
                break;
            case 'canceled':
                // Twilio uses "canceled" when the caller hangs up before the callee answers.
                events.push({ ...base(), kind: 'call-hangup-user' });
                break;
            default:
                // initiated / queued / etc. -- no normalized event emitted.
                // These are transient Twilio-internal states that don't map to
                // meaningful call lifecycle events.
                break;
        }
        // DTMF digit input (from <Gather> TwiML verb callback).
        // This can co-occur with a CallStatus update in the same webhook.
        if (digits != null && digits !== '') {
            events.push({
                ...base(),
                kind: 'call-dtmf',
                digit: digits,
            });
        }
        return { events };
    }
    // ── Call Control ──────────────────────────────────────────────────────────
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
    async initiateCall(input) {
        const url = `${this.baseUrl}/Accounts/${this.config.accountSid}/Calls.json`;
        // Build form-encoded body. Twilio expects this format, not JSON.
        const body = [
            `To=${encodeURIComponent(input.toNumber)}`,
            `From=${encodeURIComponent(input.fromNumber)}`,
            `Url=${encodeURIComponent(input.webhookUrl)}`,
            `StatusCallback=${encodeURIComponent(input.statusCallbackUrl ?? '')}`,
            `StatusCallbackEvent=initiated`,
            `StatusCallbackEvent=ringing`,
            `StatusCallbackEvent=answered`,
            `StatusCallbackEvent=completed`,
        ].join('&');
        const response = await this.fetch(url, {
            method: 'POST',
            headers: {
                Authorization: this.authHeader,
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body,
        });
        if (!response.ok) {
            const text = await response.text().catch(() => String(response.status));
            return { providerCallId: '', success: false, error: `Twilio error ${response.status}: ${text}` };
        }
        const data = (await response.json());
        return { providerCallId: data.sid, success: true };
    }
    /**
     * Hang up an active call by POSTing `Status=completed`.
     *
     * Twilio uses the same Calls resource endpoint for both querying and
     * modifying a call. Setting `Status=completed` instructs Twilio to
     * immediately terminate the call.
     *
     * @param input - Contains the Twilio `CallSid` to hang up.
     */
    async hangupCall(input) {
        const url = `${this.baseUrl}/Accounts/${this.config.accountSid}/Calls/${input.providerCallId}.json`;
        await this.fetch(url, {
            method: 'POST',
            headers: {
                Authorization: this.authHeader,
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: 'Status=completed',
        });
    }
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
    async playTts(input) {
        const url = `${this.baseUrl}/Accounts/${this.config.accountSid}/Calls/${input.providerCallId}.json`;
        const voiceAttr = input.voice ? ` voice="${input.voice}"` : '';
        const twiml = `<Response><Say${voiceAttr}>${input.text}</Say></Response>`;
        await this.fetch(url, {
            method: 'POST',
            headers: {
                Authorization: this.authHeader,
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: `Twiml=${encodeURIComponent(twiml)}`,
        });
    }
}
//# sourceMappingURL=twilio.js.map