/**
 * @module media/images/providers/FluxImageProvider
 *
 * Direct image generation provider for the Black Forest Labs (BFL) API.
 *
 * While the Replicate provider already supports Flux models via the
 * Replicate proxy, this provider connects directly to Black Forest Labs'
 * own API at `api.bfl.ml`. This can offer lower latency and access to the
 * latest model versions before they appear on third-party platforms.
 *
 * ## Supported models
 *
 * | Model ID              | Description                             |
 * |-----------------------|-----------------------------------------|
 * | `flux-pro-1.1`       | Highest quality, commercial use         |
 * | `flux-pro-1.1-ultra`  | Ultra-high resolution variant           |
 * | `flux-dev`            | Fast iteration, research-friendly       |
 *
 * ## API flow (async generation)
 *
 * 1. **Submit** — `POST https://api.bfl.ml/v1/{model}` with prompt/params.
 *    Returns `{ id }` immediately.
 * 2. **Poll** — `GET https://api.bfl.ml/v1/get_result?id={id}` until
 *    `status === 'Ready'` and `result.sample` contains the image URL.
 *
 * This submit-then-poll pattern is similar to AssemblyAI and Replicate.
 * The default poll interval is 1 second with a 120-second timeout.
 *
 * ## Authentication
 *
 * Requires a `BFL_API_KEY` environment variable. The key is sent in the
 * `X-Key` request header.
 *
 * @see {@link IImageProvider} for the provider interface contract.
 * @see {@link ReplicateImageProvider} for Flux via Replicate proxy.
 * @see {@link FalImageProvider} for Flux via Fal.ai.
 */
import { parseImageSize, } from '../IImageProvider.js';
import { ApiKeyPool } from '../../../core/providers/ApiKeyPool.js';
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
/**
 * Sleep for the specified number of milliseconds.
 * Used between poll requests to avoid hammering the API.
 * @param ms - Duration in milliseconds.
 * @returns Resolves after the delay.
 * @internal
 */
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------
/**
 * Image generation provider connecting directly to the Black Forest Labs
 * (BFL) API for Flux model access.
 *
 * Implements the async submit-then-poll pattern: a generation request
 * returns a task ID immediately, and the provider polls until the image
 * is ready or a timeout is reached.
 *
 * @implements {IImageProvider}
 *
 * @example
 * ```typescript
 * const provider = new FluxImageProvider();
 * await provider.initialize({ apiKey: process.env.BFL_API_KEY! });
 *
 * const result = await provider.generateImage({
 *   modelId: 'flux-pro-1.1',
 *   prompt: 'A photorealistic astronaut riding a horse on Mars',
 *   size: '1024x1024',
 * });
 * console.log(result.images[0].url);
 * ```
 */
