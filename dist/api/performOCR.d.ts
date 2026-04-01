/**
 * @fileoverview Top-level OCR API for AgentOS.
 *
 * Provides a simple, self-contained `performOCR(options)` function that
 * extracts text from images without requiring callers to instantiate or
 * manage a {@link VisionPipeline} directly.
 *
 * Under the hood the function:
 * 1. Resolves the input (file path, URL, base64, or raw Buffer) into a Buffer.
 * 2. Creates a {@link VisionPipeline} via {@link createVisionPipeline} using
 *    the caller's strategy/threshold preferences.
 * 3. Runs the pipeline's progressive tier system (PaddleOCR -> Tesseract ->
 *    TrOCR -> Florence-2 -> Cloud LLM).
 * 4. Maps the internal {@link VisionResult} to a consumer-friendly
 *    {@link OCRResult}.
 * 5. Disposes the pipeline so no resources leak.
 *
 * @example
 * ```ts
 * import { performOCR } from '@framers/agentos';
 *
 * // From a file path
 * const result = await performOCR({ image: '/tmp/receipt.png' });
 * console.log(result.text);
 *
 * // From a URL with cloud-only strategy
 * const result2 = await performOCR({
 *   image: 'https://example.com/scan.jpg',
 *   strategy: 'cloud-only',
 *   provider: 'openai',
 *   apiKey: process.env.OPENAI_API_KEY,
 * });
 * ```
 *
 * @module api/performOCR
 */
import type { VisionTier } from '../vision/types.js';
/**
 * Options accepted by {@link performOCR}.
 */
export interface PerformOCROptions {
    /**
     * Image source. Accepts any of:
     * - **File path** — absolute or relative filesystem path (e.g. `/tmp/scan.png`).
     * - **URL** — HTTP(S) URL to fetch the image from.
     * - **Base64 string** — raw base64-encoded image data (with or without a
     *   `data:image/...;base64,` prefix).
     * - **Buffer** — in-memory image bytes.
     */
    image: string | Buffer;
    /**
     * Vision strategy controlling which tiers are used.
     *
     * - `'progressive'` — start local, escalate to cloud only when confidence
     *   is below {@link confidenceThreshold}. Best cost/quality balance.
     * - `'local-only'` — never call cloud APIs. For air-gapped / privacy use.
     * - `'cloud-only'` — skip local processing, send straight to a cloud LLM.
     *   Highest quality but highest cost.
     *
     * @default 'progressive'
     */
    strategy?: 'progressive' | 'local-only' | 'cloud-only';
    /**
     * Minimum confidence threshold (0-1) to accept an OCR result from a local
     * tier without escalating to the next tier.
     *
     * Only meaningful for the `'progressive'` strategy.
     *
     * @default 0.7
     */
    confidenceThreshold?: number;
    /**
     * Cloud LLM provider for tier-3 fallback (e.g. `'openai'`, `'anthropic'`,
     * `'google'`). When omitted the provider is auto-detected from environment
     * variables (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, etc.).
     */
    provider?: string;
    /**
     * Cloud LLM model override. When omitted the provider's default vision
     * model is used (e.g. `gpt-4o` for OpenAI).
     */
    model?: string;
    /**
     * API key for the cloud provider. When omitted the key is read from the
     * standard environment variable for the provider.
     */
    apiKey?: string;
}
/**
 * Result returned by {@link performOCR}.
 */
export interface OCRResult {
    /** Extracted text content. */
    text: string;
    /** Overall confidence score (0 = no confidence, 1 = certain). */
    confidence: number;
    /**
     * Which processing tier produced the winning result.
     *
     * - `'ocr'` — PaddleOCR or Tesseract.js (fast, local, free).
     * - `'handwriting'` — TrOCR handwriting recognition (local).
     * - `'document-ai'` — Florence-2 document understanding (local).
     * - `'cloud-vision'` — Cloud LLM (GPT-4o, Claude, Gemini).
     */
    tier: VisionTier;
    /** Content category detected by the pipeline (e.g. `'printed-text'`). */
    category?: string;
    /** Provider name that produced the winning result (e.g. `'paddle'`, `'openai'`). */
    provider: string;
    /**
     * Text regions with bounding boxes, when the winning tier provides
     * spatial information. Not all tiers return region data.
     */
    regions?: Array<{
        text: string;
        bbox?: {
            x: number;
            y: number;
            width: number;
            height: number;
        };
        confidence: number;
    }>;
}
/**
 * Extract text from an image using AgentOS's progressive vision pipeline.
 *
 * This is the recommended high-level API for OCR. It handles input
 * resolution (file, URL, base64, Buffer), pipeline lifecycle, and
 * result mapping so callers don't need to interact with
 * {@link VisionPipeline} directly.
 *
 * ## When to use `performOCR()` vs `VisionPipeline`
 *
 * | Use case | Recommendation |
 * |----------|---------------|
 * | One-shot text extraction | `performOCR()` |
 * | Batch processing many images | `VisionPipeline` (create once, reuse) |
 * | Need embeddings or layout | `VisionPipeline` (richer result) |
 * | Simple scripts / quick integration | `performOCR()` |
 *
 * @param opts - OCR options including the image source and strategy.
 * @returns A promise resolving to an {@link OCRResult} with extracted text,
 *   confidence, tier info, and optional bounding-box regions.
 *
 * @example
 * ```ts
 * // Basic usage — file path, auto-detect everything
 * const { text, confidence } = await performOCR({
 *   image: '/path/to/receipt.png',
 * });
 *
 * // Privacy-sensitive — never call cloud APIs
 * const local = await performOCR({
 *   image: screenshotBuffer,
 *   strategy: 'local-only',
 * });
 *
 * // Best quality — go straight to cloud
 * const cloud = await performOCR({
 *   image: 'https://example.com/document.jpg',
 *   strategy: 'cloud-only',
 *   provider: 'openai',
 *   model: 'gpt-4o',
 * });
 * ```
 */
export declare function performOCR(opts: PerformOCROptions): Promise<OCRResult>;
//# sourceMappingURL=performOCR.d.ts.map