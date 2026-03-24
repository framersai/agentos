import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AzureSpeechSTTProvider } from '../providers/AzureSpeechSTTProvider.js';
import type { SpeechAudioInput } from '../types.js';

const AUDIO: SpeechAudioInput = {
  data: Buffer.from('fake-wav-bytes'),
  mimeType: 'audio/wav',
  durationSeconds: 3,
};

function makeFetch(body: object, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(JSON.stringify(body)),
  });
}

describe('AzureSpeechSTTProvider', () => {
  let provider: AzureSpeechSTTProvider;
  let mockFetch: ReturnType<typeof makeFetch>;

  beforeEach(() => {
    mockFetch = makeFetch({
      RecognitionStatus: 'Success',
      DisplayText: 'Hello Azure.',
      Duration: 30_000_000, // 3 seconds in 100-ns ticks
      Offset: 0,
    });
    provider = new AzureSpeechSTTProvider({
      key: 'azure-key',
      region: 'eastus',
      fetchImpl: mockFetch as unknown as typeof fetch,
    });
  });

  it('reports provider id, name, and streaming capability', () => {
    expect(provider.id).toBe('azure-speech-stt');
    expect(provider.supportsStreaming).toBe(false);
    expect(provider.getProviderName()).toBe('Azure Speech (STT)');
  });

  it('posts to the correct Azure Speech endpoint for the configured region', async () => {
    await provider.transcribe(AUDIO);

    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('https://eastus.stt.speech.microsoft.com');
    expect(url).toContain('/speech/recognition/conversation/cognitiveservices/v1');
    expect(url).toContain('language=en-US');
  });

  it('sends the subscription key in the Ocp-Apim-Subscription-Key header', async () => {
    await provider.transcribe(AUDIO);

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['Ocp-Apim-Subscription-Key']).toBe('azure-key');
  });

  it('sends Content-Type: audio/wav regardless of audio.mimeType', async () => {
    await provider.transcribe({ ...AUDIO, mimeType: 'audio/mpeg' });

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('audio/wav');
  });

  it('sends the audio buffer as the request body', async () => {
    await provider.transcribe(AUDIO);

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(init.body).toBe(AUDIO.data);
  });

  it('uses the language from options in the query string', async () => {
    await provider.transcribe(AUDIO, { language: 'de-DE' });

    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('language=de-DE');
  });

  it('returns transcript text and duration from a Success response', async () => {
    const result = await provider.transcribe(AUDIO);

    expect(result.text).toBe('Hello Azure.');
    expect(result.durationSeconds).toBeCloseTo(3);
    expect(result.isFinal).toBe(true);
    expect(result.language).toBe('en-US');
    expect(result.cost).toBe(0);
  });

  it('returns empty text for a NoMatch response', async () => {
    mockFetch = makeFetch({ RecognitionStatus: 'NoMatch' });
    provider = new AzureSpeechSTTProvider({
      key: 'k',
      region: 'westeurope',
      fetchImpl: mockFetch as unknown as typeof fetch,
    });

    const result = await provider.transcribe(AUDIO);

    expect(result.text).toBe('');
    expect(result.isFinal).toBe(true);
  });

  it('attaches providerResponse to the result', async () => {
    const result = await provider.transcribe(AUDIO);
    expect(result.providerResponse).toBeDefined();
  });

  it('throws a descriptive error on non-2xx response', async () => {
    mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      text: vi.fn().mockResolvedValue('Forbidden'),
    });
    provider = new AzureSpeechSTTProvider({
      key: 'bad',
      region: 'eastus',
      fetchImpl: mockFetch as unknown as typeof fetch,
    });

    await expect(provider.transcribe(AUDIO)).rejects.toThrow(
      'Azure Speech STT failed (403): Forbidden'
    );
  });

  it('uses audio.durationSeconds as fallback when Duration is absent', async () => {
    mockFetch = makeFetch({ RecognitionStatus: 'Success', DisplayText: 'hi' });
    provider = new AzureSpeechSTTProvider({
      key: 'k',
      region: 'eastus',
      fetchImpl: mockFetch as unknown as typeof fetch,
    });

    const result = await provider.transcribe({ ...AUDIO, durationSeconds: 7 });
    expect(result.durationSeconds).toBe(7);
  });
});
