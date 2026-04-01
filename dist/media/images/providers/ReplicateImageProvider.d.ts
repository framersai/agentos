import { type IImageProvider, type ImageGenerationRequest, type ImageGenerationResult, type ImageEditRequest, type ImageUpscaleRequest, type ImageModelInfo } from '../IImageProvider.js';
export interface ReplicateImageProviderConfig {
    apiKey: string;
    baseURL?: string;
    defaultModelId?: string;
}
export declare class ReplicateImageProvider implements IImageProvider {
    readonly providerId = "replicate";
    isInitialized: boolean;
    defaultModelId?: string;
    private config;
    initialize(config: Record<string, unknown>): Promise<void>;
    generateImage(request: ImageGenerationRequest): Promise<ImageGenerationResult>;
    /**
     * Edits an image using a Replicate model that supports image-to-image input.
     *
     * Uses `black-forest-labs/flux-fill` for inpainting (when a mask is provided)
     * or falls back to `stability-ai/sdxl` for generic img2img transforms.
     * The source image is passed as a base64 data URL in the model input.
     *
     * @param request - Edit request with source image, prompt, and optional mask.
     * @returns Generation result with the edited image(s).
     *
     * @throws {Error} When the provider is not initialised or the API fails.
     */
    editImage(request: ImageEditRequest): Promise<ImageGenerationResult>;
    /**
     * Upscales an image using a Replicate upscaling model.
     *
     * Defaults to `nightmareai/real-esrgan` which supports 2x and 4x upscaling
     * via the `scale` input parameter.
     *
     * @param request - Upscale request with source image and desired scale factor.
     * @returns Generation result with the upscaled image.
     *
     * @throws {Error} When the provider is not initialised or the API fails.
     */
    upscaleImage(request: ImageUpscaleRequest): Promise<ImageGenerationResult>;
    listAvailableModels(): Promise<ImageModelInfo[]>;
    private createPrediction;
    private pollPrediction;
}
//# sourceMappingURL=ReplicateImageProvider.d.ts.map