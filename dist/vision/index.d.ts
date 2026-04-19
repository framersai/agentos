/**
 * @module vision
 *
 * Unified vision pipeline with progressive enhancement for AgentOS.
 *
 * Processes images through three configurable tiers:
 *
 * 1. **Local OCR** (PaddleOCR / Tesseract.js) — fast, free, offline
 * 2. **Local Vision Models** (TrOCR / Florence-2 / CLIP) — offline, richer
 * 3. **Cloud Vision LLMs** (GPT-4o / Claude / Gemini) — best quality
 *
 * The {@link createVisionPipeline} factory auto-detects which providers
 * are installed and builds a pipeline with sensible defaults.
 *
 * @example
 * ```typescript
 * import {
 *   createVisionPipeline,
 *   VisionPipeline,
 *   type VisionPipelineConfig,
 *   type VisionResult,
 * } from '@framers/agentos/vision';
 *
 * // Auto-detect available providers
 * const pipeline = await createVisionPipeline();
 * const result = await pipeline.process(imageBuffer);
 *
 * // Or configure explicitly
 * const custom = await createVisionPipeline({
 *   strategy: 'progressive',
 *   ocr: 'paddle',
 *   embedding: true,
 *   cloudProvider: 'openai',
 * });
 * ```
 *
 * @see {@link VisionPipeline} for the main pipeline class.
 * @see {@link VisionPipelineConfig} for configuration options.
 * @see {@link LLMVisionProvider} for a simple cloud-only vision provider.
 * @see {@link PipelineVisionProvider} for wrapping the pipeline as IVisionProvider.
 */
export { VisionPipeline } from './VisionPipeline.js';
export { LLMVisionProvider } from './providers/LLMVisionProvider.js';
export type { LLMVisionProviderConfig } from './providers/LLMVisionProvider.js';
export { PipelineVisionProvider } from './providers/PipelineVisionProvider.js';
export type { VisionPipelineConfig, VisionResult, VisionStrategy, VisionTier, ContentCategory, TierResult, TextRegion, DocumentLayout, DocumentPage, LayoutBlock, VisionPreprocessingConfig, Frame, SceneBoundary, SceneDetectorConfig, SceneDetectionMethod, } from './types.js';
export { SceneDetector } from './SceneDetector.js';
/**
 * Create a vision pipeline with sensible defaults by auto-detecting
 * which providers are installed in the current environment.
 *
 * The factory probes for optional peer dependencies (ppu-paddle-ocr,
 * tesseract.js, \@huggingface/transformers) and cloud API keys in
 * environment variables, then configures the pipeline accordingly.
 *
 * ## Auto-detection logic
 *
 * | Check | Result |
 * |-------|--------|
 * | `ppu-paddle-ocr` importable | `ocr: 'paddle'` |
 * | `tesseract.js` importable (paddle missing) | `ocr: 'tesseract'` |
 * | Neither importable | `ocr: 'none'` |
 * | `@huggingface/transformers` importable | `handwriting: true`, `documentAI: true`, `embedding: true` |
 * | `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / etc. set | `cloudProvider` configured |
 *
 * Caller-supplied config overrides always take precedence over
 * auto-detected values.
 *
 * @param config - Optional partial configuration. Fields that are set
 *   override auto-detected values. Fields that are omitted are filled
 *   by the auto-detection logic.
 * @returns A configured and ready-to-use VisionPipeline instance.
 *
 * @example
 * ```typescript
 * // Full auto-detection
 * const pipeline = await createVisionPipeline();
 *
 * // Override strategy but auto-detect everything else
 * const localOnly = await createVisionPipeline({
 *   strategy: 'local-only',
 * });
 *
 * // Explicit full config (no auto-detection)
 * const explicit = await createVisionPipeline({
 *   strategy: 'progressive',
 *   ocr: 'tesseract',
 *   handwriting: true,
 *   documentAI: false,
 *   embedding: true,
 *   cloudProvider: 'openai',
 *   cloudModel: 'gpt-4o',
 *   confidenceThreshold: 0.85,
 * });
 * ```
 */
export declare function createVisionPipeline(config?: Partial<import('./types.js').VisionPipelineConfig>): Promise<import('./VisionPipeline.js').VisionPipeline>;
//# sourceMappingURL=index.d.ts.map