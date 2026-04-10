import type {
  SpeechAudioInput,
  SpeechResponseFormat,
  SpeechToTextProvider,
  SpeechTranscriptionOptions,
  SpeechTranscriptionResult,
  SpeechTranscriptionSegment,
} from '../../speech/types.js';
import { ApiKeyPool } from '../../core/providers/ApiKeyPool.js';

/**
 * Configuration for the {@link OpenAIWhisperSpeechToTextProvider}.
 *
 * @see {@link OpenAIWhisperSpeechToTextProvider} for usage examples
 * @see https://platform.openai.com/docs/api-reference/audio/createTranscription
 */
export interface OpenAIWhisperSpeechToTextProviderConfig {
  /**
   * OpenAI API key used for authentication.
   * Sent as `Authorization: Bearer <apiKey>` in the request header.
   */
  apiKey: string;

  /**
   * Base URL for the OpenAI API. Override for proxies, Azure OpenAI, or
   * compatible third-party endpoints.
   * @default 'https://api.openai.com/v1'
   */
  baseUrl?: string;

  /**
   * Default Whisper model to use for transcription.
   * @default 'whisper-1'
   */
  model?: string;

  /**
   * Custom fetch implementation for dependency injection in tests.
   * @default globalThis.fetch
   */
  fetchImpl?: typeof fetch;
}

/**
 * Normalizes raw segment data from the OpenAI Whisper `verbose_json` response
 * into strongly-typed {@link SpeechTranscriptionSegment} objects.
 *
 * This function performs defensive runtime type checking on every field because
 * the Whisper API response shape is only partially documented and may include
 * additional or differently-typed fields depending on the model version.
 *
 * The segment fields handled include standard ones (text, start, end, confidence)
 * as well as Whisper-specific fields (id, seek, tokens, temperature, avg_logprob,
 * compression_ratio, no_speech_prob) that are preserved for advanced consumers.
 *
 * @param input - The raw `segments` array from the Whisper JSON response.
 *   Expected to be an array of objects, but handles non-array gracefully.
 * @returns An array of normalized segments, or `undefined` if the input
 *   is not a valid array.
 *
 * @see {@link SpeechTranscriptionSegment} for the output shape
 */
function normalizeSegments(input: unknown): SpeechTranscriptionSegment[] | undefined {
  if (!Array.isArray(input)) return undefined;

  return input
    .filter((segment) => typeof segment === 'object' && segment !== null)
    .map((segment) => {
      // Use Record<string, unknown> for safe property access on untyped API data
      const item = segment as Record<string, unknown>;
      return {
        text: typeof item.text === 'string' ? item.text : '',
        startTime: typeof item.start === 'number' ? item.start : 0,
        endTime: typeof item.end === 'number' ? item.end : 0,
        confidence: typeof item.confidence === 'number' ? item.confidence : undefined,
        speaker:
          typeof item.speaker === 'string' || typeof item.speaker === 'number'
            ? item.speaker
            : undefined,
        // Normalize nested word-level data with the same defensive approach
        words: Array.isArray(item.words)
          ? item.words
              .filter((word) => typeof word === 'object' && word !== null)
              .map((word) => {
                const value = word as Record<string, unknown>;
                return {
                  word: typeof value.word === 'string' ? value.word : '',
                  start: typeof value.start === 'number' ? value.start : 0,
                  end: typeof value.end === 'number' ? value.end : 0,
                  confidence: typeof value.confidence === 'number' ? value.confidence : undefined,
                };
              })
          : undefined,
        // Whisper-specific metadata fields — preserved for advanced consumers
        id: typeof item.id === 'number' ? item.id : undefined,
        seek: typeof item.seek === 'number' ? item.seek : undefined,
        tokens: Array.isArray(item.tokens)
          ? item.tokens.filter((token): token is number => typeof token === 'number')
          : undefined,
        temperature: typeof item.temperature === 'number' ? item.temperature : undefined,
        avg_logprob: typeof item.avg_logprob === 'number' ? item.avg_logprob : undefined,
        compression_ratio:
          typeof item.compression_ratio === 'number' ? item.compression_ratio : undefined,
        no_speech_prob: typeof item.no_speech_prob === 'number' ? item.no_speech_prob : undefined,
      };
    });
}

/**
 * Speech-to-text provider that uses the OpenAI Whisper transcription API.
 *
 * ## API Contract
 *
 * - **Endpoint:** `POST {baseUrl}/audio/transcriptions`
 * - **Authentication:** `Authorization: Bearer <apiKey>`
 * - **Content-Type:** `multipart/form-data` (FormData with file blob)
 * - **Response format:** Controlled by the `response_format` field; defaults
 *   to `verbose_json` which includes segments, language detection, and duration.
 *
 * ## Supported Response Formats
 *
 * - `verbose_json` — Full JSON with segments, duration, and language (default)
 * - `json` — Minimal JSON with just the text
 * - `text` — Plain text response (no JSON)
 * - `srt` — SubRip subtitle format
 * - `vtt` — WebVTT subtitle format
 *
 * When `text`, `srt`, or `vtt` format is used, the response is returned as
 * plain text and segments are not available.
 *
 * @see {@link OpenAIWhisperSpeechToTextProviderConfig} for configuration options
 * See `normalizeSegments()` for the segment normalization logic.
 *
 * @example
 * ```ts
 * const provider = new OpenAIWhisperSpeechToTextProvider({
 *   apiKey: process.env.OPENAI_API_KEY!,
 *   model: 'whisper-1',
 * });
 * const result = await provider.transcribe(
 *   { data: audioBuffer, mimeType: 'audio/wav', fileName: 'recording.wav' },
 *   { language: 'en', responseFormat: 'verbose_json' },
 * );
 * ```
 */
