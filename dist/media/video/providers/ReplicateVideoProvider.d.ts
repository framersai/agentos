/**
 * @module media/video/providers/ReplicateVideoProvider
 *
 * Video generation provider for the Replicate API.
 *
 * Replicate hosts a wide range of open-source video models (Kling, CogVideo,
 * AnimateDiff, etc.) behind a uniform predictions API. This provider mirrors
 * the pattern established by {@link ReplicateImageProvider}: create a
 * prediction with `Prefer: wait`, then poll if it hasn't completed inline.
 *
 * ## Supported models
 *
 * | Model ID                         | Description                           |
 * |----------------------------------|---------------------------------------|
 * | `klingai/kling-v1`               | Kling v1 — high quality open model    |
 * | `tencent/hunyuan-video`          | HunyuanVideo — Tencent's video model  |
 * | `minimax/video-01`               | MiniMax Video-01                      |
 *
 * ## API flow (submit + sync wait + optional poll)
 *
 * 1. **Create prediction** — `POST ${baseURL}/predictions` with
 *    `Prefer: wait=60`. If the model finishes within 60 seconds the
 *    response already contains the output.
 * 2. **Poll** (if needed) — `GET prediction.urls.get` until `status` is
 *    `succeeded`, `failed`, or `canceled`.
 * 3. **Result** — `output` is the video URL (string or first array element).
 *
 * ## Authentication
 *
 * Requires a `REPLICATE_API_TOKEN`. Sent as `Authorization: Token ${apiKey}`.
 *
 * @see {@link IVideoGenerator} for the provider interface contract.
 * @see {@link ReplicateImageProvider} for the image counterpart.
 */
import type { IVideoGenerator } from '../IVideoGenerator.js';
import type { VideoGenerateRequest, ImageToVideoRequest, VideoResult } from '../types.js';
/**
 * Configuration for the Replicate video generation provider.
 *
 * @example
 * ```typescript
 * const config: ReplicateVideoProviderConfig = {
 *   apiKey: process.env.REPLICATE_API_TOKEN!,
 *   defaultModelId: 'klingai/kling-v1',
 * };
 * ```
 */
export interface ReplicateVideoProviderConfig {
    /** Replicate API token. Sent as `Authorization: Token ${apiKey}`. */
    apiKey: string;
    /**
     * Base URL for the Replicate API. Override for testing or proxy setups.
     * @default 'https://api.replicate.com/v1'
     */
    baseURL?: string;
    /**
     * Default model to use when the request doesn't specify one.
     * @default 'klingai/kling-v1'
     */
    defaultModelId?: string;
    /**
     * Milliseconds between prediction status polls.
     * @default 5000
     */
    pollIntervalMs?: number;
    /**
     * Maximum milliseconds to wait for generation before timing out.
     * @default 300000
     */
    timeoutMs?: number;
}
/**
 * Video generation provider connecting to the Replicate predictions API.
 *
 * Follows the same submit-then-poll pattern as {@link ReplicateImageProvider}:
 * create a prediction with `Prefer: wait=60`, then poll if the model takes
 * longer than the wait window.
 *
 * @implements {IVideoGenerator}
 *
 * @example
 * ```typescript
 * const provider = new ReplicateVideoProvider();
 * await provider.initialize({ apiKey: process.env.REPLICATE_API_TOKEN! });
 *
 * const result = await provider.generateVideo({
 *   modelId: 'klingai/kling-v1',
 *   prompt: 'A butterfly emerging from a cocoon in slow motion',
 * });
 * console.log(result.videos[0].url);
 * ```
 */
export declare class ReplicateVideoProvider implements IVideoGenerator {
    /** @inheritdoc */
    readonly providerId = "replicate";
    /** @inheritdoc */
    isInitialized: boolean;
    /** @inheritdoc */
    defaultModelId?: string;
    /** Internal resolved configuration. */
    private _config;
    private keyPool;
    /**
     * Initialize the provider with API credentials and optional configuration.
     *
     * @param config - Configuration object. Must include `apiKey`.
     * @throws {Error} If `apiKey` is missing or empty.
     */
    initialize(config: Record<string, unknown>): Promise<void>;
    /**
     * Generate a video from a text prompt using the Replicate predictions API.
     *
     * Creates a prediction, waits for synchronous completion (up to 60s), then
     * polls if still in progress. Returns the video URL in a result envelope.
     *
     * @param request - Video generation request with prompt and optional params.
     * @returns The generated video result envelope.
     *
     * @throws {Error} If the provider is not initialized.
     * @throws {Error} If the API returns an error or times out.
     */
    generateVideo(request: VideoGenerateRequest): Promise<VideoResult>;
    /**
     * Generate a video from a source image using the Replicate predictions API.
     *
     * The source image Buffer is converted to a base64 data URL and passed as
     * the `image` input parameter.
     *
     * @param request - Generation parameters including the source image buffer.
     * @returns The generated video result envelope.
     *
     * @throws {Error} If the provider is not initialized or the API fails.
     */
    imageToVideo(request: ImageToVideoRequest): Promise<VideoResult>;
    /**
     * Replicate supports both text-to-video and image-to-video generation.
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
     * Create a prediction and wait for it to complete.
     *
     * Uses `Prefer: wait=60` to get synchronous completion for fast models.
     * Falls back to polling if the prediction hasn't completed within the
     * wait window.
     *
     * @param model - Model identifier (e.g. 'klingai/kling-v1').
     * @param input - Model input parameters.
     * @returns The completed prediction object.
     *
     * @throws {Error} If prediction creation fails, the prediction fails,
     *   is canceled, or times out.
     * @internal
     */
    private _runPrediction;
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
    private _createPrediction;
    /**
     * Poll a prediction URL until it reaches a terminal state.
     *
     * @param url - The `prediction.urls.get` URL to poll.
     * @returns The completed prediction object.
     *
     * @throws {Error} If polling fails or times out.
     * @internal
     */
    private _pollPrediction;
    /**
     * Build a {@link VideoResult} from a completed Replicate prediction.
     *
     * @param prediction - The succeeded prediction object.
     * @param model - Model ID used for the generation.
     * @returns Normalized video result envelope.
     *
     * @throws {Error} If no video URL could be extracted from the output.
     * @internal
     */
    private _buildResult;
}
//# sourceMappingURL=ReplicateVideoProvider.d.ts.map