export class FluxImageProvider {
    constructor() {
        /** @inheritdoc */
        this.providerId = 'bfl';
        /** @inheritdoc */
        this.isInitialized = false;
    }
    /**
     * Initialize the provider with API credentials and optional configuration.
     *
     * @param config - Configuration object. Must include `apiKey`.
     * @throws {Error} If `apiKey` is missing or empty.
     *
     * @example
     * ```typescript
     * await provider.initialize({ apiKey: 'bfl_xxx' });
     * ```
     */
    async initialize(config) {
        const apiKey = typeof config.apiKey === 'string' ? config.apiKey.trim() : '';
        if (!apiKey) {
            throw new Error('BFL image provider requires apiKey (BFL_API_KEY).');
        }
        this._config = {
            apiKey,
            baseURL: typeof config.baseURL === 'string' && config.baseURL.trim()
                ? config.baseURL.trim()
                : 'https://api.bfl.ml',
            defaultModelId: typeof config.defaultModelId === 'string' && config.defaultModelId.trim()
                ? config.defaultModelId.trim()
                : 'flux-pro-1.1',
            pollIntervalMs: typeof config.pollIntervalMs === 'number' && config.pollIntervalMs > 0
                ? config.pollIntervalMs
                : 1000,
            timeoutMs: typeof config.timeoutMs === 'number' && config.timeoutMs > 0
                ? config.timeoutMs
                : 120000,
        };
        this.defaultModelId = this._config.defaultModelId;
        this.keyPool = new ApiKeyPool(apiKey);
        this.isInitialized = true;
    }
    /**
     * Generate an image using the BFL Flux API.
     *
     * Submits the generation task, then polls until the result is ready
     * or the timeout is reached.
     *
     * @param request - Image generation request with prompt and optional params.
     * @returns The generated image result with URL(s).
     *
     * @throws {Error} If the provider is not initialized.
     * @throws {Error} If the API returns an error or times out.
     *
     * @example
     * ```typescript
     * const result = await provider.generateImage({
     *   modelId: 'flux-pro-1.1',
     *   prompt: 'A serene Japanese garden in autumn',
     *   size: '1024x768',
     * });
     * ```
     */
    async generateImage(request) {
        if (!this.isInitialized) {
            throw new Error('BFL image provider is not initialized. Call initialize() first.');
        }
        if (request.referenceImageUrl) {
            console.debug('[bfl] referenceImageUrl is not natively supported — ' +
                'field ignored. Use Replicate (Pulid), Fal, or SD-Local for character consistency.');
        }
        const model = request.modelId || this.defaultModelId || 'flux-pro-1.1';
        const { width, height } = parseImageSize(request.size);
        // Extract BFL-specific options from the provider options bag.
        const providerOpts = request.providerOptions?.bfl;
        // Build the request body matching BFL's API schema.
        const body = {
            prompt: request.prompt,
        };
        // Only include dimensions if explicitly provided — BFL has sensible defaults.
        if (width)
            body.width = width;
        if (height)
            body.height = height;
        if (request.seed !== undefined)
            body.seed = request.seed;
        if (providerOpts?.seed !== undefined)
            body.seed = providerOpts.seed;
        if (providerOpts?.steps !== undefined)
            body.steps = providerOpts.steps;
        if (providerOpts?.guidance !== undefined)
            body.guidance = providerOpts.guidance;
        // Step 1: Submit the generation task
        const taskId = await this._submitTask(model, body);
        // Step 2: Poll until ready
        const result = await this._pollResult(taskId);
        if (!result.result?.sample) {
            throw new Error('BFL generation completed but returned no image URL.');
        }
        const images = [{
                url: result.result.sample,
                providerMetadata: {
                    taskId,
                    seed: result.result.seed,
                },
            }];
        return {
            created: Math.floor(Date.now() / 1000),
            modelId: model,
            providerId: this.providerId,
            images,
            usage: {
                totalImages: images.length,
            },
        };
    }
    /**
     * List available Flux models on the BFL API.
     *
     * @returns Static list of known BFL model identifiers.
     */
    async listAvailableModels() {
        return [
            { providerId: this.providerId, modelId: 'flux-pro-1.1', displayName: 'Flux Pro 1.1' },
            { providerId: this.providerId, modelId: 'flux-pro-1.1-ultra', displayName: 'Flux Pro 1.1 Ultra' },
            { providerId: this.providerId, modelId: 'flux-dev', displayName: 'Flux Dev' },
        ];
    }
    // -------------------------------------------------------------------------
    // Private helpers
    // -------------------------------------------------------------------------
    /**
     * Submit a generation task to the BFL API.
     *
     * @param model - The model identifier (path segment in the URL).
     * @param body - The request body with prompt and generation parameters.
     * @returns The task ID for polling.
     *
     * @throws {Error} If the submission request fails.
     * @internal
     */
    async _submitTask(model, body) {
        const url = `${this._config.baseURL}/v1/${model}`;
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'X-Key': this.keyPool.next(),
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        });
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`BFL image generation submission failed (${response.status}): ${errorText}`);
        }
        const data = (await response.json());
        if (!data.id) {
            throw new Error('BFL submission response missing task ID.');
        }
        return data.id;
    }
    /**
     * Poll the BFL API for a generation result until it's ready or times out.
     *
     * @param taskId - The task ID returned from submission.
     * @returns The completed result response.
     *
     * @throws {Error} If the generation fails or times out.
     * @internal
     */
    async _pollResult(taskId) {
        const startedAt = Date.now();
        while (Date.now() - startedAt < this._config.timeoutMs) {
            const url = `${this._config.baseURL}/v1/get_result?id=${encodeURIComponent(taskId)}`;
            const response = await fetch(url, {
                headers: {
                    'X-Key': this.keyPool.next(),
                },
            });
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`BFL result polling failed (${response.status}): ${errorText}`);
            }
            const data = (await response.json());
            // 'Ready' means the image is generated and available
            if (data.status === 'Ready') {
                return data;
            }
            // Error status means generation failed permanently
            if (data.status === 'Error') {
                throw new Error(`BFL image generation failed for task ${taskId}.`);
            }
            // Still pending — wait before next poll to avoid rate-limiting
            await sleep(this._config.pollIntervalMs);
        }
        throw new Error(`BFL image generation timed out after ${this._config.timeoutMs}ms for task ${taskId}.`);
    }
}
//# sourceMappingURL=FluxImageProvider.js.map