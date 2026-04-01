// File: backend/agentos/core/llm/providers/implementations/TogetherProvider.ts
import { OpenAIProvider } from './OpenAIProvider.js';
// ---------------------------------------------------------------------------
// Known model catalog
// ---------------------------------------------------------------------------
/** Static catalog of well-known Together AI models. */
const TOGETHER_MODELS = [
    {
        modelId: 'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo',
        providerId: 'together',
        displayName: 'Llama 3.1 70B Instruct Turbo',
        description: 'Meta Llama 3.1 70B optimized for fast instruction-following on Together.',
        capabilities: ['chat', 'tool_use'],
        contextWindowSize: 131072,
        supportsStreaming: true,
        status: 'active',
    },
    {
        modelId: 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo',
        providerId: 'together',
        displayName: 'Llama 3.1 8B Instruct Turbo',
        description: 'Meta Llama 3.1 8B — cost-effective instruction model on Together.',
        capabilities: ['chat', 'tool_use'],
        contextWindowSize: 131072,
        supportsStreaming: true,
        status: 'active',
    },
    {
        modelId: 'mistralai/Mixtral-8x7B-Instruct-v0.1',
        providerId: 'together',
        displayName: 'Mixtral 8x7B Instruct v0.1',
        description: 'Mistral AI Mixtral MoE instruction-tuned on Together.',
        capabilities: ['chat', 'tool_use'],
        contextWindowSize: 32768,
        supportsStreaming: true,
        status: 'active',
    },
];
// ---------------------------------------------------------------------------
// Provider implementation
// ---------------------------------------------------------------------------
/**
 * @class TogetherProvider
 * @implements {IProvider}
 *
 * Thin wrapper around {@link OpenAIProvider} that targets Together AI's
 * OpenAI-compatible API endpoint. Together hosts a wide range of open-source
 * models (Llama, Mixtral, etc.) with competitive pricing and fast inference.
 *
 * @example
 * const together = new TogetherProvider();
 * await together.initialize({ apiKey: process.env.TOGETHER_API_KEY! });
 * const res = await together.generateCompletion(
 *   'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo', messages, {},
 * );
 */
export class TogetherProvider {
    constructor() {
        /** @inheritdoc */
        this.providerId = 'together';
        /** @inheritdoc */
        this.isInitialized = false;
        /**
         * Internal OpenAI provider instance that handles the actual API communication.
         * Together's API is fully OpenAI-compatible, so we reuse the OpenAI transport layer.
         */
        this.delegate = new OpenAIProvider();
    }
    /**
     * Initializes the provider by configuring the underlying OpenAI delegate
     * with Together's base URL and the caller's API key.
     *
     * @param {TogetherProviderConfig} config - Together-specific configuration.
     * @returns {Promise<void>}
     * @throws {Error} If the API key is missing.
     */
    async initialize(config) {
        if (!config.apiKey) {
            throw new Error('API key is required for TogetherProvider. Set TOGETHER_API_KEY.');
        }
        this.defaultModelId = config.defaultModelId ?? 'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo';
        // Delegate to OpenAI provider with Together's endpoint
        await this.delegate.initialize({
            apiKey: config.apiKey,
            baseURL: config.baseURL ?? 'https://api.together.xyz/v1',
            defaultModelId: this.defaultModelId,
            requestTimeout: config.requestTimeout ?? 60000,
        });
        this.isInitialized = true;
        console.log(`TogetherProvider initialized. Default model: ${this.defaultModelId}.`);
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
     * Together AI supports embeddings for some models, delegated to the OpenAI-compatible endpoint.
     *
     * @param {string} modelId - Embedding model ID.
     * @param {string[]} texts - Texts to embed.
     * @param {ProviderEmbeddingOptions} [options] - Embedding options.
     * @returns {Promise<ProviderEmbeddingResponse>} Embedding response.
     */
    async generateEmbeddings(modelId, texts, options) {
        return this.delegate.generateEmbeddings(modelId, texts, options);
    }
    /**
     * Returns a static catalog of well-known Together-hosted models.
     *
     * @param {{ capability?: string }} [filter] - Optional capability filter.
     * @returns {Promise<ModelInfo[]>} Together model catalog.
     */
    async listAvailableModels(filter) {
        if (filter?.capability) {
            return TOGETHER_MODELS.filter(m => m.capabilities.includes(filter.capability));
        }
        return [...TOGETHER_MODELS];
    }
    /** @inheritdoc */
    async getModelInfo(modelId) {
        return TOGETHER_MODELS.find(m => m.modelId === modelId);
    }
    /** @inheritdoc */
    async checkHealth() {
        return this.delegate.checkHealth();
    }
    /** @inheritdoc */
    async shutdown() {
        await this.delegate.shutdown();
        this.isInitialized = false;
        console.log('TogetherProvider shutdown complete.');
    }
}
//# sourceMappingURL=TogetherProvider.js.map