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

import { OpenAIRealtimeTTS } from '../providers/OpenAIRealtimeTTS.js';

describe('OpenAIRealtimeTTS', () => {
  let tts: OpenAIRealtimeTTS;

  beforeEach(() => {
    tts = new OpenAIRealtimeTTS({ apiKey: 'test-key' });
  });

  it('has correct providerId', () => {
    expect(tts.providerId).toBe('openai-realtime');
  });

  it('creates a session with pushTokens and flush', async () => {
    const session = await tts.startSession({ voice: 'alloy' });
    expect(typeof session.pushTokens).toBe('function');
    expect(typeof session.flush).toBe('function');
    expect(typeof session.cancel).toBe('function');
    expect(typeof session.close).toBe('function');
  });

  it('sends session.update on connect', async () => {
    const session = await tts.startSession({ voice: 'shimmer' });
    const ws = (session as any).ws;
    const firstSend = JSON.parse(ws.send.mock.calls[0][0]);
    expect(firstSend.type).toBe('session.update');
    expect(firstSend.session.voice).toBe('shimmer');
    expect(firstSend.session.modalities).toEqual(['audio', 'text']);
  });

  it('sends text via conversation.item.create', async () => {
    const session = await tts.startSession();
    session.pushTokens('Hello world');

    const ws = (session as any).ws;
    const sent = JSON.parse(ws.send.mock.calls[ws.send.mock.calls.length - 1][0]);
    expect(sent.type).toBe('conversation.item.create');
    expect(sent.item.content[0].text).toBe('Hello world');
  });

  it('sends response.create on flush', async () => {
    const session = await tts.startSession();
    const flushPromise = session.flush();

    const ws = (session as any).ws;
    const sent = JSON.parse(ws.send.mock.calls[ws.send.mock.calls.length - 1][0]);
    expect(sent.type).toBe('response.create');

    // Simulate response.done to resolve the flush
    ws.emit('message', JSON.stringify({ type: 'response.done' }));
    await flushPromise;
  });

  it('sends response.cancel on cancel', async () => {
    const session = await tts.startSession();
    session.cancel();

    const ws = (session as any).ws;
    const sent = JSON.parse(ws.send.mock.calls[ws.send.mock.calls.length - 1][0]);
    expect(sent.type).toBe('response.cancel');
  });

  it('emits audio chunks from response.audio.delta messages', async () => {
    const session = await tts.startSession();
    session.pushTokens('Test audio');

    const audioPromise = new Promise<any>((resolve) => {
      session.on('audio', resolve);
    });

    const ws = (session as any).ws;
    const sampleAudio = Buffer.from([0x00, 0x01, 0x02, 0x03]).toString('base64');
    ws.emit('message', JSON.stringify({
      type: 'response.audio.delta',
      delta: sampleAudio,
    }));

    const chunk = await audioPromise;
    expect(chunk.format).toBe('pcm');
    expect(chunk.sampleRate).toBe(24000);
    expect(chunk.text).toBe('Test audio');
    expect(Buffer.isBuffer(chunk.audio)).toBe(true);
  });

  it('emits error on error messages', async () => {
    const session = await tts.startSession();

    const errorPromise = new Promise<Error>((resolve) => {
      session.on('error', resolve);
    });

    const ws = (session as any).ws;
    ws.emit('message', JSON.stringify({
      type: 'error',
      error: { message: 'Something went wrong' },
    }));

    const err = await errorPromise;
    expect(err.message).toBe('Something went wrong');
  });
});
