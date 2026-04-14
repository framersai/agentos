/**
 * @module media/audio/providers/SunoProvider
 *
 * Music generation provider for the Suno AI model via Replicate.
 *
 * Suno is hosted on Replicate and accessed through the predictions API
 * using the submit-then-poll pattern. This provider is music-only; it
 * does not support sound effect generation.
 *
 * ## API flow (Replicate submit-poll)
 *
 * 1. **Create prediction** — `POST ${baseURL}/predictions` with
 *    `Prefer: wait=60`. If the model finishes within 60 seconds the
 *    response already contains the output.
 * 2. **Poll** (if needed) — `GET prediction.urls.get` until `status` is
 *    `succeeded`, `failed`, or `canceled`.
 * 3. **Result** — `output` is the audio URL (string or first array element).
 *
 * ## Authentication
 *
 * Requires a `SUNO_API_KEY` or `REPLICATE_API_TOKEN`. Sent as
 * `Authorization: Token ${apiKey}`.
 *
 * @see {@link IAudioGenerator} for the provider interface contract.
 * @see {@link ReplicateVideoProvider} for the video counterpart using
 *   the same Replicate pattern.
 */
import { ApiKeyPool } from '../../../core/providers/ApiKeyPool.js';
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
/**
 * Sleep for the specified number of milliseconds.
 * @param ms - Duration in milliseconds.
 * @internal
 */
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
/**
 * Extract an audio URL from the Replicate prediction output.
 *
 * Replicate returns output in different shapes depending on the model:
 * - A plain URL string
 * - An array of URL strings (first element is the audio)
 *
 * @param output - Raw output from the prediction.
 * @returns The audio URL string, or `undefined` if not found.
 * @internal
 */
function extractAudioUrl(output) {
    if (typeof output === 'string')
        return output;
    if (Array.isArray(output)) {
        for (const item of output) {
            if (typeof item === 'string')
                return item;
        }
        return undefined;
    }
    if (output && typeof output === 'object') {
        const obj = output;
        if (typeof obj.url === 'string')
            return obj.url;
        if (typeof obj.audio === 'string')
            return obj.audio;
    }
    return undefined;
}
// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------
/**
 * Music generation provider connecting to the Suno AI model on Replicate.
 *
 * Follows the Replicate submit-then-poll pattern: create a prediction with
 * `Prefer: wait=60`, then poll if the model takes longer than the wait window.
 *
 * @implements {IAudioGenerator}
 *
 * @example
 * ```typescript
 * const provider = new SunoProvider();
 * await provider.initialize({ apiKey: process.env.REPLICATE_API_TOKEN! });
 *
 * const result = await provider.generateMusic({
 *   prompt: 'A jazzy lo-fi hip hop beat with warm piano chords',
 *   durationSec: 60,
 * });
 * console.log(result.audio[0].url);
 * ```
 */
