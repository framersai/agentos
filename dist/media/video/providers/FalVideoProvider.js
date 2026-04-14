/**
 * @module media/video/providers/FalVideoProvider
 *
 * Video generation provider for the Fal.ai serverless GPU platform.
 *
 * Fal.ai hosts video generation models (Kling, HunyuanVideo, CogVideo, etc.)
 * behind a queue-based API. This provider implements the three-step pattern
 * established by {@link FalImageProvider}: submit to queue, poll for status,
 * then fetch the completed result.
 *
 * ## Supported models
 *
 * | Model ID                         | Description                       |
 * |----------------------------------|-----------------------------------|
 * | `kling-video/v1`                 | Kling v1 — high quality video     |
 * | `fal-ai/hunyuan-video`           | HunyuanVideo — Tencent's model    |
 * | `fal-ai/cogvideox-5b`            | CogVideoX-5B — open model        |
 *
 * ## API flow (three-step queue)
 *
 * 1. **Submit** — `POST ${baseURL}/${model}` with prompt/params.
 *    Returns `{ request_id }` immediately.
 * 2. **Poll** — `GET ${baseURL}/${model}/requests/${request_id}/status`
 *    until `status === 'COMPLETED'` or `'FAILED'`.
 * 3. **Fetch** — `GET ${baseURL}/${model}/requests/${request_id}`
 *    returns `{ video: { url } }`.
 *
 * ## Authentication
 *
 * Requires a `FAL_API_KEY`. Sent as `Authorization: Key ${apiKey}`.
 *
 * @see {@link IVideoGenerator} for the provider interface contract.
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
 * Video generation provider connecting to the Fal.ai serverless platform.
 *
 * Implements the three-step queue pattern: submit a generation task,
 * poll the status endpoint until completion, then fetch the result.
 * This mirrors the flow used by {@link FalImageProvider}.
 *
 * @implements {IVideoGenerator}
 *
 * @example
 * ```typescript
 * const provider = new FalVideoProvider();
 * await provider.initialize({ apiKey: process.env.FAL_API_KEY! });
 *
 * const result = await provider.generateVideo({
 *   modelId: 'kling-video/v1',
 *   prompt: 'A time-lapse of flowers blooming in a meadow',
 * });
 * console.log(result.videos[0].url);
 * ```
 */
