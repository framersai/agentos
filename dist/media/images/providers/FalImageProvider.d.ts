/**
 * @module media/images/providers/FalImageProvider
 *
 * Image generation provider for the Fal.ai platform, a popular serverless
 * GPU host that offers fast inference for Flux and other diffusion models.
 *
 * ## Supported models
 *
 * | Model ID                    | Description                                  |
 * |-----------------------------|----------------------------------------------|
 * | `fal-ai/flux/dev`           | Flux Dev — fast iteration, open weights      |
 * | `fal-ai/flux-pro`           | Flux Pro — highest quality                   |
 * | `fal-ai/flux/schnell`       | Flux Schnell — optimised for speed           |
 *
 * ## API flow (queue-based)
 *
 * 1. **Submit** — `POST https://queue.fal.run/{model}` with prompt/params.
 *    Returns `{ request_id }` immediately.
 * 2. **Poll** — `GET https://queue.fal.run/{model}/requests/{request_id}/status`
 *    until `status === 'COMPLETED'` and `images` array is populated.
 *
 * ## Authentication
 *
 * Requires a `FAL_API_KEY` environment variable. The key is sent as
 * `Authorization: Key ${FAL_API_KEY}`.
 *
 * @see {@link IImageProvider} for the provider interface contract.
 * @see {@link FluxImageProvider} for direct BFL API access.
 * @see {@link ReplicateImageProvider} for Flux via Replicate.
 */
import { type IImageProvider, type ImageGenerationRequest, type ImageGenerationResult, type ImageModelInfo } from '../IImageProvider.js';
/**
 * Configuration for the Fal.ai image provider.
 *
 * @example
 * ```typescript
 * const config: FalImageProviderConfig = {
 *   apiKey: process.env.FAL_API_KEY!,
 *   defaultModelId: 'fal-ai/flux/dev',
 * };
 * ```
 */
export interface FalImageProviderConfig {
    /**
     * Fal.ai API key. Sent as `Authorization: Key ${apiKey}`.
     * Obtain from https://fal.ai/dashboard/keys
     */
    apiKey: string;
    /**
     * Base URL for the Fal.ai queue API. Override for testing or proxy setups.
     * @default 'https://queue.fal.run'
     */
    baseURL?: string;
    /**
     * Default model to use when the request doesn't specify one.
     * @default 'fal-ai/flux/dev'
     */
    defaultModelId?: string;
    /**
     * Milliseconds between status polls while waiting for generation.
     * @default 1000
     */
    pollIntervalMs?: number;
    /**
     * Maximum milliseconds to wait for generation before timing out.
     * @default 120000
     */
    timeoutMs?: number;
}
/**
 * Provider-specific options for Fal.ai image generation.
 *
 * Pass via `request.providerOptions.fal` when calling
 * {@link FalImageProvider.generateImage}.
 *
 * @example
 * ```typescript
 * const result = await provider.generateImage({
 *   modelId: 'fal-ai/flux/dev',
 *   prompt: 'A sunset over mountains',
 *   providerOptions: {
 *     fal: { num_images: 2, seed: 42 },
 *   },
 * });
 * ```
 */
export interface FalImageProviderOptions {
    /** Number of images to generate. Default: 1. */
    num_images?: number;
    /** Image size string (e.g. 'landscape_16_9', 'square_hd', 'portrait_4_3'). */
    image_size?: string;
    /** Random seed for reproducible generation. */
    seed?: number;
    /** Number of inference steps. */
    num_inference_steps?: number;
    /** Guidance scale for classifier-free guidance. */
    guidance_scale?: number;
    /** Whether to enable the safety checker. Default: true. */
    enable_safety_checker?: boolean;
}
/**
 * Image generation provider connecting to the Fal.ai serverless platform.
 *
 * Implements the queue-based submit-then-poll pattern: a generation request
 * returns a request ID immediately, and the provider polls the status
 * endpoint until completion or timeout.
 *
 * @implements {IImageProvider}
 *
 * @example
 * ```typescript
 * const provider = new FalImageProvider();
 * await provider.initialize({ apiKey: process.env.FAL_API_KEY! });
 *
 * const result = await provider.generateImage({
 *   modelId: 'fal-ai/flux/dev',
 *   prompt: 'A photorealistic astronaut riding a horse on Mars',
 * });
 * console.log(result.images[0].url);
 * ```
 */
export declare class FalImageProvider implements IImageProvider {
    /** @inheritdoc */
    readonly providerId = "fal";
    /** @inheritdoc */
    isInitialized: boolean;
    /** @inheritdoc */
    defaultModelId?: string;
    /** Internal resolved configuration. */
    private _config;
    /**
     * Initialize the provider with API credentials and optional configuration.
     *
     * @param config - Configuration object. Must include `apiKey`.
     * @throws {Error} If `apiKey` is missing or empty.
     *
     * @example
     * ```typescript
     * await provider.initialize({ apiKey: 'fal_xxx' });
     * ```
     */
    initialize(config: Record<string, unknown>): Promise<void>;
    /**
     * Generate an image using the Fal.ai queue API.
     *
     * Submits the generation task to the queue, then polls the status
     * endpoint until the result is ready or the timeout is reached.
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
     *   modelId: 'fal-ai/flux/dev',
     *   prompt: 'A serene Japanese garden in autumn',
     *   n: 2,
     * });
     * ```
     */
    generateImage(request: ImageGenerationRequest): Promise<ImageGenerationResult>;
    /**
     * List available Flux models on the Fal.ai platform.
     *
     * @returns Static list of known Fal.ai model identifiers.
     */
    listAvailableModels(): Promise<ImageModelInfo[]>;
    /**
     * Submit a generation task to the Fal.ai queue.
     *
     * @param model - Full model path (e.g. 'fal-ai/flux/dev').
     * @param body - Request body with prompt and generation params.
     * @returns The request_id for status polling.
     *
     * @throws {Error} If the submission request fails.
     * @internal
     */
    private _submitTask;
    /**
     * Poll the Fal.ai status endpoint until the task completes or times out.
     *
     * @param model - Full model path.
     * @param requestId - The request ID from submission.
     *
     * @throws {Error} If the generation fails or times out.
     * @internal
     */
    private _pollStatus;
    /**
     * Fetch the completed generation result from the Fal.ai result endpoint.
     *
     * Called after polling confirms the task is COMPLETED. The result
     * endpoint is separate from the status endpoint because Fal.ai
     * returns the full payload (including image URLs) only here.
     *
     * @param model - Full model path.
     * @param requestId - The request ID from submission.
     * @returns The generation result with image URLs.
     *
     * @throws {Error} If the result fetch fails.
     * @internal
     */
    private _fetchResult;
}
//# sourceMappingURL=FalImageProvider.d.ts.map