export class SunoProvider {
    constructor() {
        /** @inheritdoc */
        this.providerId = 'suno';
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
            throw new Error('Suno provider requires apiKey (SUNO_API_KEY or REPLICATE_API_TOKEN).');
        }
        this._config = {
            apiKey,
            baseURL: typeof config.baseURL === 'string' && config.baseURL.trim()
                ? config.baseURL.trim()
                : 'https://api.replicate.com/v1',
            defaultModelId: typeof config.defaultModelId === 'string' && config.defaultModelId.trim()
                ? config.defaultModelId.trim()
                : 'suno-ai/suno',
            pollIntervalMs: typeof config.pollIntervalMs === 'number' && config.pollIntervalMs > 0
                ? config.pollIntervalMs
                : 5000,
            timeoutMs: typeof config.timeoutMs === 'number' && config.timeoutMs > 0
                ? config.timeoutMs
                : 300000,
        };
        this.defaultModelId = this._config.defaultModelId;
        this.keyPool = new ApiKeyPool(apiKey);
        this.isInitialized = true;
    }
    // -------------------------------------------------------------------------
    // Generation
    // -------------------------------------------------------------------------
    /**
     * Generate music from a text prompt using the Suno model on Replicate.
     *
     * Creates a prediction, waits for synchronous completion (up to 60s), then
     * polls if still in progress.
     *
     * @param request - Music generation request with prompt and optional params.
     * @returns The generated audio result envelope.
     *
     * @throws {Error} If the provider is not initialized.
     * @throws {Error} If the API returns an error or times out.
     */
    async generateMusic(request) {
        if (!this.isInitialized) {
            throw new Error('Suno provider is not initialized. Call initialize() first.');
        }
        const model = request.modelId || this.defaultModelId || 'suno-ai/suno';
        const input = {
            prompt: request.prompt,
            make_instrumental: true,
        };
        if (request.durationSec !== undefined)
            input.duration = request.durationSec;
        const prediction = await this._runPrediction(model, input);
        return this._buildResult(prediction, model);
    }
    /**
     * SFX generation is not supported by the Suno model.
     *
     * @throws {Error} Always throws — use an SFX-capable provider instead.
     */
    async generateSFX(_request) {
        throw new Error('Suno provider does not support SFX generation. Use an SFX-capable provider.');
    }
    // -------------------------------------------------------------------------
    // Capability query
    // -------------------------------------------------------------------------
    /**
     * Suno supports music generation only.
     *
     * @param capability - The capability to check.
     * @returns `true` only for `'music'`; `false` for `'sfx'`.
     */
    supports(capability) {
        return capability === 'music';
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
     * Create a prediction and wait for it to complete.
     *
     * Uses `Prefer: wait=60` to get synchronous completion for fast models.
     * Falls back to polling if the prediction hasn't completed within the
     * wait window.
     *
     * @param model - Model identifier (e.g. 'suno-ai/suno').
     * @param input - Model input parameters.
     * @returns The completed prediction object.
     *
     * @throws {Error} If prediction creation fails, the prediction fails,
     *   is canceled, or times out.
     * @internal
     */
    async _runPrediction(model, input) {
        let prediction = await this._createPrediction(model, input);
        // If the prediction hasn't reached a terminal state, poll for it.
        if (prediction.status
            && !['succeeded', 'failed', 'canceled'].includes(prediction.status)
            && prediction.urls?.get) {
            prediction = await this._pollPrediction(prediction.urls.get);
        }
        if (prediction.status === 'failed') {
            throw new Error(`Suno music generation failed: ${prediction.error ?? 'unknown error'}`);
        }
        if (prediction.status === 'canceled') {
            throw new Error('Suno music generation was canceled.');
        }
        return prediction;
    }
    /**
     * Create a new prediction via `POST /predictions`.
     *
     * @param model - Model identifier.
     * @param input - Model input parameters.
     * @returns The prediction response (may or may not be completed).
     *
     * @throws {Error} If the HTTP request fails.
     * @internal
     */
    async _createPrediction(model, input) {
        const body = {
            model,
            input,
        };
        const response = await fetch(`${this._config.baseURL}/predictions`, {
            method: 'POST',
            headers: {
                Authorization: `Token ${this.keyPool.next()}`,
                'Content-Type': 'application/json',
                Prefer: 'wait=60',
            },
            body: JSON.stringify(body),
        });
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Suno prediction submission failed (${response.status}): ${errorText}`);
        }
        return (await response.json());
    }
    /**
     * Poll a prediction URL until it reaches a terminal state.
     *
     * @param url - The `prediction.urls.get` URL to poll.
     * @returns The completed prediction object.
     *
     * @throws {Error} If polling fails or times out.
     * @internal
     */
    async _pollPrediction(url) {
        const startedAt = Date.now();
        while (Date.now() - startedAt < this._config.timeoutMs) {
            const response = await fetch(url, {
                headers: {
                    Authorization: `Token ${this.keyPool.next()}`,
                },
            });
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Suno prediction polling failed (${response.status}): ${errorText}`);
            }
            const prediction = (await response.json());
            if (!prediction.status
                || ['succeeded', 'failed', 'canceled'].includes(prediction.status)) {
                return prediction;
            }
            await sleep(this._config.pollIntervalMs);
        }
        throw new Error(`Suno music generation timed out after ${this._config.timeoutMs}ms.`);
    }
    /**
     * Build an {@link AudioResult} from a completed Replicate prediction.
     *
     * @param prediction - The succeeded prediction object.
     * @param model - Model ID used for the generation.
     * @returns Normalized audio result envelope.
     *
     * @throws {Error} If no audio URL could be extracted from the output.
     * @internal
     */
    _buildResult(prediction, model) {
        const audioUrl = extractAudioUrl(prediction.output);
        if (!audioUrl) {
            throw new Error('Suno prediction succeeded but returned no audio output.');
        }
        return {
            created: Math.floor(Date.now() / 1000),
            modelId: model,
            providerId: this.providerId,
            audio: [{
                    url: audioUrl,
                    mimeType: 'audio/mpeg',
                    providerMetadata: {
                        predictionId: prediction.id,
                    },
                }],
            usage: {
                totalAudioClips: 1,
            },
        };
    }
}
//# sourceMappingURL=SunoProvider.js.map