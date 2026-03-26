/**
 * @module voice-pipeline/__tests__/WebSocketStreamTransport.spec
 *
 * Unit tests for {@link WebSocketStreamTransport}.
 *
 * A lightweight mock WebSocket is used in place of a real network socket,
 * allowing all WS events to be triggered synchronously via `emit()`.
 *
 * ## What is tested
 *
 * - Transport ID generation and initial state detection
 * - Inbound binary messages are decoded as AudioFrame and emitted as 'audio_frame'
 * - Inbound text messages are parsed as JSON and emitted as 'control'
 * - sendAudio correctly sends EncodedAudioChunk.audio as binary
 * - sendAudio correctly converts AudioFrame.samples Float32Array to Buffer
 * - sendControl JSON-stringifies the message and sends as text
 * - WebSocket lifecycle events ('open', 'close', 'error') propagate correctly
 * - close() sets state to 'closing' and delegates to ws.close()
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
    // Simulate synchronous success -- call back immediately with no error
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

  it('should expose a non-empty string id (UUID)', () => {
    expect(typeof transport.id).toBe('string');
    expect(transport.id.length).toBeGreaterThan(0);
  });

  it('should start as "open" when the underlying WS readyState is OPEN (1)', () => {
    expect(transport.state).toBe('open');
  });

  it('should start as "connecting" when the underlying WS readyState is not OPEN', () => {
    const pendingWs = createMockWS();
    pendingWs.readyState = 0; // CONNECTING
    const t = new WebSocketStreamTransport(pendingWs, { sampleRate: 16_000 });
    expect(t.state).toBe('connecting');
  });

  // -------------------------------------------------------------------------
  // Inbound binary -> 'audio_frame'
  // -------------------------------------------------------------------------

  /**
   * Binary WebSocket messages should be decoded as Float32Array PCM samples,
   * wrapped in an AudioFrame with the configured sampleRate, and emitted
   * as 'audio_frame'.
   */
  it('should emit "audio_frame" with correct AudioFrame when a binary message arrives', () => {
    const listener = vi.fn();
    transport.on('audio_frame', listener);

    // Build a Float32Array and wrap it in a Buffer the way the ws library delivers it
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
    // Verify the decoded values match the original samples
    expect(frame.samples[0]).toBeCloseTo(0.1);
    expect(frame.samples[2]).toBeCloseTo(0.3);
  });

  // -------------------------------------------------------------------------
  // Inbound text -> 'control'
  // -------------------------------------------------------------------------

  it('should emit "control" with parsed JSON when a text message arrives', () => {
    const listener = vi.fn();
    transport.on('control', listener);

    const payload = { type: 'control', action: { type: 'mute' } };
    ws.emit('message', JSON.stringify(payload));

    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0][0]).toEqual(payload);
  });

  // -------------------------------------------------------------------------
  // sendAudio -- EncodedAudioChunk
  // -------------------------------------------------------------------------

  /** The audio Buffer from an EncodedAudioChunk should be sent directly as binary. */
  it('should send the audio Buffer as binary when given an EncodedAudioChunk', async () => {
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
  // sendAudio -- AudioFrame
  // -------------------------------------------------------------------------

  /** Float32Array samples should be converted to a raw byte Buffer before sending. */
  it('should convert Float32Array samples to Buffer and send binary when given an AudioFrame', async () => {
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
    // Each float32 sample is 4 bytes
    expect(sentData.byteLength).toBe(samples.byteLength);
  });

  // -------------------------------------------------------------------------
  // sendControl
  // -------------------------------------------------------------------------

  it('should JSON-stringify the message and send as a text frame', async () => {
    const msg = { type: 'session_started' as const, sessionId: 'abc', config: {} as any };

    await transport.sendControl(msg);

    expect(ws.send).toHaveBeenCalledOnce();
    const [sentData] = ws.send.mock.calls[0];
    expect(typeof sentData).toBe('string');
    expect(JSON.parse(sentData)).toEqual(msg);
  });

  // -------------------------------------------------------------------------
  // Lifecycle -- WS 'close' event
  // -------------------------------------------------------------------------

  it('should transition to "closed" and emit "disconnected" when the WS closes', () => {
    const disconnectedListener = vi.fn();
    transport.on('disconnected', disconnectedListener);

    ws.emit('close');

    expect(transport.state).toBe('closed');
    expect(disconnectedListener).toHaveBeenCalledOnce();
  });

  // -------------------------------------------------------------------------
  // Lifecycle -- WS 'error' event
  // -------------------------------------------------------------------------

  it('should re-emit socket errors as "error" events', () => {
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

  it('should set state to "closing" and delegate to ws.close()', () => {
    transport.close(1000, 'normal');

    expect(transport.state).toBe('closing');
    expect(ws.close).toHaveBeenCalledOnce();
    expect(ws.close).toHaveBeenCalledWith(1000, 'normal');
  });

  // -------------------------------------------------------------------------
  // WS 'open' event (late-open path)
  // -------------------------------------------------------------------------

  /**
   * When a transport is created before the WebSocket handshake completes,
   * the 'open' event should transition state to 'open' and emit 'connected'.
   */
  it('should transition to "open" and emit "connected" when WS fires its open event', () => {
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
