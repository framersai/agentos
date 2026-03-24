/**
 * @fileoverview Unit tests for {@link TwilioVoiceProvider}.
 *
 * All HTTP calls are intercepted via an injected `fetchImpl` — no real
 * network traffic is made. Webhook verification and event-mapping are
 * exercised for every supported call status and DTMF input.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { TwilioVoiceProvider } from '../providers/twilio.js';
import type { WebhookContext } from '../types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ACCOUNT_SID = 'ACtest1234567890';
const AUTH_TOKEN = 'test_auth_token';

/** Build a minimal mock Response. */
function makeResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

/** Compute the expected Twilio HMAC-SHA1 signature for a given url + body. */
function twilioSignature(url: string, body: string): string {
  const params = new URLSearchParams(body);
  const sorted = [...params.entries()].sort(([a], [b]) => a.localeCompare(b));
  let data = url;
  for (const [k, v] of sorted) data += k + v;
  return createHmac('sha1', AUTH_TOKEN).update(data).digest('base64');
}

/** Build a WebhookContext for a URL-encoded body. */
function makeWebhookCtx(url: string, body: string, overrideHeaders?: Record<string, string>): WebhookContext {
  const sig = twilioSignature(url, body);
  return {
    method: 'POST',
    url,
    headers: { 'x-twilio-signature': sig, ...overrideHeaders },
    body,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TwilioVoiceProvider', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let provider: TwilioVoiceProvider;

  beforeEach(() => {
    fetchMock = vi.fn();
    provider = new TwilioVoiceProvider({
      accountSid: ACCOUNT_SID,
      authToken: AUTH_TOKEN,
      fetchImpl: fetchMock as typeof fetch,
    });
  });

  // ── Metadata ───────────────────────────────────────────────────────────

  it('has name "twilio"', () => {
    expect(provider.name).toBe('twilio');
  });

  // ── initiateCall ───────────────────────────────────────────────────────

  describe('initiateCall()', () => {
    it('POSTs to /Accounts/{sid}/Calls.json with correct form body', async () => {
      fetchMock.mockResolvedValue(makeResponse({ sid: 'CA001' }));

      const result = await provider.initiateCall({
        callId: 'call-1',
        fromNumber: '+15550000001',
        toNumber: '+15550000002',
        mode: 'notify',
        webhookUrl: 'https://example.com/webhook',
        statusCallbackUrl: 'https://example.com/status',
      });

      expect(result).toEqual({ providerCallId: 'CA001', success: true });
      expect(fetchMock).toHaveBeenCalledOnce();

      const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/Calls.json`);
      expect(options.method).toBe('POST');
      expect(options.headers).toMatchObject({ 'Content-Type': 'application/x-www-form-urlencoded' });

      const body = options.body as string;
      expect(body).toContain('To=%2B15550000002');
      expect(body).toContain('From=%2B15550000001');
      expect(body).toContain('StatusCallbackEvent=initiated');
      expect(body).toContain('StatusCallbackEvent=ringing');
      expect(body).toContain('StatusCallbackEvent=answered');
      expect(body).toContain('StatusCallbackEvent=completed');
    });

    it('returns success: false with error on non-2xx response', async () => {
      fetchMock.mockResolvedValue(makeResponse({ message: 'Not found' }, 404));

      const result = await provider.initiateCall({
        callId: 'call-2',
        fromNumber: '+15550000001',
        toNumber: '+15550000002',
        mode: 'notify',
        webhookUrl: 'https://example.com/webhook',
      });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/404/);
    });

    it('sends a Basic auth header', async () => {
      fetchMock.mockResolvedValue(makeResponse({ sid: 'CA002' }));

      await provider.initiateCall({
        callId: 'call-3',
        fromNumber: '+1',
        toNumber: '+2',
        mode: 'notify',
        webhookUrl: 'https://example.com/wh',
      });

      const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      const expectedAuth = 'Basic ' + Buffer.from(`${ACCOUNT_SID}:${AUTH_TOKEN}`).toString('base64');
      expect((options.headers as Record<string, string>).Authorization).toBe(expectedAuth);
    });
  });

  // ── hangupCall ─────────────────────────────────────────────────────────

  describe('hangupCall()', () => {
    it('POSTs Status=completed to /Accounts/{sid}/Calls/{callSid}.json', async () => {
      fetchMock.mockResolvedValue(makeResponse({}));

      await provider.hangupCall({ providerCallId: 'CA999' });

      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('/Calls/CA999.json');
      expect(options.method).toBe('POST');
      expect(options.body).toBe('Status=completed');
    });
  });

  // ── playTts ────────────────────────────────────────────────────────────

  describe('playTts()', () => {
    it('POSTs TwiML <Say> without voice attribute when voice is omitted', async () => {
      fetchMock.mockResolvedValue(makeResponse({}));

      await provider.playTts({ providerCallId: 'CA100', text: 'Hello world' });

      const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = decodeURIComponent(options.body as string).replace('Twiml=', '');
      expect(body).toBe('<Response><Say>Hello world</Say></Response>');
    });

    it('includes voice attribute when voice is provided', async () => {
      fetchMock.mockResolvedValue(makeResponse({}));

      await provider.playTts({ providerCallId: 'CA101', text: 'Hey there', voice: 'alice' });

      const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = decodeURIComponent(options.body as string).replace('Twiml=', '');
      expect(body).toBe('<Response><Say voice="alice">Hey there</Say></Response>');
    });
  });

  // ── verifyWebhook ──────────────────────────────────────────────────────

  describe('verifyWebhook()', () => {
    const url = 'https://example.com/twilio/webhook';
    const body = 'CallSid=CA001&CallStatus=ringing&From=%2B15550000001';

    it('returns valid: true for a correctly signed request', () => {
      const ctx = makeWebhookCtx(url, body);
      expect(provider.verifyWebhook(ctx)).toEqual({ valid: true });
    });

    it('returns valid: false for a wrong signature', () => {
      const ctx: WebhookContext = {
        method: 'POST',
        url,
        headers: { 'x-twilio-signature': 'wrong_sig' },
        body,
      };
      const result = provider.verifyWebhook(ctx);
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/mismatch/i);
    });

    it('returns valid: false when signature header is missing', () => {
      const ctx: WebhookContext = {
        method: 'POST',
        url,
        headers: {},
        body,
      };
      expect(provider.verifyWebhook(ctx).valid).toBe(false);
    });
  });

  // ── parseWebhookEvent ──────────────────────────────────────────────────

  describe('parseWebhookEvent()', () => {
    const url = 'https://example.com/twilio/webhook';

    const cases: Array<[string, string]> = [
      ['ringing', 'call-ringing'],
      ['in-progress', 'call-answered'],
      ['completed', 'call-completed'],
      ['failed', 'call-failed'],
      ['busy', 'call-busy'],
      ['no-answer', 'call-no-answer'],
      ['canceled', 'call-hangup-user'],
    ];

    for (const [twilioStatus, expectedKind] of cases) {
      it(`maps CallStatus="${twilioStatus}" → kind="${expectedKind}"`, () => {
        const body = `CallSid=CA001&CallStatus=${twilioStatus}`;
        const ctx = makeWebhookCtx(url, body);
        const result = provider.parseWebhookEvent(ctx);
        expect(result.events).toHaveLength(1);
        expect(result.events[0].kind).toBe(expectedKind);
        expect(result.events[0].providerCallId).toBe('CA001');
      });
    }

    it('emits call-dtmf event when Digits param is present', () => {
      const body = 'CallSid=CA002&CallStatus=in-progress&Digits=5';
      const ctx = makeWebhookCtx(url, body);
      const result = provider.parseWebhookEvent(ctx);
      // Both call-answered and call-dtmf
      expect(result.events).toHaveLength(2);
      const dtmf = result.events.find(e => e.kind === 'call-dtmf');
      expect(dtmf).toBeDefined();
      if (dtmf?.kind === 'call-dtmf') {
        expect(dtmf.digit).toBe('5');
      }
    });

    it('emits no events for unknown CallStatus', () => {
      const body = 'CallSid=CA003&CallStatus=queued';
      const ctx = makeWebhookCtx(url, body);
      const result = provider.parseWebhookEvent(ctx);
      expect(result.events).toHaveLength(0);
    });

    it('assigns unique eventIds to each event', () => {
      const body = 'CallSid=CA004&CallStatus=in-progress&Digits=3';
      const ctx = makeWebhookCtx(url, body);
      const result = provider.parseWebhookEvent(ctx);
      const ids = result.events.map(e => e.eventId);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });
});
