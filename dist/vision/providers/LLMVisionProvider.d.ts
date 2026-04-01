/**
 * @module vision/providers/LLMVisionProvider
 *
 * Implements the {@link IVisionProvider} interface by wrapping the
 * `generateText()` high-level API with a multimodal image message.
 *
 * Works with any vision-capable LLM provider — GPT-4o, Claude,
 * Gemini, Ollama + LLaVA, OpenRouter, etc. The provider and model
 * are specified at construction time and used for every call.
 *
 * This is the simplest way to add vision to the multimodal indexer
 * without the full OCR + embedding pipeline. For the full progressive
 * pipeline, see {@link PipelineVisionProvider}.
 *
 * @see {@link IVisionProvider} for the interface contract.
 * @see {@link PipelineVisionProvider} for the full-pipeline wrapper.
 * @see {@link VisionPipeline} for the underlying pipeline engine.
 *
 * @example
 * ```typescript
 * import { LLMVisionProvider } from '../../vision';
 *
 * const vision = new LLMVisionProvider({
 *   provider: 'openai',
 *   model: 'gpt-4o',
 * });
 *
 * const description = await vision.describeImage(imageUrl);
 * ```
 */
import type { IVisionProvider } from '../../rag/multimodal/types.js';
/**
 * Configuration for the LLM vision provider.
 *
 * @example
 * ```typescript
 * const config: LLMVisionProviderConfig = {
 *   provider: 'openai',
 *   model: 'gpt-4o',
 *   prompt: 'Describe this image for a search index.',
 *   apiKey: process.env.OPENAI_API_KEY,
 * };
 * ```
 */
export interface LLMVisionProviderConfig {
    /**
     * LLM provider name (e.g. 'openai', 'anthropic', 'google', 'ollama').
     * Must be resolvable by the `generateText()` API.
     */
    provider: string;
    /**
     * Model identifier. When omitted, the provider's default vision model
     * is used.
     * @example 'gpt-4o', 'claude-sonnet-4-20250514', 'gemini-2.0-flash'
     */
    model?: string;
    /**
     * Custom prompt for image description. When omitted, a default prompt
     * optimized for search indexing is used.
     */
    prompt?: string;
    /**
     * Override the API key instead of reading from environment variables.
     * Useful for multi-tenant setups where each user has their own key.
     */
    apiKey?: string;
    /**
     * Override the provider base URL (e.g. for Ollama or local proxies).
     */
    baseUrl?: string;
}
/**
 * Vision provider that delegates to a cloud LLM via `generateText()`.
 *
 * Satisfies the narrow {@link IVisionProvider} contract used by the
 * {@link MultimodalIndexer}, allowing any vision-capable LLM to serve
 * as the image description backend.
 *
 * @example
 * ```typescript
 * const provider = new LLMVisionProvider({ provider: 'openai' });
 * const indexer = new MultimodalIndexer({
 *   embeddingManager,
 *   vectorStore,
 *   visionProvider: provider,
 * });
 * ```
 */
export declare class LLMVisionProvider implements IVisionProvider {
    /** Resolved configuration. */
    private readonly _config;
    /** Description prompt. */
    private readonly _prompt;
    /**
     * Create a new LLM vision provider.
     *
     * @param config - Provider configuration specifying which LLM to use.
     *
     * @throws {Error} If `config.provider` is not specified.
     *
     * @example
     * ```typescript
     * const provider = new LLMVisionProvider({
     *   provider: 'anthropic',
     *   model: 'claude-sonnet-4-20250514',
     * });
     * ```
     */
    constructor(config: LLMVisionProviderConfig);
    /**
     * Generate a text description of the provided image using a cloud
     * vision LLM.
     *
     * The image is sent as a base64 data URL in a multimodal message
     * to the configured provider. The LLM's response is returned as-is.
     *
     * @param image - Image as a URL string (https://...) or base64 data URL
     *   (data:image/png;base64,...).
     * @returns Detailed text description of the image content.
     *
     * @throws {Error} If the LLM call fails.
     * @throws {Error} If the LLM returns an empty response.
     *
     * @example
     * ```typescript
     * const description = await provider.describeImage(
     *   'data:image/png;base64,iVBORw0KGgoAAAA...'
     * );
     * console.log(description);
     * // "A golden retriever playing fetch on a sandy beach..."
     * ```
     */
    describeImage(image: string): Promise<string>;
}
//# sourceMappingURL=LLMVisionProvider.d.ts.map