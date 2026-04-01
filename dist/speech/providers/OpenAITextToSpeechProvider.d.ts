import type { SpeechSynthesisOptions, SpeechSynthesisResult, SpeechVoice, TextToSpeechProvider } from '../types.js';
/**
 * Configuration for the {@link OpenAITextToSpeechProvider}.
 *
 * @see {@link OpenAITextToSpeechProvider} for usage examples
 * @see https://platform.openai.com/docs/api-reference/audio/createSpeech
 */
export interface OpenAITextToSpeechProviderConfig {
    /**
     * OpenAI API key used for authentication.
     * Sent as `Authorization: Bearer <apiKey>`.
     */
    apiKey: string;
    /**
     * Base URL for the OpenAI API. Override for proxies, Azure OpenAI, or
     * compatible third-party endpoints.
     * @default 'https://api.openai.com/v1'
     */
    baseUrl?: string;
    /**
     * Default TTS model. `tts-1` is optimized for real-time, `tts-1-hd` for quality.
     * @default 'tts-1'
     */
    model?: string;
    /**
     * Default voice identifier. See `OPENAI_VOICES` for available options.
     * @default 'nova'
     */
    voice?: string;
    /**
     * Custom fetch implementation for dependency injection in tests.
     * @default globalThis.fetch
     */
    fetchImpl?: typeof fetch;
}
/**
 * Text-to-speech provider that uses the OpenAI TTS API.
 *
 * ## API Contract
 *
 * - **Endpoint:** `POST {baseUrl}/audio/speech`
 * - **Authentication:** `Authorization: Bearer <apiKey>`
 * - **Content-Type:** `application/json`
 * - **Request body:** `{ model, voice, input, response_format, speed }`
 * - **Response:** Raw audio bytes in the requested format
 *
 * ## Models
 *
 * - `tts-1` — Optimized for real-time, lower latency, slightly lower quality
 * - `tts-1-hd` — Higher quality at the cost of additional latency
 *
 * ## Voice Listing
 *
 * OpenAI's voice catalog is static (6 voices), so `listAvailableVoices()`
 * returns a hardcoded list from `OPENAI_VOICES` without making an API call.
 *
 * @see {@link OpenAITextToSpeechProviderConfig} for configuration options
 * @see {@link OpenAIWhisperSpeechToTextProvider} for the corresponding STT provider
 *
 * @example
 * ```ts
 * const provider = new OpenAITextToSpeechProvider({
 *   apiKey: process.env.OPENAI_API_KEY!,
 *   model: 'tts-1',
 *   voice: 'nova',
 * });
 * const result = await provider.synthesize('Hello!', { speed: 1.1 });
 * ```
 */
export declare class OpenAITextToSpeechProvider implements TextToSpeechProvider {
    private readonly config;
    /** Unique provider identifier used for registration and resolution. */
    readonly id = "openai-tts";
    /** Human-readable display name for UI and logging. */
    readonly displayName = "OpenAI TTS";
    /**
     * Streaming is supported — the OpenAI API streams audio bytes as they
     * are generated, enabling low-latency playback pipelines.
     */
    readonly supportsStreaming = true;
    /** Fetch implementation — injected for testability, defaults to global fetch. */
    private readonly fetchImpl;
    /**
     * Creates a new OpenAITextToSpeechProvider.
     *
     * @param config - Provider configuration including API key and optional defaults.
     *
     * @example
     * ```ts
     * const provider = new OpenAITextToSpeechProvider({
     *   apiKey: 'sk-xxxx',
     *   voice: 'shimmer',
     * });
     * ```
     */
    constructor(config: OpenAITextToSpeechProviderConfig);
    /**
     * Returns the human-readable provider name.
     *
     * @returns The display name string `'OpenAI TTS'`.
     *
     * @example
     * ```ts
     * provider.getProviderName(); // 'OpenAI TTS'
     * ```
     */
    getProviderName(): string;
    /**
     * Synthesizes speech from text using the OpenAI TTS API.
     *
     * @param text - The text to convert to audio. Maximum 4096 characters.
     * @param options - Optional synthesis settings including voice, model,
     *   output format, and speed (0.25–4.0 range).
     * @returns A promise resolving to the audio buffer and metadata.
     * @throws {Error} When the OpenAI API returns a non-2xx status code.
     *   Common causes: invalid API key (401), rate limit (429), text too long (400).
     *
     * @example
     * ```ts
     * const result = await provider.synthesize('Hello world', {
     *   voice: 'alloy',
     *   speed: 1.2,
     *   outputFormat: 'opus',
     * });
     * ```
     */
    synthesize(text: string, options?: SpeechSynthesisOptions): Promise<SpeechSynthesisResult>;
    /**
     * Returns the static list of available OpenAI TTS voices.
     *
     * Unlike other providers (ElevenLabs, Azure) that require an API call to
     * list voices, OpenAI's voice catalog is fixed and hardcoded. This method
     * returns a shallow copy to prevent external mutation.
     *
     * @returns A promise resolving to the 6 built-in OpenAI voice options.
     *
     * @example
     * ```ts
     * const voices = await provider.listAvailableVoices();
     * const defaultVoice = voices.find(v => v.isDefault); // 'nova'
     * ```
     */
    listAvailableVoices(): Promise<SpeechVoice[]>;
}
//# sourceMappingURL=OpenAITextToSpeechProvider.d.ts.map