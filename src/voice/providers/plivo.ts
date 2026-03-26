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

import { createHmac, randomUUID } from 'node:crypto';

import type {
  IVoiceCallProvider,
  InitiateCallInput,
  InitiateCallResult,
  HangupCallInput,
  PlayTtsInput,
} from '../IVoiceCallProvider.js';

import type {
  WebhookContext,
  WebhookVerificationResult,
  WebhookParseResult,
  NormalizedCallEvent,
} from '../types.js';

// ============================================================================
// Config
// ============================================================================

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

// ============================================================================
// PlivoVoiceProvider
// ============================================================================

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
export class PlivoVoiceProvider implements IVoiceCallProvider {
  /** Provider identifier, always `'plivo'`. */
  readonly name = 'plivo' as const;

  /** Immutable configuration snapshot. */
  private readonly config: PlivoVoiceProviderConfig;

  /** Base URL for the Plivo REST API v1. */
  private readonly baseUrl: string;

  /** Pre-computed `Authorization: Basic ...` header value. */
  private readonly authHeader: string;

  /** HTTP fetch implementation (injectable for testing). */
  private readonly fetch: typeof fetch;

  /**
   * @param config - Plivo credentials and optional overrides.
   */
  constructor(config: PlivoVoiceProviderConfig) {
    this.config = config;
    this.baseUrl = 'https://api.plivo.com/v1';
    // Plivo uses HTTP Basic auth with authId:authToken (similar to Twilio).
    this.authHeader =
      'Basic ' + Buffer.from(`${config.authId}:${config.authToken}`).toString('base64');
    this.fetch = config.fetchImpl ?? globalThis.fetch;
  }

  // ── Webhook ───────────────────────────────────────────────────────────────

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
  verifyWebhook(ctx: WebhookContext): WebhookVerificationResult {
    const nonce = ctx.headers['x-plivo-signature-v3-nonce'];
    const signature = ctx.headers['x-plivo-signature-v3'];

    if (Array.isArray(nonce) || Array.isArray(signature)) {
      return { valid: false, error: 'Duplicate Plivo signature headers' };
    }

    // Use empty string as nonce fallback when header is missing --
    // the HMAC will still compute but won't match the expected signature.
    const nonceStr = nonce ?? '';
    const data = ctx.url + nonceStr;
    const expected = createHmac('sha256', this.config.authToken)
      .update(data)
      .digest('base64');

    const valid = expected === signature;
    return { valid };
  }

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
  parseWebhookEvent(ctx: WebhookContext): WebhookParseResult {
    const body = ctx.body.toString();
    let params: URLSearchParams;

    // Plivo sends URL-encoded bodies for most events; try JSON as fallback.
    try {
      if (body.trimStart().startsWith('{')) {
        const obj = JSON.parse(body) as Record<string, string>;
        params = new URLSearchParams(obj);
      } else {
        params = new URLSearchParams(body);
      }
    } catch {
      params = new URLSearchParams(body);
    }

    // Support both PascalCase and snake_case field naming conventions.
    const callUuid = params.get('CallUUID') ?? params.get('call_uuid') ?? '';
    const callStatus = params.get('CallStatus') ?? params.get('call_status') ?? '';
    const digits = params.get('Digits');

    const timestamp = Date.now();
    const events: NormalizedCallEvent[] = [];

    /** Helper: shared base fields with a unique event ID for idempotency. */
    const base = () => ({
      eventId: randomUUID(),
      providerCallId: callUuid,
      timestamp,
    });

    // Map Plivo CallStatus values to normalized event kinds.
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
      case 'busy':
        events.push({ ...base(), kind: 'call-busy' });
        break;
      case 'no-answer':
        events.push({ ...base(), kind: 'call-no-answer' });
        break;
      case 'failed':
        events.push({ ...base(), kind: 'call-failed' });
        break;
      default:
        // initiated / queued / etc. -- no normalized event emitted.
        break;
    }

    // DTMF digit input (from <GetDigits> XML element callback).
    if (digits != null && digits !== '') {
      events.push({ ...base(), kind: 'call-dtmf', digit: digits });
    }

    return { events };
  }

  // ── Call Control ──────────────────────────────────────────────────────────

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
  async initiateCall(input: InitiateCallInput): Promise<InitiateCallResult> {
    const url = `${this.baseUrl}/Account/${this.config.authId}/Call/`;

    const response = await this.fetch(url, {
      method: 'POST',
      headers: {
        Authorization: this.authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: input.fromNumber,
        to: input.toNumber,
        answer_url: input.webhookUrl,
        answer_method: 'POST',
      }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => String(response.status));
      return { providerCallId: '', success: false, error: `Plivo error ${response.status}: ${text}` };
    }

    const data = (await response.json()) as { request_uuid: string };
    return { providerCallId: data.request_uuid, success: true };
  }

  /**
   * Hang up an active call using the Plivo Call DELETE endpoint.
   *
   * Plivo uses HTTP `DELETE` to terminate a call (unlike Twilio's POST with
   * `Status=completed` or Telnyx's POST to `/actions/hangup`). This is a
   * RESTful convention where deleting the call resource ends the call.
   *
   * @param input - Contains the Plivo `call_uuid` to hang up.
   */
  async hangupCall(input: HangupCallInput): Promise<void> {
    const url = `${this.baseUrl}/Account/${this.config.authId}/Call/${input.providerCallId}/`;

    await this.fetch(url, {
      method: 'DELETE',
      headers: {
        Authorization: this.authHeader,
      },
    });
  }

  /**
   * Speak text into a live call using the Plivo Speak API.
   *
   * POSTs a JSON body to `/v1/Account/{authId}/Call/{callUuid}/Speak/`
   * with the text, voice (default `'WOMAN'`), and language (default `'en-US'`).
   *
   * @param input - TTS parameters (text, optional voice, call ID).
   */
  async playTts(input: PlayTtsInput): Promise<void> {
    const url = `${this.baseUrl}/Account/${this.config.authId}/Call/${input.providerCallId}/Speak/`;

    await this.fetch(url, {
      method: 'POST',
      headers: {
        Authorization: this.authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: input.text,
        voice: input.voice ?? 'WOMAN',
        language: 'en-US',
      }),
    });
  }
}
