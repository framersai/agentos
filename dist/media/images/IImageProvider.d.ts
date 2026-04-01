export type ImageProviderId = 'openai' | 'openrouter' | 'stability' | 'replicate' | 'stable-diffusion-local' | (string & {});
export type ImageModality = 'image' | 'text';
export type ImageBackground = 'transparent' | 'opaque' | 'auto';
export type ImageOutputFormat = 'png' | 'jpeg' | 'jpg' | 'webp';
export type ImageResponseFormat = 'b64_json' | 'url';
export interface ImageModelInfo {
    modelId: string;
    providerId: string;
    displayName?: string;
    description?: string;
}
export interface ImageProviderUsage {
    totalImages: number;
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    totalCostUSD?: number;
}
export interface GeneratedImage {
    url?: string;
    dataUrl?: string;
    base64?: string;
    mimeType?: string;
    revisedPrompt?: string;
    providerMetadata?: Record<string, unknown>;
}
export interface OpenAIImageProviderOptions {
    style?: 'vivid' | 'natural';
    moderation?: 'low' | 'auto';
    extraBody?: Record<string, unknown>;
}
export interface OpenRouterImageProviderOptions {
    imageConfig?: Record<string, unknown>;
    provider?: Record<string, unknown>;
    transforms?: Array<Record<string, unknown>>;
    extraBody?: Record<string, unknown>;
}
export interface StabilityImageProviderOptions {
    engine?: 'core' | 'ultra' | 'sd3' | string;
    negativePrompt?: string;
    seed?: number;
    stylePreset?: string;
    cfgScale?: number;
    steps?: number;
    samples?: number;
    strength?: number;
    aspectRatio?: string;
    outputFormat?: ImageOutputFormat;
    extraFields?: Record<string, string | number | boolean>;
}
export interface ReplicateImageProviderOptions {
    wait?: number;
    webhook?: string;
    webhookEventsFilter?: string[];
    seed?: number;
    negativePrompt?: string;
    numOutputs?: number;
    aspectRatio?: string;
    outputFormat?: ImageOutputFormat;
    outputQuality?: number;
    disableSafetyChecker?: boolean;
    goFast?: boolean;
    megapixels?: string;
    input?: Record<string, unknown>;
    extraBody?: Record<string, unknown>;
}
export interface StableDiffusionLocalImageProviderOptions {
    /** Number of inference steps (default 25). */
    steps?: number;
    /** Classifier-free guidance scale (default 7.5). */
    cfgScale?: number;
    /** Random seed (-1 for random). */
    seed?: number;
    /** Sampler name (e.g. 'Euler a', 'DPM++ 2M Karras'). */
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
export interface ImageProviderOptionBag {
    openai?: OpenAIImageProviderOptions;
    openrouter?: OpenRouterImageProviderOptions;
    stability?: StabilityImageProviderOptions;
    replicate?: ReplicateImageProviderOptions;
    'stable-diffusion-local'?: StableDiffusionLocalImageProviderOptions;
    [providerId: string]: unknown;
}
export interface ImageGenerationRequest {
    modelId?: string;
    prompt: string;
    modalities?: ImageModality[];
    n?: number;
    size?: string;
    aspectRatio?: string;
    quality?: string;
    background?: ImageBackground;
    outputFormat?: ImageOutputFormat;
    outputCompression?: number;
    responseFormat?: ImageResponseFormat;
    userId?: string;
    seed?: number;
    negativePrompt?: string;
    providerOptions?: ImageProviderOptionBag | Record<string, unknown>;
}
export interface ImageGenerationResult {
    created: number;
    modelId: string;
    providerId: string;
    text?: string;
    images: GeneratedImage[];
    usage?: ImageProviderUsage;
}
/** The kind of editing operation to perform. */
export type ImageEditMode = 'img2img' | 'inpaint' | 'outpaint';
/**
 * Provider-level request for image editing.
 *
 * Passed to {@link IImageProvider.editImage} by the high-level
 * {@link editImage} helper after normalising user input.
 */
export interface ImageEditRequest {
    /** Model identifier to use for the edit. */
    modelId: string;
    /** Source image as a raw `Buffer`. */
    image: Buffer;
    /** Text prompt describing the desired changes. */
    prompt: string;
    /** Optional mask for inpainting (white = edit region, black = keep). */
    mask?: Buffer;
    /** Editing mode. Defaults to `'img2img'`. */
    mode?: ImageEditMode;
    /**
     * How much the output may deviate from the source.
     * `0` = identical, `1` = completely redrawn.  Default `0.75`.
     */
    strength?: number;
    /** Negative prompt describing content to avoid. */
    negativePrompt?: string;
    /** Desired output dimensions (e.g. `"1024x1024"`). */
    size?: string;
    /** Seed for reproducible output. */
    seed?: number;
    /** Number of output images. */
    n?: number;
    /** Arbitrary provider-specific options. */
    providerOptions?: ImageProviderOptionBag | Record<string, unknown>;
}
/**
 * Provider-level request for image upscaling / super-resolution.
 *
 * Passed to {@link IImageProvider.upscaleImage} by the high-level
 * {@link upscaleImage} helper.
 */
export interface ImageUpscaleRequest {
    /** Model identifier to use for upscaling. */
    modelId: string;
    /** Source image as a raw `Buffer`. */
    image: Buffer;
    /** Integer scale factor (e.g. `2` or `4`). */
    scale?: 2 | 4;
    /** Target width in pixels (alternative to `scale`). */
    width?: number;
    /** Target height in pixels (alternative to `scale`). */
    height?: number;
    /** Arbitrary provider-specific options. */
    providerOptions?: ImageProviderOptionBag | Record<string, unknown>;
}
/**
 * Provider-level request for generating image variations.
 *
 * Passed to {@link IImageProvider.variateImage} by the high-level
 * {@link variateImage} helper.
 */
export interface ImageVariateRequest {
    /** Model identifier to use for variation generation. */
    modelId: string;
    /** Source image as a raw `Buffer`. */
    image: Buffer;
    /** Number of variations to generate. */
    n?: number;
    /**
     * How different from the original (`0` = identical, `1` = very different).
     * Default `0.5`.
     */
    variance?: number;
    /** Desired output size (e.g. `"1024x1024"`). */
    size?: string;
    /** Arbitrary provider-specific options. */
    providerOptions?: ImageProviderOptionBag | Record<string, unknown>;
}
export interface IImageProvider {
    readonly providerId: string;
    readonly isInitialized: boolean;
    readonly defaultModelId?: string;
    initialize(config: Record<string, unknown>): Promise<void>;
    generateImage(request: ImageGenerationRequest): Promise<ImageGenerationResult>;
    listAvailableModels?(): Promise<ImageModelInfo[]>;
    shutdown?(): Promise<void>;
    /**
     * Perform an image-to-image edit, inpainting, or outpainting operation.
     * Providers that do not support editing should leave this `undefined`.
     */
    editImage?(request: ImageEditRequest): Promise<ImageGenerationResult>;
    /**
     * Upscale / super-resolve an image.
     * Providers that do not support upscaling should leave this `undefined`.
     */
    upscaleImage?(request: ImageUpscaleRequest): Promise<ImageGenerationResult>;
    /**
     * Generate visual variations of the supplied image.
     * Providers that do not support variations should leave this `undefined`.
     */
    variateImage?(request: ImageVariateRequest): Promise<ImageGenerationResult>;
}
export declare function getImageProviderOptions<T extends object>(providerId: string, providerOptions?: ImageGenerationRequest['providerOptions']): T | undefined;
export declare function parseDataUrl(value: string): {
    mimeType?: string;
    base64?: string;
    dataUrl?: string;
};
export declare function normalizeOutputFormat(format?: ImageOutputFormat): 'png' | 'jpeg' | 'webp' | undefined;
export declare function parseImageSize(size?: string): {
    width?: number;
    height?: number;
};
export declare function inferAspectRatioFromSize(size?: string): string | undefined;
//# sourceMappingURL=IImageProvider.d.ts.map