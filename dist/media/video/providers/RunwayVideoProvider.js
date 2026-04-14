/**
 * @module media/video/providers/RunwayVideoProvider
 *
 * Video generation provider for the Runway Gen-3 Alpha API.
 *
 * Runway offers high-quality AI video generation with both text-to-video
 * and image-to-video capabilities. This provider implements the submit-then-
 * poll pattern: a generation task is created via POST, then polled via GET
 * until the task reaches a terminal state.
 *
 * ## Supported models
 *
 * | Model ID       | Description                            |
 * |----------------|----------------------------------------|
 * | `gen3a_turbo`  | Gen-3 Alpha Turbo — fast, lower cost   |
 * | `gen3a`        | Gen-3 Alpha — highest quality          |
 *
 * ## API flow
 *
 * 1. **Submit** — `POST ${baseURL}/text_to_video` or `/image_to_video`.
 *    Returns a task object with `{ id }`.
 * 2. **Poll** — `GET ${baseURL}/tasks/${id}` until `status` is
 *    `SUCCEEDED` or `FAILED`.
 * 3. **Result** — `output[0]` on the SUCCEEDED task is the video URL.
 *
 * ## Authentication
 *
 * Requires a `RUNWAY_API_KEY`. Sent as `Authorization: Bearer ${apiKey}`.
 *
 * @see {@link IVideoGenerator} for the provider interface contract.
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
 * Video generation provider connecting to the Runway Gen-3 Alpha API.
 *
 * Implements the submit-then-poll pattern: a generation request returns
 * a task ID immediately, and the provider polls the status endpoint
 * until completion or timeout.
 *
 * @implements {IVideoGenerator}
 *
 * @example
 * ```typescript
 * const provider = new RunwayVideoProvider();
 * await provider.initialize({ apiKey: process.env.RUNWAY_API_KEY! });
 *
 * const result = await provider.generateVideo({
 *   modelId: 'gen3a_turbo',
 *   prompt: 'A cinematic drone shot over a misty forest at dawn',
 *   durationSec: 5,
 *   aspectRatio: '16:9',
 * });
 * console.log(result.videos[0].url);
 * ```
 */
