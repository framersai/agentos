import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { TelephonyStreamTransport } from '../TelephonyStreamTransport.js';
import type { MediaStreamParser, MediaStreamIncoming } from '../MediaStreamParser.js';
import type { EncodedAudioChunk } from '../../voice-pipeline/types.js';

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function createMockWS() {
  const ws = new EventEmitter() as any;
  ws.send = vi.fn();
  ws.close = vi.fn();
  return ws;
}

function createMockParser(): MediaStreamParser {
  return {
    parseIncoming: vi.fn(),
    formatOutgoing: vi.fn((audio: Buffer, sid: string) => `formatted:${sid}`),
    formatConnected: vi.fn((sid: string) => `connected:${sid}`),
  };
}

/** Build a minimal mu-law Buffer — a single zero-value byte. */
function mulawPayload(length = 8): Buffer {
  return Buffer.alloc(length, 0x7f); // 0x7f decodes to silence
}

// ---------------------------------------------------------------------------
// Helpers for firing WS messages
// ---------------------------------------------------------------------------

function emitStartMessage(ws: any, parser: MediaStreamParser, streamSid = 'STREAM_001') {
  const event: MediaStreamIncoming = {
    type: 'start',
    streamSid,
    callSid: 'CALL_001',
  };
  (parser.parseIncoming as ReturnType<typeof vi.fn>).mockReturnValueOnce(event);
  ws.emit('message', Buffer.from('{}'));
}

function emitAudioMessage(ws: any, parser: MediaStreamParser, streamSid = 'STREAM_001') {
  const event: MediaStreamIncoming = {
    type: 'audio',
    streamSid,
    payload: mulawPayload(16),
  };
  (parser.parseIncoming as ReturnType<typeof vi.fn>).mockReturnValueOnce(event);
  ws.emit('message', Buffer.from('{}'));
}

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

