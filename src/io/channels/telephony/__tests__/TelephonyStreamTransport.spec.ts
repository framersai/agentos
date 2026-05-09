/**
 * @fileoverview Unit tests for {@link TelephonyStreamTransport}.
 *
 * Exercises the full transport lifecycle: WebSocket message -> parser ->
 * audio conversion -> event emission. Uses mocked WebSocket and
 * MediaStreamParser to isolate the transport's logic from provider specifics.
 *
 * Tests cover:
 * - State machine transitions (connecting -> open -> closing -> closed).
 * - Inbound audio path: mu-law -> PCM -> resample -> Float32 -> AudioFrame.
 * - Outbound audio path: PCM -> resample -> mu-law -> formatOutgoing -> ws.send.
 * - DTMF event relay.
 * - Mark event relay.
 * - Connection acknowledgment (formatConnected).
 * - WebSocket error propagation.
 * - Double-close prevention.
 * - Null parse result handling.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { TelephonyStreamTransport } from '../TelephonyStreamTransport.js';
import type { MediaStreamParser, MediaStreamIncoming } from '../MediaStreamParser.js';
import type { EncodedAudioChunk } from '../../../voice-pipeline/types.js';

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

/** Create a mock WebSocket-like EventEmitter with send() and close() stubs. */
function createMockWS() {
  const ws = new EventEmitter() as any;
  ws.send = vi.fn();
  ws.close = vi.fn();
  return ws;
}

/** Create a mock MediaStreamParser with all methods as vi.fn() stubs. */
function createMockParser(): MediaStreamParser {
  return {
    parseIncoming: vi.fn(),
    formatOutgoing: vi.fn((audio: Buffer, sid: string) => `formatted:${sid}`),
    formatConnected: vi.fn((sid: string) => `connected:${sid}`),
  };
}

/**
 * Build a minimal mu-law Buffer for testing.
 * 0x7f decodes to silence in the mu-law expansion table.
 */
function mulawPayload(length = 8): Buffer {
  return Buffer.alloc(length, 0x7f);
}

// ---------------------------------------------------------------------------
// Helpers for firing WS messages through the mock parser
// ---------------------------------------------------------------------------

/** Simulate a provider 'start' event arriving on the WebSocket. */
function emitStartMessage(ws: any, parser: MediaStreamParser, streamSid = 'STREAM_001') {
  const event: MediaStreamIncoming = {
    type: 'start',
    streamSid,
    callSid: 'CALL_001',
  };
  (parser.parseIncoming as ReturnType<typeof vi.fn>).mockReturnValueOnce(event);
  ws.emit('message', Buffer.from('{}'));
}

/** Simulate a provider 'audio' event arriving on the WebSocket. */
function emitAudioMessage(ws: any, parser: MediaStreamParser, streamSid = 'STREAM_001') {
  const event: MediaStreamIncoming = {
    type: 'audio',
    streamSid,
    payload: mulawPayload(16),
  };
  (parser.parseIncoming as ReturnType<typeof vi.fn>).mockReturnValueOnce(event);
  ws.emit('message', Buffer.from('{}'));
}

/** Simulate a provider 'dtmf' event arriving on the WebSocket. */
function emitDtmfMessage(ws: any, parser: MediaStreamParser, digit = '5', durationMs = 150) {
  const event: MediaStreamIncoming = {
    type: 'dtmf',
    streamSid: 'STREAM_001',
    digit,
    durationMs,
  };
  (parser.parseIncoming as ReturnType<typeof vi.fn>).mockReturnValueOnce(event);
  ws.emit('message', Buffer.from('{}'));
}

/** Simulate a provider 'stop' event arriving on the WebSocket. */
function emitStopMessage(ws: any, parser: MediaStreamParser) {
  const event: MediaStreamIncoming = {
    type: 'stop',
    streamSid: 'STREAM_001',
  };
  (parser.parseIncoming as ReturnType<typeof vi.fn>).mockReturnValueOnce(event);
  ws.emit('message', Buffer.from('{}'));
}

