import { ApiKeyPool } from '../../core/providers/ApiKeyPool.js';
import { isQuotaError } from '../../core/providers/quotaErrors.js';
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
export class ElevenLabsTextToSpeechProvider {
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
    constructor(config) {
        this.config = config;
        /** Unique provider identifier used for registration and resolution. */
        this.id = 'elevenlabs';
        /** Human-readable display name for UI and logging. */
        this.displayName = 'ElevenLabs';
        /**
         * Streaming is supported — ElevenLabs offers a WebSocket streaming endpoint,
         * and even the REST endpoint can be consumed as a stream.
         */
        this.supportsStreaming = true;
        this.fetchImpl = config.fetchImpl ?? fetch;
        this.keyPool = new ApiKeyPool(config.apiKey);
    }
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
    getProviderName() {
        return this.displayName;
    }
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
    async synthesize(text, options = {}) {
        // Voice ID resolution with 4-level fallback chain.
        // The providerSpecificOptions.voiceId path exists for backwards compat.
        const voiceId = options.voice ??
            this.config.voiceId ??
            (typeof options.providerSpecificOptions?.voiceId === 'string'
                ? options.providerSpecificOptions.voiceId
                : undefined) ??
            'EXAVITQu4vr4xnSDxMaL'; // Default "Sarah" voice
        const model = options.model ?? this.config.model ?? 'eleven_multilingual_v2';
        const baseUrl = this.config.baseUrl ?? 'https://api.elevenlabs.io/v1';
        const requestBody = JSON.stringify({
            text,
            model_id: model,
            voice_settings: {
                stability: typeof options.providerSpecificOptions?.stability === 'number'
                    ? options.providerSpecificOptions.stability
                    : 0.5,
                similarity_boost: typeof options.providerSpecificOptions?.similarityBoost === 'number'
                    ? options.providerSpecificOptions.similarityBoost
                    : 0.75,
                style: typeof options.providerSpecificOptions?.style === 'number'
                    ? options.providerSpecificOptions.style
                    : undefined,
                use_speaker_boost: typeof options.providerSpecificOptions?.useSpeakerBoost === 'boolean'
                    ? options.providerSpecificOptions.useSpeakerBoost
                    : true,
            },
        });
        const doFetch = (key) => this.fetchImpl(`${baseUrl}/text-to-speech/${voiceId}`, {
            method: 'POST',
            headers: {
                'xi-api-key': key,
                'Content-Type': 'application/json',
                Accept: 'audio/mpeg',
            },
            body: requestBody,
        });
        const key = this.keyPool.next();
        let response = await doFetch(key);
        if (!response.ok && this.keyPool.size > 1) {
            const errBody = await response.text().catch(() => '');
            if (isQuotaError(response.status, errBody)) {
                this.keyPool.markExhausted(key);
                response = await doFetch(this.keyPool.next());
            }
            else {
                throw new Error(`ElevenLabs synthesis failed (${response.status}): ${errBody}`);
            }
        }
        if (!response.ok) {
            const message = await response.text();
            throw new Error(`ElevenLabs synthesis failed (${response.status}): ${message}`);
        }
        const audioBuffer = Buffer.from(await response.arrayBuffer());
        return {
            audioBuffer,
            mimeType: 'audio/mpeg',
            cost: 0, // Cost tracking is handled at a higher layer
            voiceUsed: voiceId,
            providerName: this.displayName,
            usage: {
                characters: text.length,
                modelUsed: model,
            },
        };
    }
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
    async listAvailableVoices() {
        const response = await this.fetchImpl(`${this.config.baseUrl ?? 'https://api.elevenlabs.io/v1'}/voices`, {
            method: 'GET',
            headers: {
                'xi-api-key': this.config.apiKey,
            },
        });
        // Graceful degradation: return empty list on API failure rather than
        // throwing, since voice listing is typically used for UI population
        // and should not block core functionality.
        if (!response.ok) {
            return [];
        }
        const payload = (await response.json());
        return (payload.voices ?? [])
            .filter((voice) => typeof voice === 'object' && voice !== null)
            .map((voice) => {
            // Extract labels object for accent/language metadata
            const labels = typeof voice.labels === 'object' && voice.labels !== null
                ? voice.labels
                : {};
            return {
                id: typeof voice.voice_id === 'string' ? voice.voice_id : '',
                name: typeof voice.name === 'string' ? voice.name : 'Unknown',
                lang: typeof labels.accent === 'string'
                    ? labels.accent
                    : typeof labels.language === 'string'
                        ? labels.language
                        : 'various',
                description: typeof voice.description === 'string' ? voice.description : undefined,
                provider: this.id,
            };
        })
            // Filter out entries with empty IDs (malformed API response entries)
            .filter((voice) => voice.id);
    }
}
//# sourceMappingURL=ElevenLabsTextToSpeechProvider.js.map