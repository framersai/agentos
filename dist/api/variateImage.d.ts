import type { GeneratedImage, ImageProviderOptionBag } from '../media/images/IImageProvider.js';
import { type AgentOSUsageLedgerOptions } from './runtime/usageLedger.js';
/**
 * Options for a {@link variateImage} call.
 *
 * @example
 * ```ts
 * const result = await variateImage({
 *   provider: 'openai',
 *   image: fs.readFileSync('hero.png'),
 *   n: 3,
 *   variance: 0.4,
 * });
 * ```
 */
export interface VariateImageOptions {
    /**
     * Provider name (e.g. `"openai"`, `"stability"`, `"stable-diffusion-local"`).
     * When omitted, auto-detection via env vars is attempted.
     */
    provider?: string;
    /**
     * Model identifier.  When omitted, the provider's default variation model
     * is used (e.g. `dall-e-2` for OpenAI).
     */
    model?: string;
    /**
     * Source image as a base64 data URL, raw base64 string, `Buffer`,
     * local file path, or HTTP/HTTPS URL.
     */
    image: string | Buffer;
    /**
     * Number of variations to generate.
     * @default 1
     */
    n?: number;
    /**
     * How different from the original each variation should be.
     * `0` = nearly identical, `1` = very different.
     *
     * For providers that support strength/denoising (Stability, A1111), this is
     * mapped to that parameter.  OpenAI's variations API does not expose a
     * strength control so this value is advisory only.
     *
     * @default 0.5
     */
    variance?: number;
    /** Desired output size (e.g. `"1024x1024"`). */
    size?: string;
    /** Override the provider API key. */
    apiKey?: string;
    /** Override the provider base URL. */
    baseUrl?: string;
    /** Arbitrary provider-specific options. */
    providerOptions?: ImageProviderOptionBag | Record<string, unknown>;
    /** Optional usage ledger configuration. */
    usageLedger?: AgentOSUsageLedgerOptions;
}
/**
 * Result returned by {@link variateImage}.
 */
export interface VariateImageResult {
    /** Array of variation images. */
    images: GeneratedImage[];
    /** Provider identifier. */
    provider: string;
    /** Model identifier. */
    model: string;
    /** Token/credit usage reported by the provider. */
    usage: {
        costUSD?: number;
    };
}
/**
 * Generates visual variations of a source image using a provider-agnostic interface.
 *
 * Resolves credentials via `resolveMediaProvider()`, initialises the
 * matching image provider, converts the input image to a `Buffer`, and
 * dispatches to the provider's `variateImage` method.
 *
 * For providers without a native variation endpoint, the high-level API falls
 * back to an img2img call with `strength = variance` to produce similar output.
 *
 * @param opts - Variation options including the source image and desired count.
 * @returns A promise resolving to the variation result with image data.
 *
 * @throws {ImageVariationNotSupportedError} When the resolved provider does not
 *   implement image variations and has no img2img fallback.
 * @throws {Error} When no provider can be determined or credentials are missing.
 *
 * @example
 * ```ts
 * const result = await variateImage({
 *   provider: 'openai',
 *   image: 'https://example.com/hero.png',
 *   n: 4,
 * });
 * result.images.forEach((img, i) => console.log(`Variation ${i}:`, img.url));
 * ```
 */
export declare function variateImage(opts: VariateImageOptions): Promise<VariateImageResult>;
//# sourceMappingURL=variateImage.d.ts.map