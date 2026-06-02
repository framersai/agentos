/**
 * Unit tests for DeepgramAuraStreamingTTS.
 *
 * Uses a mock WebSocket to simulate Deepgram Aura's streaming /v1/speak API.
 * Deepgram returns audio as BINARY frames and sends control as text JSON
 * ({ type: 'Flushed' | 'Cleared' | 'Metadata' | ... }).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('ws', () => {
  const { EventEmitter: EE } = require('node:events');
  class MockWebSocket extends EE {
    static OPEN = 1;
    static CLOSED = 3;
    readyState = 1;
    send = vi.fn();
    close = vi.fn();
    constructor() {
      super();
      process.nextTick(() => this.emit('open'));
    }
  }
  return { default: MockWebSocket, WebSocket: MockWebSocket };
});

import { DeepgramAuraStreamingTTS } from '../providers/DeepgramAuraStreamingTTS.js';

describe('DeepgramAuraStreamingTTS', () => {
  let tts: DeepgramAuraStreamingTTS;

  beforeEach(() => {
    tts = new DeepgramAuraStreamingTTS({ apiKey: 'dg-key', voice: 'aura-2-thalia-en' });
  });

  it('has providerId deepgram-aura', () => {
    expect(tts.providerId).toBe('deepgram-aura');
  });

  it('creates a session with the streaming methods', async () => {
    const session = await tts.startSession();
    expect(typeof session.pushTokens).toBe('function');
    expect(typeof session.flush).toBe('function');
    expect(typeof session.cancel).toBe('function');
    expect(typeof session.close).toBe('function');
  });

  it('sends a Speak control message on pushTokens', async () => {
    const session = await tts.startSession();
    const ws = (session as any).ws;
    ws.send.mockClear();
    session.pushTokens('Hello there');
    expect(ws.send).toHaveBeenCalledOnce();
    expect(JSON.parse(ws.send.mock.calls[0][0])).toEqual({ type: 'Speak', text: 'Hello there' });
  });

  it('emits an audio chunk for an inbound binary frame', async () => {
    const session = await tts.startSession();
    const listener = vi.fn();
    session.on('audio', listener);
    session.pushTokens('hi');

    const ws = (session as any).ws;
    ws.emit('message', Buffer.from([1, 2, 3, 4]), true); // binary audio frame

    expect(listener).toHaveBeenCalledOnce();
    const chunk = listener.mock.calls[0][0];
    expect(Buffer.isBuffer(chunk.audio)).toBe(true);
    expect(chunk.audio.byteLength).toBe(4);
    expect(chunk.text).toBe('hi');
  });

  it('ignores non-audio JSON control frames (no audio emit)', async () => {
    const session = await tts.startSession();
    const listener = vi.fn();
    session.on('audio', listener);
    const ws = (session as any).ws;
    ws.emit('message', JSON.stringify({ type: 'Metadata', request_id: 'x' }), false);
    expect(listener).not.toHaveBeenCalled();
  });

  it('sends Flush and resolves flush on a Flushed control message', async () => {
    const session = await tts.startSession();
    const flushDone = vi.fn();
    session.on('flush_complete', flushDone);
    const ws = (session as any).ws;
    ws.send.mockClear();

    const p = session.flush();
    expect(JSON.parse(ws.send.mock.calls[0][0])).toEqual({ type: 'Flush' });

    ws.emit('message', JSON.stringify({ type: 'Flushed' }), false);
    await p;
    expect(flushDone).toHaveBeenCalledOnce();
  });

  it('sends Clear on cancel', async () => {
    const session = await tts.startSession();
    const ws = (session as any).ws;
    ws.send.mockClear();
    session.cancel();
    expect(JSON.parse(ws.send.mock.calls[0][0])).toEqual({ type: 'Clear' });
  });
});
