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
import { type IImageProvider, type ImageGenerationRequest, type ImageGenerationResult, type ImageModelInfo } from '../IImageProvider.js';
/**
 * Configuration for the BFL (Black Forest Labs) image provider.
 *
 * @example
 * ```typescript
 * const config: FluxImageProviderConfig = {
 *   apiKey: process.env.BFL_API_KEY!,
 *   defaultModelId: 'flux-pro-1.1',
 *   pollIntervalMs: 1500,
 * };
 * ```
 */
export interface FluxImageProviderConfig {
    /**
     * BFL API key. Sent as `X-Key` header on all requests.
     * Obtain from https://api.bfl.ml
     */
    apiKey: string;
    /**
     * Base URL for the BFL API. Override for testing or proxy setups.
     * @default 'https://api.bfl.ml'
     */
    baseURL?: string;
    /**
     * Default Flux model to use when the request doesn't specify one.
     * @default 'flux-pro-1.1'
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
 * Provider-specific options for BFL Flux image generation.
 *
 * These can be passed via `request.providerOptions.bfl` when calling
 * {@link FluxImageProvider.generateImage}.
 *
 * @example
 * ```typescript
 * const result = await provider.generateImage({
 *   modelId: 'flux-pro-1.1',
 *   prompt: 'A sunset over mountains',
 *   providerOptions: {
 *     bfl: { steps: 30, guidance: 3.5, seed: 42 },
 *   },
 * });
 * ```
 */
export interface FluxImageProviderOptions {
    /** Number of diffusion steps. Higher = better quality, slower. */
    steps?: number;
    /** Classifier-free guidance scale. Higher = more prompt adherence. */
    guidance?: number;
    /** Random seed for reproducible generation. */
    seed?: number;
}
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
export declare class FluxImageProvider implements IImageProvider {
    /** @inheritdoc */
    readonly providerId = "bfl";
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
     * await provider.initialize({ apiKey: 'bfl_xxx' });
     * ```
     */
    initialize(config: Record<string, unknown>): Promise<void>;
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
    generateImage(request: ImageGenerationRequest): Promise<ImageGenerationResult>;
    /**
     * List available Flux models on the BFL API.
     *
     * @returns Static list of known BFL model identifiers.
     */
    listAvailableModels(): Promise<ImageModelInfo[]>;
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
    private _submitTask;
    /**
     * Poll the BFL API for a generation result until it's ready or times out.
     *
     * @param taskId - The task ID returned from submission.
     * @returns The completed result response.
     *
     * @throws {Error} If the generation fails or times out.
     * @internal
     */
    private _pollResult;
}
//# sourceMappingURL=FluxImageProvider.d.ts.map