/**
 * @module media/audio/providers/FalAudioProvider
 *
 * Audio generation provider for the Fal.ai serverless GPU platform.
 *
 * Fal.ai hosts audio generation models (Stable Audio, etc.) behind a
 * queue-based API. This provider implements the three-step pattern
 * established by {@link FalVideoProvider}: submit to queue, poll for status,
 * then fetch the completed result.
 *
 * ## Supported models
 *
 * | Model ID               | Description                          |
 * |------------------------|--------------------------------------|
 * | `fal-ai/stable-audio`  | Stable Audio on Fal.ai — default     |
 *
 * ## API flow (three-step queue)
 *
 * 1. **Submit** — `POST ${baseURL}/${model}` with prompt/params.
 *    Returns `{ request_id }` immediately.
 * 2. **Poll** — `GET ${baseURL}/${model}/requests/${request_id}/status`
 *    until `status === 'COMPLETED'` or `'FAILED'`.
 * 3. **Fetch** — `GET ${baseURL}/${model}/requests/${request_id}`
 *    returns `{ audio: { url } }`.
 *
 * ## Authentication
 *
 * Requires a `FAL_API_KEY`. Sent as `Authorization: Key ${apiKey}`.
 *
 * @see {@link IAudioGenerator} for the provider interface contract.
 * @see {@link FalVideoProvider} for the video counterpart.
 * @see {@link FalImageProvider} for the image counterpart.
 */
import { ApiKeyPool } from '../../../core/providers/ApiKeyPool.js';
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
/**
 * Sleep for the specified number of milliseconds.
 * Used between poll requests to avoid rate-limiting.
 * @param ms - Duration in milliseconds.
 * @internal
 */
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------
/**
 * Audio generation provider connecting to the Fal.ai serverless platform.
 *
 * Implements the three-step queue pattern: submit a generation task,
 * poll the status endpoint until completion, then fetch the result.
 * This mirrors the flow used by {@link FalVideoProvider}.
 *
 * Supports both music and SFX generation through the same endpoint.
 *
 * @implements {IAudioGenerator}
 *
 * @example
 * ```typescript
 * const provider = new FalAudioProvider();
 * await provider.initialize({ apiKey: process.env.FAL_API_KEY! });
 *
 * const result = await provider.generateMusic({
 *   modelId: 'fal-ai/stable-audio',
 *   prompt: 'A dreamy ambient track with reverb-heavy synths',
 *   durationSec: 30,
 * });
 * console.log(result.audio[0].url);
 * ```
 */
