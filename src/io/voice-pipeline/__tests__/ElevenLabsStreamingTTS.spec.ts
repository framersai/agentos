/**
 * Unit tests for ElevenLabsStreamingTTS provider.
 *
 * Uses a mock WebSocket to simulate ElevenLabs' streaming API responses.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';

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

import { ElevenLabsStreamingTTS } from '../providers/ElevenLabsStreamingTTS.js';

describe('ElevenLabsStreamingTTS', () => {
  let tts: ElevenLabsStreamingTTS;

  beforeEach(() => {
    tts = new ElevenLabsStreamingTTS({
      apiKey: 'test-key-123',
      voiceId: 'test-voice-id',
    });
  });

  it('should have correct provider metadata', () => {
    expect(tts.providerId).toBe('elevenlabs-streaming');
  });

  it('should create a session that resolves on open', async () => {
    const session = await tts.startSession({ voice: 'test-voice-id' });
    expect(session).toBeDefined();
    expect(typeof session.pushTokens).toBe('function');
    expect(typeof session.flush).toBe('function');
    expect(typeof session.cancel).toBe('function');
    expect(typeof session.close).toBe('function');
  });

  it('should send BOS message on connection', async () => {
    const session = await tts.startSession();
    const ws = (session as any).ws;

    // First call is the BOS (beginning of stream) message
    expect(ws.send).toHaveBeenCalledOnce();
    const bosMsg = JSON.parse(ws.send.mock.calls[0][0]);
    expect(bosMsg).toHaveProperty('text', ' ');
    expect(bosMsg).toHaveProperty('voice_settings');
    expect(bosMsg).toHaveProperty('generation_config');
  });

  it('should send text tokens as JSON messages', async () => {
    const session = await tts.startSession();
    const ws = (session as any).ws;
    ws.send.mockClear();

    session.pushTokens('Hello ');
    session.pushTokens('world!');

    expect(ws.send).toHaveBeenCalledTimes(2);
    expect(JSON.parse(ws.send.mock.calls[0][0])).toEqual({ text: 'Hello ' });
    expect(JSON.parse(ws.send.mock.calls[1][0])).toEqual({ text: 'world!' });
  });

  it('should emit audio events when receiving audio chunks', async () => {
    const session = await tts.startSession();
    const audioListener = vi.fn();
    session.on('audio', audioListener);

    const ws = (session as any).ws;
    // Simulate an audio response with base64-encoded data
    const fakeAudio = Buffer.from('fake-mp3-data').toString('base64');
    ws.emit(
      'message',
      JSON.stringify({
        audio: fakeAudio,
        isFinal: false,
      })
    );

    expect(audioListener).toHaveBeenCalledOnce();
    const chunk = audioListener.mock.calls[0][0];
    expect(chunk.format).toBe('mp3');
    expect(chunk.sampleRate).toBe(44100);
    expect(Buffer.isBuffer(chunk.audio)).toBe(true);
    expect(chunk.durationMs).toBeGreaterThan(0);
  });

  it('should emit flush_complete when isFinal is received after flush', async () => {
    const session = await tts.startSession();
    const flushListener = vi.fn();
    session.on('flush_complete', flushListener);

    const ws = (session as any).ws;
    ws.send.mockClear();

    // Start flush (sends EOS message)
    const flushPromise = session.flush();

    // Verify EOS was sent
    expect(ws.send).toHaveBeenCalledOnce();
    expect(JSON.parse(ws.send.mock.calls[0][0])).toEqual({ text: '' });

    // Simulate final response
    ws.emit('message', JSON.stringify({ isFinal: true }));

    await flushPromise;
    expect(flushListener).toHaveBeenCalledOnce();
  });

  it('should close the WebSocket on cancel', async () => {
    const session = await tts.startSession();
    const ws = (session as any).ws;

    session.cancel();

    expect(ws.close).toHaveBeenCalledOnce();
  });
});
