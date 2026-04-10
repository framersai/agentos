import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('Provider key rotation integration', () => {
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('ElevenLabsBatchTTS rotates keys on quota error', async () => {
    const { ElevenLabsBatchTTS } = await import('../../../voice-pipeline/providers/ElevenLabsBatchTTS.js');

    const tts = new ElevenLabsBatchTTS({ apiKey: 'sk_a,sk_b' });

    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => '{"detail":{"status":"quota_exceeded"}}',
      })
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(1000),
      });
    vi.stubGlobal('fetch', mockFetch);

    const result = await tts.synthesize('hello');
    expect(result.audio).toBeDefined();
    expect(mockFetch).toHaveBeenCalledTimes(2);

    const firstKey = (mockFetch.mock.calls[0][1] as any).headers['xi-api-key'];
    const secondKey = (mockFetch.mock.calls[1][1] as any).headers['xi-api-key'];
    expect(firstKey).not.toBe(secondKey);
  });

  it('OpenAIBatchTTS rotates keys on 429', async () => {
    const { OpenAIBatchTTS } = await import('../../../voice-pipeline/providers/OpenAIBatchTTS.js');

    const tts = new OpenAIBatchTTS({ apiKey: 'sk_a,sk_b' });

    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: async () => '{"error":{"type":"rate_limit"}}',
      })
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(500),
      });
    vi.stubGlobal('fetch', mockFetch);

    const result = await tts.synthesize('hello');
    expect(result.audio).toBeDefined();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('single key still works without pool overhead', async () => {
    const { ElevenLabsBatchTTS } = await import('../../../voice-pipeline/providers/ElevenLabsBatchTTS.js');

    const tts = new ElevenLabsBatchTTS({ apiKey: 'sk_single' });

    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(500),
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await tts.synthesize('hello');
    expect(result.audio).toBeDefined();
    expect((mockFetch.mock.calls[0][1] as any).headers['xi-api-key']).toBe('sk_single');
  });

  it('single key does not retry on quota error (no fallback available)', async () => {
    const { ElevenLabsBatchTTS } = await import('../../../voice-pipeline/providers/ElevenLabsBatchTTS.js');

    const tts = new ElevenLabsBatchTTS({ apiKey: 'sk_only' });

    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => '{"detail":{"status":"quota_exceeded"}}',
    });
    vi.stubGlobal('fetch', mockFetch);

    await expect(tts.synthesize('hello')).rejects.toThrow('ElevenLabs TTS failed');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
