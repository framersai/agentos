/**
 * @fileoverview Implements the EmbeddingManager (`EmbeddingManager`), which is responsible
 * for generating vector embeddings for textual content. It adheres to the
 * `IEmbeddingManager` interface.
 *
 * This manager handles configurations for various embedding models, interacts with an
 * `AIModelProviderManager` to make calls to actual LLM providers, and supports
 * features like caching of embeddings and dynamic model selection based on configured strategies.
 * It uses the dedicated `generateEmbeddings` method from the `IProvider` interface for
 * making calls to embedding models.
 *
 * @module backend/agentos/rag/EmbeddingManager
 * @see ./IEmbeddingManager.ts for the interface definition.
 * @see ../config/EmbeddingManagerConfiguration.ts for configuration structures.
 * @see ../core/llm/providers/AIModelProviderManager.ts for provider management.
 * @see ../core/llm/providers/IProvider.ts for the provider contract.
 */
import { IEmbeddingManager, EmbeddingRequest, EmbeddingResponse } from './IEmbeddingManager';
import { EmbeddingManagerConfig, EmbeddingModelConfig } from '../core/config/EmbeddingManagerConfiguration';
import { AIModelProviderManager } from '../core/llm/providers/AIModelProviderManager';
/**
 * Implements the `IEmbeddingManager` interface to provide robust embedding generation services.
 *
 * @class EmbeddingManager
 * @implements {IEmbeddingManager}
 */
export declare class EmbeddingManager implements IEmbeddingManager {
    private config;
    private providerManager;
    private initialized;
    private availableModels;
    private defaultModel?;
    private cache?;
    /**
     * Constructs an EmbeddingManager instance.
     * The manager is not operational until `initialize` is called.
     */
    constructor();
    /**
     * @inheritdoc
     */
    initialize(config: EmbeddingManagerConfig, providerManager: AIModelProviderManager): Promise<void>;
    /**
     * Ensures that the manager has been initialized.
     * @private
     * @throws {GMIError} If not initialized.
     */
    private ensureInitialized;
    /**
     * Selects an embedding model based on the request and configured strategy.
     * @private
     * @param {EmbeddingRequest} request - The embedding request.
     * @returns {EmbeddingModelConfig} The selected model configuration.
     * @throws {GMIError} If no suitable model can be selected.
     */
    private selectModel;
    /**
     * @inheritdoc
     */
    generateEmbeddings(request: EmbeddingRequest): Promise<EmbeddingResponse>;
    /**
     * @inheritdoc
     */
    getEmbeddingModelInfo(modelId?: string): Promise<EmbeddingModelConfig | undefined>;
    /**
     * @inheritdoc
     */
    getEmbeddingDimension(modelId?: string): Promise<number>;
    /**
     * @inheritdoc
     */
    checkHealth(): Promise<{
        isHealthy: boolean;
        details?: any;
    }>;
    /**
     * @inheritdoc
     */
    shutdown(): Promise<void>;
}
//# sourceMappingURL=EmbeddingManager.d.ts.map