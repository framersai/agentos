import type { GeneratedImage, ImageProviderOptionBag } from '../media/images/IImageProvider.js';
import { type AgentOSUsageLedgerOptions } from './runtime/usageLedger.js';
/**
 * Options for an {@link upscaleImage} call.
 *
 * @example
 * ```ts
 * const result = await upscaleImage({
 *   provider: 'stability',
 *   image: fs.readFileSync('lowres.png'),
 *   scale: 4,
 * });
 * ```
 */
export interface UpscaleImageOptions {
    /**
     * Provider name (e.g. `"stability"`, `"replicate"`, `"stable-diffusion-local"`).
     * When omitted, auto-detection via env vars is attempted.
     */
    provider?: string;
    /**
     * Model identifier.  Most upscale providers use a fixed model so this is
     * usually left unset.
     */
    model?: string;
    /**
     * Source image as a base64 data URL, raw base64 string, `Buffer`,
     * local file path, or HTTP/HTTPS URL.
     */
    image: string | Buffer;
    /**
     * Integer scale factor.  `2` doubles each dimension; `4` quadruples them.
     * When both `scale` and `width`/`height` are provided, explicit dimensions
     * take precedence.
     *
     * @default 2
     */
    scale?: 2 | 4;
    /** Target width in pixels (alternative to `scale`). */
    width?: number;
    /** Target height in pixels (alternative to `scale`). */
    height?: number;
    /** Override the provider API key instead of reading from env vars. */
    apiKey?: string;
    /** Override the provider base URL. */
    baseUrl?: string;
    /** Arbitrary provider-specific options. */
    providerOptions?: ImageProviderOptionBag | Record<string, unknown>;
    /** Optional usage ledger configuration. */
    usageLedger?: AgentOSUsageLedgerOptions;
}
/**
 * Result returned by {@link upscaleImage}.
 */
export interface UpscaleImageResult {
    /** The upscaled image. */
    image: GeneratedImage;
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
 * Upscales an image using a provider-agnostic interface.
 *
 * Resolves credentials via `resolveMediaProvider()`, initialises the
 * matching image provider, converts the input image to a `Buffer`, and
 * dispatches to the provider's `upscaleImage` method.
 *
 * @param opts - Upscale options including the source image and desired scale.
 * @returns A promise resolving to the upscale result with the higher-resolution image.
 *
 * @throws {ImageUpscaleNotSupportedError} When the resolved provider does not
 *   implement image upscaling.
 * @throws {Error} When no provider can be determined or credentials are missing.
 *
 * @example
 * ```ts
 * const result = await upscaleImage({
 *   provider: 'stability',
 *   image: 'https://example.com/lowres.jpg',
 *   scale: 4,
 * });
 * console.log(result.image.dataUrl);
 * ```
 */
export declare function upscaleImage(opts: UpscaleImageOptions): Promise<UpscaleImageResult>;
//# sourceMappingURL=upscaleImage.d.ts.map