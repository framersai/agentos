import type { SpeechAudioInput, SpeechToTextProvider, SpeechTranscriptionOptions, SpeechTranscriptionResult } from '../../speech/types.js';
/**
 * Configuration for the {@link AzureSpeechSTTProvider}.
 *
 * @see {@link AzureSpeechSTTProvider} for usage examples
 * @see https://learn.microsoft.com/azure/ai-services/speech-service/rest-speech-to-text
 */
export interface AzureSpeechSTTProviderConfig {
    /**
     * Azure Cognitive Services subscription key.
     * Sent as the `Ocp-Apim-Subscription-Key` header — this is Azure's
     * standard authentication mechanism for Cognitive Services REST APIs.
     * Obtain from the Azure portal under your Speech resource's "Keys and Endpoint".
     */
    key: string;
    /**
     * Azure region where the Speech resource is deployed, e.g. `'eastus'`,
     * `'westeurope'`, `'southeastasia'`.
     *
     * The region determines the REST endpoint hostname:
     * `https://{region}.stt.speech.microsoft.com`
     *
     * @see https://learn.microsoft.com/azure/ai-services/speech-service/regions
     */
    region: string;
    /**
     * Custom fetch implementation for dependency injection in tests.
     * @default globalThis.fetch
     */
    fetchImpl?: typeof fetch;
}
/**
 * Speech-to-text provider that uses the Azure Cognitive Services Speech REST API.
 *
 * ## Azure REST Endpoint Format
 *
 * The endpoint URL follows this pattern:
 * ```
 * https://{region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language={lang}
 * ```
 *
 * - `{region}` — The Azure region from config (e.g. `eastus`, `westeurope`).
 * - `{lang}` — BCP-47 language code from options or `'en-US'` default.
 * - The `/conversation/` path segment selects the conversation recognition mode
 *   (as opposed to `/interactive/` or `/dictation/`).
 *
 * ## Authentication: `Ocp-Apim-Subscription-Key`
 *
 * Azure Cognitive Services uses the `Ocp-Apim-Subscription-Key` HTTP header
 * for authentication, which differs from the typical `Authorization: Bearer`
 * pattern. The subscription key is sent as a plain-text header value — no
 * "Bearer" or "Token" prefix.
 *
 * An alternative is to use a short-lived token from the token endpoint, but
 * this provider uses the simpler key-based approach for reliability.
 *
 * ## NoMatch Handling
 *
 * When Azure's recognizer detects audio but cannot identify any speech, it
 * returns `RecognitionStatus: 'NoMatch'` instead of raising an HTTP error.
 * This provider maps `NoMatch` to an empty-text result (`text: ''`) with
 * `isFinal: true`, matching the Azure Speech SDK's behaviour. This prevents
 * the fallback proxy from unnecessarily trying another provider when the
 * audio genuinely contains no speech.
 *
 * ## Limitations
 *
 * - Audio must be PCM WAV format. The `Content-Type` is hardcoded to
 *   `audio/wav` regardless of the `audio.mimeType` value.
 * - Streaming is not supported — use the Azure Speech SDK for real-time STT.
 * - Speaker diarization is not available via the REST API.
 *
 * @see {@link AzureSpeechSTTProviderConfig} for configuration options
 * @see {@link AzureSpeechTTSProvider} for the corresponding TTS provider
 *
 * @example
 * ```ts
 * const provider = new AzureSpeechSTTProvider({
 *   key: process.env.AZURE_SPEECH_KEY!,
 *   region: 'eastus',
 * });
 * const result = await provider.transcribe(
 *   { data: wavBuffer, mimeType: 'audio/wav' },
 *   { language: 'de-DE' },
 * );
 * console.log(result.text); // '' if no speech detected
 * ```
 */
export declare class AzureSpeechSTTProvider implements SpeechToTextProvider {
    private readonly config;
    /** Unique provider identifier used for registration and resolution. */
    readonly id = "azure-speech-stt";
    /** Human-readable display name for UI and logging. */
    readonly displayName = "Azure Speech (STT)";
    /** This provider uses synchronous HTTP requests, not WebSocket streaming. */
    readonly supportsStreaming = false;
    /** Fetch implementation — injected for testability, defaults to global fetch. */
    private readonly fetchImpl;
    /**
     * Creates a new AzureSpeechSTTProvider.
     *
     * @param config - Provider configuration including the subscription key and region.
     *
     * @example
     * ```ts
     * const provider = new AzureSpeechSTTProvider({
     *   key: 'your-azure-subscription-key',
     *   region: 'eastus',
     * });
     * ```
     */
    constructor(config: AzureSpeechSTTProviderConfig);
    /**
     * Returns the human-readable provider name.
     *
     * @returns The display name string `'Azure Speech (STT)'`.
     *
     * @example
     * ```ts
     * provider.getProviderName(); // 'Azure Speech (STT)'
     * ```
     */
    getProviderName(): string;
    /**
     * Transcribes an audio buffer using the Azure Speech recognition REST endpoint.
     *
     * Sends the raw audio as PCM WAV and returns a normalized result. Azure's
     * `NoMatch` status is treated as an empty transcript (not an error).
     *
     * @param audio - Raw audio data. Azure expects PCM WAV format; the
     *   Content-Type header is always set to `'audio/wav'` regardless of
     *   `audio.mimeType`.
     * @param options - Optional transcription settings. Only `language` is
     *   supported by the Azure REST endpoint.
     * @returns A promise resolving to the normalized transcription result.
     * @throws {Error} When the Azure API returns a non-2xx HTTP status code.
     *   The error message includes the status and response body text.
     *
     * @example
     * ```ts
     * const result = await provider.transcribe(
     *   { data: wavBuffer, durationSeconds: 5 },
     *   { language: 'fr-FR' },
     * );
     * if (result.text === '') {
     *   console.log('No speech detected in the audio');
     * }
     * ```
     */
    transcribe(audio: SpeechAudioInput, options?: SpeechTranscriptionOptions): Promise<SpeechTranscriptionResult>;
}
//# sourceMappingURL=AzureSpeechSTTProvider.d.ts.map