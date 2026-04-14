import type { SpeechAudioInput, SpeechToTextProvider, SpeechTranscriptionOptions, SpeechTranscriptionResult } from '../../speech/types.js';
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
export declare class OpenAIWhisperSpeechToTextProvider implements SpeechToTextProvider {
    private readonly config;
    /** Unique provider identifier used for registration and resolution. */
    readonly id = "openai-whisper";
    /** Human-readable display name for UI and logging. */
    readonly displayName = "OpenAI Whisper";
    /** Whisper API is batch-only; streaming requires a WebSocket adapter. */
    readonly supportsStreaming = false;
    /** Fetch implementation — injected for testability, defaults to global fetch. */
    private readonly fetchImpl;
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
    private readonly keyPool;
    constructor(config: OpenAIWhisperSpeechToTextProviderConfig);
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
    getProviderName(): string;
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
    transcribe(audio: SpeechAudioInput, options?: SpeechTranscriptionOptions): Promise<SpeechTranscriptionResult>;
}
//# sourceMappingURL=OpenAIWhisperSpeechToTextProvider.d.ts.map