/** Simulate a provider 'mark' event arriving on the WebSocket. */
function emitMarkMessage(ws: any, parser: MediaStreamParser, name = 'flush-complete') {
  const event: MediaStreamIncoming = {
    type: 'mark',
    streamSid: 'STREAM_001',
    name,
  };
  (parser.parseIncoming as ReturnType<typeof vi.fn>).mockReturnValueOnce(event);
  ws.emit('message', Buffer.from('{}'));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TelephonyStreamTransport', () => {
  let ws: ReturnType<typeof createMockWS>;
  let parser: MediaStreamParser;
  let transport: TelephonyStreamTransport;

  beforeEach(() => {
    ws = createMockWS();
    parser = createMockParser();
    transport = new TelephonyStreamTransport(ws, parser);
  });

  // -------------------------------------------------------------------------
  // 1. Initial state
  // -------------------------------------------------------------------------

  it('should start in "connecting" state before any provider messages arrive', () => {
    expect(transport.state).toBe('connecting');
  });

  it('should have a stable UUID v4 id for transport identification', () => {
    expect(transport.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  // -------------------------------------------------------------------------
  // 2. 'start' message -> state 'open', sends connected message
  // -------------------------------------------------------------------------

  it('should transition to "open" when a start message arrives from the provider', () => {
    emitStartMessage(ws, parser);
    expect(transport.state).toBe('open');
  });

  it('should send the formatConnected message to the WebSocket on start', () => {
    emitStartMessage(ws, parser, 'SID_42');
    expect(ws.send).toHaveBeenCalledWith('connected:SID_42');
  });

  it('should not send a connected message when formatConnected returns null', () => {
    // Simulates Telnyx/Plivo behaviour where no handshake is needed.
    (parser.formatConnected as ReturnType<typeof vi.fn>).mockReturnValueOnce(null);
    emitStartMessage(ws, parser);
    expect(ws.send).not.toHaveBeenCalled();
  });

  it('should not send a connected message when formatConnected is not defined on the parser', () => {
    // Some parser implementations may omit formatConnected entirely.
    delete (parser as any).formatConnected;
    emitStartMessage(ws, parser);
    expect(ws.send).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 3. 'audio' message -> emits 'audio' AudioFrame
  // -------------------------------------------------------------------------

  it('should emit an "audio" event with a Float32Array when audio messages arrive', () => {
    emitStartMessage(ws, parser);

    const frames: any[] = [];
    transport.on('audio', (f) => frames.push(f));
    emitAudioMessage(ws, parser);

    expect(frames).toHaveLength(1);
    expect(frames[0].samples).toBeInstanceOf(Float32Array);
  });

  it('should emit AudioFrame with the configured outputSampleRate when custom rate is set', () => {
    // Use isolated ws/parser so the mockReturnValueOnce calls don't interfere.
    const ws2 = createMockWS();
    const parser2 = createMockParser();
    const customTransport = new TelephonyStreamTransport(ws2, parser2, { outputSampleRate: 24000 });
    emitStartMessage(ws2, parser2);

    const frames: any[] = [];
    customTransport.on('audio', (f) => frames.push(f));
    emitAudioMessage(ws2, parser2);

    expect(frames[0].sampleRate).toBe(24000);
  });

  it('should emit AudioFrame with default sampleRate 16000 when no config is provided', () => {
    emitStartMessage(ws, parser);

    const frames: any[] = [];
    transport.on('audio', (f) => frames.push(f));
    emitAudioMessage(ws, parser);

    expect(frames[0].sampleRate).toBe(16000);
  });

  it('should emit AudioFrame with a numeric timestamp for chronological ordering', () => {
    emitStartMessage(ws, parser);

    const frames: any[] = [];
    transport.on('audio', (f) => frames.push(f));
    emitAudioMessage(ws, parser);

    expect(typeof frames[0].timestamp).toBe('number');
    expect(frames[0].timestamp).toBeGreaterThan(0);
  });

  it('should normalise Float32Array samples to the [-1, 1] range', () => {
    emitStartMessage(ws, parser);

    const frames: any[] = [];
    transport.on('audio', (f) => frames.push(f));
    emitAudioMessage(ws, parser);

    // Every sample must be within the WebAudio / Whisper expected range.
    const { samples } = frames[0] as { samples: Float32Array };
    for (let i = 0; i < samples.length; i++) {
      expect(samples[i]).toBeGreaterThanOrEqual(-1);
      expect(samples[i]).toBeLessThanOrEqual(1);
    }
  });

  // -------------------------------------------------------------------------
  // 4. 'dtmf' message -> emits 'dtmf'
  // -------------------------------------------------------------------------

  it('should emit a "dtmf" event with digit and durationMs when a DTMF key is pressed', () => {
    emitStartMessage(ws, parser);

    const dtmfEvents: any[] = [];
    transport.on('dtmf', (e) => dtmfEvents.push(e));
    emitDtmfMessage(ws, parser, '#', 200);

    expect(dtmfEvents).toHaveLength(1);
    expect(dtmfEvents[0].digit).toBe('#');
    expect(dtmfEvents[0].durationMs).toBe(200);
  });

  // -------------------------------------------------------------------------
  // 5. 'stop' message -> emits 'close', state 'closed'
  // -------------------------------------------------------------------------

  it('should transition to "closed" when a stop message arrives', () => {
    emitStartMessage(ws, parser);
    emitStopMessage(ws, parser);
    expect(transport.state).toBe('closed');
  });

  it('should emit "close" when a stop message arrives', () => {
    emitStartMessage(ws, parser);

    let closed = false;
    transport.on('close', () => { closed = true; });
    emitStopMessage(ws, parser);

    expect(closed).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 6. sendAudio -> converts PCM to mu-law, calls parser.formatOutgoing
  // -------------------------------------------------------------------------

  it('should call formatOutgoing and ws.send when sending audio to the caller', async () => {
    emitStartMessage(ws, parser, 'STREAM_SEND');
    ws.send.mockClear(); // Clear the 'connected' send call.

    const pcmSamples = new Int16Array(160).fill(1000); // 10 ms at 16 kHz
    const chunk: EncodedAudioChunk = {
      audio: Buffer.from(pcmSamples.buffer),
      format: 'pcm',
      sampleRate: 16000,
      durationMs: 10,
      text: 'hello',
    };

    await transport.sendAudio(chunk);

    expect(parser.formatOutgoing).toHaveBeenCalledOnce();
    const [mulawBuf, sid] = (parser.formatOutgoing as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(Buffer.isBuffer(mulawBuf)).toBe(true);
    expect(sid).toBe('STREAM_SEND');
    expect(ws.send).toHaveBeenCalledWith('formatted:STREAM_SEND');
  });

  it('should be a no-op when sendAudio is called before the stream is open', async () => {
    // Still in 'connecting' state -- no start message has been received.
    const chunk: EncodedAudioChunk = {
      audio: Buffer.alloc(32),
      format: 'pcm',
      sampleRate: 16000,
      durationMs: 10,
      text: '',
    };
    await transport.sendAudio(chunk);
    expect(ws.send).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 7. sendControl -> JSON.stringify, ws.send
  // -------------------------------------------------------------------------

  it('should send JSON-serialised control messages over the WebSocket when open', async () => {
    emitStartMessage(ws, parser);
    ws.send.mockClear();

    const msg = { type: 'session_ended' as const, reason: 'done' };
    await transport.sendControl(msg);

    expect(ws.send).toHaveBeenCalledWith(JSON.stringify(msg));
  });

  it('should be a no-op when sendControl is called before the stream is open', async () => {
    const msg = { type: 'session_ended' as const };
    await transport.sendControl(msg);
    expect(ws.send).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 8. close -> state 'closing', ws.close called
  // -------------------------------------------------------------------------

  it('should set state to "closing" and call ws.close with the provided code and reason', () => {
    emitStartMessage(ws, parser);
    transport.close(1000, 'bye');
    expect(transport.state).toBe('closing');
    expect(ws.close).toHaveBeenCalledWith(1000, 'bye');
  });

  it('should work without optional close arguments', () => {
    transport.close();
    expect(ws.close).toHaveBeenCalledWith(undefined, undefined);
  });

  // -------------------------------------------------------------------------
  // 9. WS error -> emits 'error'
  // -------------------------------------------------------------------------

  it('should re-emit WebSocket errors as "error" events for upstream handling', () => {
    const errors: Error[] = [];
    transport.on('error', (e) => errors.push(e));

    const err = new Error('socket exploded');
    ws.emit('error', err);

    expect(errors).toHaveLength(1);
    expect(errors[0]).toBe(err);
  });

  // -------------------------------------------------------------------------
  // 10. WS close -> emits 'close' unless already closed
  // -------------------------------------------------------------------------

  it('should emit "close" and transition to "closed" when the WebSocket closes unexpectedly', () => {
    let closed = false;
    transport.on('close', () => { closed = true; });
    ws.emit('close');
    expect(closed).toBe(true);
    expect(transport.state).toBe('closed');
  });

  it('should not double-emit "close" when WS close fires after a stop message already closed it', () => {
    emitStartMessage(ws, parser);
    emitStopMessage(ws, parser);

    let closeCount = 0;
    transport.on('close', () => { closeCount++; });

    // WS close fires after stop -- should be a no-op since already 'closed'.
    ws.emit('close');
    expect(closeCount).toBe(0);
  });

  // -------------------------------------------------------------------------
  // 11. null parse result is silently ignored
  // -------------------------------------------------------------------------

  it('should silently ignore null parseIncoming results (heartbeats, unknown messages)', () => {
    (parser.parseIncoming as ReturnType<typeof vi.fn>).mockReturnValueOnce(null);
    // Should not throw, emit, or change state.
    ws.emit('message', Buffer.from('heartbeat'));
    expect(transport.state).toBe('connecting');
  });

  // -------------------------------------------------------------------------
  // 12. 'mark' message -> emits 'mark'
  // -------------------------------------------------------------------------

  it('should emit a "mark" event with the marker name for audio sync tracking', () => {
    emitStartMessage(ws, parser);

    const marks: any[] = [];
    transport.on('mark', (m) => marks.push(m));
    emitMarkMessage(ws, parser, 'tts-done');

    expect(marks).toHaveLength(1);
    expect(marks[0].name).toBe('tts-done');
  });
});
