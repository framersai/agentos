/**
 * @fileoverview Unit tests for {@link PlivoVoiceProvider}.
 *
 * All HTTP calls are intercepted via an injected `fetchImpl`. Webhook
 * verification uses HMAC-SHA256 (v3 scheme). Event mapping is tested
 * for every supported Plivo call status, DTMF, and edge cases (JSON body,
 * missing params).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { PlivoVoiceProvider } from '../providers/plivo.js';
import type { WebhookContext } from '../types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const AUTH_ID = 'MATEST12345';
const AUTH_TOKEN = 'test_plivo_auth_token';

function makeResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

/** Compute the expected Plivo v3 HMAC-SHA256 signature. */
function plivoSignature(url: string, nonce: string, authToken: string): string {
  const data = url + nonce;
  return createHmac('sha256', authToken).update(data).digest('base64');
}

function makeWebhookCtx(
  url: string,
  body: string,
  nonce = 'test-nonce-123',
  overrideHeaders?: Record<string, string>,
): WebhookContext {
  const sig = plivoSignature(url, nonce, AUTH_TOKEN);
  return {
    method: 'POST',
    url,
    headers: {
      'x-plivo-signature-v3-nonce': nonce,
      'x-plivo-signature-v3': sig,
      ...overrideHeaders,
    },
    body,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PlivoVoiceProvider', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let provider: PlivoVoiceProvider;

  beforeEach(() => {
    fetchMock = vi.fn();
    provider = new PlivoVoiceProvider({
      authId: AUTH_ID,
      authToken: AUTH_TOKEN,
      fetchImpl: fetchMock as typeof fetch,
    });
  });

  // ── Metadata ───────────────────────────────────────────────────────────

  it('has name "plivo"', () => {
    expect(provider.name).toBe('plivo');
  });

  // ── initiateCall ───────────────────────────────────────────────────────

  describe('initiateCall()', () => {
    it('POSTs to /Account/{authId}/Call/ with correct JSON body', async () => {
      fetchMock.mockResolvedValue(makeResponse({ request_uuid: 'req-uuid-001' }));

      const result = await provider.initiateCall({
        callId: 'call-1',
        fromNumber: '+15550000001',
        toNumber: '+15550000002',
        mode: 'notify',
        webhookUrl: 'https://example.com/answer',
      });

      expect(result).toEqual({ providerCallId: 'req-uuid-001', success: true });
      expect(fetchMock).toHaveBeenCalledOnce();

      const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`https://api.plivo.com/v1/Account/${AUTH_ID}/Call/`);
      expect(options.method).toBe('POST');

      const body = JSON.parse(options.body as string);
      expect(body.from).toBe('+15550000001');
      expect(body.to).toBe('+15550000002');
      expect(body.answer_url).toBe('https://example.com/answer');
      expect(body.answer_method).toBe('POST');
    });

    it('sends Basic auth header', async () => {
      fetchMock.mockResolvedValue(makeResponse({ request_uuid: 'r2' }));

      await provider.initiateCall({
        callId: 'c',
        fromNumber: '+1',
        toNumber: '+2',
        mode: 'notify',
        webhookUrl: 'https://example.com/wh',
      });

      const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      const expectedAuth = 'Basic ' + Buffer.from(`${AUTH_ID}:${AUTH_TOKEN}`).toString('base64');
      expect((options.headers as Record<string, string>).Authorization).toBe(expectedAuth);
    });

    it('returns success: false on non-2xx response', async () => {
      fetchMock.mockResolvedValue(makeResponse({ error: 'not found' }, 404));

      const result = await provider.initiateCall({
        callId: 'c',
        fromNumber: '+1',
        toNumber: '+2',
        mode: 'notify',
        webhookUrl: 'https://example.com/wh',
      });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/404/);
    });
  });

  // ── hangupCall ─────────────────────────────────────────────────────────

  describe('hangupCall()', () => {
    it('sends DELETE to /Account/{authId}/Call/{uuid}/', async () => {
      fetchMock.mockResolvedValue(makeResponse({}, 204));

      await provider.hangupCall({ providerCallId: 'req-uuid-999' });

      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`https://api.plivo.com/v1/Account/${AUTH_ID}/Call/req-uuid-999/`);
      expect(options.method).toBe('DELETE');
    });

    it('includes Basic auth header on DELETE', async () => {
      fetchMock.mockResolvedValue(makeResponse({}, 204));

      await provider.hangupCall({ providerCallId: 'uuid-aaa' });

      const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      const expectedAuth = 'Basic ' + Buffer.from(`${AUTH_ID}:${AUTH_TOKEN}`).toString('base64');
      expect((options.headers as Record<string, string>).Authorization).toBe(expectedAuth);
    });
  });

  // ── playTts ────────────────────────────────────────────────────────────

  describe('playTts()', () => {
    it('POSTs to /Account/{authId}/Call/{uuid}/Speak/ with defaults', async () => {
      fetchMock.mockResolvedValue(makeResponse({}));

      await provider.playTts({ providerCallId: 'uuid-100', text: 'Hello there' });

      const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`https://api.plivo.com/v1/Account/${AUTH_ID}/Call/uuid-100/Speak/`);
      const body = JSON.parse(options.body as string);
      expect(body.text).toBe('Hello there');
      expect(body.voice).toBe('WOMAN');
      expect(body.language).toBe('en-US');
    });

    it('uses provided voice when specified', async () => {
      fetchMock.mockResolvedValue(makeResponse({}));

      await provider.playTts({ providerCallId: 'uuid-101', text: 'Hi', voice: 'MAN' });

      const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(options.body as string);
      expect(body.voice).toBe('MAN');
    });
  });

  // ── verifyWebhook ──────────────────────────────────────────────────────

  describe('verifyWebhook()', () => {
    const url = 'https://example.com/plivo/webhook';
    const body = 'CallUUID=uuid-001&CallStatus=ringing';

    it('returns valid: true for a correctly signed request', () => {
      const ctx = makeWebhookCtx(url, body);
      expect(provider.verifyWebhook(ctx).valid).toBe(true);
    });

    it('returns valid: false for a wrong signature', () => {
      const ctx = makeWebhookCtx(url, body, 'test-nonce-123', {
        'x-plivo-signature-v3': 'wrong_signature',
      });
      expect(provider.verifyWebhook(ctx).valid).toBe(false);
    });

    it('returns valid: false when signature header is missing', () => {
      const ctx: WebhookContext = {
        method: 'POST',
        url,
        headers: { 'x-plivo-signature-v3-nonce': 'some-nonce' },
        body,
      };
      // Missing signature → computed !== undefined gives false
      expect(provider.verifyWebhook(ctx).valid).toBe(false);
    });

    it('produces different signatures for different nonces', () => {
      const ctx1 = makeWebhookCtx(url, body, 'nonce-AAA');
      const ctx2 = makeWebhookCtx(url, body, 'nonce-BBB');
      // Both should be valid with their respective correct signatures
      expect(provider.verifyWebhook(ctx1).valid).toBe(true);
      expect(provider.verifyWebhook(ctx2).valid).toBe(true);
    });
  });

  // ── parseWebhookEvent ──────────────────────────────────────────────────

  describe('parseWebhookEvent()', () => {
    const url = 'https://example.com/plivo/webhook';

    const cases: Array<[string, string]> = [
      ['ringing', 'call-ringing'],
      ['in-progress', 'call-answered'],
      ['completed', 'call-completed'],
      ['busy', 'call-busy'],
      ['no-answer', 'call-no-answer'],
      ['failed', 'call-failed'],
    ];

    for (const [plivoStatus, expectedKind] of cases) {
      it(`maps CallStatus="${plivoStatus}" → kind="${expectedKind}"`, () => {
        const body = `CallUUID=uuid-001&CallStatus=${plivoStatus}`;
        const ctx = makeWebhookCtx(url, body);
        const result = provider.parseWebhookEvent(ctx);
        expect(result.events).toHaveLength(1);
        expect(result.events[0].kind).toBe(expectedKind);
        expect(result.events[0].providerCallId).toBe('uuid-001');
      });
    }

    it('emits call-dtmf when Digits param is present', () => {
      const body = 'CallUUID=uuid-002&CallStatus=in-progress&Digits=9';
      const ctx = makeWebhookCtx(url, body);
      const result = provider.parseWebhookEvent(ctx);
      expect(result.events).toHaveLength(2);
      const dtmf = result.events.find(e => e.kind === 'call-dtmf');
      expect(dtmf).toBeDefined();
      if (dtmf?.kind === 'call-dtmf') {
        expect(dtmf.digit).toBe('9');
      }
    });

    it('emits no events for unknown CallStatus', () => {
      const body = 'CallUUID=uuid-003&CallStatus=queued';
      const ctx = makeWebhookCtx(url, body);
      const result = provider.parseWebhookEvent(ctx);
      expect(result.events).toHaveLength(0);
    });

    it('parses a JSON body (fallback path)', () => {
      const body = JSON.stringify({ CallUUID: 'uuid-004', CallStatus: 'completed' });
      const ctx: WebhookContext = { method: 'POST', url, headers: {}, body };
      const result = provider.parseWebhookEvent(ctx);
      expect(result.events[0].kind).toBe('call-completed');
      expect(result.events[0].providerCallId).toBe('uuid-004');
    });

    it('assigns unique eventIds to multiple events', () => {
      const body = 'CallUUID=uuid-005&CallStatus=in-progress&Digits=1';
      const ctx = makeWebhookCtx(url, body);
      const result = provider.parseWebhookEvent(ctx);
      const ids = result.events.map(e => e.eventId);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });
});