function emitStopMessage(ws: any, parser: MediaStreamParser) {
  const event: MediaStreamIncoming = {
    type: 'stop',
    streamSid: 'STREAM_001',
  };
  (parser.parseIncoming as ReturnType<typeof vi.fn>).mockReturnValueOnce(event);
  ws.emit('message', Buffer.from('{}'));
}

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

  it('starts in "connecting" state', () => {
    expect(transport.state).toBe('connecting');
  });

  it('has a stable UUID id', () => {
    expect(transport.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  // -------------------------------------------------------------------------
  // 2. 'start' message → state 'open', sends connected message
  // -------------------------------------------------------------------------

  it('transitions to "open" on start message', () => {
    emitStartMessage(ws, parser);
    expect(transport.state).toBe('open');
  });

  it('sends the formatConnected message on start', () => {
    emitStartMessage(ws, parser, 'SID_42');
    expect(ws.send).toHaveBeenCalledWith('connected:SID_42');
  });

  it('does not send a connected message if formatConnected returns null', () => {
    (parser.formatConnected as ReturnType<typeof vi.fn>).mockReturnValueOnce(null);
    emitStartMessage(ws, parser);
    expect(ws.send).not.toHaveBeenCalled();
  });

  it('does not send a connected message if formatConnected is not defined', () => {
    delete (parser as any).formatConnected;
    emitStartMessage(ws, parser);
    expect(ws.send).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 3. 'audio' message → emits 'audio' AudioFrame
  // -------------------------------------------------------------------------

  it('emits an "audio" event with a Float32Array on audio messages', () => {
    emitStartMessage(ws, parser);

    const frames: any[] = [];
    transport.on('audio', (f) => frames.push(f));
    emitAudioMessage(ws, parser);

    expect(frames).toHaveLength(1);
    expect(frames[0].samples).toBeInstanceOf(Float32Array);
  });

  it('emits AudioFrame with the configured outputSampleRate', () => {
    // Use isolated ws/parser so the mockReturnValueOnce calls are not shared
    // with the transport created in beforeEach.
    const ws2 = createMockWS();
    const parser2 = createMockParser();
    const customTransport = new TelephonyStreamTransport(ws2, parser2, { outputSampleRate: 24000 });
    emitStartMessage(ws2, parser2);

    const frames: any[] = [];
    customTransport.on('audio', (f) => frames.push(f));
    emitAudioMessage(ws2, parser2);

    expect(frames[0].sampleRate).toBe(24000);
  });

  it('emits AudioFrame with default sampleRate 16000', () => {
    emitStartMessage(ws, parser);

    const frames: any[] = [];
    transport.on('audio', (f) => frames.push(f));
    emitAudioMessage(ws, parser);

    expect(frames[0].sampleRate).toBe(16000);
  });

  it('emits AudioFrame with a numeric timestamp', () => {
    emitStartMessage(ws, parser);

    const frames: any[] = [];
    transport.on('audio', (f) => frames.push(f));
    emitAudioMessage(ws, parser);

    expect(typeof frames[0].timestamp).toBe('number');
    expect(frames[0].timestamp).toBeGreaterThan(0);
  });

  it('normalises Float32Array samples to [-1, 1]', () => {
    emitStartMessage(ws, parser);

    const frames: any[] = [];
    transport.on('audio', (f) => frames.push(f));
    emitAudioMessage(ws, parser);

    const { samples } = frames[0] as { samples: Float32Array };
    for (let i = 0; i < samples.length; i++) {
      expect(samples[i]).toBeGreaterThanOrEqual(-1);
      expect(samples[i]).toBeLessThanOrEqual(1);
    }
  });

  // -------------------------------------------------------------------------
  // 4. 'dtmf' message → emits 'dtmf'
  // -------------------------------------------------------------------------

  it('emits a "dtmf" event with digit and durationMs', () => {
    emitStartMessage(ws, parser);

    const dtmfEvents: any[] = [];
    transport.on('dtmf', (e) => dtmfEvents.push(e));
    emitDtmfMessage(ws, parser, '#', 200);

    expect(dtmfEvents).toHaveLength(1);
    expect(dtmfEvents[0].digit).toBe('#');
    expect(dtmfEvents[0].durationMs).toBe(200);
  });

  // -------------------------------------------------------------------------
  // 5. 'stop' message → emits 'close', state 'closed'
  // -------------------------------------------------------------------------

  it('transitions to "closed" on stop message', () => {
    emitStartMessage(ws, parser);
    emitStopMessage(ws, parser);
    expect(transport.state).toBe('closed');
  });

  it('emits "close" on stop message', () => {
    emitStartMessage(ws, parser);

    let closed = false;
    transport.on('close', () => { closed = true; });
    emitStopMessage(ws, parser);

    expect(closed).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 6. sendAudio → converts PCM to mu-law, calls parser.formatOutgoing, ws.send
  // -------------------------------------------------------------------------

  it('sendAudio calls formatOutgoing and ws.send', async () => {
    emitStartMessage(ws, parser, 'STREAM_SEND');
    ws.send.mockClear(); // clear the 'connected' send call

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

  it('sendAudio is a no-op when state is not "open"', async () => {
    // Still in 'connecting' state — no start message sent
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
  // 7. sendControl → JSON.stringify, ws.send
  // -------------------------------------------------------------------------

  it('sendControl sends JSON over the WebSocket', async () => {
    emitStartMessage(ws, parser);
    ws.send.mockClear();

    const msg = { type: 'session_ended' as const, reason: 'done' };
    await transport.sendControl(msg);

    expect(ws.send).toHaveBeenCalledWith(JSON.stringify(msg));
  });

  it('sendControl is a no-op when state is not "open"', async () => {
    const msg = { type: 'session_ended' as const };
    await transport.sendControl(msg);
    expect(ws.send).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 8. close → state 'closing', ws.close called
  // -------------------------------------------------------------------------

  it('sets state to "closing" and calls ws.close', () => {
    emitStartMessage(ws, parser);
    transport.close(1000, 'bye');
    expect(transport.state).toBe('closing');
    expect(ws.close).toHaveBeenCalledWith(1000, 'bye');
  });

  it('close works without optional arguments', () => {
    transport.close();
    expect(ws.close).toHaveBeenCalledWith(undefined, undefined);
  });

  // -------------------------------------------------------------------------
  // 9. WS error → emits 'error'
  // -------------------------------------------------------------------------

  it('re-emits WebSocket errors as "error" events', () => {
    const errors: Error[] = [];
    transport.on('error', (e) => errors.push(e));

    const err = new Error('socket exploded');
    ws.emit('error', err);

    expect(errors).toHaveLength(1);
    expect(errors[0]).toBe(err);
  });

  // -------------------------------------------------------------------------
  // 10. WS close → emits 'close' unless already closed
  // -------------------------------------------------------------------------

  it('emits "close" when the WebSocket closes unexpectedly', () => {
    let closed = false;
    transport.on('close', () => { closed = true; });
    ws.emit('close');
    expect(closed).toBe(true);
    expect(transport.state).toBe('closed');
  });

  it('does not double-emit "close" if already closed via stop message', () => {
    emitStartMessage(ws, parser);
    emitStopMessage(ws, parser);

    let closeCount = 0;
    transport.on('close', () => { closeCount++; });

    // WS close fires after stop — should be a no-op since already 'closed'
    ws.emit('close');
    expect(closeCount).toBe(0);
  });

  // -------------------------------------------------------------------------
  // 11. null parse result is silently ignored
  // -------------------------------------------------------------------------

  it('ignores null parseIncoming results', () => {
    (parser.parseIncoming as ReturnType<typeof vi.fn>).mockReturnValueOnce(null);
    // Should not throw or emit anything
    ws.emit('message', Buffer.from('heartbeat'));
    expect(transport.state).toBe('connecting');
  });

  // -------------------------------------------------------------------------
  // 12. 'mark' message → emits 'mark'
  // -------------------------------------------------------------------------

  it('emits a "mark" event with the marker name', () => {
    emitStartMessage(ws, parser);

    const marks: any[] = [];
    transport.on('mark', (m) => marks.push(m));
    emitMarkMessage(ws, parser, 'tts-done');

    expect(marks).toHaveLength(1);
    expect(marks[0].name).toBe('tts-done');
  });
});
