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
import type { IVideoGenerator } from '../IVideoGenerator.js';
import type { VideoGenerateRequest, ImageToVideoRequest, VideoResult } from '../types.js';
/**
 * Configuration for the Runway video generation provider.
 *
 * @example
 * ```typescript
 * const config: RunwayVideoProviderConfig = {
 *   apiKey: process.env.RUNWAY_API_KEY!,
 *   defaultModelId: 'gen3a_turbo',
 * };
 * ```
 */
export interface RunwayVideoProviderConfig {
    /** Runway API key. Sent as `Authorization: Bearer ${apiKey}`. */
    apiKey: string;
    /**
     * Base URL for the Runway API. Override for testing or proxy setups.
     * @default 'https://api.dev.runwayml.com/v1'
     */
    baseURL?: string;
    /**
     * Default model to use when the request doesn't specify one.
     * @default 'gen3a_turbo'
     */
    defaultModelId?: string;
    /**
     * Milliseconds between task status polls.
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
export declare class RunwayVideoProvider implements IVideoGenerator {
    /** @inheritdoc */
    readonly providerId = "runway";
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
    generateVideo(request: VideoGenerateRequest): Promise<VideoResult>;
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
    imageToVideo(request: ImageToVideoRequest): Promise<VideoResult>;
    /**
     * Runway supports both text-to-video and image-to-video generation.
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
     * Submit a generation task to the Runway API.
     *
     * @param endpoint - API endpoint path ('text_to_video' or 'image_to_video').
     * @param body - Request body with model, prompt, and generation params.
     * @returns The task ID for status polling.
     *
     * @throws {Error} If the submission request fails.
     * @internal
     */
    private _submitTask;
    /**
     * Poll the Runway task status endpoint until the task reaches a terminal state.
     *
     * @param taskId - The task ID from submission.
     * @returns The completed task status object.
     *
     * @throws {Error} If the task fails or polling times out.
     * @internal
     */
    private _pollTask;
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
    private _buildResult;
}
//# sourceMappingURL=RunwayVideoProvider.d.ts.map