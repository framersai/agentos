/**
 * @module vision/providers/PipelineVisionProvider
 *
 * Wraps the full {@link VisionPipeline} as an {@link IVisionProvider}
 * for seamless integration with the {@link MultimodalIndexer}.
 *
 * Unlike the simpler {@link LLMVisionProvider} which only calls a cloud
 * LLM, this provider runs the complete multi-tier pipeline — local OCR,
 * handwriting recognition, document understanding, and cloud fallback —
 * before returning the best text description.
 *
 * This is the recommended provider when you want the multimodal indexer
 * to benefit from the full progressive enhancement pipeline.
 *
 * @see {@link VisionPipeline} for the underlying pipeline engine.
 * @see {@link LLMVisionProvider} for the cloud-only alternative.
 * @see {@link IVisionProvider} for the interface contract.
 *
 * @example
 * ```typescript
 * import { VisionPipeline, PipelineVisionProvider } from '@framers/agentos/vision';
 * import { MultimodalIndexer } from '@framers/agentos/rag/multimodal';
 *
 * const pipeline = new VisionPipeline({
 *   strategy: 'progressive',
 *   ocr: 'paddle',
 *   cloudProvider: 'openai',
 * });
 *
 * const indexer = new MultimodalIndexer({
 *   embeddingManager,
 *   vectorStore,
 *   visionProvider: new PipelineVisionProvider(pipeline),
 * });
 * ```
 */
import type { IVisionProvider } from '../../rag/multimodal/types.js';
import type { VisionPipeline } from '../VisionPipeline.js';
import type { VisionResult } from '../types.js';
/**
 * Adapts the full {@link VisionPipeline} to the narrow
 * {@link IVisionProvider} interface used by the multimodal indexer.
 *
 * The pipeline's `process()` method runs all configured tiers and returns
 * a rich {@link VisionResult}. This adapter extracts just the text field
 * that the indexer needs for embedding generation.
 *
 * For callers that need the full pipeline result (embeddings, layout,
 * confidence, regions), use `processWithFullResult()` instead.
 *
 * @example
 * ```typescript
 * const provider = new PipelineVisionProvider(pipeline);
 *
 * // Simple: just the description text
 * const text = await provider.describeImage(imageUrl);
 *
 * // Advanced: full pipeline result
 * const result = await provider.processWithFullResult(imageBuffer);
 * console.log(result.embedding);  // CLIP vector
 * console.log(result.layout);     // Florence-2 layout
 * ```
 */
export declare class PipelineVisionProvider implements IVisionProvider {
    /**
     * Reference to the underlying vision pipeline.
     * Held as a readonly reference — the caller is responsible for
     * disposing the pipeline when they're done with it.
     */
    private readonly _pipeline;
    /**
     * Create a new pipeline vision provider.
     *
     * @param pipeline - An initialized {@link VisionPipeline} instance.
     *   The caller retains ownership and is responsible for calling
     *   `pipeline.dispose()` when done.
     *
     * @throws {Error} If pipeline is null or undefined.
     *
     * @example
     * ```typescript
     * const pipeline = new VisionPipeline({ strategy: 'progressive' });
     * const provider = new PipelineVisionProvider(pipeline);
     * ```
     */
    constructor(pipeline: VisionPipeline);
    /**
     * Generate a text description of the provided image by running it
     * through the full vision pipeline.
     *
     * This satisfies the {@link IVisionProvider} contract. The image passes
     * through all configured tiers (OCR, handwriting, document-ai, cloud)
     * and the best extracted text is returned.
     *
     * @param image - Image as a URL string (https://... or data:image/...).
     * @returns Text description or extracted content from the image.
     *
     * @throws {Error} If all pipeline tiers fail to produce output.
     * @throws {Error} If the pipeline has been disposed.
     *
     * @example
     * ```typescript
     * const description = await provider.describeImage(imageUrl);
     * console.log(description);
     * ```
     */
    describeImage(image: string): Promise<string>;
    /**
     * Process an image through the full pipeline and return the complete
     * {@link VisionResult} — including embeddings, layout, confidence
     * scores, and per-tier breakdowns.
     *
     * Use this when you need more than just the text description (e.g.
     * to store the CLIP embedding alongside the text embedding in the
     * vector store).
     *
     * @param image - Image data as a Buffer or URL string.
     * @returns Full vision pipeline result.
     *
     * @throws {Error} If all pipeline tiers fail.
     * @throws {Error} If the pipeline has been disposed.
     *
     * @example
     * ```typescript
     * const result = await provider.processWithFullResult(imageBuffer);
     *
     * // Use both text embedding (via indexer) and image embedding (via CLIP)
     * if (result.embedding) {
     *   await imageVectorStore.upsert('images', [{
     *     id: docId,
     *     embedding: result.embedding,
     *     metadata: { text: result.text },
     *   }]);
     * }
     * ```
     */
    processWithFullResult(image: Buffer | string): Promise<VisionResult>;
    /**
     * Get a reference to the underlying pipeline for direct access.
     *
     * Useful when the caller needs to invoke pipeline-specific methods
     * like `extractText()`, `embed()`, or `analyzeLayout()` that aren't
     * exposed through the {@link IVisionProvider} interface.
     *
     * @returns The underlying VisionPipeline instance.
     *
     * @example
     * ```typescript
     * const layout = await provider.getPipeline().analyzeLayout(image);
     * ```
     */
    getPipeline(): VisionPipeline;
}
//# sourceMappingURL=PipelineVisionProvider.d.ts.map