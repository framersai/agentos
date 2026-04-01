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
import type { IVideoGenerator } from '../IVideoGenerator.js';
import type { VideoGenerateRequest, ImageToVideoRequest, VideoResult } from '../types.js';
/**
 * Configuration for the Fal.ai video generation provider.
 *
 * @example
 * ```typescript
 * const config: FalVideoProviderConfig = {
 *   apiKey: process.env.FAL_API_KEY!,
 *   defaultModelId: 'kling-video/v1',
 * };
 * ```
 */
export interface FalVideoProviderConfig {
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
     * @default 'kling-video/v1'
     */
    defaultModelId?: string;
    /**
     * Milliseconds between status polls while waiting for generation.
     * @default 2000
     */
    pollIntervalMs?: number;
    /**
     * Maximum milliseconds to wait for generation before timing out.
     * @default 300000
     */
    timeoutMs?: number;
}
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
export declare class FalVideoProvider implements IVideoGenerator {
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
     */
    initialize(config: Record<string, unknown>): Promise<void>;
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
    generateVideo(request: VideoGenerateRequest): Promise<VideoResult>;
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
    imageToVideo(request: ImageToVideoRequest): Promise<VideoResult>;
    /**
     * Fal.ai supports both text-to-video and image-to-video generation.
     *
     * @param capability - The capability to check.
     * @returns `true` for both `'text-to-video'` and `'image-to-video'`.
     */
    supports(capability: 'text-to-video' | 'image-to-video'): boolean;
    /**
     * Release any resources held by the provider. No-op for HTTP-only providers.
     */
    shutdown(): Promise<void>;
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
    private _fetchResult;
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
    private _buildResult;
}
//# sourceMappingURL=FalVideoProvider.d.ts.map