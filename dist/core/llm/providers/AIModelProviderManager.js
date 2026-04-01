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
import { OpenAIProvider } from './implementations/OpenAIProvider.js';
import { OpenRouterProvider } from './implementations/OpenRouterProvider.js';
import { OllamaProvider } from './implementations/OllamaProvider.js';
import { AnthropicProvider } from './implementations/AnthropicProvider.js';
import { GroqProvider } from './implementations/GroqProvider.js';
import { TogetherProvider } from './implementations/TogetherProvider.js';
import { MistralProvider } from './implementations/MistralProvider.js';
import { XAIProvider } from './implementations/XAIProvider.js';
import { GeminiProvider } from './implementations/GeminiProvider.js';
import { ClaudeCodeProvider } from './implementations/ClaudeCodeProvider.js';
import { GeminiCLIProvider } from './implementations/GeminiCLIProvider.js';
import { GMIError, GMIErrorCode, createGMIErrorFromError } from '../../../core/utils/errors.js'; // Corrected import path
/**
 * @class AIModelProviderManager
 * @description Manages and provides access to various configured AI model provider instances (`IProvider`).
 */
export class AIModelProviderManager {
    constructor() {
        this.providers = new Map();
        this.modelToProviderMap = new Map();
        this.allModelsCache = null;
        this.isInitialized = false;
    }
    /**
     * Ensures the manager has been properly initialized before any operations.
     * @private
     * @throws {GMIError} If the manager is not initialized.
     */
    ensureInitialized() {
        if (!this.isInitialized) {
            throw new GMIError('AIModelProviderManager is not initialized. Call initialize() first.', GMIErrorCode.NOT_INITIALIZED, undefined, 'AIModelProviderManager');
        }
    }
    async initialize(config) {
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
            let providerInstance;
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
                    case 'anthropic':
                        providerInstance = new AnthropicProvider();
                        break;
                    case 'groq':
                        providerInstance = new GroqProvider();
                        break;
                    case 'together':
                        providerInstance = new TogetherProvider();
                        break;
                    case 'mistral':
                        providerInstance = new MistralProvider();
                        break;
                    case 'xai':
                        providerInstance = new XAIProvider();
                        break;
                    case 'gemini':
                        providerInstance = new GeminiProvider();
                        break;
                    case 'claude-code-cli':
                        providerInstance = new ClaudeCodeProvider();
                        break;
                    case 'gemini-cli':
                        providerInstance = new GeminiCLIProvider();
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
            }
            catch (error) {
                const gmiError = createGMIErrorFromError(// Using the imported function
                error, // Pass the original error
                GMIErrorCode.LLM_PROVIDER_ERROR, { providerId: providerEntry.providerId }, `Failed to initialize provider '${providerEntry.providerId}'`);
                console.error(gmiError.message, gmiError.details);
            }
        }
        if (!this.defaultProviderId && this.providers.size > 0) {
            this.defaultProviderId = this.providers.keys().next().value;
        }
        if (this.defaultProviderId) {
            console.log(`AIModelProviderManager: Default provider set to '${this.defaultProviderId}'.`);
        }
        else if (config.providers.some(p => p.enabled)) {
            console.warn("AIModelProviderManager: No default provider could be set.");
        }
        else {
            console.log("AIModelProviderManager: No providers enabled or configured.");
        }
        this.isInitialized = true;
        console.log(`AIModelProviderManager initialized with ${this.providers.size} active providers.`);
    }
    async cacheModelsFromProvider(provider) {
        if (provider.isInitialized && typeof provider.listAvailableModels === 'function') {
            try {
                const models = await provider.listAvailableModels();
                models.forEach(model => {
                    if (!this.modelToProviderMap.has(model.modelId)) {
                        this.modelToProviderMap.set(model.modelId, provider.providerId);
                    }
                });
                this.allModelsCache = null;
            }
            catch (error) {
                const gmiError = createGMIErrorFromError(// Using the imported function
                error, GMIErrorCode.LLM_PROVIDER_ERROR, { providerId: provider.providerId }, `Error caching models from provider '${provider.providerId}'`);
                console.error(gmiError.message, gmiError.details);
            }
        }
    }
    getProvider(providerId) {
        this.ensureInitialized(); // Corrected: using ensureInitialized
        const provider = this.providers.get(providerId);
        return provider?.isInitialized ? provider : undefined;
    }
    getDefaultProvider() {
        this.ensureInitialized(); // Corrected: using ensureInitialized
        return this.defaultProviderId ? this.getProvider(this.defaultProviderId) : undefined;
    }
    getProviderForModel(modelId) {
        this.ensureInitialized(); // Corrected: using ensureInitialized
        const mappedProviderId = this.modelToProviderMap.get(modelId);
        if (mappedProviderId) {
            const provider = this.getProvider(mappedProviderId);
            if (provider)
                return provider;
        }
        for (const provider of this.providers.values()) {
            if (provider.isInitialized && provider.defaultModelId === modelId) {
                return provider;
            }
        }
        if (modelId.includes('/')) {
            const prefix = modelId.split('/')[0];
            const providerByPrefix = this.getProvider(prefix);
            if (providerByPrefix)
                return providerByPrefix;
        }
        console.warn(`AIModelProviderManager: Could not determine a specific provider for model '${modelId}'. Falling back to default provider if available.`);
        return this.getDefaultProvider();
    }
    async listAllAvailableModels() {
        this.ensureInitialized(); // Corrected: using ensureInitialized
        if (this.allModelsCache) {
            return [...this.allModelsCache];
        }
        let allModels = [];
        const promises = [];
        for (const provider of this.providers.values()) {
            if (provider.isInitialized && typeof provider.listAvailableModels === 'function') {
                promises.push(provider.listAvailableModels().then(models => models.map(m => ({ ...m, providerId: provider.providerId }))).catch(error => {
                    console.error(`AIModelProviderManager: Failed to list models from provider '${provider.providerId}':`, error);
                    return [];
                }));
            }
        }
        const results = await Promise.allSettled(promises);
        results.forEach(result => {
            if (result.status === 'fulfilled') {
                allModels = allModels.concat(result.value);
            }
        });
        const uniqueModelsMap = new Map();
        for (const model of allModels) {
            if (!uniqueModelsMap.has(model.modelId)) {
                uniqueModelsMap.set(model.modelId, model);
            }
        }
        this.allModelsCache = Array.from(uniqueModelsMap.values());
        return [...this.allModelsCache];
    }
    async getModelInfo(modelId, providerId) {
        this.ensureInitialized(); // Corrected: using ensureInitialized
        let targetProvider;
        if (providerId) {
            targetProvider = this.getProvider(providerId);
        }
        else {
            targetProvider = this.getProviderForModel(modelId);
        }
        if (targetProvider && typeof targetProvider.getModelInfo === 'function') {
            try {
                const modelInfo = await targetProvider.getModelInfo(modelId);
                if (modelInfo)
                    return { ...modelInfo, providerId: targetProvider.providerId };
            }
            catch (e) {
                console.warn(`AIModelProviderManager: Error getting model info for '${modelId}' from provider '${targetProvider.providerId}'. Will try cache.`, e);
            }
        }
        const allModels = await this.listAllAvailableModels();
        return allModels.find(m => m.modelId === modelId && (providerId ? m.providerId === providerId : true));
    }
    async checkOverallHealth() {
        this.ensureInitialized(); // Corrected: using ensureInitialized
        const providerDetails = [];
        let isOverallHealthy = true;
        for (const provider of this.providers.values()) {
            if (provider.isInitialized && typeof provider.checkHealth === 'function') {
                try {
                    const health = await provider.checkHealth();
                    providerDetails.push({ providerId: provider.providerId, ...health });
                    if (!health.isHealthy) {
                        isOverallHealthy = false;
                    }
                }
                catch (error) {
                    isOverallHealthy = false;
                    providerDetails.push({
                        providerId: provider.providerId,
                        isHealthy: false,
                        details: { message: `Health check failed for ${provider.providerId}: ${error.message}`, error }
                    });
                }
            }
            else {
                providerDetails.push({ providerId: provider.providerId, isHealthy: provider.isInitialized, details: provider.isInitialized ? "Initialized, no specific health check method." : "Not initialized." });
                if (!provider.isInitialized)
                    isOverallHealthy = false;
            }
        }
        return { isOverallHealthy, providerDetails };
    }
    async shutdown() {
        if (!this.isInitialized) {
            console.warn("AIModelProviderManager: Shutdown called but manager was not initialized or already shut down.");
            return;
        }
        console.log("AIModelProviderManager: Shutting down all managed providers...");
        const shutdownPromises = [];
        for (const provider of this.providers.values()) {
            if (provider.isInitialized && typeof provider.shutdown === 'function') {
                shutdownPromises.push(provider.shutdown().catch(error => {
                    console.error(`AIModelProviderManager: Error shutting down provider '${provider.providerId}':`, error);
                }));
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
//# sourceMappingURL=AIModelProviderManager.js.map