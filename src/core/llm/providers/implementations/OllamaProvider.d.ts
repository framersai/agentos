import { IProvider, ChatMessage, ModelCompletionOptions, ModelCompletionResponse, ModelInfo, ProviderEmbeddingOptions, ProviderEmbeddingResponse } from '../IProvider';
/**
 * Configuration specific to the OllamaProvider.
 */
export interface OllamaProviderConfig {
    /**
     * The base URL of the Ollama API.
     * @example "http://localhost:11434" (Ollama's default)
     */
    baseURL: string;
    /**
     * Default model ID to use if not specified in a request (e.g., "llama3:latest").
     * This model must be available in the connected Ollama instance.
     */
    defaultModelId?: string;
    /**
     * Timeout for API requests to Ollama in milliseconds.
     * @default 60000 (60 seconds)
     */
    requestTimeout?: number;
    /**
     * Optional API key if the Ollama instance is secured (not common for local instances).
     * Currently, Ollama itself does not use API keys for authentication.
     */
    apiKey?: string;
}
/**
 * @class OllamaProvider
 * @implements {IProvider}
 * Provides an interface to locally hosted LLMs through an Ollama instance.
 * It handles API requests for chat completions, streaming, embeddings, and model listing.
 */
export declare class OllamaProvider implements IProvider {
    /** @inheritdoc */
    readonly providerId: string;
    /** @inheritdoc */
    isInitialized: boolean;
    /** @inheritdoc */
    defaultModelId?: string;
    private config;
    private client;
    /**
     * Creates an instance of OllamaProvider.
     * The provider must be initialized using `initialize()` before use.
     */
    constructor();
    /** @inheritdoc */
    initialize(config: OllamaProviderConfig): Promise<void>;
    /**
     * Ensures the provider is initialized.
     * @private
     * @throws {OllamaProviderError} If not initialized.
     */
    private ensureInitialized;
    /**
     * Transforms standard ChatMessage array to Ollama's expected format.
     * @private
     */
    private mapToOllamaMessages;
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
        _details?: unknown;
    }>;
    /** @inheritdoc */
    shutdown(): Promise<void>;
}
//# sourceMappingURL=OllamaProvider.d.ts.map