import type {
  SpeechAudioInput,
  SpeechToTextProvider,
  SpeechTranscriptionOptions,
  SpeechTranscriptionResult,
  SpeechTranscriptionSegment,
} from '../types.js';

/** Configuration for the AssemblyAISTTProvider. */
export interface AssemblyAISTTProviderConfig {
  /** AssemblyAI API key. */
  apiKey: string;
  /**
   * Custom fetch implementation, useful for testing.
   * Defaults to the global `fetch`.
   */
  fetchImpl?: typeof fetch;
}

/** Word-level timing returned by AssemblyAI transcripts. */
interface AssemblyAIWord {
  text: string;
  start: number;
  end: number;
  confidence: number;
  /** Speaker label when `speaker_labels` is enabled. */
  speaker?: string | null;
}

/** Subset of the AssemblyAI transcript polling response. */
interface AssemblyAITranscript {
  id: string;
  status: 'queued' | 'processing' | 'completed' | 'error';
  text?: string | null;
  confidence?: number | null;
  audio_duration?: number | null;
  language_code?: string | null;
  words?: AssemblyAIWord[] | null;
  error?: string | null;
}

const ASSEMBLYAI_BASE = 'https://api.assemblyai.com/v2';
/** Maximum time (ms) to wait for a transcript before rejecting. */
const DEFAULT_TIMEOUT_MS = 120_000;
/** Polling interval (ms) between transcript status checks. */
const POLL_INTERVAL_MS = 1_000;

/**
 * Maps AssemblyAI word objects to {@link SpeechTranscriptionSegment} entries.
 *
 * Each word becomes its own segment so that per-word timing and speaker
 * attribution are preserved in the normalised result.
 */
function wordsToSegments(words: AssemblyAIWord[]): SpeechTranscriptionSegment[] {
  return words.map((w) => ({
    text: w.text,
    startTime: w.start / 1000, // AssemblyAI returns milliseconds
    endTime: w.end / 1000,
    confidence: w.confidence,
    speaker: w.speaker ?? undefined,
    words: [
      {
        word: w.text,
        start: w.start / 1000,
        end: w.end / 1000,
        confidence: w.confidence,
      },
    ],
  }));
}

/**
 * Speech-to-text provider that uses the AssemblyAI async transcription API.
 *
 * The three-step workflow is:
 * 1. **Upload** – POST the raw audio to `/v2/upload` to obtain an upload URL.
 * 2. **Submit** – POST to `/v2/transcript` with the upload URL to start processing.
 * 3. **Poll** – GET `/v2/transcript/:id` every second until `status` is
 *    `completed` or `error`, or until the optional timeout elapses.
 *
 * @example
 * ```ts
 * const provider = new AssemblyAISTTProvider({ apiKey: process.env.ASSEMBLYAI_API_KEY! });
 * const result = await provider.transcribe({ data: audioBuffer }, { enableSpeakerDiarization: true });
 * console.log(result.text);
 * ```
 */
export class AssemblyAISTTProvider implements SpeechToTextProvider {
  public readonly id = 'assemblyai';
  public readonly displayName = 'AssemblyAI';
  public readonly supportsStreaming = false;

  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: AssemblyAISTTProviderConfig) {
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  /** Returns the human-readable provider name. */
  getProviderName(): string {
    return this.displayName;
  }

  /**
   * Transcribes an audio buffer via the AssemblyAI async pipeline.
   *
   * @param audio - Raw audio data and associated metadata.
   * @param options - Optional transcription settings. Pass
   *   `providerSpecificOptions.signal` (an {@link AbortSignal}) to cancel.
   * @returns A promise resolving to the normalised transcription result.
   * @throws When the API returns a non-2xx status, when transcription fails,
   *   or when the 120-second timeout is exceeded.
   */
  async transcribe(
    audio: SpeechAudioInput,
    options: SpeechTranscriptionOptions = {}
  ): Promise<SpeechTranscriptionResult> {
    const signal = options.providerSpecificOptions?.signal as AbortSignal | undefined;
    const timeoutMs = DEFAULT_TIMEOUT_MS;

    // ── Step 1: Upload audio ────────────────────────────────────────────────
    const uploadResponse = await this.fetchImpl(`${ASSEMBLYAI_BASE}/upload`, {
      method: 'POST',
      headers: {
        Authorization: this.config.apiKey,
        'Content-Type': audio.mimeType ?? 'audio/wav',
      },
      body: audio.data,
      signal,
    });

    if (!uploadResponse.ok) {
      const msg = await uploadResponse.text();
      throw new Error(`AssemblyAI upload failed (${uploadResponse.status}): ${msg}`);
    }

    const { upload_url } = (await uploadResponse.json()) as { upload_url: string };

    // ── Step 2: Submit transcript request ───────────────────────────────────
    const submitPayload: Record<string, unknown> = {
      audio_url: upload_url,
      speaker_labels: options.enableSpeakerDiarization ?? false,
    };
    if (options.language) submitPayload.language_code = options.language;

    const submitResponse = await this.fetchImpl(`${ASSEMBLYAI_BASE}/transcript`, {
      method: 'POST',
      headers: {
        Authorization: this.config.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(submitPayload),
      signal,
    });

    if (!submitResponse.ok) {
      const msg = await submitResponse.text();
      throw new Error(`AssemblyAI transcript submit failed (${submitResponse.status}): ${msg}`);
    }

    const { id } = (await submitResponse.json()) as { id: string };

    // ── Step 3: Poll until completed ────────────────────────────────────────
    const deadline = Date.now() + timeoutMs;

    while (true) {
      if (signal?.aborted) {
        throw new Error('AssemblyAI transcription aborted by caller signal');
      }

      if (Date.now() >= deadline) {
        throw new Error(
          `AssemblyAI transcription timed out after ${timeoutMs / 1000}s (transcript id: ${id})`
        );
      }

      const pollResponse = await this.fetchImpl(`${ASSEMBLYAI_BASE}/transcript/${id}`, {
        headers: { Authorization: this.config.apiKey },
        signal,
      });

      if (!pollResponse.ok) {
        const msg = await pollResponse.text();
        throw new Error(`AssemblyAI poll failed (${pollResponse.status}): ${msg}`);
      }

      const transcript = (await pollResponse.json()) as AssemblyAITranscript;

      if (transcript.status === 'error') {
        throw new Error(`AssemblyAI transcription error: ${transcript.error ?? 'unknown error'}`);
      }

      if (transcript.status === 'completed') {
        const text = transcript.text ?? '';
        const durationSeconds = transcript.audio_duration ?? audio.durationSeconds;
        const words = transcript.words ?? [];

        return {
          text,
          language: transcript.language_code ?? options.language,
          durationSeconds,
          confidence: transcript.confidence ?? undefined,
          cost: 0,
          segments: words.length > 0 ? wordsToSegments(words) : undefined,
          providerResponse: transcript,
          isFinal: true,
          usage: {
            durationMinutes: (durationSeconds ?? 0) / 60,
            modelUsed: 'assemblyai',
          },
        };
      }

      // Still queued or processing — wait before polling again.
      await new Promise<void>((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  }
}
