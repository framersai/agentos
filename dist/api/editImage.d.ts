import type { GeneratedImage, ImageEditMode, ImageProviderOptionBag } from '../media/images/IImageProvider.js';
import { type AgentOSUsageLedgerOptions } from './runtime/usageLedger.js';
/**
 * Options for an {@link editImage} call.
 *
 * @example
 * ```ts
 * const result = await editImage({
 *   provider: 'openai',
 *   image: 'data:image/png;base64,...',
 *   prompt: 'Add a rainbow in the sky.',
 *   mode: 'img2img',
 *   strength: 0.6,
 * });
 * ```
 */
export interface EditImageOptions {
    /**
     * Provider name (e.g. `"openai"`, `"stability"`, `"stable-diffusion-local"`).
     * When omitted, auto-detection via env vars is attempted.
     */
    provider?: string;
    /**
     * Model in `provider:model` format (legacy) or plain model name when `provider` is set.
     * @example `"openai:gpt-image-1"`, `"stability:sd3-medium"`
     */
    model?: string;
    /**
     * Source image as a base64 data URL, raw base64 string, `Buffer`,
     * local file path, or HTTP/HTTPS URL.
     */
    image: string | Buffer;
    /** Text prompt describing the desired changes. */
    prompt: string;
    /**
     * Optional mask for inpainting.  White pixels mark regions to be edited;
     * black pixels mark regions to keep.  Accepts the same formats as `image`.
     */
    mask?: string | Buffer;
    /**
     * Edit mode.
     * - `'img2img'` (default) — prompt-guided transformation.
     * - `'inpaint'` — mask-guided regional editing.
     * - `'outpaint'` — extend image borders.
     */
    mode?: ImageEditMode;
    /**
     * How much to deviate from the source image.
     * `0` = identical, `1` = completely new.  Default `0.75`.
     */
    strength?: number;
    /** Negative prompt describing content to avoid. */
    negativePrompt?: string;
    /** Output size (e.g. `"1024x1024"`). */
    size?: string;
    /** Seed for reproducibility (provider-dependent support). */
    seed?: number;
    /** Number of output images. */
    n?: number;
    /** Override the provider API key instead of reading from env vars. */
    apiKey?: string;
    /** Override the provider base URL. */
    baseUrl?: string;
    /** Arbitrary provider-specific options. */
    providerOptions?: ImageProviderOptionBag | Record<string, unknown>;
    /** Optional usage ledger configuration. */
    usageLedger?: AgentOSUsageLedgerOptions;
    /**
     * Content policy tier. When `'mature'` or `'private-adult'`, the edit is
     * rerouted through {@link PolicyAwareImageRouter} to pick an uncensored
     * community model (e.g. IP-Adapter FaceID SDXL for face-consistent
     * edits, SDXL for generic img2img) and `disable_safety_checker: true`
     * is applied automatically to the Replicate request so the model's own
     * NSFW filter does not veto the prompt.
     *
     * `'safe'` and `'standard'` tiers fall back to whatever `provider` /
     * `model` the caller supplied (or env-detected defaults), keeping the
     * existing censored path intact.
     */
    policyTier?: 'safe' | 'standard' | 'mature' | 'private-adult';
    /**
     * Required provider capabilities for mature/private-adult routing.
     * Drives {@link UncensoredModelCatalog} filtering so callers can ask
     * for `'face-consistency'` when editing a character's outfit, or
     * `'img2img'` when the source is a scene the author wants preserved.
     * Ignored for safe/standard tiers.
     */
    capabilities?: string[];
}
/**
 * Result returned by {@link editImage}.
 */
export interface EditImageResult {
    /** Array of edited image objects containing URLs or base64 data. */
    images: GeneratedImage[];
    /** Provider identifier. */
    provider: string;
    /** Model identifier. */
    model: string;
    /** Token/credit usage reported by the provider, when available. */
    usage: {
        costUSD?: number;
    };
}
/**
 * Edits an image using a provider-agnostic interface.
 *
 * Resolves credentials via `resolveMediaProvider()`, initialises the
 * matching image provider, converts the input image to a `Buffer`, and
 * dispatches to the provider's `editImage` method.
 *
 * @param opts - Image editing options.
 * @returns A promise resolving to the edit result with image data and metadata.
 *
 * @throws {ImageEditNotSupportedError} When the resolved provider does not
 *   implement image editing.
 * @throws {Error} When no provider can be determined or credentials are missing.
 *
 * @example
 * ```ts
 * // Img2img transformation
 * const result = await editImage({
 *   provider: 'stability',
 *   image: fs.readFileSync('landscape.png'),
 *   prompt: 'Convert the daytime scene to a starry night.',
 *   strength: 0.7,
 * });
 *
 * // Inpainting with mask
 * const inpainted = await editImage({
 *   provider: 'openai',
 *   image: 'data:image/png;base64,...',
 *   mask: 'data:image/png;base64,...',
 *   prompt: 'Replace the sky with aurora borealis.',
 *   mode: 'inpaint',
 * });
 * ```
 */
export declare function editImage(opts: EditImageOptions): Promise<EditImageResult>;
//# sourceMappingURL=editImage.d.ts.map