export class FalAudioProvider {
    constructor() {
        /** @inheritdoc */
        this.providerId = 'fal-audio';
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
            throw new Error('Fal.ai audio provider requires apiKey (FAL_API_KEY).');
        }
        this._config = {
            apiKey,
            baseURL: typeof config.baseURL === 'string' && config.baseURL.trim()
                ? config.baseURL.trim()
                : 'https://queue.fal.run',
            defaultModelId: typeof config.defaultModelId === 'string' && config.defaultModelId.trim()
                ? config.defaultModelId.trim()
                : 'fal-ai/stable-audio',
            pollIntervalMs: typeof config.pollIntervalMs === 'number' && config.pollIntervalMs > 0
                ? config.pollIntervalMs
                : 2000,
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
     * Generate music from a text prompt using the Fal.ai queue API.
     *
     * Submits the task, polls until complete, then fetches the result.
     *
     * @param request - Music generation request with prompt and optional params.
     * @returns The generated audio result envelope.
     *
     * @throws {Error} If the provider is not initialized.
     * @throws {Error} If the API returns an error or times out.
     */
    async generateMusic(request) {
        if (!this.isInitialized) {
            throw new Error('Fal.ai audio provider is not initialized. Call initialize() first.');
        }
        return this._generate(request.prompt, request.durationSec, request.modelId);
    }
    /**
     * Generate a sound effect from a text prompt using the Fal.ai queue API.
     *
     * Submits the task, polls until complete, then fetches the result.
     *
     * @param request - SFX generation request with prompt and optional params.
     * @returns The generated audio result envelope.
     *
     * @throws {Error} If the provider is not initialized.
     * @throws {Error} If the API returns an error or times out.
     */
    async generateSFX(request) {
        if (!this.isInitialized) {
            throw new Error('Fal.ai audio provider is not initialized. Call initialize() first.');
        }
        return this._generate(request.prompt, request.durationSec, request.modelId);
    }
    // -------------------------------------------------------------------------
    // Capability query
    // -------------------------------------------------------------------------
    /**
     * Fal.ai audio supports both music and SFX generation.
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
     * Run the full three-step generation flow: submit, poll, fetch.
     *
     * @param prompt - Text description of the desired audio.
     * @param durationSec - Desired duration in seconds.
     * @param modelId - Optional model override.
     * @returns Normalized audio result envelope.
     *
     * @throws {Error} If any step of the flow fails.
     * @internal
     */
    async _generate(prompt, durationSec, modelId) {
        const model = modelId || this.defaultModelId || 'fal-ai/stable-audio';
        const body = {
            prompt,
        };
        if (durationSec !== undefined)
            body.duration = durationSec;
        // Three-step flow: submit -> poll -> fetch
        const requestId = await this._submitTask(model, body);
        await this._pollStatus(model, requestId);
        const result = await this._fetchResult(model, requestId);
        return this._buildResult(result, model);
    }
    /**
     * Submit a generation task to the Fal.ai queue.
     *
     * @param model - Full model path (e.g. 'fal-ai/stable-audio').
     * @param body - Request body with prompt and generation params.
     * @returns The request_id for status polling.
     *
     * @throws {Error} If the submission request fails.
     * @internal
     */
    async _submitTask(model, body) {
        const url = `${this._config.baseURL}/${model}`;
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                Authorization: `Key ${this.keyPool.next()}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        });
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Fal.ai audio generation submission failed (${response.status}): ${errorText}`);
        }
        const data = (await response.json());
        if (!data.request_id) {
            throw new Error('Fal.ai audio submission response missing request_id.');
        }
        return data.request_id;
    }
    /**
     * Poll the Fal.ai status endpoint until the task completes or times out.
     *
     * @param model - Full model path.
     * @param requestId - The request ID from submission.
     *
     * @throws {Error} If the generation fails or times out.
     * @internal
     */
    async _pollStatus(model, requestId) {
        const startedAt = Date.now();
        while (Date.now() - startedAt < this._config.timeoutMs) {
            const url = `${this._config.baseURL}/${model}/requests/${requestId}/status`;
            const response = await fetch(url, {
                headers: {
                    Authorization: `Key ${this.keyPool.next()}`,
                },
            });
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Fal.ai audio status polling failed (${response.status}): ${errorText}`);
            }
            const data = (await response.json());
            if (data.status === 'COMPLETED') {
                return;
            }
            if (data.status === 'FAILED') {
                throw new Error(`Fal.ai audio generation failed for request ${requestId}.`);
            }
            // 'IN_QUEUE' or 'IN_PROGRESS' — wait before next poll
            await sleep(this._config.pollIntervalMs);
        }
        throw new Error(`Fal.ai audio generation timed out after ${this._config.timeoutMs}ms for request ${requestId}.`);
    }
    /**
     * Fetch the completed generation result from the Fal.ai result endpoint.
     *
     * Called after polling confirms the task is COMPLETED.
     *
     * @param model - Full model path.
     * @param requestId - The request ID from submission.
     * @returns The generation result with audio URL.
     *
     * @throws {Error} If the result fetch fails.
     * @internal
     */
    async _fetchResult(model, requestId) {
        const url = `${this._config.baseURL}/${model}/requests/${requestId}`;
        const response = await fetch(url, {
            headers: {
                Authorization: `Key ${this.keyPool.next()}`,
            },
        });
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Fal.ai audio result fetch failed (${response.status}): ${errorText}`);
        }
        return (await response.json());
    }
    /**
     * Build an {@link AudioResult} from a completed Fal.ai result.
     *
     * @param result - The Fal.ai result response.
     * @param model - Model ID used for the generation.
     * @returns Normalized audio result envelope.
     *
     * @throws {Error} If the result has no audio URL.
     * @internal
     */
    _buildResult(result, model) {
        if (!result.audio?.url) {
            throw new Error('Fal.ai audio generation completed but returned no audio output.');
        }
        return {
            created: Math.floor(Date.now() / 1000),
            modelId: model,
            providerId: this.providerId,
            audio: [{
                    url: result.audio.url,
                    mimeType: result.audio.content_type ?? 'audio/mpeg',
                    durationSec: result.audio.duration,
                    providerMetadata: {
                        seed: result.seed,
                    },
                }],
            usage: {
                totalAudioClips: 1,
            },
        };
    }
}
//# sourceMappingURL=FalAudioProvider.js.map