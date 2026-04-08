import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { ElevenLabsBatchTTS } from '../providers/ElevenLabsBatchTTS.js';

describe('ElevenLabsBatchTTS', () => {
  let tts: ElevenLabsBatchTTS;

  beforeEach(() => {
    mockFetch.mockReset();
    tts = new ElevenLabsBatchTTS({ apiKey: 'test-key', voiceId: 'voice-123' });
  });

  it('has correct providerId', () => {
    expect(tts.providerId).toBe('elevenlabs-batch');
  });

  it('synthesize calls ElevenLabs REST endpoint', async () => {
    const fakeAudio = Buffer.from('fake-audio');
    mockFetch.mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(fakeAudio.buffer),
    });

    const result = await tts.synthesize('Hello world');

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('https://api.elevenlabs.io/v1/text-to-speech/voice-123');
    expect(opts.headers['xi-api-key']).toBe('test-key');
    const body = JSON.parse(opts.body);
    expect(body.text).toBe('Hello world');
    expect(body.model_id).toBe('eleven_multilingual_v2');
    expect(result.provider).toBe('elevenlabs-batch');
    expect(result.format).toBe('mp3');
  });

  it('passes voice settings from providerOptions', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(Buffer.from('audio').buffer),
    });

    await tts.synthesize('Test', {
      providerOptions: { stability: 0.8, similarityBoost: 0.9 },
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.voice_settings.stability).toBe(0.8);
    expect(body.voice_settings.similarity_boost).toBe(0.9);
  });

  it('overrides voiceId from config.voice', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(Buffer.from('a').buffer),
    });

    await tts.synthesize('Hi', { voice: 'other-voice' });

    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe('https://api.elevenlabs.io/v1/text-to-speech/other-voice');
  });

  it('throws on API error', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve('Unauthorized'),
    });

    await expect(tts.synthesize('Test')).rejects.toThrow('ElevenLabs TTS failed: 401');
  });
});
