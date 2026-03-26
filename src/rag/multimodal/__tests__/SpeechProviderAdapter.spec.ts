/**
 * @module rag/multimodal/__tests__/SpeechProviderAdapter.spec
 *
 * Unit tests for {@link SpeechProviderAdapter}.
 *
 * Verifies that the adapter correctly bridges between the voice pipeline's
 * `SpeechToTextProvider` interface and the multimodal indexer's
 * `ISpeechToTextProvider` interface.
 *
 * ## What is tested
 *
 * - Constructor validates that a provider is supplied
 * - `transcribe()` wraps the raw Buffer in a SpeechAudioInput with default MIME
 * - `transcribe()` forwards the language option via SpeechTranscriptionOptions
 * - `transcribe()` extracts the plain text from SpeechTranscriptionResult
 * - `transcribe()` works without a language parameter
 * - Custom default MIME type is applied to SpeechAudioInput
 * - `getProviderName()` returns displayName when available
 * - `getProviderName()` falls back to id when displayName is undefined
 * - Errors from the underlying provider propagate through
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SpeechProviderAdapter } from '../SpeechProviderAdapter.js';
import type { SpeechToTextProvider, SpeechTranscriptionResult } from '../../../speech/types.js';

// ---------------------------------------------------------------------------
// Mock factory
// ---------------------------------------------------------------------------

/**
 * Create a mock SpeechToTextProvider with configurable transcription result.
 * Defaults to a simple English transcript.
 */
function createMockSpeechProvider(overrides?: Partial<SpeechToTextProvider>): SpeechToTextProvider {
  return {
    id: 'mock-stt',
    displayName: 'Mock STT Provider',
    supportsStreaming: false,
    transcribe: vi.fn(async (): Promise<SpeechTranscriptionResult> => ({
      text: 'Hello, this is a test transcript.',
      language: 'en',
      cost: 0.001,
      confidence: 0.95,
    })),
    getProviderName: vi.fn(() => 'mock-stt'),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SpeechProviderAdapter', () => {
  let mockProvider: SpeechToTextProvider;
  let adapter: SpeechProviderAdapter;

  beforeEach(() => {
    mockProvider = createMockSpeechProvider();
    adapter = new SpeechProviderAdapter(mockProvider);
  });

  // -------------------------------------------------------------------------
  // Constructor validation
  // -------------------------------------------------------------------------

  it('should throw if provider is null', () => {
    expect(() => new SpeechProviderAdapter(null as any)).toThrow(
      /SpeechToTextProvider instance is required/,
    );
  });

  it('should throw if provider is undefined', () => {
    expect(() => new SpeechProviderAdapter(undefined as any)).toThrow(
      /SpeechToTextProvider instance is required/,
    );
  });

  it('should construct successfully with a valid provider', () => {
    expect(() => new SpeechProviderAdapter(mockProvider)).not.toThrow();
  });

  // -------------------------------------------------------------------------
  // transcribe() — input mapping
  // -------------------------------------------------------------------------

  it('should wrap raw Buffer in SpeechAudioInput with default audio/wav MIME type', async () => {
    const audioBuffer = Buffer.from('fake audio data');
    await adapter.transcribe(audioBuffer);

    expect(mockProvider.transcribe).toHaveBeenCalledTimes(1);

    const [audioInput] = (mockProvider.transcribe as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(audioInput).toEqual({
      data: audioBuffer,
      mimeType: 'audio/wav',
    });
  });

  it('should forward language option via SpeechTranscriptionOptions', async () => {
    const audioBuffer = Buffer.from('audio');
    await adapter.transcribe(audioBuffer, 'es');

    const [, options] = (mockProvider.transcribe as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(options).toEqual({ language: 'es' });
  });

  it('should pass undefined options when no language is specified', async () => {
    const audioBuffer = Buffer.from('audio');
    await adapter.transcribe(audioBuffer);

    const [, options] = (mockProvider.transcribe as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(options).toBeUndefined();
  });

  it('should use custom default MIME type when specified', async () => {
    const mp3Adapter = new SpeechProviderAdapter(mockProvider, 'audio/mpeg');
    const audioBuffer = Buffer.from('mp3 data');
    await mp3Adapter.transcribe(audioBuffer);

    const [audioInput] = (mockProvider.transcribe as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(audioInput.mimeType).toBe('audio/mpeg');
  });

  // -------------------------------------------------------------------------
  // transcribe() — output mapping
  // -------------------------------------------------------------------------

  it('should extract plain text from SpeechTranscriptionResult', async () => {
    const result = await adapter.transcribe(Buffer.from('audio'));

    expect(result).toBe('Hello, this is a test transcript.');
  });

  it('should return text even when result has rich metadata', async () => {
    const richProvider = createMockSpeechProvider({
      transcribe: vi.fn(async (): Promise<SpeechTranscriptionResult> => ({
        text: 'Rich transcript with segments.',
        language: 'en',
        cost: 0.002,
        durationSeconds: 5.5,
        confidence: 0.98,
        segments: [
          {
            text: 'Rich transcript with segments.',
            startTime: 0,
            endTime: 5.5,
            confidence: 0.98,
          },
        ],
        usage: {
          durationMinutes: 0.09,
          modelUsed: 'whisper-1',
        },
      })),
    });

    const richAdapter = new SpeechProviderAdapter(richProvider);
    const result = await richAdapter.transcribe(Buffer.from('audio'));

    // Only the text should come through — segments, usage, etc. are discarded
    expect(result).toBe('Rich transcript with segments.');
  });

  // -------------------------------------------------------------------------
  // transcribe() — error propagation
  // -------------------------------------------------------------------------

  it('should propagate errors from the underlying provider', async () => {
    const failingProvider = createMockSpeechProvider({
      transcribe: vi.fn(async () => {
        throw new Error('STT provider rate limit exceeded');
      }),
    });

    const failingAdapter = new SpeechProviderAdapter(failingProvider);

    await expect(failingAdapter.transcribe(Buffer.from('audio'))).rejects.toThrow(
      'STT provider rate limit exceeded',
    );
  });

  // -------------------------------------------------------------------------
  // getProviderName()
  // -------------------------------------------------------------------------

  it('should return displayName when available', () => {
    expect(adapter.getProviderName()).toBe('Mock STT Provider');
  });

  it('should fall back to id when displayName is undefined', () => {
    const noDisplayNameProvider = createMockSpeechProvider({
      displayName: undefined,
    });
    const noNameAdapter = new SpeechProviderAdapter(noDisplayNameProvider);

    expect(noNameAdapter.getProviderName()).toBe('mock-stt');
  });
});
