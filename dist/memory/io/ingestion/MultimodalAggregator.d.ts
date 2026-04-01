/**
 * @fileoverview MultimodalAggregator — post-processing stage for images
 * extracted from documents.
 *
 * After loaders such as {@link PdfLoader} and {@link DocxLoader} extract
 * embedded images as {@link ExtractedImage} objects, `MultimodalAggregator`
 * enriches them with natural-language captions by optionally calling a
 * vision-capable LLM function supplied by the application layer.
 *
 * The class is intentionally thin: it holds no state beyond the optional
 * configuration and delegates all vision intelligence to the caller-supplied
 * `describeImage` function.  This keeps the aggregator testable without any
 * live LLM dependencies.
 *
 * @module memory/ingestion/MultimodalAggregator
 */
import type { ExtractedImage } from '../../io/facade/types.js';
/**
 * Configuration for {@link MultimodalAggregator}.
 */
export interface MultimodalConfig {
    /**
     * Async function that accepts a raw image buffer and its MIME type and
     * returns a natural-language description of the image.
     *
     * When this is `undefined` the aggregator passes images through unchanged.
     *
     * @param imageBuffer - Raw bytes of the image (PNG, JPEG, WebP, …).
     * @param mimeType    - MIME type of the image, e.g. `'image/png'`.
     * @returns A promise resolving to a human-readable description string.
     *
     * @example
     * ```ts
     * async (buffer, mimeType) => {
     *   return openaiClient.vision(buffer, mimeType);
     * }
     * ```
     */
    describeImage?: (imageBuffer: Buffer, mimeType: string) => Promise<string>;
}
/**
 * Adds auto-generated captions to {@link ExtractedImage} objects that lack
 * one, using a caller-supplied vision LLM function.
 *
 * Images are processed in parallel via `Promise.allSettled()` so a single
 * failed captioning attempt does not block the rest.  Images whose captioning
 * fails retain their original (un-captioned) state rather than propagating the
 * error.
 *
 * ### Example — with a vision LLM
 * ```ts
 * const aggregator = new MultimodalAggregator({
 *   describeImage: async (buf, mime) => myVisionLLM.describe(buf, mime),
 * });
 *
 * const captioned = await aggregator.processImages(doc.images ?? []);
 * ```
 *
 * ### Example — passthrough (no LLM configured)
 * ```ts
 * const aggregator = new MultimodalAggregator();
 * const unchanged  = await aggregator.processImages(doc.images ?? []);
 * ```
 */
export declare class MultimodalAggregator {
    private readonly config?;
    /**
     * @param config - Optional configuration.  Omit to use in passthrough mode.
     */
    constructor(config?: MultimodalConfig | undefined);
    /**
     * Enrich images with captions via the configured vision LLM.
     *
     * Only images that have no existing `caption` field are processed.  Images
     * that already carry a caption are left unchanged to avoid redundant LLM
     * calls.
     *
     * When no `describeImage` function is configured all images are returned
     * unchanged.
     *
     * @param images - Array of {@link ExtractedImage} objects to process.
     * @returns A promise resolving to the same-length array of
     *          {@link ExtractedImage} objects, with captions filled in where
     *          possible.
     */
    processImages(images: ExtractedImage[]): Promise<ExtractedImage[]>;
}
//# sourceMappingURL=MultimodalAggregator.d.ts.map