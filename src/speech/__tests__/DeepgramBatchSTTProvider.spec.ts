import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DeepgramBatchSTTProvider } from '../providers/DeepgramBatchSTTProvider.js';
import type { SpeechAudioInput } from '../types.js';

/** Minimal audio fixture used across tests. */
const AUDIO: SpeechAudioInput = {
  data: Buffer.from('fake-audio-bytes'),
  mimeType: 'audio/wav',
  durationSeconds: 5,
};

/** Builds a minimal valid Deepgram response payload. */
function makeDeepgramResponse(
  transcript: string,
  confidence = 0.98,
  words: object[] = [],
  durationSeconds = 5
) {
  return {
    metadata: { duration: durationSeconds },
    results: {
      channels: [
        {
          alternatives: [{ transcript, confidence, words }],
        },
      ],
    },
  };
}

/** Creates a mock fetch that returns a successful JSON response. */
function makeFetch(body: object, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(JSON.stringify(body)),
  });
}

describe('DeepgramBatchSTTProvider', () => {
  let provider: DeepgramBatchSTTProvider;
  let mockFetch: ReturnType<typeof makeFetch>;

  beforeEach(() => {
    mockFetch = makeFetch(makeDeepgramResponse('hello world'));
    provider = new DeepgramBatchSTTProvider({
      apiKey: 'test-key',
      model: 'nova-2',
      language: 'en-US',
      fetchImpl: mockFetch as unknown as typeof fetch,
    });
  });

  it('sends POST to the correct Deepgram URL', async () => {
    await provider.transcribe(AUDIO);

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('https://api.deepgram.com/v1/listen');
    expect(url).toContain('model=nova-2');
    expect(url).toContain('punctuate=true');
    expect(url).toContain('language=en-US');
  });

  it('includes the correct Authorization and Content-Type headers', async () => {
    await provider.transcribe(AUDIO);

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Token test-key');
    expect(headers['Content-Type']).toBe('audio/wav');
  });

  it('sends the raw audio buffer as the request body', async () => {
    await provider.transcribe(AUDIO);

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(init.body).toBe(AUDIO.data);
  });

  it('uses audio mimeType as Content-Type when provided', async () => {
    const mp3Audio: SpeechAudioInput = { ...AUDIO, mimeType: 'audio/mpeg' };
    await provider.transcribe(mp3Audio);

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('audio/mpeg');
  });

  it('returns the transcript text and metadata from the response', async () => {
    mockFetch = makeFetch(makeDeepgramResponse('hello world', 0.97, [], 3.5));
    provider = new DeepgramBatchSTTProvider({ apiKey: 'k', fetchImpl: mockFetch as unknown as typeof fetch });

    const result = await provider.transcribe(AUDIO);

    expect(result.text).toBe('hello world');
    expect(result.confidence).toBe(0.97);
    expect(result.durationSeconds).toBe(3.5);
    expect(result.isFinal).toBe(true);
    expect(result.language).toBe('en-US');
  });

  it('maps word-level data to segments when words are present', async () => {
    const words = [
      { word: 'hello', start: 0.0, end: 0.4, confidence: 0.99, speaker: 0 },
      { word: 'world', start: 0.5, end: 0.9, confidence: 0.98, speaker: 1 },
    ];
    mockFetch = makeFetch(makeDeepgramResponse('hello world', 0.99, words));
    provider = new DeepgramBatchSTTProvider({ apiKey: 'k', fetchImpl: mockFetch as unknown as typeof fetch });

    const result = await provider.transcribe(AUDIO);

    expect(result.segments).toHaveLength(2);
    expect(result.segments![0]).toMatchObject({
      text: 'hello',
      startTime: 0.0,
      endTime: 0.4,
      speaker: 0,
    });
    expect(result.segments![1].speaker).toBe(1);
  });

  it('omits segments when word list is empty', async () => {
    const result = await provider.transcribe(AUDIO);
    expect(result.segments).toBeUndefined();
  });

  it('sets diarize=true in URL when enableSpeakerDiarization is true', async () => {
    await provider.transcribe(AUDIO, { enableSpeakerDiarization: true });

    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('diarize=true');
  });

  it('respects language override from options', async () => {
    await provider.transcribe(AUDIO, { language: 'fr-FR' });

    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('language=fr-FR');
  });

  it('throws a descriptive error on non-2xx response', async () => {
    mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: vi.fn().mockResolvedValue('Unauthorized'),
    });
    provider = new DeepgramBatchSTTProvider({ apiKey: 'bad-key', fetchImpl: mockFetch as unknown as typeof fetch });

    await expect(provider.transcribe(AUDIO)).rejects.toThrow(
      'Deepgram transcription failed (401): Unauthorized'
    );
  });

  it('returns cost 0 and attaches providerResponse', async () => {
    const result = await provider.transcribe(AUDIO);
    expect(result.cost).toBe(0);
    expect(result.providerResponse).toBeDefined();
  });

  it('reports provider name and id correctly', () => {
    expect(provider.id).toBe('deepgram-batch');
    expect(provider.supportsStreaming).toBe(false);
    expect(provider.getProviderName()).toBe('Deepgram (Batch)');
  });
});