export class OpenAIWhisperSpeechToTextProvider implements SpeechToTextProvider {
  /** Unique provider identifier used for registration and resolution. */
  public readonly id = 'openai-whisper';

  /** Human-readable display name for UI and logging. */
  public readonly displayName = 'OpenAI Whisper';

  /** Whisper API is batch-only; streaming requires a WebSocket adapter. */
  public readonly supportsStreaming = false;

  /** Fetch implementation — injected for testability, defaults to global fetch. */
  private readonly fetchImpl: typeof fetch;

  /**
   * Creates a new OpenAIWhisperSpeechToTextProvider.
   *
   * @param config - Provider configuration including API key and optional defaults.
   *
   * @example
   * ```ts
   * const provider = new OpenAIWhisperSpeechToTextProvider({
   *   apiKey: 'sk-xxxx',
   *   baseUrl: 'https://api.openai.com/v1', // default
   *   model: 'whisper-1', // default
   * });
   * ```
   */
  private readonly keyPool: ApiKeyPool;

  constructor(private readonly config: OpenAIWhisperSpeechToTextProviderConfig) {
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.keyPool = new ApiKeyPool(config.apiKey);
  }

  /**
   * Returns the human-readable provider name.
   *
   * @returns The display name string `'OpenAI Whisper'`.
   *
   * @example
   * ```ts
   * provider.getProviderName(); // 'OpenAI Whisper'
   * ```
   */
  getProviderName(): string {
    return this.displayName;
  }

  /**
   * Transcribes an audio buffer using the OpenAI Whisper API.
   *
   * The audio is sent as a multipart form upload with the file, model, and
   * optional parameters (language, prompt, temperature, response_format).
   *
   * @param audio - Raw audio data and metadata. The `data` buffer is wrapped
   *   in a Blob and sent as a form file field. If `fileName` is not provided,
   *   a default name is generated from the `format` field.
   * @param options - Optional transcription settings including language hint,
   *   context prompt, temperature for sampling, and response format.
   * @returns A promise resolving to the normalized transcription result.
   * @throws {Error} When the OpenAI API returns a non-2xx status code.
   *
   * @example
   * ```ts
   * const result = await provider.transcribe(
   *   { data: mp3Buffer, mimeType: 'audio/mpeg', fileName: 'voice.mp3' },
   *   { language: 'fr', prompt: 'Discussion about AI' },
   * );
   * ```
   */
  async transcribe(
    audio: SpeechAudioInput,
    options: SpeechTranscriptionOptions = {}
  ): Promise<SpeechTranscriptionResult> {
    const form = new FormData();
    const responseFormat = (options.responseFormat ?? 'verbose_json') as SpeechResponseFormat;
    const model = options.model ?? this.config.model ?? 'whisper-1';
    // Generate a filename with the correct extension for Whisper's format detection
    const fileName = audio.fileName ?? `speech.${audio.format ?? 'wav'}`;

    // Build the multipart form payload — Whisper requires a file upload
    form.append(
      'file',
      new Blob([Uint8Array.from(audio.data)], { type: audio.mimeType ?? 'audio/wav' }),
      fileName
    );
    form.append('model', model);
    form.append('response_format', responseFormat);
    // Optional fields — only include when explicitly set to avoid API warnings
    if (options.language) form.append('language', options.language);
    if (options.prompt) form.append('prompt', options.prompt);
    if (typeof options.temperature === 'number') {
      form.append('temperature', String(options.temperature));
    }

    const response = await this.fetchImpl(
      `${this.config.baseUrl ?? 'https://api.openai.com/v1'}/audio/transcriptions`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.keyPool.next()}`,
          // Content-Type is NOT set — FormData sets it automatically with boundary
        },
        body: form,
      }
    );

    if (!response.ok) {
      const message = await response.text();
      throw new Error(`OpenAI Whisper transcription failed (${response.status}): ${message}`);
    }

    // Plain text responses (format=text, or server returning text/plain)
    // don't have structured data — return minimal result with just the text.
    if (responseFormat === 'text' || response.headers.get('content-type')?.includes('text/plain')) {
      const text = await response.text();
      return {
        text,
        language: options.language,
        durationSeconds: audio.durationSeconds,
        cost: 0,
        isFinal: true,
        usage: {
          durationMinutes: (audio.durationSeconds ?? 0) / 60,
          modelUsed: model,
        },
      };
    }

    // JSON responses (verbose_json or json) — parse and normalize
    const payload = (await response.json()) as Record<string, unknown>;
    const durationSeconds =
      typeof payload.duration === 'number' ? payload.duration : audio.durationSeconds;

    return {
      text: typeof payload.text === 'string' ? payload.text : '',
      language: typeof payload.language === 'string' ? payload.language : options.language,
      durationSeconds,
      cost: 0,
      segments: normalizeSegments(payload.segments),
      providerResponse: payload,
      isFinal: true,
      usage: {
        durationMinutes: (durationSeconds ?? 0) / 60,
        modelUsed: model,
      },
    };
  }
}
