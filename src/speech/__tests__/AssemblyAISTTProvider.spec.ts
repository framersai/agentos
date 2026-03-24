import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AssemblyAISTTProvider } from '../providers/AssemblyAISTTProvider.js';
import type { SpeechAudioInput } from '../types.js';

/** Minimal audio fixture used across tests. */
const AUDIO: SpeechAudioInput = {
  data: Buffer.from('fake-audio-bytes'),
  mimeType: 'audio/wav',
  durationSeconds: 4,
};

/** Standard completed transcript response from AssemblyAI. */
const COMPLETED_TRANSCRIPT = {
  id: 'tx_123',
  status: 'completed',
  text: 'hello there',
  confidence: 0.95,
  audio_duration: 4,
  language_code: 'en_us',
  words: [
    { text: 'hello', start: 0, end: 400, confidence: 0.96, speaker: 'A' },
    { text: 'there', start: 500, end: 900, confidence: 0.94, speaker: 'A' },
  ],
};

/**
 * Builds a mock `fetch` implementation that handles the three AssemblyAI steps:
 * upload → submit → poll (sequence of statuses).
 */
function makeAssemblyFetch(pollStatuses: string[]) {
  let pollCallIndex = 0;

  return vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    // Step 1 — upload
    if (url === 'https://api.assemblyai.com/v2/upload') {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ upload_url: 'https://cdn.assemblyai.com/audio/abc123' }),
        text: () => Promise.resolve(''),
      });
    }

    // Step 2 — submit transcript
    if (url === 'https://api.assemblyai.com/v2/transcript' && init?.method === 'POST') {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ id: 'tx_123' }),
        text: () => Promise.resolve(''),
      });
    }

    // Step 3 — poll
    if (url === 'https://api.assemblyai.com/v2/transcript/tx_123') {
      const status = pollStatuses[pollCallIndex] ?? 'completed';
      const isCompleted = status === 'completed';
      const isError = status === 'error';
      pollCallIndex++;

      const body = isCompleted
        ? COMPLETED_TRANSCRIPT
        : isError
          ? { id: 'tx_123', status: 'error', error: 'Audio file could not be decoded' }
          : { id: 'tx_123', status };

      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(body),
        text: () => Promise.resolve(''),
      });
    }

    return Promise.reject(new Error(`Unexpected URL: ${url}`));
  });
}

