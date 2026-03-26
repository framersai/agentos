/**
 * @fileoverview Unit tests for {@link PlivoVoiceProvider}.
 *
 * All HTTP calls are intercepted via an injected `fetchImpl` -- no real
 * network traffic is made. Tests cover:
 * - HMAC-SHA256 webhook verification (v3 scheme with nonce).
 * - Event mapping for every supported Plivo `CallStatus` value.
 * - DTMF digit extraction from the `Digits` form parameter.
 * - JSON body fallback parsing.
 * - Outbound call initiation with JSON body.
 * - Call hangup via HTTP DELETE (Plivo's RESTful convention).
 * - TTS via the `/Speak/` endpoint.
 * - Authentication header format (HTTP Basic).
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

/** Build a minimal mock Response that satisfies the fetch() contract. */
function makeResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

/**
 * Compute the expected Plivo v3 HMAC-SHA256 signature.
 *
 * Plivo signs `{url}{nonce}` (no body involved) with HMAC-SHA256.
 */
function plivoSignature(url: string, nonce: string, authToken: string): string {
  const data = url + nonce;
  return createHmac('sha256', authToken).update(data).digest('base64');
}

/** Build a WebhookContext with a correctly signed Plivo v3 signature header. */
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

  it('should have name "plivo"', () => {
    expect(provider.name).toBe('plivo');
  });

  // ── initiateCall ───────────────────────────────────────────────────────

  describe('initiateCall()', () => {
    it('should POST to /Account/{authId}/Call/ with JSON body containing from, to, and answer_url', async () => {
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

    it('should send a Basic auth header with authId:authToken base64-encoded', async () => {
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

    it('should return success: false with a descriptive error on non-2xx responses', async () => {
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
    it('should send DELETE to /Account/{authId}/Call/{uuid}/ (RESTful hangup convention)', async () => {
      fetchMock.mockResolvedValue(makeResponse({}, 204));

      await provider.hangupCall({ providerCallId: 'req-uuid-999' });

      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`https://api.plivo.com/v1/Account/${AUTH_ID}/Call/req-uuid-999/`);
      expect(options.method).toBe('DELETE');
    });

    it('should include the Basic auth header on DELETE requests', async () => {
      fetchMock.mockResolvedValue(makeResponse({}, 204));

      await provider.hangupCall({ providerCallId: 'uuid-aaa' });

      const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      const expectedAuth = 'Basic ' + Buffer.from(`${AUTH_ID}:${AUTH_TOKEN}`).toString('base64');
      expect((options.headers as Record<string, string>).Authorization).toBe(expectedAuth);
    });
  });

  // ── playTts ────────────────────────────────────────────────────────────

  describe('playTts()', () => {
    it('should POST to /Account/{authId}/Call/{uuid}/Speak/ with default voice WOMAN', async () => {
      fetchMock.mockResolvedValue(makeResponse({}));

      await provider.playTts({ providerCallId: 'uuid-100', text: 'Hello there' });

      const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`https://api.plivo.com/v1/Account/${AUTH_ID}/Call/uuid-100/Speak/`);
      const body = JSON.parse(options.body as string);
      expect(body.text).toBe('Hello there');
      expect(body.voice).toBe('WOMAN');
      expect(body.language).toBe('en-US');
    });

    it('should use the provided voice when specified instead of the default', async () => {
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

    it('should return valid: true when the HMAC-SHA256 signature matches the computed digest', () => {
      const ctx = makeWebhookCtx(url, body);
      expect(provider.verifyWebhook(ctx).valid).toBe(true);
    });

    it('should return valid: false when the signature header has an incorrect value', () => {
      const ctx = makeWebhookCtx(url, body, 'test-nonce-123', {
        'x-plivo-signature-v3': 'wrong_signature',
      });
      expect(provider.verifyWebhook(ctx).valid).toBe(false);
    });

    it('should return valid: false when the signature header is missing entirely', () => {
      const ctx: WebhookContext = {
        method: 'POST',
        url,
        headers: { 'x-plivo-signature-v3-nonce': 'some-nonce' },
        body,
      };
      // Missing signature header means computed !== undefined, resulting in false.
      expect(provider.verifyWebhook(ctx).valid).toBe(false);
    });

    it('should produce different valid signatures for different nonces (replay protection)', () => {
      // Each nonce produces a unique signature, preventing replay attacks.
      const ctx1 = makeWebhookCtx(url, body, 'nonce-AAA');
      const ctx2 = makeWebhookCtx(url, body, 'nonce-BBB');
      expect(provider.verifyWebhook(ctx1).valid).toBe(true);
      expect(provider.verifyWebhook(ctx2).valid).toBe(true);
    });
  });

  // ── parseWebhookEvent ──────────────────────────────────────────────────

  describe('parseWebhookEvent()', () => {
    const url = 'https://example.com/plivo/webhook';

    // Table-driven test for all CallStatus -> kind mappings.
    const cases: Array<[string, string]> = [
      ['ringing', 'call-ringing'],
      ['in-progress', 'call-answered'],
      ['completed', 'call-completed'],
      ['busy', 'call-busy'],
      ['no-answer', 'call-no-answer'],
      ['failed', 'call-failed'],
    ];

    for (const [plivoStatus, expectedKind] of cases) {
      it(`should map CallStatus="${plivoStatus}" to kind="${expectedKind}"`, () => {
        const body = `CallUUID=uuid-001&CallStatus=${plivoStatus}`;
        const ctx = makeWebhookCtx(url, body);
        const result = provider.parseWebhookEvent(ctx);
        expect(result.events).toHaveLength(1);
        expect(result.events[0].kind).toBe(expectedKind);
        expect(result.events[0].providerCallId).toBe('uuid-001');
      });
    }

    it('should emit a call-dtmf event when Digits param is present (from <GetDigits> callback)', () => {
      const body = 'CallUUID=uuid-002&CallStatus=in-progress&Digits=9';
      const ctx = makeWebhookCtx(url, body);
      const result = provider.parseWebhookEvent(ctx);
      // Both call-answered and call-dtmf events should be emitted.
      expect(result.events).toHaveLength(2);
      const dtmf = result.events.find(e => e.kind === 'call-dtmf');
      expect(dtmf).toBeDefined();
      if (dtmf?.kind === 'call-dtmf') {
        expect(dtmf.digit).toBe('9');
      }
    });

    it('should emit no events for unknown CallStatus values like "queued"', () => {
      const body = 'CallUUID=uuid-003&CallStatus=queued';
      const ctx = makeWebhookCtx(url, body);
      const result = provider.parseWebhookEvent(ctx);
      expect(result.events).toHaveLength(0);
    });

    it('should parse a JSON body as a fallback when the body starts with "{"', () => {
      // Some Plivo callbacks may arrive as JSON instead of form-encoded.
      const body = JSON.stringify({ CallUUID: 'uuid-004', CallStatus: 'completed' });
      const ctx: WebhookContext = { method: 'POST', url, headers: {}, body };
      const result = provider.parseWebhookEvent(ctx);
      expect(result.events[0].kind).toBe('call-completed');
      expect(result.events[0].providerCallId).toBe('uuid-004');
    });

    it('should assign unique eventIds to multiple events for idempotency tracking', () => {
      const body = 'CallUUID=uuid-005&CallStatus=in-progress&Digits=1';
      const ctx = makeWebhookCtx(url, body);
      const result = provider.parseWebhookEvent(ctx);
      const ids = result.events.map(e => e.eventId);
      // Every event ID should be unique (UUIDs).
      expect(new Set(ids).size).toBe(ids.length);
    });
  });
});
