import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AzureSpeechSTTProvider } from '../providers/AzureSpeechSTTProvider.js';
import type { SpeechAudioInput } from '../types.js';

/** Minimal audio fixture used across all Azure STT tests. */
const AUDIO: SpeechAudioInput = {
  data: Buffer.from('fake-wav-bytes'),
  mimeType: 'audio/wav',
  durationSeconds: 3,
};

/**
 * Creates a mock fetch that returns a JSON response with the given body.
 * The `ok` flag is automatically derived from the status code.
 */
function makeFetch(body: object, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(JSON.stringify(body)),
  });
}

/**
 * Tests for {@link AzureSpeechSTTProvider} — verifies the Azure REST endpoint
 * URL format, Ocp-Apim-Subscription-Key authentication, Content-Type handling,
 * NoMatch graceful degradation, and 100-nanosecond tick-to-seconds conversion.
 */
describe('AzureSpeechSTTProvider', () => {
  let provider: AzureSpeechSTTProvider;
  let mockFetch: ReturnType<typeof makeFetch>;

  beforeEach(() => {
    mockFetch = makeFetch({
      RecognitionStatus: 'Success',
      DisplayText: 'Hello Azure.',
      Duration: 30_000_000, // 3 seconds in Azure's 100-nanosecond ticks
      Offset: 0,
    });
    provider = new AzureSpeechSTTProvider({
      key: 'azure-key',
      region: 'eastus',
      fetchImpl: mockFetch as unknown as typeof fetch,
    });
  });

  it('should report correct provider id, name, and streaming capability', () => {
    expect(provider.id).toBe('azure-speech-stt');
    expect(provider.supportsStreaming).toBe(false);
    expect(provider.getProviderName()).toBe('Azure Speech (STT)');
  });

  it('should POST to the correct Azure Speech endpoint for the configured region', async () => {
    await provider.transcribe(AUDIO);

    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    // The endpoint includes the region in the hostname
    expect(url).toContain('https://eastus.stt.speech.microsoft.com');
    // Uses the /conversation/ recognition mode
    expect(url).toContain('/speech/recognition/conversation/cognitiveservices/v1');
    // Default language is en-US
    expect(url).toContain('language=en-US');
  });

  it('should send the subscription key in the Ocp-Apim-Subscription-Key header', async () => {
    await provider.transcribe(AUDIO);

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    // Azure uses this non-standard header instead of Authorization: Bearer
    expect(headers['Ocp-Apim-Subscription-Key']).toBe('azure-key');
  });

  it('should always send Content-Type: audio/wav regardless of audio.mimeType', async () => {
    // Even when the audio has a different mimeType, Azure REST expects WAV
    await provider.transcribe({ ...AUDIO, mimeType: 'audio/mpeg' });

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('audio/wav');
  });

  it('should send the audio buffer as the request body', async () => {
    await provider.transcribe(AUDIO);

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(init.body).toBe(AUDIO.data);
  });

  it('should use the language from options in the query string', async () => {
    await provider.transcribe(AUDIO, { language: 'de-DE' });

    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('language=de-DE');
  });

  it('should return transcript text and duration from a Success response', async () => {
    const result = await provider.transcribe(AUDIO);

    expect(result.text).toBe('Hello Azure.');
    // 30_000_000 ticks / 10_000_000 = 3 seconds
    expect(result.durationSeconds).toBeCloseTo(3);
    expect(result.isFinal).toBe(true);
    expect(result.language).toBe('en-US');
    expect(result.cost).toBe(0);
  });

  it('should return empty text for a NoMatch response instead of throwing', async () => {
    mockFetch = makeFetch({ RecognitionStatus: 'NoMatch' });
    provider = new AzureSpeechSTTProvider({
      key: 'k',
      region: 'westeurope',
      fetchImpl: mockFetch as unknown as typeof fetch,
    });

    const result = await provider.transcribe(AUDIO);

    // NoMatch = no speech detected, should be empty text not an error
    expect(result.text).toBe('');
    expect(result.isFinal).toBe(true);
  });

  it('should attach the raw providerResponse to the result', async () => {
    const result = await provider.transcribe(AUDIO);
    expect(result.providerResponse).toBeDefined();
  });

  it('should throw a descriptive error including status code on non-2xx response', async () => {
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

  it('should fall back to audio.durationSeconds when Duration is absent from the response', async () => {
    mockFetch = makeFetch({ RecognitionStatus: 'Success', DisplayText: 'hi' });
    provider = new AzureSpeechSTTProvider({
      key: 'k',
      region: 'eastus',
      fetchImpl: mockFetch as unknown as typeof fetch,
    });

    const result = await provider.transcribe({ ...AUDIO, durationSeconds: 7 });
    // Without Duration in the response, should use audio.durationSeconds
    expect(result.durationSeconds).toBe(7);
  });
});
