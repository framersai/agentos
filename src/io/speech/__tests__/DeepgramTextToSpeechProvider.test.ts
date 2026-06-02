import { describe, it, expect, vi } from 'vitest';
import { DeepgramTextToSpeechProvider } from '../providers/DeepgramTextToSpeechProvider.js';

function okFetch(bytes = new Uint8Array([1, 2, 3])) {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    arrayBuffer: async () => bytes.buffer,
    text: async () => '',
  })) as unknown as typeof fetch;
}

describe('DeepgramTextToSpeechProvider', () => {
  it('posts to /v1/speak with Token auth and returns a synthesis result', async () => {
    const fetchImpl = okFetch();
    const p = new DeepgramTextToSpeechProvider({ apiKey: 'dg', fetchImpl });
    const res = await p.synthesize('hello', { voice: 'aura-2-arcas-en' });

    expect(res.providerName).toBe('Deepgram Aura');
    expect(res.mimeType).toBe('audio/mpeg');
    expect(Buffer.isBuffer(res.audioBuffer)).toBe(true);
    expect(res.voiceUsed).toBe('aura-2-arcas-en');
    expect(res.usage?.characters).toBe(5);

    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(url)).toContain('/v1/speak');
    expect(String(url)).toContain('model=aura-2-arcas-en');
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Token dg' });
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ text: 'hello' });
  });

  it('lists Aura-2 voices', async () => {
    const p = new DeepgramTextToSpeechProvider({ apiKey: 'dg' });
    const voices = await p.listAvailableVoices();
    expect(voices.length).toBeGreaterThan(0);
    expect(voices.every((v) => v.id.startsWith('aura-2-'))).toBe(true);
    expect(voices[0].provider).toBe('deepgram-aura');
  });

  it('throws on non-2xx', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 401,
      text: async () => 'nope',
    })) as unknown as typeof fetch;
    const p = new DeepgramTextToSpeechProvider({ apiKey: 'dg', fetchImpl });
    await expect(p.synthesize('x')).rejects.toThrow(/Deepgram Aura/i);
  });
});
