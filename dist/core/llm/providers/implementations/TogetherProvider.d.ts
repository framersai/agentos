/**
 * @fileoverview Implements the IProvider interface for Together AI's inference API.
 *
 * Together AI exposes a fully OpenAI-compatible `/v1/chat/completions` endpoint,
 * so this provider delegates to the existing {@link OpenAIProvider} with Together's
 * base URL and credentials. The wrapper provides Together-specific provider ID,
 * default model catalog, and configuration.
 *
 * @module backend/agentos/core/llm/providers/implementations/TogetherProvider
 * @implements {IProvider}
 */
import { IProvider, ChatMessage, ModelCompletionOptions, ModelCompletionResponse, ModelInfo, ProviderEmbeddingOptions, ProviderEmbeddingResponse } from '../IProvider';
/**
 * Configuration for the TogetherProvider.
 *
 * @example
 * const config: TogetherProviderConfig = {
 *   apiKey: process.env.TOGETHER_API_KEY!,
 *   defaultModelId: 'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo',
 * };
 */
export interface TogetherProviderConfig {
    /** Together API key. Sourced from `TOGETHER_API_KEY`. */
    apiKey: string;
    /**
     * Base URL override.
     * @default "https://api.together.xyz/v1"
     */
    baseURL?: string;
    /**
     * Default model to use when none is specified.
     * @default "meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo"
     */
    defaultModelId?: string;
    /** Request timeout in milliseconds. @default 60000 */
    requestTimeout?: number;
}
/**
 * @class TogetherProvider
 * @implements {IProvider}
 *
 * Thin wrapper around {@link OpenAIProvider} that targets Together AI's
 * OpenAI-compatible API endpoint. Together hosts a wide range of open-source
 * models (Llama, Mixtral, etc.) with competitive pricing and fast inference.
 *
 * @example
 * const together = new TogetherProvider();
 * await together.initialize({ apiKey: process.env.TOGETHER_API_KEY! });
 * const res = await together.generateCompletion(
 *   'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo', messages, {},
 * );
 */
export declare class TogetherProvider implements IProvider {
    /** @inheritdoc */
    readonly providerId: string;
    /** @inheritdoc */
    isInitialized: boolean;
    /** @inheritdoc */
    defaultModelId?: string;
    /**
     * Internal OpenAI provider instance that handles the actual API communication.
     * Together's API is fully OpenAI-compatible, so we reuse the OpenAI transport layer.
     */
    private delegate;
    constructor();
    /**
     * Initializes the provider by configuring the underlying OpenAI delegate
     * with Together's base URL and the caller's API key.
     *
     * @param {TogetherProviderConfig} config - Together-specific configuration.
     * @returns {Promise<void>}
     * @throws {Error} If the API key is missing.
     */
    initialize(config: TogetherProviderConfig): Promise<void>;
    /** @inheritdoc */
    generateCompletion(modelId: string, messages: ChatMessage[], options: ModelCompletionOptions): Promise<ModelCompletionResponse>;
    /** @inheritdoc */
    generateCompletionStream(modelId: string, messages: ChatMessage[], options: ModelCompletionOptions): AsyncGenerator<ModelCompletionResponse, void, undefined>;
    /**
     * Together AI supports embeddings for some models, delegated to the OpenAI-compatible endpoint.
     *
     * @param {string} modelId - Embedding model ID.
     * @param {string[]} texts - Texts to embed.
     * @param {ProviderEmbeddingOptions} [options] - Embedding options.
     * @returns {Promise<ProviderEmbeddingResponse>} Embedding response.
     */
    generateEmbeddings(modelId: string, texts: string[], options?: ProviderEmbeddingOptions): Promise<ProviderEmbeddingResponse>;
    /**
     * Returns a static catalog of well-known Together-hosted models.
     *
     * @param {{ capability?: string }} [filter] - Optional capability filter.
     * @returns {Promise<ModelInfo[]>} Together model catalog.
     */
    listAvailableModels(filter?: {
        capability?: string;
    }): Promise<ModelInfo[]>;
    /** @inheritdoc */
    getModelInfo(modelId: string): Promise<ModelInfo | undefined>;
    /** @inheritdoc */
    checkHealth(): Promise<{
        isHealthy: boolean;
        details?: unknown;
    }>;
    /** @inheritdoc */
    shutdown(): Promise<void>;
}
//# sourceMappingURL=TogetherProvider.d.ts.map