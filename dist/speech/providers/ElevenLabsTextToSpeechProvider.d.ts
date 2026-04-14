import type { SpeechSynthesisOptions, SpeechSynthesisResult, SpeechVoice, TextToSpeechProvider } from '../types.js';
/**
 * Configuration for the {@link ElevenLabsTextToSpeechProvider}.
 *
 * @see {@link ElevenLabsTextToSpeechProvider} for usage examples
 * @see https://docs.elevenlabs.io/api-reference/text-to-speech
 */
export interface ElevenLabsTextToSpeechProviderConfig {
    /**
     * ElevenLabs API key used for authentication.
     * Sent as the `xi-api-key` header value (not Bearer-style auth).
     */
    apiKey: string;
    /**
     * Base URL for the ElevenLabs API. Override for proxies or self-hosted instances.
     * @default 'https://api.elevenlabs.io/v1'
     */
    baseUrl?: string;
    /**
     * Default voice ID. ElevenLabs uses opaque IDs (not human-readable names).
     * @default 'EXAVITQu4vr4xnSDxMaL' (the "Sarah" voice)
     */
    voiceId?: string;
    /**
     * Default model ID for synthesis.
     * @default 'eleven_multilingual_v2'
     */
    model?: string;
    /**
     * Custom fetch implementation for dependency injection in tests.
     * @default globalThis.fetch
     */
    fetchImpl?: typeof fetch;
}
/**
 * Text-to-speech provider that uses the ElevenLabs TTS API.
 *
 * ## API Contract
 *
 * - **Endpoint:** `POST {baseUrl}/text-to-speech/{voiceId}`
 * - **Authentication:** `xi-api-key: <apiKey>` header
 * - **Content-Type:** `application/json`
 * - **Accept:** `audio/mpeg` (MP3 response)
 * - **Request body:** `{ text, model_id, voice_settings: { stability, similarity_boost, style, use_speaker_boost } }`
 * - **Response:** Raw MP3 audio bytes
 *
 * ## Voice Settings
 *
 * ElevenLabs exposes fine-grained voice control via `voice_settings`:
 * - **stability** (0.0–1.0) — Lower values = more expressive/variable, higher = more consistent
 * - **similarity_boost** (0.0–1.0) — Higher values make output more similar to the original voice
 * - **style** (0.0–1.0) — Style exaggeration (optional, only for v2+ models)
 * - **use_speaker_boost** (boolean) — Enhances speaker similarity (default: true)
 *
 * These can be passed via `options.providerSpecificOptions`.
 *
 * ## Voice ID Resolution
 *
 * The voice ID is resolved with the following priority:
 * 1. `options.voice` (per-call override)
 * 2. `config.voiceId` (constructor default)
 * 3. `options.providerSpecificOptions.voiceId` (legacy override path)
 * 4. `'EXAVITQu4vr4xnSDxMaL'` (hardcoded fallback — the "Sarah" voice)
 *
 * ## Voice Listing
 *
 * {@link listAvailableVoices} fetches the user's voice library from the
 * `/voices` endpoint and maps each entry to the normalized {@link SpeechVoice}
 * shape. Returns an empty array on API errors (graceful degradation).
 *
 * @see {@link ElevenLabsTextToSpeechProviderConfig} for configuration options
 *
 * @example
 * ```ts
 * const provider = new ElevenLabsTextToSpeechProvider({
 *   apiKey: process.env.ELEVENLABS_API_KEY!,
 *   voiceId: 'pNInz6obpgDQGcFmaJgB', // "Adam"
 * });
 * const result = await provider.synthesize('Hello world', {
 *   providerSpecificOptions: { stability: 0.7, similarityBoost: 0.8 },
 * });
 * ```
 */
export declare class ElevenLabsTextToSpeechProvider implements TextToSpeechProvider {
    private readonly config;
    /** Unique provider identifier used for registration and resolution. */
    readonly id = "elevenlabs";
    /** Human-readable display name for UI and logging. */
    readonly displayName = "ElevenLabs";
    /**
     * Streaming is supported — ElevenLabs offers a WebSocket streaming endpoint,
     * and even the REST endpoint can be consumed as a stream.
     */
    readonly supportsStreaming = true;
    /** Fetch implementation — injected for testability, defaults to global fetch. */
    private readonly fetchImpl;
    /** API key pool for round-robin rotation and quota failover. */
    private readonly keyPool;
    /**
     * Creates a new ElevenLabsTextToSpeechProvider.
     *
     * @param config - Provider configuration including API key and optional defaults.
     *
     * @example
     * ```ts
     * const provider = new ElevenLabsTextToSpeechProvider({
     *   apiKey: 'xi-xxxx',
     *   voiceId: 'pNInz6obpgDQGcFmaJgB',
     *   model: 'eleven_multilingual_v2',
     * });
     * ```
     */
    constructor(config: ElevenLabsTextToSpeechProviderConfig);
    /**
     * Returns the human-readable provider name.
     *
     * @returns The display name string `'ElevenLabs'`.
     *
     * @example
     * ```ts
     * provider.getProviderName(); // 'ElevenLabs'
     * ```
     */
    getProviderName(): string;
    /**
     * Synthesizes speech from text using the ElevenLabs TTS API.
     *
     * @param text - The text to convert to audio.
     * @param options - Optional synthesis settings. Use `providerSpecificOptions`
     *   to control ElevenLabs-specific voice settings (stability, similarityBoost,
     *   style, useSpeakerBoost).
     * @returns A promise resolving to the MP3 audio buffer and metadata.
     * @throws {Error} When the ElevenLabs API returns a non-2xx status code.
     *   Common causes: invalid API key (401), voice not found (404),
     *   character limit exceeded (400), or rate limit (429).
     *
     * @example
     * ```ts
     * const result = await provider.synthesize('Hello there!', {
     *   voice: 'pNInz6obpgDQGcFmaJgB',
     *   providerSpecificOptions: {
     *     stability: 0.3,       // More expressive
     *     similarityBoost: 0.9, // Closer to original voice
     *     style: 0.5,           // Moderate style exaggeration
     *   },
     * });
     * ```
     */
    synthesize(text: string, options?: SpeechSynthesisOptions): Promise<SpeechSynthesisResult>;
    /**
     * Fetches the user's voice library from the ElevenLabs API.
     *
     * Returns available voices mapped to the normalized {@link SpeechVoice} shape.
     * Gracefully returns an empty array on API errors (e.g. network failure,
     * invalid key) to avoid breaking voice selection UIs.
     *
     * The voice library includes both ElevenLabs' pre-made voices and any
     * custom/cloned voices in the user's account.
     *
     * @returns A promise resolving to an array of available voices, or an empty
     *   array if the API call fails.
     *
     * @example
     * ```ts
     * const voices = await provider.listAvailableVoices();
     * const rachel = voices.find(v => v.name === 'Rachel');
     * ```
     */
    listAvailableVoices(): Promise<SpeechVoice[]>;
}
//# sourceMappingURL=ElevenLabsTextToSpeechProvider.d.ts.map