describe('AssemblyAISTTProvider', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reports provider id, name, and streaming capability', () => {
    const provider = new AssemblyAISTTProvider({ apiKey: 'key' });
    expect(provider.id).toBe('assemblyai');
    expect(provider.supportsStreaming).toBe(false);
    expect(provider.getProviderName()).toBe('AssemblyAI');
  });

  it('completes the upload → submit → poll flow', async () => {
    const mockFetch = makeAssemblyFetch(['completed']);
    const provider = new AssemblyAISTTProvider({
      apiKey: 'test-key',
      fetchImpl: mockFetch as unknown as typeof fetch,
    });

    const promise = provider.transcribe(AUDIO);
    // Advance fake timer past the poll interval so setTimeout resolves.
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.text).toBe('hello there');
    expect(result.isFinal).toBe(true);
    expect(result.confidence).toBe(0.95);
    expect(result.durationSeconds).toBe(4);
  });

  it('polls through queued → processing → completed states', async () => {
    const mockFetch = makeAssemblyFetch(['queued', 'processing', 'completed']);
    const provider = new AssemblyAISTTProvider({
      apiKey: 'test-key',
      fetchImpl: mockFetch as unknown as typeof fetch,
    });

    const promise = provider.transcribe(AUDIO);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.text).toBe('hello there');
    // upload(1) + submit(1) + 3 polls = 5 fetch calls total
    expect(mockFetch).toHaveBeenCalledTimes(5);
  });

  it('sends Authorization header on all three requests', async () => {
    const mockFetch = makeAssemblyFetch(['completed']);
    const provider = new AssemblyAISTTProvider({
      apiKey: 'secret-key',
      fetchImpl: mockFetch as unknown as typeof fetch,
    });

    const promise = provider.transcribe(AUDIO);
    await vi.runAllTimersAsync();
    await promise;

    for (const [, init] of mockFetch.mock.calls as [string, RequestInit][]) {
      const headers = init?.headers as Record<string, string> | undefined;
      expect(headers?.['Authorization']).toBe('secret-key');
    }
  });

  it('sends audio body and correct content-type on upload', async () => {
    const mockFetch = makeAssemblyFetch(['completed']);
    const provider = new AssemblyAISTTProvider({
      apiKey: 'key',
      fetchImpl: mockFetch as unknown as typeof fetch,
    });

    const promise = provider.transcribe(AUDIO);
    await vi.runAllTimersAsync();
    await promise;

    const uploadCall = mockFetch.mock.calls.find(
      ([url]: [string]) => url === 'https://api.assemblyai.com/v2/upload'
    ) as [string, RequestInit] | undefined;

    expect(uploadCall).toBeDefined();
    const [, uploadInit] = uploadCall!;
    expect(uploadInit.body).toBe(AUDIO.data);
    const headers = uploadInit.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('audio/wav');
  });

  it('includes speaker_labels in the submit body when diarization requested', async () => {
    const mockFetch = makeAssemblyFetch(['completed']);
    const provider = new AssemblyAISTTProvider({
      apiKey: 'key',
      fetchImpl: mockFetch as unknown as typeof fetch,
    });

    const promise = provider.transcribe(AUDIO, { enableSpeakerDiarization: true });
    await vi.runAllTimersAsync();
    await promise;

    const submitCall = mockFetch.mock.calls.find(
      ([url, init]: [string, RequestInit]) =>
        url === 'https://api.assemblyai.com/v2/transcript' && init?.method === 'POST'
    ) as [string, RequestInit] | undefined;

    expect(submitCall).toBeDefined();
    const [, submitInit] = submitCall!;
    const body = JSON.parse(submitInit.body as string);
    expect(body.speaker_labels).toBe(true);
  });

  it('maps word timing (milliseconds → seconds) in segments', async () => {
    const mockFetch = makeAssemblyFetch(['completed']);
    const provider = new AssemblyAISTTProvider({
      apiKey: 'key',
      fetchImpl: mockFetch as unknown as typeof fetch,
    });

    const promise = provider.transcribe(AUDIO);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.segments).toHaveLength(2);
    expect(result.segments![0].startTime).toBe(0);
    expect(result.segments![0].endTime).toBeCloseTo(0.4);
    expect(result.segments![0].speaker).toBe('A');
  });

  it('throws when transcript status is error', async () => {
    const mockFetch = makeAssemblyFetch(['error']);
    const provider = new AssemblyAISTTProvider({
      apiKey: 'key',
      fetchImpl: mockFetch as unknown as typeof fetch,
    });

    const caught = provider.transcribe(AUDIO).catch((e: unknown) => e);
    await vi.runAllTimersAsync();
    const err = await caught;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch('AssemblyAI transcription error');
  });

  it('throws on timeout when transcript never completes', async () => {
    // Always return 'processing' so the loop never finishes.
    const mockFetch = makeAssemblyFetch(Array(200).fill('processing'));
    const provider = new AssemblyAISTTProvider({
      apiKey: 'key',
      fetchImpl: mockFetch as unknown as typeof fetch,
    });

    const caught = provider.transcribe(AUDIO).catch((e: unknown) => e);
    // Advance time well past the 120s timeout.
    await vi.advanceTimersByTimeAsync(125_000);
    const err = await caught;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/timed out/);
  });

  it('throws a descriptive error when upload returns non-2xx', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: () => Promise.resolve('Service Unavailable'),
    });
    const provider = new AssemblyAISTTProvider({
      apiKey: 'key',
      fetchImpl: mockFetch as unknown as typeof fetch,
    });

    await expect(provider.transcribe(AUDIO)).rejects.toThrow(
      'AssemblyAI upload failed (503): Service Unavailable'
    );
  });
});
