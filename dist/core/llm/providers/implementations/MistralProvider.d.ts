/**
 * @fileoverview Implements the IProvider interface for Mistral AI's inference API.
 *
 * Mistral AI exposes a fully OpenAI-compatible `/v1/chat/completions` endpoint
 * at `https://api.mistral.ai`. This provider delegates to the existing
 * {@link OpenAIProvider} with Mistral's base URL and API key, providing
 * Mistral-specific provider identity and a curated model catalog.
 *
 * @module backend/agentos/core/llm/providers/implementations/MistralProvider
 * @implements {IProvider}
 */
import { IProvider, ChatMessage, ModelCompletionOptions, ModelCompletionResponse, ModelInfo, ProviderEmbeddingOptions, ProviderEmbeddingResponse } from '../IProvider';
/**
 * Configuration for the MistralProvider.
 *
 * @example
 * const config: MistralProviderConfig = {
 *   apiKey: process.env.MISTRAL_API_KEY!,
 *   defaultModelId: 'mistral-large-latest',
 * };
 */
export interface MistralProviderConfig {
    /** Mistral API key. Sourced from `MISTRAL_API_KEY`. */
    apiKey: string;
    /**
     * Base URL override.
     * @default "https://api.mistral.ai/v1"
     */
    baseURL?: string;
    /**
     * Default model to use when none is specified.
     * @default "mistral-large-latest"
     */
    defaultModelId?: string;
    /** Request timeout in milliseconds. @default 60000 */
    requestTimeout?: number;
}
/**
 * @class MistralProvider
 * @implements {IProvider}
 *
 * Thin wrapper around {@link OpenAIProvider} that targets Mistral AI's
 * OpenAI-compatible API endpoint. Mistral offers a range of proprietary
 * models known for strong multilingual capabilities and efficient inference.
 *
 * @example
 * const mistral = new MistralProvider();
 * await mistral.initialize({ apiKey: process.env.MISTRAL_API_KEY! });
 * const res = await mistral.generateCompletion('mistral-large-latest', messages, {});
 */
export declare class MistralProvider implements IProvider {
    /** @inheritdoc */
    readonly providerId: string;
    /** @inheritdoc */
    isInitialized: boolean;
    /** @inheritdoc */
    defaultModelId?: string;
    /**
     * Internal OpenAI provider instance that handles the actual API communication.
     * Mistral's API is fully OpenAI-compatible, so we reuse the OpenAI transport layer.
     */
    private delegate;
    constructor();
    /**
     * Initializes the provider by configuring the underlying OpenAI delegate
     * with Mistral's base URL and the caller's API key.
     *
     * @param {MistralProviderConfig} config - Mistral-specific configuration.
     * @returns {Promise<void>}
     * @throws {Error} If the API key is missing.
     */
    initialize(config: MistralProviderConfig): Promise<void>;
    /** @inheritdoc */
    generateCompletion(modelId: string, messages: ChatMessage[], options: ModelCompletionOptions): Promise<ModelCompletionResponse>;
    /** @inheritdoc */
    generateCompletionStream(modelId: string, messages: ChatMessage[], options: ModelCompletionOptions): AsyncGenerator<ModelCompletionResponse, void, undefined>;
    /**
     * Mistral offers an embeddings API via the OpenAI-compatible endpoint.
     *
     * @param {string} modelId - Embedding model ID (e.g., "mistral-embed").
     * @param {string[]} texts - Texts to embed.
     * @param {ProviderEmbeddingOptions} [options] - Embedding options.
     * @returns {Promise<ProviderEmbeddingResponse>} Embedding response.
     */
    generateEmbeddings(modelId: string, texts: string[], options?: ProviderEmbeddingOptions): Promise<ProviderEmbeddingResponse>;
    /**
     * Returns a static catalog of well-known Mistral models.
     *
     * @param {{ capability?: string }} [filter] - Optional capability filter.
     * @returns {Promise<ModelInfo[]>} Mistral model catalog.
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
//# sourceMappingURL=MistralProvider.d.ts.map