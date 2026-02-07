/**
 * @fileoverview Implements the IProvider interface for OpenRouter, a service that
 * provides access to a wide variety of LLMs from different providers through a unified API.
 * This provider handles routing requests to the specified models via OpenRouter.
 * @module backend/agentos/core/llm/providers/implementations/OpenRouterProvider
 * @implements {IProvider}
 */
import { IProvider, ChatMessage, ModelCompletionOptions, ModelCompletionResponse, ModelInfo, ProviderEmbeddingOptions, ProviderEmbeddingResponse } from '../IProvider';
/**
 * Configuration specific to the OpenRouterProvider.
 */
export interface OpenRouterProviderConfig {
    apiKey: string;
    baseURL?: string;
    defaultModelId?: string;
    siteUrl?: string;
    appName?: string;
    requestTimeout?: number;
    streamRequestTimeout?: number;
}
export declare class OpenRouterProvider implements IProvider {
    readonly providerId: string;
    isInitialized: boolean;
    defaultModelId?: string;
    private config;
    private client;
    private readonly availableModelsCache;
    constructor();
    initialize(config: OpenRouterProviderConfig): Promise<void>;
    private refreshAvailableModels;
    private mapApiToModelInfo;
    private ensureInitialized;
    private mapToOpenRouterMessages;
    generateCompletion(modelId: string, messages: ChatMessage[], options: ModelCompletionOptions): Promise<ModelCompletionResponse>;
    generateCompletionStream(modelId: string, messages: ChatMessage[], options: ModelCompletionOptions): AsyncGenerator<ModelCompletionResponse, void, undefined>;
    generateEmbeddings(modelId: string, texts: string[], options?: ProviderEmbeddingOptions): Promise<ProviderEmbeddingResponse>;
    listAvailableModels(filter?: {
        capability?: string;
    }): Promise<ModelInfo[]>;
    getModelInfo(modelId: string): Promise<ModelInfo | undefined>;
    checkHealth(): Promise<{
        isHealthy: boolean;
        details?: unknown;
    }>;
    shutdown(): Promise<void>;
    private mapApiToCompletionResponse;
    private mapApiToStreamChunkResponse;
    private makeApiRequest;
    private parseSseStream;
}
//# sourceMappingURL=OpenRouterProvider.d.ts.map