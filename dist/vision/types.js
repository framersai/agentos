/**
 * @module vision/types
 *
 * Type definitions for the unified vision pipeline.
 *
 * The vision pipeline processes images through configurable tiers — from fast,
 * free, offline OCR (PaddleOCR / Tesseract.js) through local vision models
 * (TrOCR, Florence-2, CLIP via HuggingFace Transformers) to cloud vision LLMs
 * (GPT-4o, Claude, Gemini). Each tier adds progressively richer understanding
 * at increasing cost and latency.
 *
 * ## Tier overview
 *
 * | Tier | Provider | Capability | Cost |
 * |------|----------|-----------|------|
 * | 1 — OCR | PaddleOCR / Tesseract.js | Printed text extraction | Free/offline |
 * | 2 — Local Vision | TrOCR / Florence-2 / CLIP | Handwriting, layout, embeddings | Free/offline |
 * | 3 — Cloud Vision | GPT-4o / Claude / Gemini | Scene understanding, complex docs | API cost |
 *
 * @see {@link VisionPipeline} for the orchestration engine.
 * @see {@link VisionStrategy} for how tiers are combined.
 */
export {};
//# sourceMappingURL=types.js.map