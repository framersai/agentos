import type { GeneratedImage, ImageGenerationResult, ImageProviderOptionBag, ImageResponseFormat, ImageBackground, ImageModality, ImageOutputFormat } from '../media/images/IImageProvider.js';
import { type MediaProviderPreference } from '../media/ProviderPreferences.js';
import { type AgentOSUsageLedgerOptions } from './runtime/usageLedger.js';
/**
 * Options for a {@link generateImage} call.
 */
export interface GenerateImageOptions {
    /**
     * Provider name.  When supplied without `model`, the default image model for
     * the provider is resolved automatically from the built-in defaults registry.
     *
     * @example `"openai"`, `"stability"`, `"replicate"`
     */
    provider?: string;
    /**
     * Model in `provider:model` format (legacy) or plain model name when `provider` is set.
     * @example `"openai:dall-e-3"`, `"stability:stable-diffusion-xl-1024-v1-0"`
     *
     * Either `provider` or `model` (or an API key env var for auto-detection) is required.
     */
    model?: string;
    /** Text description of the desired image. */
    prompt: string;
    /** Output modalities requested from the provider (provider-dependent). */
    modalities?: ImageModality[];
    /** Number of images to generate. Defaults to `1` for most providers. */
    n?: number;
    /** Pixel dimensions string, e.g. `"1024x1024"`. Provider-dependent. */
    size?: string;
    /** Aspect ratio string, e.g. `"16:9"`. Used by some providers instead of `size`. */
    aspectRatio?: string;
    /** Quality hint forwarded to the provider (e.g. `"hd"` for DALL-E 3). */
    quality?: string;
    /** Background style for transparent-capable providers. */
    background?: ImageBackground;
    /** Desired output file format (e.g. `"png"`, `"jpeg"`, `"webp"`). */
    outputFormat?: ImageOutputFormat;
    /** Compression level (0–100) for lossy output formats. */
    outputCompression?: number;
    /** Whether the provider should return a URL or base64-encoded data. */
    responseFormat?: ImageResponseFormat;
    /** Override the provider API key instead of reading from environment variables. */
    apiKey?: string;
    /** Override the provider base URL. */
    baseUrl?: string;
    /** Optional user identifier forwarded to the provider for moderation tracking. */
    userId?: string;
    /** Random seed for reproducible generation (provider-dependent support). */
    seed?: number;
    /** Negative prompt describing content to avoid (provider-dependent support). */
    negativePrompt?: string;
    /** Arbitrary provider-specific options not covered by the standard fields. */
    providerOptions?: ImageProviderOptionBag | Record<string, unknown>;
    /**
     * Provider preferences for reordering or filtering the fallback chain.
     * When supplied, the available image providers are reordered according to
     * `preferred` and filtered by `blocked` before building the chain.
     */
    providerPreferences?: MediaProviderPreference;
    /**
     * Content policy tier. When mature or private-adult, the image provider
     * chain is reordered to prefer uncensored providers (Replicate, Fal)
     * over censored ones (DALL-E, Stability safe mode).
     */
    policyTier?: 'safe' | 'standard' | 'mature' | 'private-adult';
    /** Optional durable usage ledger configuration for helper-level accounting. */
    usageLedger?: AgentOSUsageLedgerOptions;
}
/**
 * The result returned by {@link generateImage}.
 */
export interface GenerateImageResult {
    /** Model identifier reported by the provider. */
    model: string;
    /** Provider identifier (e.g. `"openai"`, `"stability"`). */
    provider: string;
    /** Unix timestamp (seconds) when the image was created. */
    created: number;
    /** Optional text response accompanying the images (provider-dependent). */
    text?: string;
    /** Array of generated image objects containing URLs or base64 data. */
    images: GeneratedImage[];
    /** Token / credit usage reported by the provider, when available. */
    usage?: ImageGenerationResult['usage'];
}
/**
 * Generates one or more images using a provider-agnostic `provider:model` string.
 *
 * Resolves credentials via `resolveMediaProvider()`, initialises the matching
 * image provider, and returns a normalised {@link GenerateImageResult}.
 *
 * @param opts - Image generation options including model, prompt, and optional parameters.
 * @returns A promise resolving to the generation result with image data and metadata.
 *
 * @example
 * ```ts
 * const result = await generateImage({
 *   model: 'openai:dall-e-3',
 *   prompt: 'A photorealistic red panda sitting on a moonlit rooftop.',
 *   size: '1024x1024',
 * });
 * console.log(result.images[0].url);
 * ```
 */
export declare function generateImage(opts: GenerateImageOptions): Promise<GenerateImageResult>;
//# sourceMappingURL=generateImage.d.ts.map