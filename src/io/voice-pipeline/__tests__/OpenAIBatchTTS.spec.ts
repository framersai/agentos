import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { OpenAIBatchTTS } from '../providers/OpenAIBatchTTS.js';

describe('OpenAIBatchTTS', () => {
  let tts: OpenAIBatchTTS;

  beforeEach(() => {
    mockFetch.mockReset();
    tts = new OpenAIBatchTTS({ apiKey: 'test-key' });
  });

  it('has correct providerId', () => {
    expect(tts.providerId).toBe('openai-tts-1');
  });

  it('providerId reflects model', () => {
    const hd = new OpenAIBatchTTS({ apiKey: 'k', model: 'tts-1-hd' });
    expect(hd.providerId).toBe('openai-tts-1-hd');
  });

  it('synthesize calls OpenAI speech endpoint', async () => {
    const fakeAudio = Buffer.from('fake-audio-data');
    mockFetch.mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(fakeAudio.buffer),
    });

    const result = await tts.synthesize('Hello world');

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/audio/speech');
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body);
    expect(body.model).toBe('tts-1');
    expect(body.input).toBe('Hello world');
    expect(body.voice).toBe('nova');
    expect(body.response_format).toBe('mp3');
    expect(result.provider).toBe('openai-tts-1');
    expect(result.format).toBe('mp3');
    expect(result.audio).toBeInstanceOf(Buffer);
  });

  it('passes voice and speed from config', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(Buffer.from('audio').buffer),
    });

    await tts.synthesize('Test', { voice: 'echo', speed: 1.5 });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.voice).toBe('echo');
    expect(body.speed).toBe(1.5);
  });

  it('throws on API error', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 429,
      text: () => Promise.resolve('Rate limited'),
    });

    await expect(tts.synthesize('Test')).rejects.toThrow('OpenAI TTS failed: 429');
  });
});
