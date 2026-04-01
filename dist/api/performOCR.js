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
import { readFile } from 'node:fs/promises';
import { createVisionPipeline } from '../vision/index.js';
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
/**
 * Returns `true` when a string looks like a `data:` URI or raw base64.
 *
 * Heuristic: starts with `data:` prefix, or is a string containing only
 * base64-legal characters that is at least 64 chars long (to avoid false
 * positives on short file paths).
 */
function looksLikeBase64(value) {
    if (value.startsWith('data:'))
        return true;
    if (value.length < 64)
        return false;
    return /^[A-Za-z0-9+/\r\n]+=*$/.test(value);
}
/**
 * Strips the `data:...;base64,` prefix from a data URI and returns
 * the raw base64 payload.
 */
function stripDataPrefix(value) {
    const idx = value.indexOf(',');
    return idx >= 0 ? value.slice(idx + 1) : value;
}
/**
 * Resolves a heterogeneous image input into a raw `Buffer`.
 *
 * @param image - File path, URL, base64 string, or Buffer.
 * @returns The image as a Buffer.
 */
async function resolveImageToBuffer(image) {
    // Already a Buffer — return as-is.
    if (Buffer.isBuffer(image)) {
        return image;
    }
    // Base64 string (with or without data: prefix).
    if (looksLikeBase64(image)) {
        const raw = stripDataPrefix(image);
        return Buffer.from(raw, 'base64');
    }
    // HTTP(S) URL — fetch and return body as Buffer.
    if (image.startsWith('http://') || image.startsWith('https://')) {
        const response = await fetch(image);
        if (!response.ok) {
            throw new Error(`performOCR: failed to fetch image from ${image} — HTTP ${response.status} ${response.statusText}`);
        }
        const arrayBuffer = await response.arrayBuffer();
        return Buffer.from(arrayBuffer);
    }
    // File path — read from disk.
    return readFile(image);
}
/**
 * Determines the winning tier from a {@link VisionResult}.
 *
 * The winning tier is the one whose text was selected as the final
 * `result.text`. We find it by matching against `tierResults` — the last
 * tier result whose text matches the overall text is the winner (later
 * tiers override earlier ones in the pipeline).
 */
function resolveWinningTier(result) {
    // Walk tier results in reverse — the last match is the winner.
    for (let i = result.tierResults.length - 1; i >= 0; i--) {
        const tr = result.tierResults[i];
        if (tr.text === result.text) {
            return { tier: tr.tier, provider: tr.provider };
        }
    }
    // Fallback: use the first tier reported in the result's tiers array.
    const fallbackTier = result.tiers[0] ?? 'ocr';
    const fallbackProvider = result.tierResults[0]?.provider ?? 'unknown';
    return { tier: fallbackTier, provider: fallbackProvider };
}
// ---------------------------------------------------------------------------
// Main API
// ---------------------------------------------------------------------------
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
export async function performOCR(opts) {
    // 1. Resolve the input into a raw image buffer.
    const imageBuffer = await resolveImageToBuffer(opts.image);
    // 2. Create a vision pipeline with the caller's preferences.
    const pipeline = await createVisionPipeline({
        strategy: opts.strategy ?? 'progressive',
        confidenceThreshold: opts.confidenceThreshold,
        cloudProvider: opts.provider,
        cloudModel: opts.model,
        // Disable embedding tier — OCR callers don't need CLIP vectors.
        embedding: false,
    });
    try {
        // 3. Run the pipeline.
        const visionResult = await pipeline.process(imageBuffer);
        // 4. Determine which tier won.
        const winning = resolveWinningTier(visionResult);
        // 5. Map regions from the winning tier (if available).
        const regions = visionResult.regions?.map((r) => ({
            text: r.text,
            bbox: r.bbox
                ? { x: r.bbox.x, y: r.bbox.y, width: r.bbox.width, height: r.bbox.height }
                : undefined,
            confidence: r.confidence,
        }));
        return {
            text: visionResult.text,
            confidence: visionResult.confidence,
            tier: winning.tier,
            category: visionResult.category,
            provider: winning.provider,
            regions,
        };
    }
    finally {
        // 6. Always clean up pipeline resources.
        await pipeline.dispose();
    }
}
//# sourceMappingURL=performOCR.js.map