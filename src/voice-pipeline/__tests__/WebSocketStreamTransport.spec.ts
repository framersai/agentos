/**
 * @module voice-pipeline/__tests__/WebSocketStreamTransport.spec.ts
 *
 * Unit tests for {@link WebSocketStreamTransport}.
 *
 * A lightweight mock WebSocket is used in place of a real network socket,
 * allowing all WS events to be triggered synchronously via `emit()`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { WebSocketStreamTransport } from '../WebSocketStreamTransport.js';
import type { AudioFrame, EncodedAudioChunk } from '../types.js';

// ---------------------------------------------------------------------------
// Mock WebSocket factory
// ---------------------------------------------------------------------------

/**
 * Creates a minimal WebSocket-like object sufficient for testing the transport.
 * Extends EventEmitter so WS lifecycle events can be triggered via `.emit()`.
 */
function createMockWS() {
  const ws = new EventEmitter() as any;
  ws.readyState = 1; // OPEN
  ws.send = vi.fn((_data: unknown, cb?: (err?: Error) => void) => {
    // Simulate synchronous success — call back immediately with no error
    if (typeof cb === 'function') cb(undefined);
  });
  ws.close = vi.fn();
  ws.OPEN = 1;
  ws.CLOSED = 3;
  return ws;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Construct a transport with default config (16 kHz) around the given mock. */
function makeTransport(ws: ReturnType<typeof createMockWS>) {
  return new WebSocketStreamTransport(ws, { sampleRate: 16_000 });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WebSocketStreamTransport', () => {
  let ws: ReturnType<typeof createMockWS>;
  let transport: WebSocketStreamTransport;

  beforeEach(() => {
    ws = createMockWS();
    transport = makeTransport(ws);
  });

  // -------------------------------------------------------------------------
  // Identity and initial state
  // -------------------------------------------------------------------------

  it('exposes a string id', () => {
    expect(typeof transport.id).toBe('string');
    expect(transport.id.length).toBeGreaterThan(0);
  });

  it('starts as "open" when the underlying WS readyState is OPEN (1)', () => {
    expect(transport.state).toBe('open');
  });

  it('starts as "connecting" when the underlying WS is not yet open', () => {
    const pendingWs = createMockWS();
    pendingWs.readyState = 0; // CONNECTING
    const t = new WebSocketStreamTransport(pendingWs, { sampleRate: 16_000 });
    expect(t.state).toBe('connecting');
  });

  // -------------------------------------------------------------------------
  // Inbound binary → 'audio_frame'
  // -------------------------------------------------------------------------

  it('emits "audio_frame" with an AudioFrame when a binary message is received', () => {
    const listener = vi.fn();
    transport.on('audio_frame', listener);

    // Build a small Float32Array and wrap it in a Buffer the way ws delivers it
    const samples = new Float32Array([0.1, -0.2, 0.3, -0.4]);
    const buf = Buffer.from(samples.buffer);

    ws.emit('message', buf);

    expect(listener).toHaveBeenCalledOnce();
    const frame: AudioFrame = listener.mock.calls[0][0];
    expect(frame).toHaveProperty('samples');
    expect(frame.sampleRate).toBe(16_000);
    expect(typeof frame.timestamp).toBe('number');
    expect(frame.samples).toBeInstanceOf(Float32Array);
    expect(frame.samples.length).toBe(4);
    // Values should match the original samples
    expect(frame.samples[0]).toBeCloseTo(0.1);
    expect(frame.samples[2]).toBeCloseTo(0.3);
  });

  // -------------------------------------------------------------------------
  // Inbound text → 'control'
  // -------------------------------------------------------------------------

  it('emits "control" with parsed JSON when a text message is received', () => {
    const listener = vi.fn();
    transport.on('control', listener);

    const payload = { type: 'control', action: { type: 'mute' } };
    ws.emit('message', JSON.stringify(payload));

    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0][0]).toEqual(payload);
  });

  // -------------------------------------------------------------------------
  // sendAudio — EncodedAudioChunk
  // -------------------------------------------------------------------------

  it('sends the audio Buffer as binary when given an EncodedAudioChunk', async () => {
    const chunk: EncodedAudioChunk = {
      audio: Buffer.from([0xde, 0xad, 0xbe, 0xef]),
      format: 'opus',
      sampleRate: 24_000,
      durationMs: 20,
      text: 'hello',
    };

    await transport.sendAudio(chunk);

    expect(ws.send).toHaveBeenCalledOnce();
    const [sentData] = ws.send.mock.calls[0];
    expect(Buffer.isBuffer(sentData)).toBe(true);
    expect(sentData).toEqual(chunk.audio);
  });

  // -------------------------------------------------------------------------
  // sendAudio — AudioFrame
  // -------------------------------------------------------------------------

  it('converts Float32Array samples to a Buffer and sends binary when given an AudioFrame', async () => {
    const samples = new Float32Array([0.5, -0.5, 0.25]);
    const frame: AudioFrame = {
      samples,
      sampleRate: 16_000,
      timestamp: Date.now(),
    };

    await transport.sendAudio(frame);

    expect(ws.send).toHaveBeenCalledOnce();
    const [sentData] = ws.send.mock.calls[0];
    expect(Buffer.isBuffer(sentData)).toBe(true);
    expect(sentData.byteLength).toBe(samples.byteLength);
  });

  // -------------------------------------------------------------------------
  // sendControl
  // -------------------------------------------------------------------------

  it('JSON-stringifies the message and sends as text', async () => {
    const msg = { type: 'session_started' as const, sessionId: 'abc', config: {} as any };

    await transport.sendControl(msg);

    expect(ws.send).toHaveBeenCalledOnce();
    const [sentData] = ws.send.mock.calls[0];
    expect(typeof sentData).toBe('string');
    expect(JSON.parse(sentData)).toEqual(msg);
  });

  // -------------------------------------------------------------------------
  // Lifecycle — WS 'close' event
  // -------------------------------------------------------------------------

  it('transitions to "closed" and emits "disconnected" when the WS closes', () => {
    const disconnectedListener = vi.fn();
    transport.on('disconnected', disconnectedListener);

    ws.emit('close');

    expect(transport.state).toBe('closed');
    expect(disconnectedListener).toHaveBeenCalledOnce();
  });

  // -------------------------------------------------------------------------
  // Lifecycle — WS 'error' event
  // -------------------------------------------------------------------------

  it('re-emits socket errors as "error" events', () => {
    const errorListener = vi.fn();
    transport.on('error', errorListener);

    const socketError = new Error('ECONNRESET');
    ws.emit('error', socketError);

    expect(errorListener).toHaveBeenCalledOnce();
    expect(errorListener.mock.calls[0][0]).toBe(socketError);
  });

  // -------------------------------------------------------------------------
  // close()
  // -------------------------------------------------------------------------

  it('sets state to "closing" and calls ws.close()', () => {
    transport.close(1000, 'normal');

    expect(transport.state).toBe('closing');
    expect(ws.close).toHaveBeenCalledOnce();
    expect(ws.close).toHaveBeenCalledWith(1000, 'normal');
  });

  // -------------------------------------------------------------------------
  // WS 'open' event (late-open path)
  // -------------------------------------------------------------------------

  it('transitions to "open" and emits "connected" when the WS fires its open event', () => {
    const pendingWs = createMockWS();
    pendingWs.readyState = 0; // CONNECTING
    const t = new WebSocketStreamTransport(pendingWs, { sampleRate: 16_000 });
    expect(t.state).toBe('connecting');

    const connectedListener = vi.fn();
    t.on('connected', connectedListener);

    pendingWs.emit('open');

    expect(t.state).toBe('open');
    expect(connectedListener).toHaveBeenCalledOnce();
  });
});
