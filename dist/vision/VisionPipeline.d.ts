/**
 * @module vision/VisionPipeline
 *
 * Unified vision pipeline with progressive enhancement.
 *
 * Processes images through configurable tiers:
 *
 * ```
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │ Image Buffer / URL                                                  │
 * │   ↓                                                                 │
 * │ Preprocessing (sharp: resize, grayscale, sharpen, normalize)        │
 * │   ↓                                                                 │
 * │ Tier 1 — Local OCR (PaddleOCR or Tesseract.js)                     │
 * │   ↓ confidence < threshold?                                         │
 * │ Tier 2 — Local Vision (TrOCR / Florence-2)                         │
 * │   ↓ still below threshold?                                          │
 * │ Tier 3 — Cloud Vision (GPT-4o / Claude / Gemini via generateText)  │
 * │   ↓                                                                 │
 * │ Merge: highest-confidence text wins, structured layout preserved    │
 * │                                                                     │
 * │ [parallel] CLIP embedding runs alongside all tiers                  │
 * └─────────────────────────────────────────────────────────────────────┘
 * ```
 *
 * ## Dependency loading
 *
 * All heavy ML dependencies (ppu-paddle-ocr, tesseract.js,
 * \@huggingface/transformers) are loaded lazily via dynamic `import()`.
 * If a dependency is missing, the pipeline throws a helpful error
 * with installation instructions — it never crashes on missing
 * optional peer deps at module load time.
 *
 * ## Strategy behaviours
 *
 * | Strategy | Tier 1 | Tier 2 | Tier 3 | Notes |
 * |----------|--------|--------|--------|-------|
 * | progressive | Always | If low confidence | If still low | Default |
 * | local-only | Always | Always | Never | Air-gapped |
 * | cloud-only | Never | Never | Always | Best quality |
 * | parallel | Always | Always | Always | Merge best |
 *
 * @see {@link VisionPipelineConfig} for configuration options.
 * @see {@link VisionResult} for the output shape.
 * @see {@link createVisionPipeline} for the auto-detecting factory.
 *
 * @example
 * ```typescript
 * const pipeline = new VisionPipeline({
 *   strategy: 'progressive',
 *   ocr: 'paddle',
 *   handwriting: true,
 *   documentAI: true,
 *   embedding: true,
 *   cloudProvider: 'openai',
 *   confidenceThreshold: 0.8,
 * });
 *
 * const result = await pipeline.process(imageBuffer);
 * console.log(result.text);       // extracted text
 * console.log(result.category);   // 'printed-text' | 'handwritten' | etc.
 * console.log(result.embedding);  // CLIP vector for search
 * console.log(result.layout);     // structured document layout
 * ```
 */
import type { VisionPipelineConfig, VisionResult, VisionTier, ContentCategory, DocumentLayout } from './types.js';
/**
 * Unified vision pipeline with progressive enhancement.
 *
 * Processes images through up to three tiers of increasing capability:
 * 1. Local OCR (PaddleOCR / Tesseract.js) — fast, free, offline
 * 2. Local Vision Models (TrOCR / Florence-2 / CLIP) — offline but slower
 * 3. Cloud Vision LLMs (GPT-4o, Claude, Gemini) — best quality, API cost
 *
 * All heavy dependencies are loaded lazily on first use. The pipeline
 * never imports ML libraries at module load time, so it's safe to
 * instantiate even when optional peer deps are missing — errors only
 * surface when a tier that needs them actually runs.
 *
 * @see {@link createVisionPipeline} for automatic provider detection.
 */
