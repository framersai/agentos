/**
 * Static catalog of built-in OpenAI TTS voices.
 *
 * These voices are available for both `tts-1` and `tts-1-hd` models.
 * `'nova'` is marked as default because it provides a good balance of
 * naturalness and clarity across languages.
 *
 * @see https://platform.openai.com/docs/guides/text-to-speech/voice-options
 */
const OPENAI_VOICES = [
    { id: 'alloy', name: 'Alloy', provider: 'openai-tts', lang: 'various', isDefault: false },
    { id: 'echo', name: 'Echo', provider: 'openai-tts', lang: 'various', isDefault: false },
    { id: 'fable', name: 'Fable', provider: 'openai-tts', lang: 'various', isDefault: false },
    { id: 'onyx', name: 'Onyx', provider: 'openai-tts', lang: 'various', isDefault: false },
    { id: 'nova', name: 'Nova', provider: 'openai-tts', lang: 'various', isDefault: true },
    { id: 'shimmer', name: 'Shimmer', provider: 'openai-tts', lang: 'various', isDefault: false },
];
/**
 * Maps an OpenAI output format identifier to its corresponding MIME type.
 *
 * OpenAI TTS supports multiple output formats. The default is MP3, which
 * provides good quality at reasonable file sizes. PCM returns raw 24kHz
 * 16-bit little-endian audio (MIME type `audio/L16`).
 *
 * @param format - The OpenAI output format string (e.g. `'mp3'`, `'opus'`).
 * @returns The corresponding MIME type string.
 *
 * @example
 * ```ts
 * mimeTypeForOutput('opus'); // 'audio/opus'
 * mimeTypeForOutput(undefined); // 'audio/mpeg' (default)
 * ```
 */
function mimeTypeForOutput(format) {
    switch (format) {
        case 'opus':
            return 'audio/opus';
        case 'aac':
            return 'audio/aac';
        case 'flac':
            return 'audio/flac';
        case 'wav':
            return 'audio/wav';
        case 'pcm':
            return 'audio/L16'; // Raw 24kHz 16-bit little-endian mono
        default:
            return 'audio/mpeg'; // MP3 is the default format
    }
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
export class OpenAITextToSpeechProvider {
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
    constructor(config) {
        this.config = config;
        /** Unique provider identifier used for registration and resolution. */
        this.id = 'openai-tts';
        /** Human-readable display name for UI and logging. */
        this.displayName = 'OpenAI TTS';
        /**
         * Streaming is supported — the OpenAI API streams audio bytes as they
         * are generated, enabling low-latency playback pipelines.
         */
        this.supportsStreaming = true;
        this.fetchImpl = config.fetchImpl ?? fetch;
    }
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
    getProviderName() {
        return this.displayName;
    }
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
    async synthesize(text, options = {}) {
        // Resolve options with fallback chain: per-call options > config > defaults
        const model = options.model ?? this.config.model ?? 'tts-1';
        const voice = options.voice ?? this.config.voice ?? 'nova';
        const outputFormat = options.outputFormat ?? 'mp3';
        const response = await this.fetchImpl(`${this.config.baseUrl ?? 'https://api.openai.com/v1'}/audio/speech`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${this.config.apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model,
                voice,
                input: text,
                response_format: outputFormat,
                speed: options.speed, // undefined is omitted by JSON.stringify
            }),
        });
        if (!response.ok) {
            const message = await response.text();
            throw new Error(`OpenAI TTS synthesis failed (${response.status}): ${message}`);
        }
        const audioBuffer = Buffer.from(await response.arrayBuffer());
        return {
            audioBuffer,
            mimeType: mimeTypeForOutput(outputFormat),
            cost: 0, // Cost tracking is handled at a higher layer
            voiceUsed: voice,
            providerName: this.displayName,
            usage: {
                characters: text.length,
                modelUsed: model,
            },
        };
    }
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
    async listAvailableVoices() {
        // Return a shallow copy to prevent external mutation of the static catalog
        return [...OPENAI_VOICES];
    }
}
//# sourceMappingURL=OpenAITextToSpeechProvider.js.map