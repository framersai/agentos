/**
 * @fileoverview Manages different AI Model Provider instances.
 * It loads, configures, and provides access to them, enabling a provider-agnostic
 * approach to model usage within AgentOS. This manager acts as a central registry
 * and factory for IProvider implementations.
 *
 * Key Responsibilities:
 * - Dynamically loading and initializing configured provider instances (e.g., OpenAI, OpenRouter, Ollama).
 * - Providing a unified interface to access specific providers or the default provider.
 * - Mapping model IDs to their respective providers, especially for prefixed model IDs (e.g., "openai/gpt-4o").
 * - Caching and serving lists of all available models across all configured and enabled providers.
 * - Offering methods to retrieve detailed information (`ModelInfo`) for specific models.
 *
 * This class is crucial for decoupling the core AgentOS logic from concrete LLM provider implementations,
 * allowing for flexibility and easier integration of new providers.
 *
 * @module backend/agentos/core/llm/providers/AIModelProviderManager
 */
import { IProvider, ModelInfo } from './IProvider';
import { OpenAIProviderConfig } from './implementations/OpenAIProvider';
import { OpenRouterProviderConfig } from './implementations/OpenRouterProvider';
import { OllamaProviderConfig } from './implementations/OllamaProvider';
/**
 * Configuration for a single AI model provider entry within the manager.
 * @interface ProviderConfigEntry
 */
export interface ProviderConfigEntry {
    providerId: string;
    enabled: boolean;
    config: Partial<OpenAIProviderConfig | OpenRouterProviderConfig | OllamaProviderConfig | Record<string, any>>;
    isDefault?: boolean;
}
/**
 * Configuration for the AIModelProviderManager itself.
 * @interface AIModelProviderManagerConfig
 */
export interface AIModelProviderManagerConfig {
    providers: ProviderConfigEntry[];
}
/**
 * @class AIModelProviderManager
 * @description Manages and provides access to various configured AI model provider instances (`IProvider`).
 */
export declare class AIModelProviderManager {
    private readonly providers;
    private defaultProviderId?;
    private readonly modelToProviderMap;
    private allModelsCache;
    isInitialized: boolean;
    constructor();
    /**
     * Ensures the manager has been properly initialized before any operations.
     * @private
     * @throws {GMIError} If the manager is not initialized.
     */
    private ensureInitialized;
    initialize(config: AIModelProviderManagerConfig): Promise<void>;
    private cacheModelsFromProvider;
    getProvider(providerId: string): IProvider | undefined;
    getDefaultProvider(): IProvider | undefined;
    getProviderForModel(modelId: string): IProvider | undefined;
    listAllAvailableModels(): Promise<ModelInfo[]>;
    getModelInfo(modelId: string, providerId?: string): Promise<ModelInfo | undefined>;
    checkOverallHealth(): Promise<{
        isOverallHealthy: boolean;
        providerDetails: Array<{
            providerId: string;
            isHealthy: boolean;
            details?: any;
        }>;
    }>;
    shutdown(): Promise<void>;
}
//# sourceMappingURL=AIModelProviderManager.d.ts.map