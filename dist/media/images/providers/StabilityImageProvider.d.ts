import { type IImageProvider, type ImageGenerationRequest, type ImageGenerationResult, type ImageEditRequest, type ImageUpscaleRequest, type ImageModelInfo } from '../IImageProvider.js';
export interface StabilityImageProviderConfig {
    apiKey: string;
    baseURL?: string;
    defaultModelId?: string;
}
export declare class StabilityImageProvider implements IImageProvider {
    readonly providerId = "stability";
    isInitialized: boolean;
    defaultModelId?: string;
    private config;
    initialize(config: Record<string, unknown>): Promise<void>;
    generateImage(request: ImageGenerationRequest): Promise<ImageGenerationResult>;
    /**
     * Edits an image using the Stability AI image-to-image endpoint.
     *
     * Routes to different endpoints depending on the edit mode:
     * - `'img2img'` (default) — `/v2beta/stable-image/generate/sd3` with `image` and `strength`.
     * - `'inpaint'` — same endpoint but additionally includes `mask_image`.
     * - `'outpaint'` — currently treated identically to `img2img` (provider
     *   does not expose a dedicated outpainting endpoint in the v2beta surface).
     *
     * @param request - Edit request containing the source image, prompt, and optional mask.
     * @returns Generation result with the edited image(s).
     *
     * @throws {Error} When the provider is not initialised.
     * @throws {Error} When the Stability API returns an HTTP error status.
     *
     * @see https://platform.stability.ai/docs/api-reference#tag/Generate/paths/~1v2beta~1stable-image~1generate~1sd3/post
     */
    editImage(request: ImageEditRequest): Promise<ImageGenerationResult>;
    /**
     * Upscales an image using the Stability AI upscale endpoint.
     *
     * Uses `/v2beta/stable-image/upscale/conservative` which takes an image
     * and a target width to produce a higher-resolution version.
     *
     * @param request - Upscale request with the source image and desired dimensions.
     * @returns Generation result with the upscaled image.
     *
     * @throws {Error} When the provider is not initialised.
     * @throws {Error} When the Stability API returns an HTTP error status.
     *
     * @see https://platform.stability.ai/docs/api-reference#tag/Upscale
     */
    upscaleImage(request: ImageUpscaleRequest): Promise<ImageGenerationResult>;
    /**
     * Parses a Stability API response into an array of {@link GeneratedImage} objects.
     *
     * Handles both JSON envelope responses (with `image` or `artifacts` fields)
     * and raw binary responses (identified by non-JSON content types).
     */
    private parseStabilityResponse;
    listAvailableModels(): Promise<ImageModelInfo[]>;
}
//# sourceMappingURL=StabilityImageProvider.d.ts.map