export class RunwayVideoProvider {
    constructor() {
        /** @inheritdoc */
        this.providerId = 'runway';
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
            throw new Error('Runway video provider requires apiKey (RUNWAY_API_KEY).');
        }
        this._config = {
            apiKey,
            baseURL: typeof config.baseURL === 'string' && config.baseURL.trim()
                ? config.baseURL.trim()
                : 'https://api.dev.runwayml.com/v1',
            defaultModelId: typeof config.defaultModelId === 'string' && config.defaultModelId.trim()
                ? config.defaultModelId.trim()
                : 'gen3a_turbo',
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
     * Generate a video from a text prompt using the Runway text_to_video endpoint.
     *
     * Submits the task, polls until completion, and returns the video result.
     *
     * @param request - Video generation request with prompt and optional params.
     * @returns The generated video result envelope.
     *
     * @throws {Error} If the provider is not initialized.
     * @throws {Error} If the API returns an error or times out.
     */
    async generateVideo(request) {
        if (!this.isInitialized) {
            throw new Error('Runway video provider is not initialized. Call initialize() first.');
        }
        const model = request.modelId || this.defaultModelId || 'gen3a_turbo';
        const body = {
            model,
            prompt: request.prompt,
        };
        if (request.durationSec !== undefined)
            body.duration = request.durationSec;
        if (request.aspectRatio)
            body.ratio = request.aspectRatio;
        // Step 1: Submit
        const taskId = await this._submitTask('text_to_video', body);
        // Step 2: Poll until done
        const task = await this._pollTask(taskId);
        // Step 3: Extract result
        return this._buildResult(task, model);
    }
    /**
     * Generate a video from a source image using the Runway image_to_video endpoint.
     *
     * The source image Buffer is converted to a base64 data URL for the API.
     *
     * @param request - Generation parameters including the source image buffer.
     * @returns The generated video result envelope.
     *
     * @throws {Error} If the provider is not initialized or the API fails.
     */
    async imageToVideo(request) {
        if (!this.isInitialized) {
            throw new Error('Runway video provider is not initialized. Call initialize() first.');
        }
        const model = request.modelId || this.defaultModelId || 'gen3a_turbo';
        // Convert the image buffer to a base64 data URL for the Runway API.
        const imageBase64 = `data:image/png;base64,${request.image.toString('base64')}`;
        const body = {
            model,
            prompt_image: imageBase64,
        };
        if (request.prompt)
            body.prompt = request.prompt;
        if (request.durationSec !== undefined)
            body.duration = request.durationSec;
        if (request.aspectRatio)
            body.ratio = request.aspectRatio;
        // Step 1: Submit
        const taskId = await this._submitTask('image_to_video', body);
        // Step 2: Poll until done
        const task = await this._pollTask(taskId);
        // Step 3: Extract result
        return this._buildResult(task, model);
    }
    // -------------------------------------------------------------------------
    // Capability query
    // -------------------------------------------------------------------------
    /**
     * Runway supports both text-to-video and image-to-video generation.
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
     * Submit a generation task to the Runway API.
     *
     * @param endpoint - API endpoint path ('text_to_video' or 'image_to_video').
     * @param body - Request body with model, prompt, and generation params.
     * @returns The task ID for status polling.
     *
     * @throws {Error} If the submission request fails.
     * @internal
     */
    async _submitTask(endpoint, body) {
        const url = `${this._config.baseURL}/${endpoint}`;
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
            throw new Error(`Runway video generation submission failed (${response.status}): ${errorText}`);
        }
        const data = (await response.json());
        if (!data.id) {
            throw new Error('Runway submission response missing task id.');
        }
        return data.id;
    }
    /**
     * Poll the Runway task status endpoint until the task reaches a terminal state.
     *
     * @param taskId - The task ID from submission.
     * @returns The completed task status object.
     *
     * @throws {Error} If the task fails or polling times out.
     * @internal
     */
    async _pollTask(taskId) {
        const startedAt = Date.now();
        while (Date.now() - startedAt < this._config.timeoutMs) {
            const url = `${this._config.baseURL}/tasks/${taskId}`;
            const response = await fetch(url, {
                headers: {
                    Authorization: `Bearer ${this.keyPool.next()}`,
                },
            });
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Runway task polling failed (${response.status}): ${errorText}`);
            }
            const task = (await response.json());
            if (task.status === 'SUCCEEDED') {
                return task;
            }
            if (task.status === 'FAILED') {
                const reason = task.failure || task.failureCode || 'unknown error';
                throw new Error(`Runway video generation failed: ${reason}`);
            }
            await sleep(this._config.pollIntervalMs);
        }
        throw new Error(`Runway video generation timed out after ${this._config.timeoutMs}ms for task ${taskId}.`);
    }
    /**
     * Build a {@link VideoResult} from a completed Runway task.
     *
     * @param task - The SUCCEEDED task status object.
     * @param model - Model ID used for the generation.
     * @returns Normalized video result envelope.
     *
     * @throws {Error} If the task has no output URLs.
     * @internal
     */
    _buildResult(task, model) {
        if (!task.output || task.output.length === 0) {
            throw new Error('Runway task succeeded but returned no video output.');
        }
        return {
            created: Math.floor(Date.now() / 1000),
            modelId: model,
            providerId: this.providerId,
            videos: task.output.map((url) => ({
                url,
                mimeType: 'video/mp4',
                providerMetadata: {
                    taskId: task.id,
                },
            })),
            usage: {
                totalVideos: task.output.length,
            },
        };
    }
}
//# sourceMappingURL=RunwayVideoProvider.js.map