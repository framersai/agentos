/**
 * @file transferStyle.ts
 * Provider-agnostic style transfer for the AgentOS high-level API.
 *
 * Applies the visual aesthetic of a reference image to a source image,
 * guided by a text prompt. Internally routes to the best available
 * provider for style transfer:
 *
 * - **Replicate** (preferred): Flux Redux — purpose-built for image-guided generation
 * - **Fal**: Flux Dev img2img with style reference in prompt
 * - **Stability**: img2img with strength control
 * - **OpenAI**: editImage with descriptive prompt
 *
 * @module agentos/api/transferStyle
 *
 * @example
 * ```typescript
 * import { transferStyle } from '../api/transferStyle';
 *
 * const result = await transferStyle({
 *   image: './photo.jpg',
 *   styleReference: './monet-painting.jpg',
 *   prompt: 'Impressionist oil painting with warm golden light',
 *   strength: 0.7,
 * });
 * console.log(result.images[0].url);
 * ```
 */
import type { GeneratedImage } from '../media/images/IImageProvider.js';
import { type AgentOSUsageLedgerOptions } from './runtime/usageLedger.js';
/**
 * Options for a {@link transferStyle} call.
 */
export interface TransferStyleOptions {
    /** Source image to transform (Buffer, file path, URL, or data URI). */
    image: string | Buffer;
    /** Reference image whose visual aesthetic to apply. */
    styleReference: string | Buffer;
    /** Text prompt guiding the transfer direction. */
    prompt: string;
    /**
     * Transfer strength. Controls how much of the reference style to apply.
     * `0.0` = source unchanged, `1.0` = fully adopts reference style.
     * @default 0.7
     */
    strength?: number;
    /** Provider override. Auto-detects from env vars if omitted. */
    provider?: string;
    /** Model override. Provider-specific. */
    model?: string;
    /** Output size (e.g. `'1024x1024'`). */
    size?: string;
    /** Negative prompt describing content to avoid. */
    negativePrompt?: string;
    /** Seed for reproducible output. */
    seed?: number;
    /** Policy tier for provider routing. */
    policyTier?: 'safe' | 'standard' | 'mature' | 'private-adult';
    /** Provider-specific options passthrough. */
    providerOptions?: Record<string, unknown>;
    /** Usage ledger configuration. */
    usageLedger?: AgentOSUsageLedgerOptions;
}
/**
 * Result returned by {@link transferStyle}.
 */
export interface TransferStyleResult {
    /** Generated images with transferred style. */
    images: GeneratedImage[];
    /** Provider that served the request. */
    provider: string;
    /** Model used for the transfer. */
    model: string;
    /** Usage/cost metadata. */
    usage: {
        costUSD?: number;
    };
}
/**
 * Transfers the visual aesthetic of a reference image onto a source image.
 *
 * Routes to the best available provider:
 * - **Replicate** (Flux Redux): purpose-built for image-guided style transfer
 * - **Fal** (Flux Dev): img2img with style guidance
 * - **Stability** (img2img): strength-controlled transformation
 * - **OpenAI** (edit): prompt-guided editing
 *
 * @param opts - Style transfer options.
 * @returns Promise resolving to the transfer result with styled image(s).
 *
 * @throws {Error} When no style transfer provider is available.
 *
 * @example
 * ```typescript
 * // Photo to oil painting
 * const result = await transferStyle({
 *   image: photoBuffer,
 *   styleReference: './monet.jpg',
 *   prompt: 'Impressionist oil painting, warm golden light, visible brushstrokes',
 *   strength: 0.7,
 * });
 * ```
 */
export declare function transferStyle(opts: TransferStyleOptions): Promise<TransferStyleResult>;
//# sourceMappingURL=transferStyle.d.ts.map