/**
 * @fileoverview Plivo telephony provider for AgentOS voice calls.
 *
 * Implements {@link IVoiceCallProvider} using the Plivo Voice REST API v1.
 * Webhook verification uses HMAC-SHA256 with the v3 signature scheme.
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

/** Configuration for {@link PlivoVoiceProvider}. */
export interface PlivoVoiceProviderConfig {
  /** Plivo Auth ID (account identifier). */
  authId: string;
  /** Plivo Auth Token. */
  authToken: string;
  /**
   * Optional fetch override — inject a mock in tests.
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
  readonly name = 'plivo' as const;

  private readonly config: PlivoVoiceProviderConfig;
  private readonly baseUrl: string;
  private readonly authHeader: string;
  private readonly fetch: typeof fetch;

  constructor(config: PlivoVoiceProviderConfig) {
    this.config = config;
    this.baseUrl = 'https://api.plivo.com/v1';
    this.authHeader =
      'Basic ' + Buffer.from(`${config.authId}:${config.authToken}`).toString('base64');
    this.fetch = config.fetchImpl ?? globalThis.fetch;
  }

  // ── Webhook ───────────────────────────────────────────────────────────────

  /**
   * Verify an incoming Plivo webhook request using HMAC-SHA256 (v3 scheme).
   *
   * Plivo signs the concatenation of the full request URL and the nonce
   * header value. The resulting base64-encoded digest is compared against
   * the `x-plivo-signature-v3` header.
   */
  verifyWebhook(ctx: WebhookContext): WebhookVerificationResult {
    const nonce = ctx.headers['x-plivo-signature-v3-nonce'];
    const signature = ctx.headers['x-plivo-signature-v3'];

    if (Array.isArray(nonce) || Array.isArray(signature)) {
      return { valid: false, error: 'Duplicate Plivo signature headers' };
    }

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
   * Supports both URL-encoded and JSON request bodies. Maps `CallStatus`
   * parameter values to call lifecycle events.
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

    const callUuid = params.get('CallUUID') ?? params.get('call_uuid') ?? '';
    const callStatus = params.get('CallStatus') ?? params.get('call_status') ?? '';
    const digits = params.get('Digits');

    const timestamp = Date.now();
    const events: NormalizedCallEvent[] = [];

    const base = () => ({
      eventId: randomUUID(),
      providerCallId: callUuid,
      timestamp,
    });

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
        // initiated / queued / etc. — no normalized event emitted
        break;
    }

    if (digits != null && digits !== '') {
      events.push({ ...base(), kind: 'call-dtmf', digit: digits });
    }

    return { events };
  }

  // ── Call Control ──────────────────────────────────────────────────────────

  /**
   * Initiate an outbound call via the Plivo Call API.
   *
   * POSTs a JSON body to `/Account/{authId}/Call/` with the caller, callee,
   * and answer URL. Returns the `request_uuid` as the provider call ID.
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
   * Defaults to `WOMAN` voice and `en-US` language when not specified.
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
