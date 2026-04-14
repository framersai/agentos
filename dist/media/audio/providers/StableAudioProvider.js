/**
 * @module media/audio/providers/StableAudioProvider
 *
 * Audio generation provider for the Stability AI Stable Audio API.
 *
 * Stable Audio generates both music and sound effects from text prompts
 * using the Stable Audio Open model. The API is synchronous: a single
 * POST request returns audio data directly (no queue or polling).
 *
 * ## Supported models
 *
 * | Model ID                   | Description                        |
 * |----------------------------|------------------------------------|
 * | `stable-audio-open-1.0`    | Stable Audio Open 1.0 — default    |
 *
 * ## API flow (synchronous)
 *
 * 1. **Generate** — `POST ${baseURL}/audio/generate` with prompt, duration,
 *    and output format. Returns audio data directly in the response body.
 *
 * ## Authentication
 *
 * Requires a `STABILITY_API_KEY`. Sent as `Authorization: Bearer ${apiKey}`.
 *
 * @see {@link IAudioGenerator} for the provider interface contract.
 */
import { ApiKeyPool } from '../../../core/providers/ApiKeyPool.js';
// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------
/**
 * Audio generation provider connecting to the Stability AI Stable Audio API.
 *
 * Implements a synchronous request pattern: a single POST request returns
 * the generated audio data directly. Supports both music and SFX generation.
 *
 * @implements {IAudioGenerator}
 *
 * @example
 * ```typescript
 * const provider = new StableAudioProvider();
 * await provider.initialize({ apiKey: process.env.STABILITY_API_KEY! });
 *
 * const result = await provider.generateMusic({
 *   prompt: 'Upbeat electronic dance track with heavy bass',
 *   durationSec: 30,
 * });
 * console.log(result.audio[0].url);
 * ```
 */
export class StableAudioProvider {
    constructor() {
        /** @inheritdoc */
        this.providerId = 'stable-audio';
        /** @inheritdoc */
        this.isInitialized = false;
    }
    // -------------------------------------------------------------------------
    // Lifecycle
    // -------------------------------------------------------------------------
    /**
     * Initialize the provider with API credentials and optional configuration.
     *
     * @param config - Configuration object. Must include `apiKey`.
     * @throws {Error} If `apiKey` is missing or empty.
     */
    async initialize(config) {
        const apiKey = typeof config.apiKey === 'string' ? config.apiKey.trim() : '';
        if (!apiKey) {
            throw new Error('Stable Audio provider requires apiKey (STABILITY_API_KEY).');
        }
        this._config = {
            apiKey,
            baseURL: typeof config.baseURL === 'string' && config.baseURL.trim()
                ? config.baseURL.trim()
                : 'https://api.stability.ai/v2beta',
            defaultModelId: typeof config.defaultModelId === 'string' && config.defaultModelId.trim()
                ? config.defaultModelId.trim()
                : 'stable-audio-open-1.0',
        };
        this.defaultModelId = this._config.defaultModelId;
        this.keyPool = new ApiKeyPool(apiKey);
        this.isInitialized = true;
    }
    // -------------------------------------------------------------------------
    // Generation
    // -------------------------------------------------------------------------
    /**
     * Generate music from a text prompt using the Stability AI audio endpoint.
     *
     * @param request - Music generation request with prompt and optional params.
     * @returns The generated audio result envelope.
     *
     * @throws {Error} If the provider is not initialized.
     * @throws {Error} If the API returns an error.
     */
    async generateMusic(request) {
        if (!this.isInitialized) {
            throw new Error('Stable Audio provider is not initialized. Call initialize() first.');
        }
        return this._generate(request.prompt, request.durationSec, request.modelId);
    }
    /**
     * Generate a sound effect from a text prompt using the Stability AI audio endpoint.
     *
     * @param request - SFX generation request with prompt and optional params.
     * @returns The generated audio result envelope.
     *
     * @throws {Error} If the provider is not initialized.
     * @throws {Error} If the API returns an error.
     */
    async generateSFX(request) {
        if (!this.isInitialized) {
            throw new Error('Stable Audio provider is not initialized. Call initialize() first.');
        }
        return this._generate(request.prompt, request.durationSec, request.modelId);
    }
    // -------------------------------------------------------------------------
    // Capability query
    // -------------------------------------------------------------------------
    /**
     * Stable Audio supports both music and SFX generation.
     *
     * @param capability - The capability to check.
     * @returns `true` for both `'music'` and `'sfx'`.
     */
    supports(capability) {
        return capability === 'music' || capability === 'sfx';
    }
    /**
     * Release any resources held by the provider. No-op for HTTP-only providers.
     */
    async shutdown() {
        this.isInitialized = false;
    }
    // -------------------------------------------------------------------------
    // Private helpers
    // -------------------------------------------------------------------------
    /**
     * Send a synchronous audio generation request to the Stability AI API.
     *
     * The API returns audio data directly in the response body (no queue or
     * polling required). The response is treated as a binary blob and converted
     * to a base64-encoded string.
     *
     * @param prompt - Text description of the desired audio.
     * @param durationSec - Desired duration in seconds.
     * @param modelId - Optional model override.
     * @returns Normalized audio result envelope.
     *
     * @throws {Error} If the HTTP request fails.
     * @internal
     */
    async _generate(prompt, durationSec, modelId) {
        const model = modelId || this.defaultModelId || 'stable-audio-open-1.0';
        const url = `${this._config.baseURL}/audio/generate`;
        const body = {
            prompt,
            output_format: 'mp3',
        };
        if (durationSec !== undefined)
            body.duration = durationSec;
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${this.keyPool.next()}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        });
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Stable Audio generation failed (${response.status}): ${errorText}`);
        }
        // The API returns raw audio bytes. Convert to base64 for the result envelope.
        const arrayBuffer = await response.arrayBuffer();
        const base64 = Buffer.from(arrayBuffer).toString('base64');
        return {
            created: Math.floor(Date.now() / 1000),
            modelId: model,
            providerId: this.providerId,
            audio: [{
                    base64,
                    mimeType: 'audio/mpeg',
                    durationSec,
                    providerMetadata: {},
                }],
            usage: {
                totalAudioClips: 1,
            },
        };
    }
}
//# sourceMappingURL=StableAudioProvider.js.map