import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { DeepgramAuraBatchTTS, chunkForAura } from '../providers/DeepgramAuraBatchTTS.js';

describe('DeepgramAuraBatchTTS', () => {
  let tts: DeepgramAuraBatchTTS;

  beforeEach(() => {
    mockFetch.mockReset();
    tts = new DeepgramAuraBatchTTS({ apiKey: 'dg_key' });
  });

  it('has providerId deepgram-aura', () => {
    expect(tts.providerId).toBe('deepgram-aura');
  });

  it('posts to /v1/speak with Token auth and the model query param', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new Uint8Array([1, 2, 3]).buffer),
    });

    const res = await tts.synthesize('hello world', { voice: 'aura-2-thalia-en', format: 'mp3' });

    expect(res.provider).toBe('deepgram-aura');
    expect(res.format).toBe('mp3');
    expect(res.audio).toBeInstanceOf(Buffer);

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain('https://api.deepgram.com/v1/speak');
    expect(url).toContain('model=aura-2-thalia-en');
    expect(opts.headers.Authorization).toBe('Token dg_key');
    expect(JSON.parse(opts.body)).toEqual({ text: 'hello world' });
    expect(opts.signal).toBeInstanceOf(AbortSignal);
  });

  it('chunks text over 2000 chars into multiple requests and concatenates audio', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new Uint8Array([9]).buffer),
    });

    const long = 'Sentence one. '.repeat(200); // ~2800 chars
    const res = await tts.synthesize(long, { voice: 'aura-2-arcas-en' });

    expect(mockFetch.mock.calls.length).toBeGreaterThan(1);
    // each mocked chunk returns exactly one byte, so the concatenated
    // length equals the number of requests made.
    expect(res.audio.byteLength).toBe(mockFetch.mock.calls.length);
  });

  it('throws a classified error on non-2xx', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve('bad'),
    });
    await expect(tts.synthesize('x')).rejects.toThrow(/Deepgram Aura/i);
  });

  it('chunkForAura splits long text into <= max-length pieces', () => {
    const chunks = chunkForAura('A sentence here. '.repeat(300), 2000);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(2000);
  });

  it('chunkForAura returns a single chunk for short text', () => {
    expect(chunkForAura('short', 2000)).toEqual(['short']);
  });
});
