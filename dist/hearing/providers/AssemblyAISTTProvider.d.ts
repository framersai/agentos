import type { SpeechAudioInput, SpeechToTextProvider, SpeechTranscriptionOptions, SpeechTranscriptionResult } from '../../speech/types.js';
/**
 * Configuration for the {@link AssemblyAISTTProvider}.
 *
 * @see {@link AssemblyAISTTProvider} for usage examples
 */
export interface AssemblyAISTTProviderConfig {
    /**
     * AssemblyAI API key used for authentication.
     * Sent as the `Authorization` header value (without a prefix like "Bearer").
     * Obtain from https://www.assemblyai.com/dashboard/account
     */
    apiKey: string;
    /**
     * Custom fetch implementation for dependency injection in tests.
     * When omitted, the global `fetch` is used.
     * @default globalThis.fetch
     */
    fetchImpl?: typeof fetch;
}
/**
 * Speech-to-text provider that uses the AssemblyAI async transcription API.
 *
 * ## Three-Step Workflow
 *
 * AssemblyAI uses an asynchronous transcription pipeline that requires three
 * sequential HTTP requests:
 *
 * 1. **Upload** — `POST /v2/upload` sends the raw audio bytes to AssemblyAI's
 *    CDN and returns an `upload_url`. This step is necessary because the
 *    transcript endpoint accepts URLs, not raw audio.
 *
 * 2. **Submit** — `POST /v2/transcript` creates a transcription job referencing
 *    the upload URL. Returns a transcript `id` used for polling. Optional
 *    features like `speaker_labels` are enabled in this request's JSON body.
 *
 * 3. **Poll** — `GET /v2/transcript/:id` is called every `POLL_INTERVAL_MS`
 *    (1 second) until the transcript `status` transitions to `'completed'` or
 *    `'error'`. The polling loop is bounded by `DEFAULT_TIMEOUT_MS`
 *    (120 seconds) to prevent indefinite waiting.
 *
 * ## AbortController Usage
 *
 * An optional `AbortSignal` can be passed via
 * `options.providerSpecificOptions.signal` to cancel the transcription at any
 * point. The signal is forwarded to all three fetch calls and also checked at
 * the top of each polling iteration. When aborted, an error is thrown
 * immediately without waiting for the current fetch to complete.
 *
 * ## Error Handling
 *
 * - Non-2xx responses at any step throw an `Error` with the HTTP status and body.
 * - `status === 'error'` on the transcript throws with AssemblyAI's error message.
 * - Timeout expiry throws with the transcript ID for manual inspection.
 * - Aborted signals throw with a descriptive cancellation message.
 *
 * @see {@link AssemblyAISTTProviderConfig} for configuration options
 * See `AssemblyAITranscript` for the polling response shape.
 *
 * @example
 * ```ts
 * const provider = new AssemblyAISTTProvider({
 *   apiKey: process.env.ASSEMBLYAI_API_KEY!,
 * });
 *
 * // Basic transcription
 * const result = await provider.transcribe({ data: audioBuffer });
 *
 * // With diarization and cancellation support
 * const controller = new AbortController();
 * const result = await provider.transcribe(
 *   { data: audioBuffer },
 *   {
 *     enableSpeakerDiarization: true,
 *     providerSpecificOptions: { signal: controller.signal },
 *   },
 * );
 * ```
 */
export declare class AssemblyAISTTProvider implements SpeechToTextProvider {
    private readonly config;
    /** Unique provider identifier used for registration and resolution. */
    readonly id = "assemblyai";
    /** Human-readable display name for UI and logging. */
    readonly displayName = "AssemblyAI";
    /**
     * Streaming is not supported by this provider's async pipeline.
     * AssemblyAI does offer a separate real-time streaming API via WebSocket,
     * but that would be a different provider implementation.
     */
    readonly supportsStreaming = false;
    /** Fetch implementation — injected for testability, defaults to global fetch. */
    private readonly fetchImpl;
    /**
     * Creates a new AssemblyAISTTProvider.
     *
     * @param config - Provider configuration including the API key.
     *
     * @example
     * ```ts
     * const provider = new AssemblyAISTTProvider({
     *   apiKey: 'your-assemblyai-api-key',
     * });
     * ```
     */
    private readonly keyPool;
    constructor(config: AssemblyAISTTProviderConfig);
    /**
     * Returns the human-readable provider name.
     *
     * @returns The display name string `'AssemblyAI'`.
     *
     * @example
     * ```ts
     * provider.getProviderName(); // 'AssemblyAI'
     * ```
     */
    getProviderName(): string;
    /**
     * Transcribes an audio buffer via the AssemblyAI three-step async pipeline:
     * upload, submit, and poll.
     *
     * @param audio - Raw audio data and associated metadata. The `data` buffer
     *   is uploaded to AssemblyAI's CDN in step 1.
     * @param options - Optional transcription settings. Pass
     *   `providerSpecificOptions.signal` (an `AbortSignal`) to cancel
     *   at any point in the pipeline.
     * @returns A promise resolving to the normalized transcription result.
     * @throws {Error} When the upload API returns a non-2xx status.
     * @throws {Error} When the transcript submit API returns a non-2xx status.
     * @throws {Error} When the polling API returns a non-2xx status.
     * @throws {Error} When the transcript status becomes `'error'` (includes
     *   AssemblyAI's error message, e.g. "Audio file could not be decoded").
     * @throws {Error} When the 120-second timeout is exceeded (includes the
     *   transcript ID for manual inspection via the AssemblyAI dashboard).
     * @throws {Error} When the caller's AbortSignal is triggered.
     *
     * @example
     * ```ts
     * const result = await provider.transcribe(
     *   { data: wavBuffer, mimeType: 'audio/wav' },
     *   { enableSpeakerDiarization: true, language: 'en' },
     * );
     * console.log(result.text);
     * console.log(result.segments?.map(s => `[${s.speaker}] ${s.text}`));
     * ```
     */
    transcribe(audio: SpeechAudioInput, options?: SpeechTranscriptionOptions): Promise<SpeechTranscriptionResult>;
}
//# sourceMappingURL=AssemblyAISTTProvider.d.ts.map