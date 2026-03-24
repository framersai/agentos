/**
 * @fileoverview Telephony integration tests.
 *
 * Exercises the full inbound media-stream path:
 *   TwilioMediaStreamParser → TelephonyStreamTransport → AudioFrame events
 *
 * And the webhook/state-machine path:
 *   TwilioVoiceProvider + CallManager → state transitions (ringing → answered → completed)
 *
 * No network I/O is performed — WebSocket and HTTP interactions are mocked.
 *
 * @module @framers/agentos/voice/__tests__/telephony-integration
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { createHmac } from 'node:crypto';

import { TwilioMediaStreamParser } from '../parsers/TwilioMediaStreamParser.js';
import { TelephonyStreamTransport } from '../TelephonyStreamTransport.js';
import { CallManager } from '../CallManager.js';
import { TwilioVoiceProvider } from '../providers/twilio.js';
import type { AudioFrame } from '../../voice-pipeline/types.js';

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Build a minimal mock WebSocket-like EventEmitter. */
function createMockWS() {
  const ws = new EventEmitter() as ReturnType<typeof createMockWS>;
  (ws as any).send = vi.fn();
  (ws as any).close = vi.fn();
  return ws as EventEmitter & { send: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };
}

/** Encode a mu-law byte value that decodes to audible audio (0x7f = silence). */
function mulawBytes(count = 16): Buffer {
  return Buffer.alloc(count, 0x7f);
}

/** Build a Twilio `start` JSON string. */
function twilioStart(streamSid = 'MX_STREAM_001', callSid = 'CA_CALL_001'): string {
  return JSON.stringify({
    event: 'start',
    streamSid,
    start: { callSid, streamSid, mediaFormat: { encoding: 'audio/x-mulaw', sampleRate: 8000, channels: 1 } },
  });
}

/** Build a Twilio `media` JSON string with a base64 mu-law payload. */
function twilioMedia(streamSid = 'MX_STREAM_001', payloadBytes = 16): string {
  return JSON.stringify({
    event: 'media',
    streamSid,
    media: {
      track: 'inbound',
      payload: mulawBytes(payloadBytes).toString('base64'),
    },
  });
}

/** Build a Twilio `dtmf` JSON string. */
function twilioDtmf(streamSid = 'MX_STREAM_001', digit = '7', duration = 200): string {
  return JSON.stringify({
    event: 'dtmf',
    streamSid,
    dtmf: { digit, duration },
  });
}

/** Build a Twilio `stop` JSON string. */
function twilioStop(streamSid = 'MX_STREAM_001'): string {
  return JSON.stringify({ event: 'stop', streamSid });
}

