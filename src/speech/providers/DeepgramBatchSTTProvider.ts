import type {
  SpeechAudioInput,
  SpeechToTextProvider,
  SpeechTranscriptionOptions,
  SpeechTranscriptionResult,
  SpeechTranscriptionSegment,
} from '../types.js';

/** Configuration for the DeepgramBatchSTTProvider. */
export interface DeepgramBatchSTTProviderConfig {
  /** Deepgram API key. */
  apiKey: string;
  /**
   * Deepgram model to use for transcription.
   * @default 'nova-2'
   */
  model?: string;
  /**
   * BCP-47 language code, e.g. `'en-US'`.
   * When omitted Deepgram uses automatic language detection.
   */
  language?: string;
  /**
   * Custom fetch implementation, useful for testing.
   * Defaults to the global `fetch`.
   */
  fetchImpl?: typeof fetch;
}

/** Shape of a single word returned by the Deepgram REST response. */
interface DeepgramWord {
  word: string;
  start: number;
  end: number;
  confidence: number;
  /** Speaker index when diarization is enabled. */
  speaker?: number;
}

/** Minimal typed subset of the Deepgram batch transcription response. */
interface DeepgramResponse {
  results?: {
    channels?: Array<{
      alternatives?: Array<{
        transcript?: string;
        confidence?: number;
        words?: DeepgramWord[];
      }>;
    }>;
  };
  metadata?: {
    duration?: number;
  };
}

/**
 * Maps Deepgram word-level data to {@link SpeechTranscriptionSegment} objects.
 *
 * Each word is promoted to its own segment so that per-word timing and speaker
 * information is preserved in the normalized result.
 */
function wordsToSegments(words: DeepgramWord[]): SpeechTranscriptionSegment[] {
  return words.map((w) => ({
    text: w.word,
    startTime: w.start,
    endTime: w.end,
    confidence: w.confidence,
    speaker: w.speaker,
    words: [
      {
        word: w.word,
        start: w.start,
        end: w.end,
        confidence: w.confidence,
      },
    ],
  }));
}

/**
 * Speech-to-text provider that uses the Deepgram batch (pre-recorded) REST API.
 *
 * Sends audio as a raw binary body and returns a normalised
 * {@link SpeechTranscriptionResult}. Streaming is not supported — use a
 * Deepgram streaming adapter for real-time transcription.
 *
 * @example
 * ```ts
 * const provider = new DeepgramBatchSTTProvider({ apiKey: process.env.DEEPGRAM_API_KEY! });
 * const result = await provider.transcribe({ data: audioBuffer, mimeType: 'audio/wav' });
 * console.log(result.text);
 * ```
 */
export class DeepgramBatchSTTProvider implements SpeechToTextProvider {
  public readonly id = 'deepgram-batch';
  public readonly displayName = 'Deepgram (Batch)';
  public readonly supportsStreaming = false;

  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: DeepgramBatchSTTProviderConfig) {
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  /** Returns the human-readable provider name. */
  getProviderName(): string {
    return this.displayName;
  }

  /**
   * Transcribes an audio buffer using the Deepgram pre-recorded API.
   *
   * @param audio - Raw audio data and associated metadata.
   * @param options - Optional transcription settings (language, diarization…).
   * @returns A promise resolving to the normalised transcription result.
   * @throws When the Deepgram API returns a non-2xx status.
   */
  async transcribe(
    audio: SpeechAudioInput,
    options: SpeechTranscriptionOptions = {}
  ): Promise<SpeechTranscriptionResult> {
    const model = options.model ?? this.config.model ?? 'nova-2';
    const lang = options.language ?? this.config.language ?? 'en-US';
    const diarize = options.enableSpeakerDiarization ?? false;

    const url =
      `https://api.deepgram.com/v1/listen` +
      `?model=${encodeURIComponent(model)}` +
      `&punctuate=true` +
      `&diarize=${diarize}` +
      `&language=${encodeURIComponent(lang)}`;

    const contentType = audio.mimeType ?? 'audio/wav';

    const response = await this.fetchImpl(url, {
      method: 'POST',
      headers: {
        Authorization: `Token ${this.config.apiKey}`,
        'Content-Type': contentType,
      },
      body: audio.data instanceof Buffer ? new Uint8Array(audio.data) : audio.data,
    });

    if (!response.ok) {
      const message = await response.text();
      throw new Error(`Deepgram transcription failed (${response.status}): ${message}`);
    }

    const payload = (await response.json()) as DeepgramResponse;

    const firstAlternative = payload.results?.channels?.[0]?.alternatives?.[0];
    const transcript = firstAlternative?.transcript ?? '';
    const confidence = firstAlternative?.confidence;
    const words = firstAlternative?.words ?? [];
    const durationSeconds = payload.metadata?.duration ?? audio.durationSeconds;

    return {
      text: transcript,
      language: lang,
      durationSeconds,
      confidence,
      cost: 0,
      segments: words.length > 0 ? wordsToSegments(words) : undefined,
      providerResponse: payload,
      isFinal: true,
      usage: {
        durationMinutes: (durationSeconds ?? 0) / 60,
        modelUsed: model,
      },
    };
  }
}
