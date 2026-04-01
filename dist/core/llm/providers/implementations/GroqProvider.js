// File: backend/agentos/core/llm/providers/implementations/GroqProvider.ts
import { OpenAIProvider } from './OpenAIProvider.js';
// ---------------------------------------------------------------------------
// Known model catalog
// ---------------------------------------------------------------------------
/** Static catalog of well-known Groq models. */
const GROQ_MODELS = [
    {
        modelId: 'llama-3.3-70b-versatile',
        providerId: 'groq',
        displayName: 'Llama 3.3 70B Versatile',
        description: 'Meta Llama 3.3 70B optimized for versatile tasks on Groq LPU.',
        capabilities: ['chat', 'tool_use'],
        contextWindowSize: 131072,
        supportsStreaming: true,
        status: 'active',
    },
    {
        modelId: 'mixtral-8x7b-32768',
        providerId: 'groq',
        displayName: 'Mixtral 8x7B 32K',
        description: 'Mistral AI Mixtral MoE with 32K context on Groq LPU.',
        capabilities: ['chat', 'tool_use'],
        contextWindowSize: 32768,
        supportsStreaming: true,
        status: 'active',
    },
    {
        modelId: 'gemma2-9b-it',
        providerId: 'groq',
        displayName: 'Gemma 2 9B IT',
        description: 'Google Gemma 2 9B instruction-tuned on Groq LPU.',
        capabilities: ['chat'],
        contextWindowSize: 8192,
        supportsStreaming: true,
        status: 'active',
    },
];
// ---------------------------------------------------------------------------
// Provider implementation
// ---------------------------------------------------------------------------
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
export class GroqProvider {
    constructor() {
        /** @inheritdoc */
        this.providerId = 'groq';
        /** @inheritdoc */
        this.isInitialized = false;
        /**
         * Internal OpenAI provider instance that handles the actual API communication.
         * Groq's API is fully OpenAI-compatible, so we reuse the OpenAI transport layer.
         */
        this.delegate = new OpenAIProvider();
    }
    /**
     * Initializes the provider by configuring the underlying OpenAI delegate
     * with Groq's base URL and the caller's API key.
     *
     * @param {GroqProviderConfig} config - Groq-specific configuration.
     * @returns {Promise<void>}
     * @throws {Error} If the API key is missing.
     */
    async initialize(config) {
        if (!config.apiKey) {
            throw new Error('API key is required for GroqProvider. Set GROQ_API_KEY.');
        }
        this.defaultModelId = config.defaultModelId ?? 'llama-3.3-70b-versatile';
        // Delegate to OpenAI provider with Groq's endpoint
        await this.delegate.initialize({
            apiKey: config.apiKey,
            baseURL: config.baseURL ?? 'https://api.groq.com/openai/v1',
            defaultModelId: this.defaultModelId,
            requestTimeout: config.requestTimeout ?? 60000,
        });
        this.isInitialized = true;
        console.log(`GroqProvider initialized. Default model: ${this.defaultModelId}.`);
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
     * Groq does not currently offer an embeddings API.
     *
     * @throws {Error} Always — embeddings are not supported on Groq.
     */
    async generateEmbeddings(_modelId, _texts, _options) {
        throw new Error('Groq does not currently support embeddings. Use a dedicated embedding provider.');
    }
    /**
     * Returns a static catalog of known Groq-hosted models.
     *
     * @param {{ capability?: string }} [filter] - Optional capability filter.
     * @returns {Promise<ModelInfo[]>} Groq model catalog.
     */
    async listAvailableModels(filter) {
        if (filter?.capability) {
            return GROQ_MODELS.filter(m => m.capabilities.includes(filter.capability));
        }
        return [...GROQ_MODELS];
    }
    /** @inheritdoc */
    async getModelInfo(modelId) {
        return GROQ_MODELS.find(m => m.modelId === modelId);
    }
    /** @inheritdoc */
    async checkHealth() {
        return this.delegate.checkHealth();
    }
    /** @inheritdoc */
    async shutdown() {
        await this.delegate.shutdown();
        this.isInitialized = false;
        console.log('GroqProvider shutdown complete.');
    }
}
//# sourceMappingURL=GroqProvider.js.map