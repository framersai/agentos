/**
 * @fileoverview Twilio telephony provider for AgentOS voice calls.
 *
 * Implements {@link IVoiceCallProvider} using the Twilio REST API v2010-04-01.
 * Webhook verification uses HMAC-SHA1 per Twilio's security documentation.
 *
 * @module @framers/agentos/voice/providers/twilio
 */

import { createHmac } from 'node:crypto';
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

/** Configuration for {@link TwilioVoiceProvider}. */
export interface TwilioVoiceProviderConfig {
  /** Twilio Account SID (starts with "AC"). */
  accountSid: string;
  /** Twilio Auth Token. */
  authToken: string;
  /**
   * Optional fetch override — inject a mock in tests.
   * Defaults to the global `fetch`.
   */
  fetchImpl?: typeof fetch;
}

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
export class TwilioVoiceProvider implements IVoiceCallProvider {
  readonly name = 'twilio' as const;

  private readonly config: TwilioVoiceProviderConfig;
  private readonly baseUrl: string;
  private readonly authHeader: string;
  private readonly fetch: typeof fetch;

  constructor(config: TwilioVoiceProviderConfig) {
    this.config = config;
    this.baseUrl = 'https://api.twilio.com/2010-04-01';
    this.authHeader =
      'Basic ' +
      Buffer.from(`${config.accountSid}:${config.authToken}`).toString('base64');
    this.fetch = config.fetchImpl ?? globalThis.fetch;
  }

  // ── Webhook ───────────────────────────────────────────────────────────────

  /**
   * Verify an incoming Twilio webhook request using HMAC-SHA1.
   *
   * Twilio constructs the signed data by appending all POST params (sorted
   * alphabetically) as key+value pairs directly to the full request URL.
   */
  verifyWebhook(ctx: WebhookContext): WebhookVerificationResult {
    const signature = ctx.headers['x-twilio-signature'];
    if (!signature || Array.isArray(signature)) {
      return { valid: false, error: 'Missing x-twilio-signature header' };
    }

    // Build the signed data string
    const bodyParams = new URLSearchParams(ctx.body.toString());
    const sorted = [...bodyParams.entries()].sort(([a], [b]) => a.localeCompare(b));
    let data = ctx.url;
    for (const [key, value] of sorted) {
      data += key + value;
    }

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
   * Handles call status transitions (ringing, in-progress, completed, failed,
   * busy, no-answer, canceled) and DTMF input.
   */
  parseWebhookEvent(ctx: WebhookContext): WebhookParseResult {
    const params = new URLSearchParams(ctx.body.toString());
    const callSid = params.get('CallSid') ?? '';
    const callStatus = params.get('CallStatus') ?? '';
    const digits = params.get('Digits');

    const timestamp = Date.now();
    const events: NormalizedCallEvent[] = [];

    /** Helper: shared base fields. */
    const base = () => ({
      eventId: randomUUID(),
      providerCallId: callSid,
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
        events.push({ ...base(), kind: 'call-hangup-user' });
        break;
      default:
        // initiated / queued / etc. — no normalized event emitted
        break;
    }

    // DTMF digit input
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
   * Posts to `/Accounts/{accountSid}/Calls.json` with form-encoded body.
   * All four status callback events (initiated, ringing, answered, completed)
   * are requested.
   */
  async initiateCall(input: InitiateCallInput): Promise<InitiateCallResult> {
    const url = `${this.baseUrl}/Accounts/${this.config.accountSid}/Calls.json`;

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

    const data = (await response.json()) as { sid: string };
    return { providerCallId: data.sid, success: true };
  }

  /**
   * Hang up an active call by posting `Status=completed`.
   */
  async hangupCall(input: HangupCallInput): Promise<void> {
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
   * Sends a `Twiml` parameter containing a minimal `<Response><Say>` document.
   * The optional `voice` attribute maps to Twilio's built-in voice names
   * (e.g., `alice`, `Polly.Joanna`).
   */
  async playTts(input: PlayTtsInput): Promise<void> {
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