export class FalVideoProvider {
    constructor() {
        /** @inheritdoc */
        this.providerId = 'fal';
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
            throw new Error('Fal.ai video provider requires apiKey (FAL_API_KEY).');
        }
        this._config = {
            apiKey,
            baseURL: typeof config.baseURL === 'string' && config.baseURL.trim()
                ? config.baseURL.trim()
                : 'https://queue.fal.run',
            defaultModelId: typeof config.defaultModelId === 'string' && config.defaultModelId.trim()
                ? config.defaultModelId.trim()
                : 'kling-video/v1',
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
     * Generate a video from a text prompt using the Fal.ai queue API.
     *
     * Submits the task, polls until complete, then fetches the result.
     *
     * @param request - Video generation request with prompt and optional params.
     * @returns The generated video result envelope.
     *
     * @throws {Error} If the provider is not initialized.
     * @throws {Error} If the API returns an error or times out.
     */
    async generateVideo(request) {
        if (!this.isInitialized) {
            throw new Error('Fal.ai video provider is not initialized. Call initialize() first.');
        }
        const model = request.modelId || this.defaultModelId || 'kling-video/v1';
        const body = {
            prompt: request.prompt,
        };
        if (request.durationSec !== undefined)
            body.duration = request.durationSec;
        if (request.aspectRatio)
            body.aspect_ratio = request.aspectRatio;
        if (request.seed !== undefined)
            body.seed = request.seed;
        // Three-step flow: submit → poll → fetch
        const requestId = await this._submitTask(model, body);
        await this._pollStatus(model, requestId);
        const result = await this._fetchResult(model, requestId);
        return this._buildResult(result, model);
    }
    /**
     * Generate a video from a source image using the Fal.ai queue API.
     *
     * The source image Buffer is converted to a base64 data URL and passed
     * as the `image_url` parameter.
     *
     * @param request - Generation parameters including the source image buffer.
     * @returns The generated video result envelope.
     *
     * @throws {Error} If the provider is not initialized or the API fails.
     */
    async imageToVideo(request) {
        if (!this.isInitialized) {
            throw new Error('Fal.ai video provider is not initialized. Call initialize() first.');
        }
        const model = request.modelId || this.defaultModelId || 'kling-video/v1';
        // Convert the image buffer to a base64 data URL for the Fal.ai API.
        const imageBase64 = `data:image/png;base64,${request.image.toString('base64')}`;
        const body = {
            prompt: request.prompt,
            image_url: imageBase64,
        };
        if (request.durationSec !== undefined)
            body.duration = request.durationSec;
        if (request.aspectRatio)
            body.aspect_ratio = request.aspectRatio;
        if (request.seed !== undefined)
            body.seed = request.seed;
        // Three-step flow: submit → poll → fetch
        const requestId = await this._submitTask(model, body);
        await this._pollStatus(model, requestId);
        const result = await this._fetchResult(model, requestId);
        return this._buildResult(result, model);
    }
    // -------------------------------------------------------------------------
    // Capability query
    // -------------------------------------------------------------------------
    /**
     * Fal.ai supports both text-to-video and image-to-video generation.
     *
     * @param capability - The capability to check.
     * @returns `true` for both `'text-to-video'` and `'image-to-video'`.
     */
    supports(capability) {
        return capability === 'text-to-video' || capability === 'image-to-video';
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
     * Submit a generation task to the Fal.ai queue.
     *
     * @param model - Full model path (e.g. 'kling-video/v1').
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
            throw new Error(`Fal.ai video generation submission failed (${response.status}): ${errorText}`);
        }
        const data = (await response.json());
        if (!data.request_id) {
            throw new Error('Fal.ai submission response missing request_id.');
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
                throw new Error(`Fal.ai status polling failed (${response.status}): ${errorText}`);
            }
            const data = (await response.json());
            if (data.status === 'COMPLETED') {
                return;
            }
            if (data.status === 'FAILED') {
                throw new Error(`Fal.ai video generation failed for request ${requestId}.`);
            }
            // 'IN_QUEUE' or 'IN_PROGRESS' — wait before next poll
            await sleep(this._config.pollIntervalMs);
        }
        throw new Error(`Fal.ai video generation timed out after ${this._config.timeoutMs}ms for request ${requestId}.`);
    }
    /**
     * Fetch the completed generation result from the Fal.ai result endpoint.
     *
     * Called after polling confirms the task is COMPLETED. The result endpoint
     * is separate from the status endpoint because Fal.ai returns the full
     * payload (including video URLs) only here.
     *
     * @param model - Full model path.
     * @param requestId - The request ID from submission.
     * @returns The generation result with video URL.
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
            throw new Error(`Fal.ai result fetch failed (${response.status}): ${errorText}`);
        }
        return (await response.json());
    }
    /**
     * Build a {@link VideoResult} from a completed Fal.ai result.
     *
     * @param result - The Fal.ai result response.
     * @param model - Model ID used for the generation.
     * @returns Normalized video result envelope.
     *
     * @throws {Error} If the result has no video URL.
     * @internal
     */
    _buildResult(result, model) {
        if (!result.video?.url) {
            throw new Error('Fal.ai generation completed but returned no video output.');
        }
        return {
            created: Math.floor(Date.now() / 1000),
            modelId: model,
            providerId: this.providerId,
            videos: [{
                    url: result.video.url,
                    mimeType: result.video.content_type ?? 'video/mp4',
                    durationSec: result.video.duration,
                    providerMetadata: {
                        seed: result.seed,
                    },
                }],
            usage: {
                totalVideos: 1,
            },
        };
    }
}
//# sourceMappingURL=FalVideoProvider.js.map