/**
 * @fileoverview Implements the IProvider interface for OpenAI's GPT models.
 * This provider offers comprehensive integration with OpenAI's API, including:
 * - Chat completions (streaming and non-streaming)
 * - Tool/function calling
 * - Vision capabilities for multimodal models (e.g., GPT-4o)
 * - Text embeddings generation
 * - Model introspection and health checks.
 *
 * It is designed with robustness and extensibility in mind, featuring:
 * - Detailed error handling using custom `OpenAIProviderError`.
 * - API key management with support for system-wide and per-request overrides.
 * - Configurable request retries with exponential backoff.
 * - Rate limiting (conceptual, actual enforcement by OpenAI).
 * - Comprehensive JSDoc documentation.
 * - Adherence to TypeScript best practices and modern ECMAScript features.
 *
 * @module backend/agentos/core/llm/providers/implementations/OpenAIProvider
 * @implements {IProvider}
 */
import { IProvider, ChatMessage, ModelCompletionOptions, ModelCompletionResponse, ModelInfo, ProviderEmbeddingOptions, ProviderEmbeddingResponse } from '../IProvider';
/**
 * Configuration specific to the OpenAIProvider.
 */
export interface OpenAIProviderConfig {
    /** The API key for accessing OpenAI services. Can be overridden by `apiKeyOverride` in request options. */
    apiKey: string;
    /** Base URL for the OpenAI API. Defaults to "https://api.openai.com/v1". Useful for proxies. */
    baseURL?: string;
    /** Default OpenAI organization ID to use for requests. */
    organizationId?: string;
    /** Maximum number of retry attempts for failed API requests. Defaults to 3. */
    maxRetries?: number;
    /** Timeout for API requests in milliseconds. Defaults to 60000 (60 seconds). */
    requestTimeout?: number;
    /** Optional custom headers to include with all requests to the OpenAI API. */
    customHeaders?: Record<string, string>;
    /** Default model ID to use if not specified in a request. E.g., "gpt-4o-mini". */
    defaultModelId?: string;
}
/**
 * @class OpenAIProvider
 * @implements {IProvider}
 * Provides an interface to OpenAI's suite of models (GPT, Embeddings).
 * It handles API requests, streaming, error management, and model information.
 */
export declare class OpenAIProvider implements IProvider {
    /** @inheritdoc */
    readonly providerId: string;
    /** @inheritdoc */
    isInitialized: boolean;
    /** @inheritdoc */
    defaultModelId?: string;
    private config;
    private availableModelsCache;
    private readonly modelPricing;
    /**
     * Creates an instance of OpenAIProvider.
     * Note: The provider is not ready to use until `initialize()` is called and resolves.
     */
    constructor();
    /** @inheritdoc */
    initialize(config: OpenAIProviderConfig): Promise<void>;
    /**
     * Fetches the list of available models from OpenAI and updates the internal cache.
     * @private
     * @throws {OpenAIProviderError} If fetching or parsing models fails.
     */
    private refreshAvailableModels;
    /**
     * Maps an OpenAI API model object to the standard ModelInfo interface.
     * @private
     * @param {OpenAIAPITypes.ModelAPIObject} apiModel - The model object from OpenAI API.
     * @returns {ModelInfo} The standardized ModelInfo object.
     */
    private mapApiToModelInfo;
    /**
     * Ensures the provider is initialized before use.
     * @private
     * @throws {OpenAIProviderError} If not initialized.
     */
    private ensureInitialized;
    /**
     * Resolves the API key to use for a request, prioritizing per-request override, then user-specific, then system default.
     * @private
     * @param {string | undefined} apiKeyOverride - API key provided directly in request options.
     * @returns {string} The API key to use.
     * @throws {OpenAIProviderError} If no API key is available.
     */
    private getApiKey;
    /** @inheritdoc */
    generateCompletion(modelId: string, messages: ChatMessage[], options: ModelCompletionOptions): Promise<ModelCompletionResponse>;
    /** @inheritdoc */
    generateCompletionStream(modelId: string, messages: ChatMessage[], options: ModelCompletionOptions): AsyncGenerator<ModelCompletionResponse, void, undefined>;
    /** @inheritdoc */
    generateEmbeddings(modelId: string, texts: string[], options?: ProviderEmbeddingOptions): Promise<ProviderEmbeddingResponse>;
    /** @inheritdoc */
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
    /**
     * Builds the payload for OpenAI's Chat Completions API.
     * @private
     */
    private buildChatCompletionPayload;
    /**
     * Maps the raw OpenAI API Chat Completion response to the standard ModelCompletionResponse.
     * @private
     */
    private mapApiToCompletionResponse;
    /**
     * Maps an OpenAI API stream chunk to a ModelCompletionResponse chunk.
     * Handles accumulation of tool calls.
     * @private
     */
    private mapApiToStreamChunkResponse;
    /**
     * Maps the raw OpenAI API Embedding response to the standard ProviderEmbeddingResponse.
     * @private
     */
    private mapApiToEmbeddingResponse;
    /**
     * Calculates token usage and cost.
     * @private
     */
    private calculateUsage;
    /**
     * Calculates the estimated cost of an API call.
     * @private
     */
    private calculateCost;
    /**
     * Makes an API request to OpenAI with error handling and retries.
     * @private
     * @template T The expected response type.
     * @param {string} endpoint - The API endpoint (e.g., "/chat/completions").
     * @param {'GET' | 'POST'} method - HTTP method.
     * @param {string} apiKey - The API key to use.
     * @param {Record<string, unknown>} [body] - The request body for POST requests.
     * @param {boolean} [expectStream] - Whether the response is expected to be a stream.
     * @returns {Promise<T | ReadableStream<Uint8Array>>} The API response or stream.
     * @throws {OpenAIProviderError} If the request fails after retries or for non-retryable errors.
     */
    private makeApiRequest;
    /**
     * Parses an SSE (Server-Sent Events) stream.
     * @private
     */
    private parseSseStream;
}
//# sourceMappingURL=OpenAIProvider.d.ts.map