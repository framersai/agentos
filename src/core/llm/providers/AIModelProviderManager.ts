// File: backend/agentos/core/llm/providers/AIModelProviderManager.ts
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
import { OpenAIProvider, OpenAIProviderConfig } from './implementations/OpenAIProvider';
import { OpenRouterProvider, OpenRouterProviderConfig } from './implementations/OpenRouterProvider';
import { OllamaProvider, OllamaProviderConfig } from './implementations/OllamaProvider';
import { GMIError, GMIErrorCode, createGMIErrorFromError } from '@agentos/core/utils/errors'; // Corrected import path

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
export class AIModelProviderManager {
  private readonly providers: Map<string, IProvider> = new Map();
  private defaultProviderId?: string;
  private readonly modelToProviderMap: Map<string, string> = new Map();
  private allModelsCache: ModelInfo[] | null = null;
  public isInitialized: boolean = false;

  constructor() {}

  /**
   * Ensures the manager has been properly initialized before any operations.
   * @private
   * @throws {GMIError} If the manager is not initialized.
   */
  private ensureInitialized(): void {
    if (!this.isInitialized) {
      throw new GMIError(
        'AIModelProviderManager is not initialized. Call initialize() first.',
        GMIErrorCode.NOT_INITIALIZED,
        undefined,
        'AIModelProviderManager'
      );
    }
  }


  public async initialize(config: AIModelProviderManagerConfig): Promise<void> {
    if (this.isInitialized) {
      console.warn("AIModelProviderManager: Manager is already initialized. Re-initializing will reset providers.");
      this.providers.clear();
      this.modelToProviderMap.clear();
      this.allModelsCache = null;
      this.defaultProviderId = undefined;
    }

    if (!config || !Array.isArray(config.providers)) {
      console.warn("AIModelProviderManager: No providers configured or configuration is invalid. Manager will be empty.");
      this.isInitialized = true;
      return;
    }

    for (const providerEntry of config.providers) {
      if (!providerEntry.enabled) {
        console.log(`AIModelProviderManager: Provider '${providerEntry.providerId}' is disabled. Skipping.`);
        continue;
      }

      let providerInstance: IProvider | undefined;
      try {
        switch (providerEntry.providerId.toLowerCase()) {
          case 'openai':
            providerInstance = new OpenAIProvider();
            break;
          case 'openrouter':
            providerInstance = new OpenRouterProvider();
            break;
          case 'ollama':
            providerInstance = new OllamaProvider();
            break;
          default:
            console.warn(`AIModelProviderManager: Unknown provider ID '${providerEntry.providerId}'. Skipping.`);
            continue;
        }

        await providerInstance.initialize(providerEntry.config || {});
        this.providers.set(providerInstance.providerId, providerInstance);
        console.log(`AIModelProviderManager: Initialized provider '${providerInstance.providerId}'.`);

        if (providerEntry.isDefault && !this.defaultProviderId) {
          this.defaultProviderId = providerInstance.providerId;
        }

        await this.cacheModelsFromProvider(providerInstance);

      } catch (error: unknown) {
        const gmiError = createGMIErrorFromError( // Using the imported function
          error, // Pass the original error
          GMIErrorCode.LLM_PROVIDER_ERROR,
          { providerId: providerEntry.providerId },
          `Failed to initialize provider '${providerEntry.providerId}'`
        );
        console.error(gmiError.message, gmiError.details);
      }
    }

    if (!this.defaultProviderId && this.providers.size > 0) {
      this.defaultProviderId = this.providers.keys().next().value;
    }

    if (this.defaultProviderId) {
      console.log(`AIModelProviderManager: Default provider set to '${this.defaultProviderId}'.`);
    } else if (config.providers.some(p => p.enabled)) {
      console.warn("AIModelProviderManager: No default provider could be set.");
    } else {
      console.log("AIModelProviderManager: No providers enabled or configured.");
    }
    this.isInitialized = true;
    console.log(`AIModelProviderManager initialized with ${this.providers.size} active providers.`);
  }

  private async cacheModelsFromProvider(provider: IProvider): Promise<void> {
    if (provider.isInitialized && typeof provider.listAvailableModels === 'function') {
      try {
        const models = await provider.listAvailableModels();
        models.forEach(model => {
          if (!this.modelToProviderMap.has(model.modelId)) {
            this.modelToProviderMap.set(model.modelId, provider.providerId);
          }
        });
        this.allModelsCache = null;
      } catch (error: unknown) {
        const gmiError = createGMIErrorFromError( // Using the imported function
          error,
          GMIErrorCode.LLM_PROVIDER_ERROR,
          { providerId: provider.providerId },
          `Error caching models from provider '${provider.providerId}'`
        );
        console.error(gmiError.message, gmiError.details);
      }
    }
  }

  public getProvider(providerId: string): IProvider | undefined {
    this.ensureInitialized(); // Corrected: using ensureInitialized
    const provider = this.providers.get(providerId);
    return provider?.isInitialized ? provider : undefined;
  }

  public getDefaultProvider(): IProvider | undefined {
    this.ensureInitialized(); // Corrected: using ensureInitialized
    return this.defaultProviderId ? this.getProvider(this.defaultProviderId) : undefined;
  }

