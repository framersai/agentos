/**
 * @fileoverview Unit tests for {@link TelnyxVoiceProvider}.
 *
 * All HTTP calls are intercepted via an injected `fetchImpl`. Webhook
 * verification covers both the no-public-key pass-through and header
 * validation paths. Event mapping is tested for all supported Telnyx
 * call event types including voicemail detection.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TelnyxVoiceProvider } from '../providers/telnyx.js';
import type { WebhookContext } from '../types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const API_KEY = 'KEY_test_abc123';
const CONNECTION_ID = 'conn-001';

function makeResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

/** Build a minimal Telnyx call event webhook body. */
function makeEventBody(eventType: string, payload: Record<string, unknown> = {}): string {
  return JSON.stringify({
    data: {
      event_type: eventType,
      payload: {
        call_control_id: 'call-ctrl-001',
        call_session_id: 'sess-001',
        ...payload,
      },
    },
  });
}

function makeWebhookCtx(body: string, overrideHeaders?: Record<string, string>): WebhookContext {
  return {
    method: 'POST',
    url: 'https://example.com/telnyx/webhook',
    headers: { 'x-telnyx-timestamp': '1234567890', ...overrideHeaders },
    body,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TelnyxVoiceProvider', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let provider: TelnyxVoiceProvider;

  beforeEach(() => {
    fetchMock = vi.fn();
    provider = new TelnyxVoiceProvider({
      apiKey: API_KEY,
      connectionId: CONNECTION_ID,
      fetchImpl: fetchMock as typeof fetch,
    });
  });

  // ── Metadata ───────────────────────────────────────────────────────────

  it('has name "telnyx"', () => {
    expect(provider.name).toBe('telnyx');
  });

  // ── initiateCall ───────────────────────────────────────────────────────

  describe('initiateCall()', () => {
    it('POSTs to /calls with correct JSON body', async () => {
      fetchMock.mockResolvedValue(
        makeResponse({ data: { call_control_id: 'ctrl-001', call_session_id: 'sess-001' } }),
      );

      const result = await provider.initiateCall({
        callId: 'call-1',
        fromNumber: '+15550000001',
        toNumber: '+15550000002',
        mode: 'conversation',
        webhookUrl: 'https://example.com/webhook',
      });

      expect(result).toEqual({ providerCallId: 'ctrl-001', success: true });
      expect(fetchMock).toHaveBeenCalledOnce();

      const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://api.telnyx.com/v2/calls');
      expect(options.method).toBe('POST');

      const body = JSON.parse(options.body as string);
      expect(body.connection_id).toBe(CONNECTION_ID);
      expect(body.to).toBe('+15550000002');
      expect(body.from).toBe('+15550000001');
      expect(body.webhook_url).toBe('https://example.com/webhook');
      // stream_url must NOT be in the initial request
      expect(body.stream_url).toBeUndefined();
    });

    it('sends Bearer auth header', async () => {
      fetchMock.mockResolvedValue(
        makeResponse({ data: { call_control_id: 'ctrl-002', call_session_id: 's' } }),
      );

      await provider.initiateCall({
        callId: 'c',
        fromNumber: '+1',
        toNumber: '+2',
        mode: 'notify',
        webhookUrl: 'https://example.com/wh',
      });

      const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect((options.headers as Record<string, string>).Authorization).toBe(`Bearer ${API_KEY}`);
    });

    it('returns success: false on non-2xx response', async () => {
      fetchMock.mockResolvedValue(makeResponse({ errors: [] }, 422));

      const result = await provider.initiateCall({
        callId: 'c',
        fromNumber: '+1',
        toNumber: '+2',
        mode: 'notify',
        webhookUrl: 'https://example.com/wh',
      });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/422/);
    });
  });

  // ── hangupCall ─────────────────────────────────────────────────────────

  describe('hangupCall()', () => {
    it('POSTs to /calls/{id}/actions/hangup', async () => {
      fetchMock.mockResolvedValue(makeResponse({}));

      await provider.hangupCall({ providerCallId: 'ctrl-999' });

      const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://api.telnyx.com/v2/calls/ctrl-999/actions/hangup');
      expect(options.method).toBe('POST');
    });
  });

  // ── playTts ────────────────────────────────────────────────────────────

  describe('playTts()', () => {
    it('POSTs to /calls/{id}/actions/speak with payload + default voice', async () => {
      fetchMock.mockResolvedValue(makeResponse({}));

      await provider.playTts({ providerCallId: 'ctrl-100', text: 'Hello!' });

      const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://api.telnyx.com/v2/calls/ctrl-100/actions/speak');
      const body = JSON.parse(options.body as string);
      expect(body.payload).toBe('Hello!');
      expect(body.voice).toBe('female');
      expect(body.language).toBe('en-US');
    });

    it('uses provided voice when specified', async () => {
      fetchMock.mockResolvedValue(makeResponse({}));

      await provider.playTts({ providerCallId: 'ctrl-101', text: 'Hey', voice: 'male' });

      const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(options.body as string);
      expect(body.voice).toBe('male');
    });
  });

  // ── verifyWebhook ──────────────────────────────────────────────────────

  describe('verifyWebhook()', () => {
    it('returns valid: true when no public key is configured (skip verification)', () => {
      const ctx = makeWebhookCtx('{}');
      expect(provider.verifyWebhook(ctx)).toEqual({ valid: true });
    });

    it('returns valid: false when signature headers are missing and publicKey is set', () => {
      const providerWithKey = new TelnyxVoiceProvider({
        apiKey: API_KEY,
        connectionId: CONNECTION_ID,
        publicKey: Buffer.alloc(32).toString('base64'), // dummy key
        fetchImpl: fetchMock as typeof fetch,
      });
      const ctx: WebhookContext = {
        method: 'POST',
        url: 'https://example.com/wh',
        headers: {},
        body: '{}',
      };
      const result = providerWithKey.verifyWebhook(ctx);
      expect(result.valid).toBe(false);
    });

    it('returns valid: false when Ed25519 verification throws (bad key format)', () => {
      const providerWithKey = new TelnyxVoiceProvider({
        apiKey: API_KEY,
        connectionId: CONNECTION_ID,
        publicKey: 'not-a-real-key',
        fetchImpl: fetchMock as typeof fetch,
      });
      const ctx: WebhookContext = {
        method: 'POST',
        url: 'https://example.com/wh',
        headers: {
          'x-telnyx-timestamp': '12345',
          'x-telnyx-signature-ed25519': 'fakesig',
        },
        body: '{}',
      };
      const result = providerWithKey.verifyWebhook(ctx);
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  // ── parseWebhookEvent ──────────────────────────────────────────────────

  describe('parseWebhookEvent()', () => {
    it('maps call.initiated → call-ringing', () => {
      const ctx = makeWebhookCtx(makeEventBody('call.initiated'));
      const result = provider.parseWebhookEvent(ctx);
      expect(result.events).toHaveLength(1);
      expect(result.events[0].kind).toBe('call-ringing');
      expect(result.events[0].providerCallId).toBe('call-ctrl-001');
    });

    it('maps call.answered → call-answered', () => {
      const ctx = makeWebhookCtx(makeEventBody('call.answered'));
      const result = provider.parseWebhookEvent(ctx);
      expect(result.events[0].kind).toBe('call-answered');
    });

    it('maps call.hangup (normal_clearing) → call-hangup-user', () => {
      const ctx = makeWebhookCtx(makeEventBody('call.hangup', { hangup_cause: 'normal_clearing' }));
      const result = provider.parseWebhookEvent(ctx);
      expect(result.events[0].kind).toBe('call-hangup-user');
    });

    it('maps call.hangup (unknown cause) → call-completed', () => {
      const ctx = makeWebhookCtx(makeEventBody('call.hangup', { hangup_cause: 'call_rejected' }));
      const result = provider.parseWebhookEvent(ctx);
      expect(result.events[0].kind).toBe('call-completed');
    });

    it('maps call.dtmf.received → call-dtmf with digit', () => {
      const ctx = makeWebhookCtx(makeEventBody('call.dtmf.received', { digit: '7' }));
      const result = provider.parseWebhookEvent(ctx);
      expect(result.events[0].kind).toBe('call-dtmf');
      if (result.events[0].kind === 'call-dtmf') {
        expect(result.events[0].digit).toBe('7');
      }
    });

    it('maps call.machine.detection.ended (result=machine) → call-voicemail', () => {
      const ctx = makeWebhookCtx(
        makeEventBody('call.machine.detection.ended', { result: 'machine' }),
      );
      const result = provider.parseWebhookEvent(ctx);
      expect(result.events[0].kind).toBe('call-voicemail');
    });

    it('emits no event for call.machine.detection.ended (result=human)', () => {
      const ctx = makeWebhookCtx(
        makeEventBody('call.machine.detection.ended', { result: 'human' }),
      );
      const result = provider.parseWebhookEvent(ctx);
      expect(result.events).toHaveLength(0);
    });

    it('emits no events for unknown event types', () => {
      const ctx = makeWebhookCtx(makeEventBody('call.some.unknown.event'));
      const result = provider.parseWebhookEvent(ctx);
      expect(result.events).toHaveLength(0);
    });

    it('returns empty events for malformed JSON', () => {
      const ctx: WebhookContext = {
        method: 'POST',
        url: 'https://example.com/wh',
        headers: {},
        body: '{not-valid-json',
      };
      const result = provider.parseWebhookEvent(ctx);
      expect(result.events).toHaveLength(0);
    });
  });
});
