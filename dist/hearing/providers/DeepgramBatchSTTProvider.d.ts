import type { SpeechAudioInput, SpeechToTextProvider, SpeechTranscriptionOptions, SpeechTranscriptionResult } from '../../speech/types.js';
/**
 * Configuration for the {@link DeepgramBatchSTTProvider}.
 *
 * @see {@link DeepgramBatchSTTProvider} for usage examples
 */
export interface DeepgramBatchSTTProviderConfig {
    /**
     * Deepgram API key used for authentication.
     * Sent as `Authorization: Token <apiKey>` in the request header.
     */
    apiKey: string;
    /**
     * Deepgram model to use for transcription.
     * See https://developers.deepgram.com/docs/models for available models.
     * @default 'nova-2'
     */
    model?: string;
    /**
     * BCP-47 language code, e.g. `'en-US'`, `'fr-FR'`, `'de-DE'`.
     * When omitted, Deepgram applies automatic language detection.
     * @default 'en-US' (set at transcribe-time if not configured here)
     */
    language?: string;
    /**
     * Custom fetch implementation for dependency injection in tests.
     * When omitted, the global `fetch` is used. This allows tests to
     * intercept HTTP calls without mocking globals.
     * @default globalThis.fetch
     */
    fetchImpl?: typeof fetch;
}
/**
 * Speech-to-text provider that uses the Deepgram batch (pre-recorded) REST API.
 *
 * ## REST API Contract
 *
 * - **Endpoint:** `POST https://api.deepgram.com/v1/listen`
 * - **Authentication:** `Authorization: Token <apiKey>` header
 * - **Content-Type:** Set to the audio's MIME type (e.g. `audio/wav`)
 * - **Body:** Raw audio bytes sent directly (no multipart form)
 * - **Query parameters:** `model`, `punctuate`, `diarize`, `language`
 * - **Response:** JSON containing `results.channels[].alternatives[]` with
 *   transcript text, confidence scores, and optional word-level timing
 *
 * ## Word-Level Diarization Mapping
 *
 * When `enableSpeakerDiarization` is `true`, the `diarize=true` query parameter
 * is set. Deepgram then includes a `speaker` field (zero-based integer index) on
 * each word in the response. These speaker indices are preserved through the
 * `wordsToSegments()` mapping into the normalized result.
 *
 * ## Error Handling
 *
 * Non-2xx responses from Deepgram trigger an `Error` with the HTTP status code
 * and response body text included in the message for debugging. Network-level
 * errors (DNS failures, timeouts) propagate as-is from the fetch implementation.
 *
 * Streaming is NOT supported by this provider — use a Deepgram WebSocket adapter
 * for real-time transcription.
 *
 * @see {@link DeepgramBatchSTTProviderConfig} for configuration options
 * See `wordsToSegments()` for the word-to-segment mapping logic.
 *
 * @example
 * ```ts
 * const provider = new DeepgramBatchSTTProvider({
 *   apiKey: process.env.DEEPGRAM_API_KEY!,
 *   model: 'nova-2',
 * });
 * const result = await provider.transcribe(
 *   { data: audioBuffer, mimeType: 'audio/wav' },
 *   { enableSpeakerDiarization: true },
 * );
 * console.log(result.text);
 * console.log(result.segments?.map(s => `[Speaker ${s.speaker}] ${s.text}`));
 * ```
 */
export declare class DeepgramBatchSTTProvider implements SpeechToTextProvider {
    private readonly config;
    /** Unique provider identifier used for registration and resolution. */
    readonly id = "deepgram-batch";
    /** Human-readable display name for UI and logging. */
    readonly displayName = "Deepgram (Batch)";
    /** This provider uses synchronous HTTP requests, not WebSocket streaming. */
    readonly supportsStreaming = false;
    /** Fetch implementation — injected for testability, defaults to global fetch. */
    private readonly fetchImpl;
    /**
     * Creates a new DeepgramBatchSTTProvider.
     *
     * @param config - Provider configuration including API key and optional defaults.
     *
     * @example
     * ```ts
     * const provider = new DeepgramBatchSTTProvider({
     *   apiKey: 'dg-xxxx',
     *   model: 'nova-2',
     *   language: 'en-US',
     * });
     * ```
     */
    private readonly keyPool;
    constructor(config: DeepgramBatchSTTProviderConfig);
    /**
     * Returns the human-readable provider name.
     *
     * @returns The display name string `'Deepgram (Batch)'`.
     *
     * @example
     * ```ts
     * provider.getProviderName(); // 'Deepgram (Batch)'
     * ```
     */
    getProviderName(): string;
    /**
     * Transcribes an audio buffer using the Deepgram pre-recorded API.
     *
     * Sends the raw audio bytes as the request body (not multipart form) with
     * the appropriate Content-Type header. The response is parsed and normalized
     * into a {@link SpeechTranscriptionResult}.
     *
     * @param audio - Raw audio data and associated metadata (buffer, MIME type,
     *   duration). The `data` buffer is sent directly as the request body.
     * @param options - Optional transcription settings. Supports `model`,
     *   `language`, and `enableSpeakerDiarization` overrides.
     * @returns A promise resolving to the normalized transcription result with
     *   text, confidence, timing, and optional speaker-attributed segments.
     * @throws {Error} When the Deepgram API returns a non-2xx status code.
     *   The error message includes the HTTP status and response body for debugging.
     *
     * @example
     * ```ts
     * const result = await provider.transcribe(
     *   { data: wavBuffer, mimeType: 'audio/wav', durationSeconds: 5.2 },
     *   { language: 'fr-FR', enableSpeakerDiarization: true },
     * );
     * ```
     */
    transcribe(audio: SpeechAudioInput, options?: SpeechTranscriptionOptions): Promise<SpeechTranscriptionResult>;
}
//# sourceMappingURL=DeepgramBatchSTTProvider.d.ts.map