/** Compute the Twilio HMAC-SHA1 webhook signature for a URL-encoded body. */
function twilioSig(authToken: string, url: string, body: string): string {
  const params = new URLSearchParams(body);
  const sorted = [...params.entries()].sort(([a], [b]) => a.localeCompare(b));
  let data = url;
  for (const [k, v] of sorted) data += k + v;
  return createHmac('sha1', authToken).update(data).digest('base64');
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite 1: TwilioMediaStreamParser + TelephonyStreamTransport (media stream flow)
// ─────────────────────────────────────────────────────────────────────────────

describe('TwilioMediaStreamParser + TelephonyStreamTransport integration', () => {
  let ws: ReturnType<typeof createMockWS>;
  let parser: TwilioMediaStreamParser;
  let transport: TelephonyStreamTransport;

  beforeEach(() => {
    ws = createMockWS();
    parser = new TwilioMediaStreamParser();
    transport = new TelephonyStreamTransport(ws, parser, { outputSampleRate: 16000 });
  });

  it('starts in "connecting" state', () => {
    expect(transport.state).toBe('connecting');
  });

  it('transitions to "open" after Twilio start message', () => {
    ws.emit('message', twilioStart());
    expect(transport.state).toBe('open');
  });

  it('sends a connected acknowledgment after start', () => {
    ws.emit('message', twilioStart('MX1', 'CA1'));
    // TwilioMediaStreamParser.formatConnected returns a JSON string
    expect((ws.send as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    const sent = JSON.parse((ws.send as ReturnType<typeof vi.fn>).mock.calls[0][0] as string);
    expect(sent).toMatchObject({ event: 'connected', protocol: 'Call' });
  });

  it('emits an "audio" event with a Float32Array AudioFrame on media message', () => {
    ws.emit('message', twilioStart());

    const frames: AudioFrame[] = [];
    transport.on('audio', (f: AudioFrame) => frames.push(f));

    ws.emit('message', twilioMedia('MX_STREAM_001', 16));

    expect(frames).toHaveLength(1);
    const frame = frames[0];
    expect(frame.samples).toBeInstanceOf(Float32Array);
    expect(frame.sampleRate).toBe(16000);
    expect(typeof frame.timestamp).toBe('number');
  });

  it('Float32 samples are normalised to [-1, 1]', () => {
    ws.emit('message', twilioStart());
    const frames: AudioFrame[] = [];
    transport.on('audio', (f: AudioFrame) => frames.push(f));
    ws.emit('message', twilioMedia('MX_STREAM_001', 64));

    const { samples } = frames[0];
    for (let i = 0; i < samples.length; i++) {
      expect(samples[i]).toBeGreaterThanOrEqual(-1);
      expect(samples[i]).toBeLessThanOrEqual(1);
    }
  });

  it('emits "dtmf" event with digit and durationMs on dtmf message', () => {
    ws.emit('message', twilioStart());

    const dtmfEvents: Array<{ digit: string; durationMs?: number }> = [];
    transport.on('dtmf', (d) => dtmfEvents.push(d));

    ws.emit('message', twilioDtmf('MX_STREAM_001', '7', 200));

    expect(dtmfEvents).toHaveLength(1);
    expect(dtmfEvents[0].digit).toBe('7');
    expect(dtmfEvents[0].durationMs).toBe(200);
  });

  it('emits "close" and transitions to "closed" on stop message', () => {
    ws.emit('message', twilioStart());

    let closedFired = false;
    transport.on('close', () => { closedFired = true; });

    ws.emit('message', twilioStop());

    expect(closedFired).toBe(true);
    expect(transport.state).toBe('closed');
  });

  it('emits "close" and transitions to "closed" when WebSocket closes', () => {
    ws.emit('message', twilioStart());

    let closedFired = false;
    transport.on('close', () => { closedFired = true; });

    ws.emit('close');

    expect(closedFired).toBe(true);
    expect(transport.state).toBe('closed');
  });

  it('does not emit a second "close" if WS close fires after stop message', () => {
    ws.emit('message', twilioStart());

    let closeCount = 0;
    transport.on('close', () => { closeCount++; });

    ws.emit('message', twilioStop());
    ws.emit('close');

    expect(closeCount).toBe(1);
  });

  it('discards outbound media messages (track=outbound)', () => {
    ws.emit('message', twilioStart());

    const frames: AudioFrame[] = [];
    transport.on('audio', (f: AudioFrame) => frames.push(f));

    const outboundMsg = JSON.stringify({
      event: 'media',
      streamSid: 'MX_STREAM_001',
      media: { track: 'outbound', payload: mulawBytes(16).toString('base64') },
    });
    ws.emit('message', outboundMsg);

    expect(frames).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 2: CallManager + TwilioVoiceProvider webhook state transitions
// ─────────────────────────────────────────────────────────────────────────────

describe('CallManager + TwilioVoiceProvider integration', () => {
  const ACCOUNT_SID = 'ACtest_integration';
  const AUTH_TOKEN = 'secret_integration_token';
  const WEBHOOK_URL = 'https://example.com/voice/webhook/twilio';

  let fetchMock: ReturnType<typeof vi.fn>;
  let provider: TwilioVoiceProvider;
  let manager: CallManager;

  beforeEach(() => {
    fetchMock = vi.fn();

    provider = new TwilioVoiceProvider({
      accountSid: ACCOUNT_SID,
      authToken: AUTH_TOKEN,
      fetchImpl: fetchMock as typeof fetch,
    });

    manager = new CallManager({
      provider: { provider: 'twilio' },
      webhookBaseUrl: 'https://example.com',
    });

    manager.registerProvider(provider);
  });

  /** Build a signed webhook context for a URL-encoded body. */
  function makeCtx(body: string) {
    const sig = twilioSig(AUTH_TOKEN, WEBHOOK_URL, body);
    return {
      method: 'POST' as const,
      url: WEBHOOK_URL,
      headers: { 'x-twilio-signature': sig } as Record<string, string>,
      body,
    };
  }

  it('registers the twilio provider and can retrieve it', () => {
    expect(manager.getProvider('twilio')).toBe(provider);
  });

  it('initiates an outbound call and creates a CallRecord in "initiated" state', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ sid: 'CA_OUT_001' }),
      text: async () => '{"sid":"CA_OUT_001"}',
    });

    const call = await manager.initiateCall({
      toNumber: '+15550001234',
      fromNumber: '+15559876543',
      mode: 'conversation',
    });

    expect(call.state).toBe('initiated');
    expect(call.toNumber).toBe('+15550001234');
    expect(call.provider).toBe('twilio');
    expect(call.providerCallId).toBe('CA_OUT_001');
  });

  it('transitions to "ringing" on call-ringing webhook event', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ sid: 'CA_RING_001' }),
      text: async () => '{"sid":"CA_RING_001"}',
    });

    const events: string[] = [];
    manager.on((e) => { events.push(e.type); });

    await manager.initiateCall({ toNumber: '+15550001111', fromNumber: '+15559991111' });

    const body = new URLSearchParams({
      CallSid: 'CA_RING_001',
      CallStatus: 'ringing',
      From: '+15559991111',
      To: '+15550001111',
    }).toString();

    manager.processWebhook('twilio', makeCtx(body));

    const call = manager.getActiveCalls()[0];
    expect(call?.state).toBe('ringing');
    expect(events).toContain('call:ringing');
  });

  it('transitions to "answered" then "completed" via webhook events', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ sid: 'CA_FULL_001' }),
      text: async () => '{"sid":"CA_FULL_001"}',
    });

    const stateHistory: string[] = [];
    manager.on((e) => { stateHistory.push(e.type); });

    await manager.initiateCall({ toNumber: '+15550002222', fromNumber: '+15559992222' });

    const callSid = 'CA_FULL_001';

    const makeBody = (status: string) =>
      new URLSearchParams({ CallSid: callSid, CallStatus: status, From: '+15559992222', To: '+15550002222' }).toString();

    manager.processWebhook('twilio', makeCtx(makeBody('ringing')));
    manager.processWebhook('twilio', makeCtx(makeBody('in-progress')));
    manager.processWebhook('twilio', makeCtx(makeBody('completed')));

    const call = manager.getActiveCalls()[0];
    expect(call.state).toBe('completed');
    expect(stateHistory).toContain('call:ringing');
    expect(stateHistory).toContain('call:answered');
    expect(stateHistory).toContain('call:ended');
  });

  it('rejects webhook with invalid signature (403 scenario)', () => {
    const badCtx = {
      method: 'POST' as const,
      url: WEBHOOK_URL,
      headers: { 'x-twilio-signature': 'bad_signature' } as Record<string, string>,
      body: new URLSearchParams({ CallSid: 'CA_BAD', CallStatus: 'ringing' }).toString(),
    };

    // processWebhook logs a warning and returns without processing
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    manager.processWebhook('twilio', badCtx);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Webhook verification failed'));
    warnSpy.mockRestore();
  });

  it('emits call:initiated event on successful call initiation', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ sid: 'CA_EVT_001' }),
      text: async () => '{"sid":"CA_EVT_001"}',
    });

    const events: string[] = [];
    manager.on((e) => { events.push(e.type); });

    await manager.initiateCall({ toNumber: '+15550003333', fromNumber: '+15559993333' });
    expect(events).toContain('call:initiated');
  });
});
