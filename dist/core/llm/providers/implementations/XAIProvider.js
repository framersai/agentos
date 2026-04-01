// File: backend/agentos/core/llm/providers/implementations/XAIProvider.ts
import { OpenAIProvider } from './OpenAIProvider.js';
// ---------------------------------------------------------------------------
// Known model catalog
// ---------------------------------------------------------------------------
/** Static catalog of well-known xAI Grok models. */
const XAI_MODELS = [
    {
        modelId: 'grok-2',
        providerId: 'xai',
        displayName: 'Grok 2',
        description: 'xAI flagship model with strong reasoning and real-time knowledge.',
        capabilities: ['chat', 'tool_use'],
        contextWindowSize: 131072,
        supportsStreaming: true,
        status: 'active',
    },
    {
        modelId: 'grok-2-mini',
        providerId: 'xai',
        displayName: 'Grok 2 Mini',
        description: 'Smaller, faster xAI model for cost-effective everyday tasks.',
        capabilities: ['chat', 'tool_use'],
        contextWindowSize: 131072,
        supportsStreaming: true,
        status: 'active',
    },
];
// ---------------------------------------------------------------------------
// Provider implementation
// ---------------------------------------------------------------------------
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
export class XAIProvider {
    constructor() {
        /** @inheritdoc */
        this.providerId = 'xai';
        /** @inheritdoc */
        this.isInitialized = false;
        /**
         * Internal OpenAI provider instance that handles the actual API communication.
         * xAI's API is fully OpenAI-compatible, so we reuse the OpenAI transport layer.
         */
        this.delegate = new OpenAIProvider();
    }
    /**
     * Initializes the provider by configuring the underlying OpenAI delegate
     * with xAI's base URL and the caller's API key.
     *
     * @param {XAIProviderConfig} config - xAI-specific configuration.
     * @returns {Promise<void>}
     * @throws {Error} If the API key is missing.
     */
    async initialize(config) {
        if (!config.apiKey) {
            throw new Error('API key is required for XAIProvider. Set XAI_API_KEY.');
        }
        this.defaultModelId = config.defaultModelId ?? 'grok-2';
        // Delegate to OpenAI provider with xAI's endpoint
        await this.delegate.initialize({
            apiKey: config.apiKey,
            baseURL: config.baseURL ?? 'https://api.x.ai/v1',
            defaultModelId: this.defaultModelId,
            requestTimeout: config.requestTimeout ?? 60000,
        });
        this.isInitialized = true;
        console.log(`XAIProvider initialized. Default model: ${this.defaultModelId}.`);
    }
    /** @inheritdoc */
    async generateCompletion(modelId, messages, options) {
        return this.delegate.generateCompletion(modelId, messages, options);
    }
    /** @inheritdoc */
    async *generateCompletionStream(modelId, messages, options) {
        yield* this.delegate.generateCompletionStream(modelId, messages, options);
    }
    /**
     * xAI does not currently offer an embeddings API.
     *
     * @throws {Error} Always — embeddings are not supported on xAI.
     */
    async generateEmbeddings(_modelId, _texts, _options) {
        throw new Error('xAI does not currently support embeddings. Use a dedicated embedding provider.');
    }
    /**
     * Returns a static catalog of known xAI Grok models.
     *
     * @param {{ capability?: string }} [filter] - Optional capability filter.
     * @returns {Promise<ModelInfo[]>} xAI model catalog.
     */
    async listAvailableModels(filter) {
        if (filter?.capability) {
            return XAI_MODELS.filter(m => m.capabilities.includes(filter.capability));
        }
        return [...XAI_MODELS];
    }
    /** @inheritdoc */
    async getModelInfo(modelId) {
        return XAI_MODELS.find(m => m.modelId === modelId);
    }
    /** @inheritdoc */
    async checkHealth() {
        return this.delegate.checkHealth();
    }
    /** @inheritdoc */
    async shutdown() {
        await this.delegate.shutdown();
        this.isInitialized = false;
        console.log('XAIProvider shutdown complete.');
    }
}
//# sourceMappingURL=XAIProvider.js.map