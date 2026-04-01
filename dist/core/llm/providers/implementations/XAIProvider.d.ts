/**
 * @fileoverview Implements the IProvider interface for xAI's Grok API.
 *
 * xAI exposes a fully OpenAI-compatible `/v1/chat/completions` endpoint at
 * `https://api.x.ai`. This provider delegates to the existing {@link OpenAIProvider}
 * with xAI's base URL and credentials, providing xAI-specific provider identity
 * and a curated catalog of Grok models.
 *
 * @module backend/agentos/core/llm/providers/implementations/XAIProvider
 * @implements {IProvider}
 */
import { IProvider, ChatMessage, ModelCompletionOptions, ModelCompletionResponse, ModelInfo, ProviderEmbeddingOptions, ProviderEmbeddingResponse } from '../IProvider';
/**
 * Configuration for the XAIProvider.
 *
 * @example
 * const config: XAIProviderConfig = {
 *   apiKey: process.env.XAI_API_KEY!,
 *   defaultModelId: 'grok-2',
 * };
 */
export interface XAIProviderConfig {
    /** xAI API key. Sourced from `XAI_API_KEY`. */
    apiKey: string;
    /**
     * Base URL override.
     * @default "https://api.x.ai/v1"
     */
    baseURL?: string;
    /**
     * Default model to use when none is specified.
     * @default "grok-2"
     */
    defaultModelId?: string;
    /** Request timeout in milliseconds. @default 60000 */
    requestTimeout?: number;
}
/**
 * @class XAIProvider
 * @implements {IProvider}
 *
 * Thin wrapper around {@link OpenAIProvider} that targets xAI's
 * OpenAI-compatible Grok API endpoint. xAI's Grok models are known for
 * wit, real-time knowledge, and strong reasoning capabilities.
 *
 * @example
 * const xai = new XAIProvider();
 * await xai.initialize({ apiKey: process.env.XAI_API_KEY! });
 * const res = await xai.generateCompletion('grok-2', messages, {});
 */
export declare class XAIProvider implements IProvider {
    /** @inheritdoc */
    readonly providerId: string;
    /** @inheritdoc */
    isInitialized: boolean;
    /** @inheritdoc */
    defaultModelId?: string;
    /**
     * Internal OpenAI provider instance that handles the actual API communication.
     * xAI's API is fully OpenAI-compatible, so we reuse the OpenAI transport layer.
     */
    private delegate;
    constructor();
    /**
     * Initializes the provider by configuring the underlying OpenAI delegate
     * with xAI's base URL and the caller's API key.
     *
     * @param {XAIProviderConfig} config - xAI-specific configuration.
     * @returns {Promise<void>}
     * @throws {Error} If the API key is missing.
     */
    initialize(config: XAIProviderConfig): Promise<void>;
    /** @inheritdoc */
    generateCompletion(modelId: string, messages: ChatMessage[], options: ModelCompletionOptions): Promise<ModelCompletionResponse>;
    /** @inheritdoc */
    generateCompletionStream(modelId: string, messages: ChatMessage[], options: ModelCompletionOptions): AsyncGenerator<ModelCompletionResponse, void, undefined>;
    /**
     * xAI does not currently offer an embeddings API.
     *
     * @throws {Error} Always — embeddings are not supported on xAI.
     */
    generateEmbeddings(_modelId: string, _texts: string[], _options?: ProviderEmbeddingOptions): Promise<ProviderEmbeddingResponse>;
    /**
     * Returns a static catalog of known xAI Grok models.
     *
     * @param {{ capability?: string }} [filter] - Optional capability filter.
     * @returns {Promise<ModelInfo[]>} xAI model catalog.
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
//# sourceMappingURL=XAIProvider.d.ts.map