/**
 * @module rag/multimodal/LLMVisionAdapter
 *
 * Wraps a vision-capable LLM as an {@link IVisionProvider} for the
 * multimodal RAG indexer.
 *
 * Unlike the full {@link VisionPipeline} which runs OCR, handwriting,
 * document-AI tiers before escalating to cloud, this adapter goes
 * straight to the LLM — making it the simplest path for teams that
 * only need cloud vision and don't want the multi-tier pipeline.
 *
 * ## Relationship to LLMVisionProvider
 *
 * The `media/vision/providers/LLMVisionProvider` class fills the same
 * role and already exists. This file re-exports it under the multimodal
 * module namespace so consumers importing from `rag/multimodal` can
 * access it without reaching into `media/vision/`. The underlying
 * implementation is identical — this is a convenience re-export plus
 * an alias type.
 *
 * @see {@link LLMVisionProvider} for the implementation.
 * @see {@link PipelineVisionProvider} for the full-pipeline alternative.
 * @see {@link IVisionProvider} for the interface contract.
 *
 * @example
 * ```typescript
 * import { LLMVisionAdapter } from './LLMVisionAdapter.js';
 *
 * const vision = new LLMVisionAdapter({
 *   provider: 'openai',
 *   model: 'gpt-4o',
 *   prompt: 'Describe this image for a RAG search index.',
 * });
 *
 * const indexer = new MultimodalIndexer({
 *   embeddingManager,
 *   vectorStore,
 *   visionProvider: vision,
 * });
 * ```
 */

// Re-export the existing LLMVisionProvider from media/vision so that
// consumers importing from the multimodal module don't need to reach
// into media/vision/ directly. The underlying class is unchanged.
export {
  LLMVisionProvider as LLMVisionAdapter,
  type LLMVisionProviderConfig as LLMVisionAdapterConfig,
} from '../../media/vision/providers/LLMVisionProvider.js';
