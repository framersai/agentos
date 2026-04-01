/**
 * @module rag/multimodal/createMultimodalIndexerFromResolver
 *
 * Factory function that creates a fully-wired {@link MultimodalIndexer}
 * using the voice pipeline's {@link SpeechProviderResolver} for STT and
 * the vision pipeline for image understanding.
 *
 * ## Why use this factory
 *
 * When both the voice pipeline and the multimodal RAG pipeline need STT
 * (or vision), you want them to share the same providers rather than
 * configuring each independently. This factory resolves the best available
 * providers from the speech resolver and vision pipeline, wires them into
 * a new multimodal indexer with the appropriate adapters, and returns
 * the ready-to-use instance.
 *
 * ## Provider resolution
 *
 * - **STT**: Calls `resolver.resolveSTT()` and wraps the result in a
 *   {@link SpeechProviderAdapter}. If resolution fails (no configured STT
 *   provider), audio indexing is gracefully disabled — the indexer will
 *   throw only when `indexAudio()` is actually called.
 *
 * - **Vision**: When a `VisionPipeline` is provided, it is wrapped in a
 *   `PipelineVisionProvider`. Otherwise vision is left unconfigured.
 *   Callers can also pass a pre-built `IVisionProvider` for custom setups.
 *
 * @see {@link SpeechProviderAdapter} for the STT bridge.
 * See `PipelineVisionProvider` for the vision bridge.
 * @see {@link MultimodalIndexer} for the indexer itself.
 *
 * @example
 * ```typescript
 * import { SpeechProviderResolver } from '../../speech/SpeechProviderResolver.js';
 * import { createVisionPipeline } from '../../vision/index.js';
 * import { createMultimodalIndexerFromResolver } from './createMultimodalIndexerFromResolver.js';
 *
 * const resolver = new SpeechProviderResolver(config, process.env);
 * await resolver.refresh();
 *
 * const visionPipeline = await createVisionPipeline({ strategy: 'progressive' });
 *
 * const indexer = createMultimodalIndexerFromResolver({
 *   resolver,
 *   visionPipeline,
 *   embeddingManager,
 *   vectorStore,
 * });
 *
 * // Now the indexer shares STT with the voice pipeline
 * await indexer.indexAudio({ audio: wavBuffer, language: 'en' });
 * ```
 */
import { MultimodalIndexer } from './MultimodalIndexer.js';
import { SpeechProviderAdapter } from './SpeechProviderAdapter.js';
import { PipelineVisionProvider } from '../../vision/providers/PipelineVisionProvider.js';
// ---------------------------------------------------------------------------
// Factory function
// ---------------------------------------------------------------------------
/**
 * Create a {@link MultimodalIndexer} that reuses providers from the
 * voice pipeline's `SpeechProviderResolver` and an optional
 * `VisionPipeline`.
 *
 * This is the recommended way to instantiate a multimodal indexer in
 * applications that also use the voice pipeline — it ensures both
 * subsystems share the same STT and vision providers instead of
 * requiring separate configuration.
 *
 * ## Error handling
 *
 * - If the resolver has no configured STT provider, `resolveSTT()` will
 *   throw. This function catches that error and simply leaves the STT
 *   slot empty — audio indexing will throw at call time, not at
 *   construction time. This makes the factory safe to call even when
 *   STT is not configured.
 *
 * - If neither `visionPipeline` nor `visionProvider` is provided, image
 *   indexing will throw at call time.
 *
 * @param opts - Factory options including resolver, pipeline, and
 *   required embedding/vector store dependencies.
 * @returns A configured `MultimodalIndexer` instance.
 *
 * @throws {Error} If `embeddingManager` or `vectorStore` is missing
 *   (propagated from `MultimodalIndexer` constructor).
 *
 * @example
 * ```typescript
 * // Full setup: shared STT + vision
 * const indexer = createMultimodalIndexerFromResolver({
 *   resolver: speechResolver,
 *   visionPipeline: pipeline,
 *   embeddingManager,
 *   vectorStore,
 * });
 *
 * // Vision-only (no audio indexing)
 * const visionIndexer = createMultimodalIndexerFromResolver({
 *   visionPipeline: pipeline,
 *   embeddingManager,
 *   vectorStore,
 * });
 *
 * // STT-only (no image indexing)
 * const audioIndexer = createMultimodalIndexerFromResolver({
 *   resolver: speechResolver,
 *   embeddingManager,
 *   vectorStore,
 * });
 * ```
 */
export function createMultimodalIndexerFromResolver(opts) {
    // ---------------------------------------------------------------------------
    // Resolve STT provider from the speech resolver
    // ---------------------------------------------------------------------------
    let sttProvider;
    if (opts.resolver) {
        try {
            const speechSTT = opts.resolver.resolveSTT();
            sttProvider = new SpeechProviderAdapter(speechSTT);
        }
        catch {
            // No configured STT provider — audio indexing will be unavailable.
            // This is not an error at construction time because the caller may
            // only intend to index images or text.
        }
    }
    // ---------------------------------------------------------------------------
    // Resolve vision provider from pipeline or direct provider
    // ---------------------------------------------------------------------------
    let visionProvider;
    if (opts.visionPipeline) {
        // Full pipeline wrapping gives the indexer progressive OCR + cloud fallback.
        visionProvider = new PipelineVisionProvider(opts.visionPipeline);
    }
    else if (opts.visionProvider) {
        // Caller-supplied provider (LLMVisionProvider, custom impl, etc.)
        visionProvider = opts.visionProvider;
    }
    // ---------------------------------------------------------------------------
    // Build the indexer
    // ---------------------------------------------------------------------------
    return new MultimodalIndexer({
        embeddingManager: opts.embeddingManager,
        vectorStore: opts.vectorStore,
        visionProvider,
        sttProvider,
        config: opts.config,
    });
}
//# sourceMappingURL=createMultimodalIndexerFromResolver.js.map