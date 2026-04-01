import { type IImageProvider, type ImageGenerationRequest, type ImageGenerationResult, type ImageEditRequest, type ImageVariateRequest, type ImageModelInfo } from '../IImageProvider.js';
export interface OpenAIImageProviderConfig {
    apiKey: string;
    baseURL?: string;
    defaultModelId?: string;
    organizationId?: string;
}
export declare class OpenAIImageProvider implements IImageProvider {
    readonly providerId = "openai";
    isInitialized: boolean;
    defaultModelId?: string;
    private config;
    initialize(config: Record<string, unknown>): Promise<void>;
    generateImage(request: ImageGenerationRequest): Promise<ImageGenerationResult>;
    /**
     * Edits an image using the OpenAI `/v1/images/edits` endpoint.
     *
     * Supports both img2img (prompt-guided transformation) and inpainting
     * (mask-guided regional editing).  The endpoint expects multipart form
     * data with the source image and an optional mask.
     *
     * @param request - Edit request with source image buffer and prompt.
     * @returns Generation result containing the edited image(s).
     *
     * @throws {Error} When the provider is not initialised.
     * @throws {Error} When the API returns an HTTP error status.
     *
     * @see https://platform.openai.com/docs/api-reference/images/createEdit
     */
    editImage(request: ImageEditRequest): Promise<ImageGenerationResult>;
    /**
     * Creates visual variations of an image using the OpenAI `/v1/images/variations` endpoint.
     *
     * The `variance` field in the request is not natively supported by OpenAI's
     * variations API (there is no strength parameter), so it is currently ignored.
     * Every call produces images with the model's default level of variation.
     *
     * @param request - Variation request with the source image buffer.
     * @returns Generation result containing the variation image(s).
     *
     * @throws {Error} When the provider is not initialised.
     * @throws {Error} When the API returns an HTTP error status.
     *
     * @see https://platform.openai.com/docs/api-reference/images/createVariation
     */
    variateImage(request: ImageVariateRequest): Promise<ImageGenerationResult>;
    listAvailableModels(): Promise<ImageModelInfo[]>;
}
//# sourceMappingURL=OpenAIImageProvider.d.ts.map