export declare class VisionPipeline {
    /** Resolved pipeline configuration. */
    private readonly _config;
    /** PaddleOCR service instance (Tier 1). */
    private _paddleOcr?;
    /** Tesseract.js worker instance (Tier 1). */
    private _tesseract?;
    /** TrOCR pipeline for handwriting recognition (Tier 2). */
    private _trOcrPipeline?;
    /** Florence-2 pipeline for document understanding (Tier 2). */
    private _florencePipeline?;
    /** CLIP pipeline for image embeddings (Tier 2). */
    private _clipPipeline?;
    /** Whether dispose() has been called. Guards against use-after-free. */
    private _disposed;
    /**
     * Create a new vision pipeline.
     *
     * @param config - Pipeline configuration. All heavy dependencies are loaded
     *   lazily, so construction is synchronous and never imports ML libraries.
     *
     * @example
     * ```typescript
     * const pipeline = new VisionPipeline({
     *   strategy: 'progressive',
     *   ocr: 'paddle',
     *   handwriting: true,
     *   cloudProvider: 'openai',
     * });
     * ```
     */
    constructor(config: VisionPipelineConfig);
    /**
     * Process an image through the configured tiers.
     *
     * Automatically detects content type (printed text, handwritten, diagram,
     * etc.) and routes through the appropriate processing tiers based on the
     * configured {@link VisionStrategy}.
     *
     * @param image - Image data as a Buffer or file-path / URL string.
     *   Buffers are preprocessed with sharp (if configured). URL strings
     *   are passed directly to providers that support them.
     * @param options - Optional overrides for this specific invocation.
     * @param options.forceCategory - Force a specific content category
     *   instead of auto-detecting from OCR confidence heuristics.
     * @param options.tiers - Run only these specific tiers, ignoring
     *   the strategy's normal routing logic.
     * @returns Aggregated vision result with text, confidence, embeddings, etc.
     *
     * @throws {Error} If all configured tiers fail to produce a result.
     * @throws {Error} If a required dependency (e.g. ppu-paddle-ocr) is missing.
     * @throws {Error} If `dispose()` was already called.
     *
     * @example
     * ```typescript
     * // Full progressive pipeline
     * const result = await pipeline.process(imageBuffer);
     *
     * // Force handwriting mode
     * const hw = await pipeline.process(scanBuffer, {
     *   forceCategory: 'handwritten',
     * });
     *
     * // Only run OCR and embedding, skip everything else
     * const partial = await pipeline.process(imageBuffer, {
     *   tiers: ['ocr', 'embedding'],
     * });
     * ```
     */
    process(image: Buffer | string, options?: {
        forceCategory?: ContentCategory;
        tiers?: VisionTier[];
    }): Promise<VisionResult>;
    /**
     * Extract text only — fastest path using OCR tier exclusively.
     *
     * Ignores all other tiers (handwriting, document-ai, cloud, embedding).
     * Useful when you just need the text content and don't need confidence
     * scoring, layout analysis, or embeddings.
     *
     * @param image - Image data as a Buffer or file-path / URL string.
     * @returns Extracted text, or empty string if OCR produces no output.
     *
     * @throws {Error} If the configured OCR engine is missing.
     *
     * @example
     * ```typescript
     * const text = await pipeline.extractText(receiptImage);
     * console.log(text); // "ACME STORE\n...\nTotal: $42.99"
     * ```
     */
    extractText(image: Buffer | string): Promise<string>;
    /**
     * Generate an image embedding using CLIP — embedding tier only.
     *
     * Useful for building image similarity search indexes without running
     * the full OCR + vision pipeline.
     *
     * @param image - Image data as a Buffer or file-path / URL string.
     * @returns CLIP embedding vector (typically 512 or 768 dimensions).
     *
     * @throws {Error} If `@huggingface/transformers` is not installed.
     * @throws {Error} If CLIP model loading fails.
     *
     * @example
     * ```typescript
     * const embedding = await pipeline.embed(photoBuffer);
     * await vectorStore.upsert('images', [{
     *   id: 'photo-1',
     *   embedding,
     *   metadata: { source: 'upload' },
     * }]);
     * ```
     */
    embed(image: Buffer | string): Promise<number[]>;
    /**
     * Analyze document layout using Florence-2 — document-ai tier only.
     *
     * Returns structured {@link DocumentLayout} with semantic blocks
     * (text, tables, figures, headings, lists, code) and their bounding
     * boxes within each page.
     *
     * @param image - Image data as a Buffer or file-path / URL string.
     * @returns Structured document layout with pages and blocks.
     *
     * @throws {Error} If `@huggingface/transformers` is not installed.
     * @throws {Error} If Florence-2 model loading fails.
     *
     * @example
     * ```typescript
     * const layout = await pipeline.analyzeLayout(documentScan);
     * for (const page of layout.pages) {
     *   for (const block of page.blocks) {
     *     console.log(`${block.type}: ${block.content.slice(0, 50)}...`);
     *   }
     * }
     * ```
     */
    analyzeLayout(image: Buffer | string): Promise<DocumentLayout>;
    /**
     * Shut down the pipeline and release all loaded model resources.
     *
     * After calling dispose(), any further calls to `process()`,
     * `extractText()`, `embed()`, or `analyzeLayout()` will throw.
     *
     * @example
     * ```typescript
     * const pipeline = new VisionPipeline({ strategy: 'progressive' });
     * try {
     *   const result = await pipeline.process(image);
     * } finally {
     *   await pipeline.dispose();
     * }
     * ```
     */
    dispose(): Promise<void>;
    /**
     * Apply configured preprocessing to an image buffer using sharp.
     *
     * @param image - Raw image buffer.
     * @returns Preprocessed image buffer, or the original if no preprocessing
     *   is configured or sharp is unavailable.
     */
    private _preprocess;
    /**
     * Run OCR on the image using the configured engine (PaddleOCR or Tesseract.js).
     *
     * @param image - Preprocessed image buffer or URL string.
     * @returns Tier result with extracted text, confidence, and regions.
     * @throws {Error} If OCR engine is 'none' or neither engine is available.
     */
    private _runOcr;
    /**
     * Run PaddleOCR for text extraction.
     *
     * Lazily loads and initializes the ppu-paddle-ocr library on first call.
     * Subsequent calls reuse the cached service instance.
     *
     * @param image - Image buffer or URL string.
     * @returns Tier result with PaddleOCR output.
     * @throws {Error} If ppu-paddle-ocr is not installed.
     */
    private _runPaddleOcr;
    /**
     * Run Tesseract.js for text extraction.
     *
     * Lazily loads the tesseract.js library and creates a worker on first call.
     * The worker is reused for subsequent calls and terminated on dispose().
     *
     * @param image - Image buffer or URL string.
     * @returns Tier result with Tesseract output.
     * @throws {Error} If tesseract.js is not installed.
     */
    private _runTesseract;
    /**
     * Run TrOCR handwriting recognition via @huggingface/transformers.
     *
     * TrOCR is a transformer model specifically trained for handwritten
     * text recognition. It excels where standard OCR engines (PaddleOCR,
     * Tesseract) produce low-confidence, garbled output on cursive text.
     *
     * @param image - Preprocessed image buffer or URL string.
     * @returns Tier result with handwriting-recognized text.
     * @throws {Error} If @huggingface/transformers is not installed.
     */
    private _runTrOcr;
    /**
     * Run Florence-2 document understanding via @huggingface/transformers.
     *
     * Florence-2 detects semantic blocks (text, tables, figures, headings,
     * lists, code) and their bounding boxes, producing a structured
     * {@link DocumentLayout} alongside extracted text.
     *
     * @param image - Preprocessed image buffer or URL string.
     * @returns Tier result plus structured document layout.
     * @throws {Error} If @huggingface/transformers is not installed.
     */
    private _runFlorence2;
    /**
     * Generate a CLIP image embedding via @huggingface/transformers.
     *
     * CLIP embeddings enable cross-modal similarity search — the embedding
     * lives in the same vector space as text embeddings from the same model,
     * so you can search images with text queries and vice versa.
     *
     * @param image - Preprocessed image buffer or URL string.
     * @returns Embedding vector (typically 512 or 768 dimensions), or undefined
     *   if CLIP is not available.
     * @throws {Error} If @huggingface/transformers is not installed.
     */
    private _runClipEmbedding;
    /**
     * Run cloud vision LLM for image understanding.
     *
     * Uses the existing `generateText()` API with a multimodal message
     * containing the image as a base64 data URL. This works with any
     * vision-capable provider (OpenAI GPT-4o, Anthropic Claude, Google
     * Gemini, Ollama with LLaVA, etc.).
     *
     * @param image - Image buffer or URL string.
     * @returns Tier result with cloud vision description.
     * @throws {Error} If no cloud provider is configured.
     * @throws {Error} If the cloud API call fails.
     */
    private _runCloudVision;
    /**
     * Lazily load and initialize PaddleOCR.
     *
     * @returns Initialized PaddleOCR service instance.
     * @throws {Error} If ppu-paddle-ocr is not installed, with install instructions.
     */
    private _loadPaddleOcr;
    /**
     * Lazily load and initialize a Tesseract.js worker.
     *
     * @returns Initialized Tesseract worker ready for recognition.
     * @throws {Error} If tesseract.js is not installed, with install instructions.
     */
    private _loadTesseract;
    /**
     * Lazily load the TrOCR image-to-text pipeline from @huggingface/transformers.
     *
     * @returns HuggingFace image-to-text pipeline configured with TrOCR weights.
     * @throws {Error} If @huggingface/transformers is not installed.
     */
    private _loadTrOcr;
    /**
     * Lazily load the Florence-2 document understanding pipeline.
     *
     * @returns HuggingFace pipeline configured for Florence-2 document analysis.
     * @throws {Error} If @huggingface/transformers is not installed.
     */
    private _loadFlorence2;
    /**
     * Lazily load the CLIP feature-extraction pipeline for image embeddings.
     *
     * @returns HuggingFace feature-extraction pipeline configured with CLIP.
     * @throws {Error} If @huggingface/transformers is not installed.
     */
    private _loadClip;
    /**
     * Detect the content category from OCR results using heuristics.
     *
     * This avoids running expensive classification models just to decide
     * which Tier 2 model to invoke. The heuristics are deliberately
     * conservative — when in doubt, they return 'mixed' which triggers
     * both handwriting and document-ai tiers.
     *
     * @param ocrResult - Result from Tier 1 OCR, or undefined if OCR was skipped.
     * @returns Detected content category.
     */
    private _detectCategory;
    /**
     * Determine whether a specific tier should run based on the strategy
     * and any explicit tier overrides.
     *
     * @param tier - The tier to check.
     * @param strategy - The pipeline's configured strategy.
     * @param requestedTiers - Explicit tier overrides from the caller, if any.
     * @returns True if the tier should run.
     */
    private _shouldRunTier;
    /**
     * Determine whether cloud vision should run based on strategy, current
     * confidence, and threshold.
     *
     * Cloud vision is the most expensive tier, so we're careful about when
     * to invoke it — only when local results are insufficient.
     *
     * @param strategy - Pipeline strategy.
     * @param bestLocalConfidence - Best confidence from local tiers so far.
     * @param threshold - Confidence threshold for cloud escalation.
     * @param requestedTiers - Explicit tier overrides, if any.
     * @returns True if cloud vision should run.
     */
    private _shouldRunCloudVision;
    /**
     * Find the highest confidence among a set of tier results.
     *
     * @param tierResults - Results from tiers that have run so far.
     * @returns Best confidence score, or 0 if no results.
     */
    private _bestConfidence;
    /**
     * Assemble the final {@link VisionResult} from individual tier outputs.
     *
     * The winning tier is the one with the highest confidence. Layout data
     * from Florence-2 is always included when available, regardless of
     * which tier's text wins.
     *
     * @param tierResults - All tier results collected during processing.
     * @param activeTiers - Which tiers actually ran (for metadata).
     * @param embedding - CLIP embedding, if generated.
     * @param layout - Florence-2 document layout, if generated.
     * @param forcedCategory - Caller-specified category override.
     * @param startTime - Timestamp when processing started (for duration).
     * @returns Assembled vision result.
     */
    private _assembleResult;
    /**
     * Convert a URL or file path to a Buffer by reading the file or
     * fetching the URL.
     *
     * @param url - URL string (http://, https://, file://, or bare path).
     * @returns Image data as a Buffer.
     */
    private _urlToBuffer;
    /**
     * Guard method that throws if the pipeline has been disposed.
     * Called at the top of every public method to prevent use-after-free.
     *
     * @throws {Error} If dispose() has been called.
     */
    private _assertNotDisposed;
}
//# sourceMappingURL=VisionPipeline.d.ts.map