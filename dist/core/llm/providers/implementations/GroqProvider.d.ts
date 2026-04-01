/**
 * @fileoverview Implements the IProvider interface for Groq's LPU-accelerated inference.
 *
 * Groq exposes a fully OpenAI-compatible `/v1/chat/completions` API, so this
 * provider delegates all heavy lifting to the existing {@link OpenAIProvider}
 * by initializing it with Groq's base URL and API key. The thin wrapper
 * exists so that the AIModelProviderManager can identify Groq-specific
 * configuration (provider ID, default model catalog, etc.) without conflating
 * it with the user's OpenAI credentials.
 *
 * @module backend/agentos/core/llm/providers/implementations/GroqProvider
 * @implements {IProvider}
 */
import { IProvider, ChatMessage, ModelCompletionOptions, ModelCompletionResponse, ModelInfo, ProviderEmbeddingOptions, ProviderEmbeddingResponse } from '../IProvider';
/**
 * Configuration for the GroqProvider.
 *
 * @example
 * const config: GroqProviderConfig = {
 *   apiKey: process.env.GROQ_API_KEY!,
 *   defaultModelId: 'llama-3.3-70b-versatile',
 * };
 */
export interface GroqProviderConfig {
    /** Groq API key. Sourced from `GROQ_API_KEY`. */
    apiKey: string;
    /**
     * Base URL override.
     * @default "https://api.groq.com/openai/v1"
     */
    baseURL?: string;
    /**
     * Default model to use when none is specified.
     * @default "llama-3.3-70b-versatile"
     */
    defaultModelId?: string;
    /** Request timeout in milliseconds. @default 60000 */
    requestTimeout?: number;
}
/**
 * @class GroqProvider
 * @implements {IProvider}
 *
 * Thin wrapper around {@link OpenAIProvider} that targets Groq's
 * OpenAI-compatible API endpoint. All request/response handling is
 * delegated to the underlying OpenAI provider — only the base URL,
 * provider ID, and model catalog are Groq-specific.
 *
 * @example
 * const groq = new GroqProvider();
 * await groq.initialize({ apiKey: process.env.GROQ_API_KEY! });
 * const res = await groq.generateCompletion('llama-3.3-70b-versatile', messages, {});
 */
export declare class GroqProvider implements IProvider {
    /** @inheritdoc */
    readonly providerId: string;
    /** @inheritdoc */
    isInitialized: boolean;
    /** @inheritdoc */
    defaultModelId?: string;
    /**
     * Internal OpenAI provider instance that handles the actual API communication.
     * Groq's API is fully OpenAI-compatible, so we reuse the OpenAI transport layer.
     */
    private delegate;
    constructor();
    /**
     * Initializes the provider by configuring the underlying OpenAI delegate
     * with Groq's base URL and the caller's API key.
     *
     * @param {GroqProviderConfig} config - Groq-specific configuration.
     * @returns {Promise<void>}
     * @throws {Error} If the API key is missing.
     */
    initialize(config: GroqProviderConfig): Promise<void>;
    /** @inheritdoc */
    generateCompletion(modelId: string, messages: ChatMessage[], options: ModelCompletionOptions): Promise<ModelCompletionResponse>;
    /** @inheritdoc */
    generateCompletionStream(modelId: string, messages: ChatMessage[], options: ModelCompletionOptions): AsyncGenerator<ModelCompletionResponse, void, undefined>;
    /**
     * Groq does not currently offer an embeddings API.
     *
     * @throws {Error} Always — embeddings are not supported on Groq.
     */
    generateEmbeddings(_modelId: string, _texts: string[], _options?: ProviderEmbeddingOptions): Promise<ProviderEmbeddingResponse>;
    /**
     * Returns a static catalog of known Groq-hosted models.
     *
     * @param {{ capability?: string }} [filter] - Optional capability filter.
     * @returns {Promise<ModelInfo[]>} Groq model catalog.
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
//# sourceMappingURL=GroqProvider.d.ts.map