  public getProviderForModel(modelId: string): IProvider | undefined {
    this.ensureInitialized(); // Corrected: using ensureInitialized
    const mappedProviderId = this.modelToProviderMap.get(modelId);
    if (mappedProviderId) {
      const provider = this.getProvider(mappedProviderId);
      if (provider) return provider;
    }

    for (const provider of this.providers.values()) {
      if (provider.isInitialized && provider.defaultModelId === modelId) {
        return provider;
      }
    }
    
    if (modelId.includes('/')) {
      const prefix = modelId.split('/')[0];
      const providerByPrefix = this.getProvider(prefix);
      if (providerByPrefix) return providerByPrefix;
    }

    console.warn(`AIModelProviderManager: Could not determine a specific provider for model '${modelId}'. Falling back to default provider if available.`);
    return this.getDefaultProvider();
  }

  public async listAllAvailableModels(): Promise<ModelInfo[]> {
    this.ensureInitialized(); // Corrected: using ensureInitialized
    if (this.allModelsCache) {
      return [...this.allModelsCache];
    }

    let allModels: ModelInfo[] = [];
    const promises: Promise<ModelInfo[]>[] = [];

    for (const provider of this.providers.values()) {
      if (provider.isInitialized && typeof provider.listAvailableModels === 'function') {
        promises.push(
          provider.listAvailableModels().then(models => 
            models.map(m => ({ ...m, providerId: provider.providerId }))
          ).catch(error => {
            console.error(`AIModelProviderManager: Failed to list models from provider '${provider.providerId}':`, error);
            return [];
          })
        );
      }
    }
    
    const results = await Promise.allSettled(promises);
    results.forEach(result => {
      if (result.status === 'fulfilled') {
        allModels = allModels.concat(result.value);
      }
    });

    const uniqueModelsMap = new Map<string, ModelInfo>();
    for (const model of allModels) {
      if (!uniqueModelsMap.has(model.modelId)) {
        uniqueModelsMap.set(model.modelId, model);
      }
    }
    this.allModelsCache = Array.from(uniqueModelsMap.values());
    return [...this.allModelsCache];
  }

  public async getModelInfo(modelId: string, providerId?: string): Promise<ModelInfo | undefined> {
    this.ensureInitialized(); // Corrected: using ensureInitialized
    let targetProvider: IProvider | undefined;

    if (providerId) {
      targetProvider = this.getProvider(providerId);
    } else {
      targetProvider = this.getProviderForModel(modelId);
    }
    
    if (targetProvider && typeof targetProvider.getModelInfo === 'function') {
      try {
        const modelInfo = await targetProvider.getModelInfo(modelId);
        if (modelInfo) return { ...modelInfo, providerId: targetProvider.providerId };
      } catch (e) {
        console.warn(`AIModelProviderManager: Error getting model info for '${modelId}' from provider '${targetProvider.providerId}'. Will try cache.`, e);
      }
    }

    const allModels = await this.listAllAvailableModels();
    return allModels.find(m => m.modelId === modelId && (providerId ? m.providerId === providerId : true));
  }

  public async checkOverallHealth(): Promise<{
    isOverallHealthy: boolean;
    providerDetails: Array<{ providerId: string; isHealthy: boolean; details?: any }>;
  }> {
    this.ensureInitialized(); // Corrected: using ensureInitialized
    const providerDetails: Array<{ providerId: string; isHealthy: boolean; details?: any }> = [];
    let isOverallHealthy = true;

    for (const provider of this.providers.values()) {
      if (provider.isInitialized && typeof provider.checkHealth === 'function') {
        try {
          const health = await provider.checkHealth();
          providerDetails.push({ providerId: provider.providerId, ...health });
          if (!health.isHealthy) {
            isOverallHealthy = false;
          }
        } catch (error: any) {
          isOverallHealthy = false;
          providerDetails.push({
            providerId: provider.providerId,
            isHealthy: false,
            details: { message: `Health check failed for ${provider.providerId}: ${error.message}`, error }
          });
        }
      } else {
        providerDetails.push({ providerId: provider.providerId, isHealthy: provider.isInitialized, details: provider.isInitialized ? "Initialized, no specific health check method." : "Not initialized." });
        if(!provider.isInitialized) isOverallHealthy = false;
      }
    }
    return { isOverallHealthy, providerDetails };
  }

  public async shutdown(): Promise<void> {
    if (!this.isInitialized) {
      console.warn("AIModelProviderManager: Shutdown called but manager was not initialized or already shut down.");
      return;
    }
    console.log("AIModelProviderManager: Shutting down all managed providers...");
    const shutdownPromises: Promise<void>[] = [];
    for (const provider of this.providers.values()) {
      if (provider.isInitialized && typeof provider.shutdown === 'function') {
        shutdownPromises.push(
          provider.shutdown().catch(error => {
            console.error(`AIModelProviderManager: Error shutting down provider '${provider.providerId}':`, error);
          })
        );
      }
    }
    await Promise.allSettled(shutdownPromises);
    this.providers.clear();
    this.modelToProviderMap.clear();
    this.allModelsCache = null;
    this.defaultProviderId = undefined;
    this.isInitialized = false;
    console.log("AIModelProviderManager: Shutdown complete. All providers processed.");
  }
}
