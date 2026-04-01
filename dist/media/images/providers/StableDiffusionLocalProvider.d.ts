/**
 * @file StableDiffusionLocalProvider.ts
 * Local Stable Diffusion image provider for AgentOS.
 *
 * Supports two common local SD backends via auto-detection:
 *
 * - **Automatic1111 / Forge WebUI** -- `POST /sdapi/v1/txt2img` (most common).
 *   Detected by probing `GET /sdapi/v1/sd-models`.
 * - **ComfyUI** -- `POST /prompt` (workflow-based alternative).
 *   Detected by probing `GET /system_stats`.
 *
 * When neither probe succeeds the provider falls back to A1111 API format,
 * which works with most WebUI forks.
 *
 * Usage cost is always reported as `0` because generation is local.
 */
import { type IImageProvider, type ImageGenerationRequest, type ImageGenerationResult, type ImageEditRequest, type ImageUpscaleRequest, type ImageModelInfo } from '../IImageProvider.js';
/**
 * Provider-specific options passed through
 * `request.providerOptions['stable-diffusion-local']`.
 */
export interface StableDiffusionLocalOptions {
    /** Number of inference steps (default 25). */
    steps?: number;
    /** Classifier-free guidance scale (default 7.5). */
    cfgScale?: number;
    /** Random seed (-1 for random). */
    seed?: number;
    /** Sampler name (e.g. `'Euler a'`, `'DPM++ 2M Karras'`). */
    sampler?: string;
    /** Negative prompt. */
    negativePrompt?: string;
    /** Image width in pixels (default 512). */
    width?: number;
    /** Image height in pixels (default 512). */
    height?: number;
    /** Number of images to generate (default 1). */
    batchSize?: number;
    /** ControlNet settings forwarded verbatim to the backend. */
    controlnet?: Record<string, unknown>;
    /** LoRA models to apply.  Injected into the prompt as `<lora:name:weight>`. */
    loras?: Array<{
        name: string;
        weight?: number;
    }>;
    /** Enable high-resolution fix (A1111 only). */
    hrFix?: boolean;
    /** Denoising strength for high-res fix or img2img (default 0.7). */
    denoisingStrength?: number;
}
export declare class StableDiffusionLocalProvider implements IImageProvider {
    readonly providerId = "stable-diffusion-local";
    isInitialized: boolean;
    defaultModelId?: string;
    /** Sanitised base URL of the local backend (no trailing slash). */
    private baseUrl;
    /** Detected backend type.  Defaults to `'automatic1111'` when detection fails. */
    private backend;
    /** Swappable `fetch` implementation (enables deterministic testing). */
    private fetchImpl;
    constructor(fetchImpl?: typeof fetch);
    /**
     * Initialise the provider.
     *
     * Accepts `baseURL` / `baseUrl` / `baseurl` from the config bag and
     * auto-detects the backend by probing known endpoints.
     *
     * @param config - Provider configuration.  Must contain a `baseURL` string.
     * @throws {Error} When no `baseURL` is supplied.
     */
    initialize(config: Record<string, unknown>): Promise<void>;
    /**
     * Generate one or more images from a text prompt.
     *
     * Dispatches to the detected backend (A1111 or ComfyUI).
     *
     * @throws {Error} When the provider has not been initialised.
     */
    generateImage(request: ImageGenerationRequest): Promise<ImageGenerationResult>;
    /**
     * Generates images using the Automatic1111 / Forge `txt2img` REST endpoint.
     */
    private generateViaA1111;
    /**
     * Generates images using the ComfyUI workflow-based REST endpoint.
     *
     * Builds a minimal txt2img workflow, submits it via `POST /prompt`, then
     * polls `GET /history/:promptId` until outputs are available (max 5 min).
     */
    private generateViaComfyUI;
    /**
     * Edits an image using the A1111 `img2img` endpoint.
     *
     * Routes to `/sdapi/v1/img2img` which accepts `init_images` (base64 array)
     * and `denoising_strength` to control how much the output deviates from the
     * source.  When a mask is provided, A1111 performs inpainting on the white
     * regions of the mask.
     *
     * @param request - Edit request with source image buffer and prompt.
     * @returns Generation result containing the edited image(s).
     *
     * @throws {Error} When the provider is not initialised.
     * @throws {Error} When the A1111 API returns an HTTP error.
     */
    editImage(request: ImageEditRequest): Promise<ImageGenerationResult>;
    /**
     * Upscales an image using the A1111 extras single-image endpoint.
     *
     * Routes to `/sdapi/v1/extra-single-image` which accepts a base64 image,
     * an upscaler name, and a resize factor.
     *
     * @param request - Upscale request with source image and desired scale.
     * @returns Generation result containing the upscaled image.
     *
     * @throws {Error} When the provider is not initialised.
     * @throws {Error} When the A1111 API returns an HTTP error.
     */
    upscaleImage(request: ImageUpscaleRequest): Promise<ImageGenerationResult>;
    /**
     * Lists available checkpoint models from an A1111 backend.
     *
     * ComfyUI does not expose a simple model listing endpoint, so an empty
     * array is returned in that case.
     */
    listAvailableModels(): Promise<ImageModelInfo[]>;
    /** Resets initialisation state.  The local backend keeps running independently. */
    shutdown(): Promise<void>;
}
//# sourceMappingURL=StableDiffusionLocalProvider.d.ts.map