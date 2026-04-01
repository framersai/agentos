import type { SpeechSynthesisOptions, SpeechSynthesisResult, SpeechVoice, TextToSpeechProvider } from '../types.js';
/**
 * Configuration for the {@link AzureSpeechTTSProvider}.
 *
 * @see {@link AzureSpeechTTSProvider} for usage examples
 * @see https://learn.microsoft.com/azure/ai-services/speech-service/rest-text-to-speech
 */
export interface AzureSpeechTTSProviderConfig {
    /**
     * Azure Cognitive Services subscription key.
     * Sent as the `Ocp-Apim-Subscription-Key` header value.
     *
     * See `AzureSpeechSTTProviderConfig.key` for the same pattern on STT.
     */
    key: string;
    /**
     * Azure region where the Speech resource is deployed, e.g. `'eastus'`,
     * `'westeurope'`, `'southeastasia'`.
     *
     * The region determines the REST endpoint hostname:
     * `https://{region}.tts.speech.microsoft.com`
     */
    region: string;
    /**
     * Default voice name to use when none is specified per-request.
     * Must be a valid Azure voice short-name (e.g. `'en-US-JennyNeural'`).
     *
     * @default 'en-US-JennyNeural'
     * @see https://learn.microsoft.com/azure/ai-services/speech-service/language-support#prebuilt-neural-voices
     */
    defaultVoice?: string;
    /**
     * Custom fetch implementation for dependency injection in tests.
     * @default globalThis.fetch
     */
    fetchImpl?: typeof fetch;
}
/**
 * Text-to-speech provider that uses the Azure Cognitive Services Speech REST API.
 *
 * ## SSML Generation
 *
 * Azure's TTS REST endpoint requires SSML (Speech Synthesis Markup Language) as
 * the request body — it does not accept plain text. This provider generates
 * minimal SSML via `buildSsml()` that wraps the input text in `<speak>`
 * and `<voice>` elements. Special XML characters in the text are escaped via
 * `escapeXml()` to prevent malformed XML.
 *
 * ## `X-Microsoft-OutputFormat` Options
 *
 * The `X-Microsoft-OutputFormat` header controls the audio encoding. This
 * provider uses `'audio-24khz-96kbitrate-mono-mp3'` which provides:
 * - 24 kHz sample rate (high quality for speech)
 * - 96 kbps bitrate (good balance of quality and file size)
 * - Mono channel (sufficient for speech synthesis)
 * - MP3 format (universally supported)
 *
 * Other available formats include:
 * - `'audio-16khz-128kbitrate-mono-mp3'` — Lower sample rate, higher bitrate
 * - `'audio-24khz-160kbitrate-mono-mp3'` — Higher bitrate for better quality
 * - `'riff-24khz-16bit-mono-pcm'` — Uncompressed WAV
 * - `'ogg-24khz-16bit-mono-opus'` — Opus codec in OGG container
 *
 * @see https://learn.microsoft.com/azure/ai-services/speech-service/rest-text-to-speech#audio-outputs
 *
 * ## Voice Listing
 *
 * The {@link listAvailableVoices} method fetches the full list of neural voices
 * available in the configured Azure region via
 * `GET /cognitiveservices/voices/list`. Results are mapped to the normalized
 * {@link SpeechVoice} shape.
 *
 * @see {@link AzureSpeechTTSProviderConfig} for configuration options
 * @see {@link AzureSpeechSTTProvider} for the corresponding STT provider
 *
 * @example
 * ```ts
 * const provider = new AzureSpeechTTSProvider({
 *   key: process.env.AZURE_SPEECH_KEY!,
 *   region: 'eastus',
 *   defaultVoice: 'en-US-GuyNeural',
 * });
 * const result = await provider.synthesize('Hello world');
 * // result.audioBuffer contains MP3 bytes
 * // result.mimeType === 'audio/mpeg'
 * ```
 */
export declare class AzureSpeechTTSProvider implements TextToSpeechProvider {
    private readonly config;
    /** Unique provider identifier used for registration and resolution. */
    readonly id = "azure-speech-tts";
    /** Human-readable display name for UI and logging. */
    readonly displayName = "Azure Speech (TTS)";
    /**
     * Marked as streaming-capable because the provider can be used within a
     * streaming pipeline — though the actual HTTP request is a single
     * synchronous call that returns the complete audio buffer.
     */
    readonly supportsStreaming = true;
    /** Fetch implementation — injected for testability, defaults to global fetch. */
    private readonly fetchImpl;
    /** Resolved default voice name used when no voice is specified per-request. */
    private readonly defaultVoice;
    /**
     * Creates a new AzureSpeechTTSProvider.
     *
     * @param config - Provider configuration including the subscription key,
     *   region, and optional default voice.
     *
     * @example
     * ```ts
     * const provider = new AzureSpeechTTSProvider({
     *   key: 'your-azure-subscription-key',
     *   region: 'westeurope',
     *   defaultVoice: 'de-DE-ConradNeural',
     * });
     * ```
     */
    constructor(config: AzureSpeechTTSProviderConfig);
    /**
     * Returns the human-readable provider name.
     *
     * @returns The display name string `'Azure Speech (TTS)'`.
     *
     * @example
     * ```ts
     * provider.getProviderName(); // 'Azure Speech (TTS)'
     * ```
     */
    getProviderName(): string;
    /**
     * Synthesizes speech from plain text using the Azure TTS REST endpoint.
     *
     * The text is wrapped in SSML, sent to Azure, and the response audio buffer
     * (MP3 format) is returned along with metadata.
     *
     * @param text - The plain-text utterance to convert to audio. XML special
     *   characters are automatically escaped.
     * @param options - Optional synthesis settings. Use `options.voice` to
     *   override the default voice with any valid Azure voice short-name.
     * @returns A promise resolving to the MP3 audio buffer and metadata.
     * @throws {Error} When the Azure API returns a non-2xx status code.
     *   Common causes: invalid subscription key (401), region mismatch (404),
     *   invalid SSML (400), or quota exceeded (429).
     *
     * @example
     * ```ts
     * const result = await provider.synthesize('Guten Tag!', {
     *   voice: 'de-DE-ConradNeural',
     * });
     * fs.writeFileSync('output.mp3', result.audioBuffer);
     * ```
     */
    synthesize(text: string, options?: SpeechSynthesisOptions): Promise<SpeechSynthesisResult>;
    /**
     * Retrieves the list of available neural voices from the Azure region.
     *
     * Fetches from `GET /cognitiveservices/voices/list` and maps each entry
     * to the normalized {@link SpeechVoice} shape. The list includes all
     * neural and standard voices available in the configured region.
     *
     * @returns A promise resolving to an array of normalized voice entries.
     * @throws {Error} When the Azure API returns a non-2xx status code
     *   (e.g. invalid key, network error).
     *
     * @example
     * ```ts
     * const voices = await provider.listAvailableVoices();
     * const englishVoices = voices.filter(v => v.lang.startsWith('en-'));
     * console.log(`Found ${englishVoices.length} English voices`);
     * ```
     */
    listAvailableVoices(): Promise<SpeechVoice[]>;
}
//# sourceMappingURL=AzureSpeechTTSProvider.d.ts.map