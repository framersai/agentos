/**
 * @fileoverview Telnyx telephony provider for AgentOS voice calls.
 *
 * Implements {@link IVoiceCallProvider} using the Telnyx Call Control v2 API.
 * Webhook verification uses Ed25519 public key verification as specified in
 * the Telnyx security documentation.
 *
 * @module @framers/agentos/voice/providers/telnyx
 */

import { verify } from 'node:crypto';
import { randomUUID } from 'node:crypto';

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

/** Configuration for {@link TelnyxVoiceProvider}. */
export interface TelnyxVoiceProviderConfig {
  /** Telnyx API key (starts with "KEY"). */
  apiKey: string;
  /** Telnyx connection/application ID for call routing. */
  connectionId: string;
  /**
   * Base64-encoded DER-encoded SPKI Ed25519 public key for webhook verification.
   * When omitted, webhook verification is skipped.
   */
  publicKey?: string;
  /**
   * Optional fetch override — inject a mock in tests.
   * Defaults to the global `fetch`.
   */
  fetchImpl?: typeof fetch;
}

// ============================================================================
// Internal types
// ============================================================================

/** Shape of Telnyx webhook payload. */
interface TelnyxWebhookPayload {
  data: {
    event_type: string;
    payload: {
      call_control_id?: string;
      call_session_id?: string;
      hangup_cause?: string;
      digit?: string;
      result?: string;
      [key: string]: unknown;
    };
  };
}

// ============================================================================
// TelnyxVoiceProvider
// ============================================================================

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
export class TelnyxVoiceProvider implements IVoiceCallProvider {
  readonly name = 'telnyx' as const;

  private readonly config: TelnyxVoiceProviderConfig;
  private readonly baseUrl: string;
  private readonly authHeader: string;
  private readonly fetch: typeof fetch;

  constructor(config: TelnyxVoiceProviderConfig) {
    this.config = config;
    this.baseUrl = 'https://api.telnyx.com/v2';
    this.authHeader = `Bearer ${config.apiKey}`;
    this.fetch = config.fetchImpl ?? globalThis.fetch;
  }

  // ── Webhook ───────────────────────────────────────────────────────────────

  /**
   * Verify an incoming Telnyx webhook using Ed25519 signature verification.
   *
   * Telnyx signs `{timestamp}|{rawBody}` with the configured Ed25519 private key.
   * The matching public key is provided as a base64-encoded DER SPKI blob.
   *
   * If no public key is configured, the check is skipped and `valid: true`
   * is returned so the provider can operate without cryptographic validation
   * during initial development.
   */
  verifyWebhook(ctx: WebhookContext): WebhookVerificationResult {
    if (!this.config.publicKey) {
      return { valid: true };
    }

    const timestamp = ctx.headers['x-telnyx-timestamp'];
    const sigHeader = ctx.headers['x-telnyx-signature-ed25519'];

    if (!timestamp || Array.isArray(timestamp) || !sigHeader || Array.isArray(sigHeader)) {
      return { valid: false, error: 'Missing Telnyx signature headers' };
    }

    const signature = Buffer.from(sigHeader, 'base64');
    const payload = Buffer.from(`${timestamp}|${ctx.body.toString()}`);

    try {
      const valid = verify(
        null,
        payload,
        {
          key: Buffer.from(this.config.publicKey, 'base64'),
          format: 'der',
          type: 'spki',
        },
        signature,
      );
      return { valid };
    } catch {
      return { valid: false, error: 'Verification failed' };
    }
  }

  /**
   * Parse a Telnyx webhook JSON body into normalized {@link NormalizedCallEvent}s.
   *
   * Handles Telnyx Call Control event types:
   * - `call.initiated` → `call-ringing`
   * - `call.answered` → `call-answered`
   * - `call.hangup` → `call-completed` or `call-hangup-user` based on hangup_cause
   * - `call.dtmf.received` → `call-dtmf`
   * - `call.machine.detection.ended` with `result === 'machine'` → `call-voicemail`
   */
  parseWebhookEvent(ctx: WebhookContext): WebhookParseResult {
    let parsed: TelnyxWebhookPayload;
    try {
      parsed = JSON.parse(ctx.body.toString()) as TelnyxWebhookPayload;
    } catch {
      return { events: [] };
    }

    const { event_type, payload } = parsed.data;
    const providerCallId = payload.call_control_id ?? '';
    const timestamp = Date.now();
    const events: NormalizedCallEvent[] = [];

    const base = () => ({ eventId: randomUUID(), providerCallId, timestamp });

    switch (event_type) {
      case 'call.initiated':
        events.push({ ...base(), kind: 'call-ringing' });
        break;

      case 'call.answered':
        events.push({ ...base(), kind: 'call-answered' });
        break;

      case 'call.hangup': {
        // Distinguish user-initiated hangup from normal completion
        const cause = (payload.hangup_cause as string | undefined) ?? '';
        const kind =
          cause === 'user_busy' || cause === 'normal_clearing' || cause === 'originator_cancel'
            ? 'call-hangup-user'
            : 'call-completed';
        events.push({ ...base(), kind });
        break;
      }

      case 'call.dtmf.received': {
        const digit = (payload.digit as string | undefined) ?? '';
        events.push({ ...base(), kind: 'call-dtmf', digit });
        break;
      }

      case 'call.machine.detection.ended':
        if (payload.result === 'machine') {
          events.push({ ...base(), kind: 'call-voicemail' });
        }
        break;

      default:
        // Unrecognized event type — emit nothing
        break;
    }

    return { events };
  }

  // ── Call Control ──────────────────────────────────────────────────────────

  /**
   * Initiate an outbound call via the Telnyx Call Control v2 API.
   *
   * POSTs to `/calls` with a JSON body. The `mediaStreamUrl` (if provided)
   * is stored internally for use after the call is answered — it is NOT sent
   * in the initial call creation request.
   */
  async initiateCall(input: InitiateCallInput): Promise<InitiateCallResult> {
    const url = `${this.baseUrl}/calls`;

    const response = await this.fetch(url, {
      method: 'POST',
      headers: {
        Authorization: this.authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        connection_id: this.config.connectionId,
        to: input.toNumber,
        from: input.fromNumber,
        webhook_url: input.webhookUrl,
      }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => String(response.status));
      return { providerCallId: '', success: false, error: `Telnyx error ${response.status}: ${text}` };
    }

    const data = (await response.json()) as { data: { call_control_id: string; call_session_id: string } };
    return { providerCallId: data.data.call_control_id, success: true };
  }

  /**
   * Hang up an active call via the Telnyx Call Control hangup action.
   */
  async hangupCall(input: HangupCallInput): Promise<void> {
    const url = `${this.baseUrl}/calls/${input.providerCallId}/actions/hangup`;

    await this.fetch(url, {
      method: 'POST',
      headers: {
        Authorization: this.authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });
  }

  /**
   * Speak text into a live call using Telnyx's text-to-speech speak action.
   *
   * Defaults to `female` voice and `en-US` language when not specified.
   */
  async playTts(input: PlayTtsInput): Promise<void> {
    const url = `${this.baseUrl}/calls/${input.providerCallId}/actions/speak`;

    await this.fetch(url, {
      method: 'POST',
      headers: {
        Authorization: this.authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        payload: input.text,
        voice: input.voice ?? 'female',
        language: 'en-US',
      }),
    });
  }
}
