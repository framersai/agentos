import type { VideoResult, VideoProgressEvent, VideoAspectRatio } from '../media/video/index.js';
import { type MediaProviderPreference } from '../media/ProviderPreferences.js';
import { type AgentOSUsageLedgerOptions } from './runtime/usageLedger.js';
/**
 * Options for a {@link generateVideo} call.
 *
 * At minimum, a `prompt` is required. The provider is resolved from
 * `opts.provider`, `opts.apiKey`, or the first video-capable env var
 * found (`RUNWAY_API_KEY` -> `REPLICATE_API_TOKEN` -> `FAL_API_KEY`).
 */
export interface GenerateVideoOptions {
    /** Text prompt describing the desired video content. */
    prompt: string;
    /**
     * Source image for image-to-video generation. When provided, the
     * request is dispatched to `imageToVideo()` instead of `generateVideo()`.
     * Accepts a raw `Buffer`.
     */
    image?: Buffer;
    /**
     * Explicit provider identifier (e.g. `"runway"`, `"replicate"`, `"fal"`).
     * When omitted, auto-detection from environment variables is used.
     */
    provider?: string;
    /**
     * Model identifier within the provider (e.g. `"gen3a_turbo"`,
     * `"klingai/kling-v1"`). When omitted, the provider's default model
     * is used.
     */
    model?: string;
    /** Desired output duration in seconds. */
    durationSec?: number;
    /** Desired aspect ratio (e.g. `"16:9"`, `"9:16"`). */
    aspectRatio?: VideoAspectRatio;
    /** Desired output resolution (e.g. `"1280x720"`, `"720p"`). */
    resolution?: string;
    /** Negative prompt describing content to avoid. */
    negativePrompt?: string;
    /** Random seed for reproducible generation (provider-dependent). */
    seed?: number;
    /**
     * Maximum time in milliseconds to wait for generation to complete.
     * Provider-dependent — not all providers honour client-side timeouts.
     */
    timeoutMs?: number;
    /**
     * Optional progress callback invoked during long-running generation.
     * Called with a {@link VideoProgressEvent} at each status transition.
     */
    onProgress?: (event: VideoProgressEvent) => void;
    /** Override the provider API key instead of reading from env vars. */
    apiKey?: string;
    /** Override the provider base URL. */
    baseUrl?: string;
    /**
     * Provider preferences for reordering or filtering the fallback chain.
     * When supplied, the available video providers are reordered according to
     * `preferred` and filtered by `blocked` before building the chain.
     */
    providerPreferences?: MediaProviderPreference;
    /** Optional durable usage ledger configuration for accounting. */
    usageLedger?: AgentOSUsageLedgerOptions;
}
/**
 * The result returned by {@link generateVideo}.
 *
 * Wraps the core {@link VideoResult} with a simpler, AI-SDK-style shape.
 */
export interface GenerateVideoResult {
    /** Model identifier reported by the provider. */
    model: string;
    /** Provider identifier (e.g. `"runway"`, `"replicate"`, `"fal"`). */
    provider: string;
    /** Unix timestamp (ms) when the video was created. */
    created: number;
    /** Array of generated video objects containing URLs or base64 data. */
    videos: VideoResult['videos'];
    /** Usage / billing information, if available. */
    usage?: VideoResult['usage'];
}
/**
 * Generates a video using a provider-agnostic interface.
 *
 * Resolves provider credentials via explicit options or environment variable
 * auto-detection, initialises the matching video provider (optionally wrapped
 * in a fallback chain), and returns a normalised {@link GenerateVideoResult}.
 *
 * When `opts.image` is provided, the request is routed to
 * {@link IVideoGenerator.imageToVideo} for image-to-video generation.
 * Otherwise, {@link IVideoGenerator.generateVideo} is used for text-to-video.
 *
 * @param opts - Video generation options.
 * @returns A promise resolving to the generation result with video data and metadata.
 *
 * @example
 * ```ts
 * // Text-to-video
 * const result = await generateVideo({
 *   prompt: 'A drone flying over a misty forest at sunrise',
 *   provider: 'runway',
 *   durationSec: 5,
 * });
 * console.log(result.videos[0].url);
 *
 * // Image-to-video
 * const i2v = await generateVideo({
 *   prompt: 'Camera slowly zooms out',
 *   image: fs.readFileSync('input.png'),
 * });
 * ```
 */
export declare function generateVideo(opts: GenerateVideoOptions): Promise<GenerateVideoResult>;
//# sourceMappingURL=generateVideo.d.ts.map