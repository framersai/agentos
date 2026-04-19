// File: backend/agentos/core/llm/providers/implementations/AnthropicProvider.ts
import { AnthropicProviderError } from '../errors/AnthropicProviderError.js';
import { ApiKeyPool } from '../../../providers/ApiKeyPool.js';
// ---------------------------------------------------------------------------
// Known model catalog — used by listAvailableModels / getModelInfo
// ---------------------------------------------------------------------------
/**
 * Static catalog of well-known Anthropic models and their metadata.
 *
 * Pricing verified against anthropic.com/pricing on 2026-04-16 (USD per 1M tokens).
 * Update when Anthropic publishes new rate cards.
 */
const ANTHROPIC_MODELS = [
    {
        modelId: 'claude-opus-4-7',
        providerId: 'anthropic',
        displayName: 'Claude Opus 4.7',
        description: 'Most intelligent model for agents and coding.',
        capabilities: ['chat', 'tool_use', 'vision_input'],
        contextWindowSize: 200000,
        outputTokenLimit: 32000,
        pricePer1MTokensInput: 5,
        pricePer1MTokensOutput: 25,
        supportsStreaming: true,
        status: 'active',
    },
    {
        modelId: 'claude-opus-4-6',
        providerId: 'anthropic',
        displayName: 'Claude Opus 4.6',
        description: 'Previous-generation Opus with same pricing as 4.7.',
        capabilities: ['chat', 'tool_use', 'vision_input'],
        contextWindowSize: 200000,
        outputTokenLimit: 32000,
        pricePer1MTokensInput: 5,
        pricePer1MTokensOutput: 25,
        supportsStreaming: true,
        status: 'active',
    },
    {
        modelId: 'claude-sonnet-4-6',
        providerId: 'anthropic',
        displayName: 'Claude Sonnet 4.6',
        description: 'Optimal balance of intelligence, cost, and speed.',
        capabilities: ['chat', 'tool_use', 'vision_input'],
        contextWindowSize: 200000,
        outputTokenLimit: 16000,
        pricePer1MTokensInput: 3,
        pricePer1MTokensOutput: 15,
        supportsStreaming: true,
        status: 'active',
    },
    {
        modelId: 'claude-sonnet-4-5',
        providerId: 'anthropic',
        displayName: 'Claude Sonnet 4.5',
        description: 'Previous-generation Sonnet with same pricing as 4.6.',
        capabilities: ['chat', 'tool_use', 'vision_input'],
        contextWindowSize: 200000,
        outputTokenLimit: 16000,
        pricePer1MTokensInput: 3,
        pricePer1MTokensOutput: 15,
        supportsStreaming: true,
        status: 'active',
    },
    {
        modelId: 'claude-haiku-4-5-20251001',
        providerId: 'anthropic',
        displayName: 'Claude Haiku 4.5',
        description: 'Fastest, most cost-efficient model for lightweight tasks.',
        capabilities: ['chat', 'tool_use', 'vision_input'],
        contextWindowSize: 200000,
        outputTokenLimit: 8192,
        pricePer1MTokensInput: 1,
        pricePer1MTokensOutput: 5,
        supportsStreaming: true,
        status: 'active',
    },
    // Legacy entries retained for model-ID back-compat. Prices reflect the
    // original rate card for those specific snapshots.
    {
        modelId: 'claude-opus-4-20250514',
        providerId: 'anthropic',
        displayName: 'Claude Opus 4 (2025-05-14)',
        description: 'Original Opus 4 snapshot. Legacy pricing retained.',
        capabilities: ['chat', 'tool_use', 'vision_input'],
        contextWindowSize: 200000,
        outputTokenLimit: 32000,
        pricePer1MTokensInput: 15,
        pricePer1MTokensOutput: 75,
        supportsStreaming: true,
        status: 'active',
    },
    {
        modelId: 'claude-sonnet-4-20250514',
        providerId: 'anthropic',
        displayName: 'Claude Sonnet 4 (2025-05-14)',
        description: 'Original Sonnet 4 snapshot.',
        capabilities: ['chat', 'tool_use', 'vision_input'],
        contextWindowSize: 200000,
        outputTokenLimit: 16000,
        pricePer1MTokensInput: 3,
        pricePer1MTokensOutput: 15,
        supportsStreaming: true,
        status: 'active',
    },
];
// ---------------------------------------------------------------------------
// Provider implementation
// ---------------------------------------------------------------------------
/**
 * @class AnthropicProvider
 * @implements {IProvider}
 *
 * Provides native integration with Anthropic's Messages API.
 * Handles the significant structural differences between Anthropic's API
 * and the OpenAI-style conventions used by IProvider, including system
 * prompt extraction, tool schema remapping, and stop reason normalization.
 *
 * @example
 * const provider = new AnthropicProvider();
 * await provider.initialize({ apiKey: 'sk-ant-...' });
 * const response = await provider.generateCompletion(
 *   'claude-sonnet-4-20250514',
 *   [{ role: 'user', content: 'Hello!' }],
 *   { maxTokens: 1024 },
 * );
 */
export class AnthropicProvider {
    constructor() {
        /** @inheritdoc */
        this.providerId = 'anthropic';
        /** @inheritdoc */
        this.isInitialized = false;
        this.keyPool = null;
    }
    // -------------------------------------------------------------------------
    // Lifecycle
    // -------------------------------------------------------------------------
    /**
     * Initialize the Anthropic provider with the given configuration.
     *
     * Validates that an API key is present — Anthropic's API will reject
     * unauthenticated requests. Does NOT make a network call on startup
     * because Anthropic has no lightweight health endpoint like OpenAI's
     * `/models` list.
     *
     * @param {AnthropicProviderConfig} config - Provider configuration.
     * @returns {Promise<void>}
     * @throws {AnthropicProviderError} If the API key is missing.
     */
    async initialize(config) {
        if (!config.apiKey) {
            throw new AnthropicProviderError('API key is required for AnthropicProvider initialization. Set ANTHROPIC_API_KEY.', 'INIT_FAILED_MISSING_API_KEY');
        }
        this.config = {
            baseURL: 'https://api.anthropic.com',
            maxRetries: 3,
            requestTimeout: 120000,
            defaultMaxTokens: 4096,
            ...config,
        };
        this.keyPool = new ApiKeyPool(config.apiKey);
        this.defaultModelId = config.defaultModelId;
        this.isInitialized = true;
        const env = typeof process !== 'undefined' ? process.env : undefined;
        const debugOn = env && (env.AGENTOS_DEBUG === '1' || env.AGENTOS_DEBUG === 'true' || (env.AGENTOS_LOG_LEVEL ?? '').toLowerCase() === 'debug');
        if (debugOn) {
            console.log(`AnthropicProvider initialized. Default model: ${this.defaultModelId || 'Not set'}.`);
        }
    }
    // -------------------------------------------------------------------------
    // Chat completions
    // -------------------------------------------------------------------------
    /**
     * Generates a non-streaming chat completion via Anthropic's Messages API.
     *
     * Extracts system messages from the conversation and promotes them to the
     * top-level `system` field, converts tool definitions from OpenAI format
     * to Anthropic's `input_schema` format, and normalizes the response back
     * to IProvider conventions.
     *
     * @param {string} modelId - The Anthropic model to use (e.g., "claude-sonnet-4-20250514").
     * @param {ChatMessage[]} messages - Conversation messages. System-role messages are
     *   extracted and sent as the top-level `system` parameter.
     * @param {ModelCompletionOptions} options - Completion options. `maxTokens` is strongly
     *   recommended; defaults to {@link AnthropicProviderConfig.defaultMaxTokens} if omitted.
     * @returns {Promise<ModelCompletionResponse>} A normalized completion response.
     * @throws {AnthropicProviderError} On authentication, validation, or network errors.
     */
    async generateCompletion(modelId, messages, options) {
        this.ensureInitialized();
        const payload = this.buildRequestPayload(modelId, messages, options, false);
        const apiResponse = await this.makeApiRequest('/v1/messages', 'POST', payload);
        return this.mapResponseToCompletion(apiResponse);
    }
    /**
     * Generates a streaming chat completion via Anthropic's Messages API.
     *
     * Anthropic's streaming uses distinct SSE event types:
     * - `message_start` — initial metadata and usage
     * - `content_block_start` — beginning of a text or tool_use block
     * - `content_block_delta` — incremental text or tool argument JSON
     * - `content_block_stop` — end of a block
     * - `message_delta` — final stop_reason and output token count
     * - `message_stop` — terminal event
     *
     * This method normalizes all of the above into the IProvider streaming
     * contract with `responseTextDelta`, `toolCallsDeltas`, and `isFinal`.
     *
     * @param {string} modelId - The Anthropic model to use.
     * @param {ChatMessage[]} messages - Conversation messages.
     * @param {ModelCompletionOptions} options - Completion options.
     * @returns {AsyncGenerator<ModelCompletionResponse>} Incremental response chunks.
     * @throws {AnthropicProviderError} On connection or stream errors.
     */
    async *generateCompletionStream(modelId, messages, options) {
        this.ensureInitialized();
        const payload = this.buildRequestPayload(modelId, messages, options, true);
        // Handle pre-aborted signals
        const abortSignal = options.abortSignal;
        if (abortSignal?.aborted) {
            yield this.buildAbortChunk(modelId);
            return;
        }
        const stream = await this.makeStreamRequest('/v1/messages', payload);
        // State accumulators across SSE events
        let responseId = `anthropic-${modelId}-${Date.now()}`;
        let accumulatedContent = '';
        let inputTokens = 0;
        let outputTokens = 0;
        /** Map from content block index → tool call accumulator */
        const toolCallAccum = new Map();
        const abortHandler = () => { };
        abortSignal?.addEventListener('abort', abortHandler, { once: true });
        try {
            for await (const rawEvent of this.parseSseStream(stream)) {
                if (abortSignal?.aborted) {
                    yield this.buildAbortChunk(modelId);
                    break;
                }
                let event;
                try {
                    event = JSON.parse(rawEvent);
                }
                catch {
                    // Malformed JSON — skip this event
                    console.warn('AnthropicProvider: Could not parse SSE event JSON:', rawEvent);
                    continue;
                }
                switch (event.type) {
                    case 'message_start': {
                        responseId = event.message.id;
                        inputTokens = event.message.usage?.input_tokens ?? 0;
                        break;
                    }
                    case 'content_block_start': {
                        // A new tool_use block registers a placeholder in the accumulator
                        if (event.content_block.type === 'tool_use') {
                            toolCallAccum.set(event.index, {
                                id: event.content_block.id ?? `call_${Date.now()}_${event.index}`,
                                name: event.content_block.name ?? 'unknown',
                                argsJson: '',
                            });
                        }
                        break;
                    }
                    case 'content_block_delta': {
                        if (event.delta.type === 'text_delta' && event.delta.text) {
                            // Incremental text content
                            const textDelta = event.delta.text;
                            accumulatedContent += textDelta;
                            yield {
                                id: responseId,
                                object: 'chat.completion.chunk',
                                created: Math.floor(Date.now() / 1000),
                                modelId,
                                choices: [{
                                        index: 0,
                                        message: { role: 'assistant', content: textDelta },
                                        finishReason: null,
                                    }],
                                responseTextDelta: textDelta,
                            };
                        }
                        else if (event.delta.type === 'input_json_delta' && event.delta.partial_json) {
                            // Incremental tool argument JSON fragment
                            const accum = toolCallAccum.get(event.index);
                            if (accum) {
                                accum.argsJson += event.delta.partial_json;
                                yield {
                                    id: responseId,
                                    object: 'chat.completion.chunk',
                                    created: Math.floor(Date.now() / 1000),
                                    modelId,
                                    choices: [{
                                            index: 0,
                                            message: { role: 'assistant', content: null },
                                            finishReason: null,
                                        }],
                                    toolCallsDeltas: [{
                                            index: event.index,
                                            id: accum.id,
                                            type: 'function',
                                            function: {
                                                name: accum.name,
                                                arguments_delta: event.delta.partial_json,
                                            },
                                        }],
                                };
                            }
                        }
                        break;
                    }
                    case 'message_delta': {
                        // Contains stop_reason and final output token count
                        outputTokens += event.usage?.output_tokens ?? 0;
                        const stopReason = this.mapStopReason(event.delta.stop_reason);
                        // Assemble final tool_calls array from accumulated blocks
                        const toolCalls = this.assembleToolCalls(toolCallAccum);
                        const hasToolCalls = toolCalls.length > 0;
                        const usage = {
                            promptTokens: inputTokens,
                            completionTokens: outputTokens,
                            totalTokens: inputTokens + outputTokens,
                            costUSD: this.estimateCost(inputTokens, outputTokens, modelId),
                        };
                        yield {
                            id: responseId,
                            object: 'chat.completion.chunk',
                            created: Math.floor(Date.now() / 1000),
                            modelId,
                            choices: [{
                                    index: 0,
                                    message: {
                                        role: 'assistant',
                                        content: accumulatedContent || null,
                                        ...(hasToolCalls && { tool_calls: toolCalls }),
                                    },
                                    finishReason: stopReason,
                                }],
                            usage,
                            isFinal: true,
                        };
                        break;
                    }
                    case 'error': {
                        // Stream-level error from Anthropic
                        yield {
                            id: responseId,
                            object: 'chat.completion.chunk',
                            created: Math.floor(Date.now() / 1000),
                            modelId,
                            choices: [],
                            error: {
                                message: event.error.message,
                                type: event.error.type,
                            },
                            isFinal: true,
                        };
                        return;
                    }
                    // 'content_block_stop', 'message_stop', 'ping' — no action needed
                    default:
                        break;
                }
            }
        }
        catch (streamError) {
            const message = streamError instanceof Error ? streamError.message : 'Anthropic stream processing error';
            console.error(`AnthropicProvider stream error for model ${modelId}:`, message);
            yield {
                id: responseId,
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                modelId,
                choices: [],
                isFinal: true,
                error: { message, type: 'STREAM_PROCESSING_ERROR' },
            };
        }
        finally {
            abortSignal?.removeEventListener('abort', abortHandler);
        }
    }
    // -------------------------------------------------------------------------
    // Embeddings (not natively supported by Anthropic)
    // -------------------------------------------------------------------------
    /**
     * Anthropic does not offer an embeddings API. This method always throws.
     *
     * @param {string} _modelId - Unused.
     * @param {string[]} _texts - Unused.
     * @param {ProviderEmbeddingOptions} [_options] - Unused.
     * @returns {Promise<ProviderEmbeddingResponse>} Never returns.
     * @throws {AnthropicProviderError} Always — embeddings are not supported.
     */
    async generateEmbeddings(_modelId, _texts, _options) {
        throw new AnthropicProviderError('Anthropic does not provide an embeddings API. Use a dedicated embedding provider (e.g., OpenAI, Voyage).', 'EMBEDDINGS_NOT_SUPPORTED');
    }
    // -------------------------------------------------------------------------
    // Introspection
    // -------------------------------------------------------------------------
    /**
     * Returns a static catalog of known Anthropic models.
     *
     * Anthropic does not expose a `/models` list endpoint, so this uses a
     * hardcoded catalog that is kept up-to-date with major releases.
     *
     * @param {{ capability?: string }} [filter] - Optional capability filter.
     * @returns {Promise<ModelInfo[]>} Array of known Anthropic models.
     */
    async listAvailableModels(filter) {
        this.ensureInitialized();
        if (filter?.capability) {
            return ANTHROPIC_MODELS.filter(m => m.capabilities.includes(filter.capability));
        }
        return [...ANTHROPIC_MODELS];
    }
    /**
     * Retrieves metadata for a specific model from the static catalog.
     *
     * @param {string} modelId - Model identifier (e.g., "claude-sonnet-4-20250514").
     * @returns {Promise<ModelInfo | undefined>} Model info or undefined if not found.
     */
    async getModelInfo(modelId) {
        this.ensureInitialized();
        return ANTHROPIC_MODELS.find(m => m.modelId === modelId);
    }
    /**
     * Performs a lightweight health check by sending a minimal Messages request.
     *
     * @returns {Promise<{ isHealthy: boolean; details?: unknown }>} Health status.
     */
    async checkHealth() {
        try {
            // Anthropic has no /health or /models endpoint, so we send a tiny
            // completion request with max_tokens=1 to verify credentials + connectivity.
            await this.makeApiRequest('/v1/messages', 'POST', {
                model: this.defaultModelId || 'claude-haiku-4-5-20251001',
                max_tokens: 1,
                messages: [{ role: 'user', content: 'ping' }],
            });
            return { isHealthy: true };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : 'Health check failed';
            return { isHealthy: false, details: { message, error } };
        }
    }
    /** @inheritdoc */
    async shutdown() {
        this.isInitialized = false;
        console.log('AnthropicProvider shutdown complete.');
    }
    // =========================================================================
    // Private helpers
    // =========================================================================
    /**
     * Guard that throws if the provider has not been initialized.
     * @private
     * @throws {AnthropicProviderError} If not initialized.
     */
    ensureInitialized() {
        if (!this.isInitialized) {
            throw new AnthropicProviderError('AnthropicProvider is not initialized. Call initialize() first.', 'PROVIDER_NOT_INITIALIZED');
        }
    }
    // -------------------------------------------------------------------------
    // Payload construction
    // -------------------------------------------------------------------------
    /**
     * Builds the Anthropic Messages API request payload from IProvider inputs.
     *
     * The key transformation is extracting system-role messages from the
     * conversation array and placing their content into the top-level `system`
     * field, since Anthropic does not accept system as a message role.
     *
     * @param {string} modelId - Target model.
     * @param {ChatMessage[]} messages - Conversation messages.
     * @param {ModelCompletionOptions} options - Completion options.
     * @param {boolean} stream - Whether to request streaming.
     * @returns {Record<string, unknown>} The request body for Anthropic's API.
     * @private
     */
    buildRequestPayload(modelId, messages, options, stream) {
        const systemBlocks = [];
        const conversationMessages = [];
        for (const msg of messages) {
            if (msg.role === 'system') {
                if (typeof msg.content === 'string') {
                    if (msg.content)
                        systemBlocks.push({ type: 'text', text: msg.content });
                }
                else if (Array.isArray(msg.content)) {
                    for (const part of msg.content) {
                        if (part.type === 'text') {
                            const block = { type: 'text', text: part.text };
                            if (part.cache_control) {
                                block.cache_control = part.cache_control;
                            }
                            systemBlocks.push(block);
                        }
                    }
                }
            }
            else {
                conversationMessages.push(msg);
            }
        }
        // --- Convert remaining messages to Anthropic format ---
        const anthropicMessages = conversationMessages.map(msg => this.toAnthropicMessage(msg));
        const payload = {
            model: modelId,
            // max_tokens is REQUIRED by Anthropic — enforce a sane default
            max_tokens: options.maxTokens ?? this.config.defaultMaxTokens ?? 4096,
            messages: anthropicMessages,
            stream,
        };
        // Emit system as content block array when cache markers are present,
        // otherwise fall back to joined string for backward compatibility.
        if (systemBlocks.length > 0) {
            const hasCacheMarkers = systemBlocks.some(b => b.cache_control);
            payload.system = hasCacheMarkers
                ? systemBlocks
                : systemBlocks.map(b => b.text).join('\n\n');
        }
        // --- Optional parameters ---
        if (options.temperature !== undefined)
            payload.temperature = options.temperature;
        if (options.topP !== undefined)
            payload.top_p = options.topP;
        if (options.stopSequences?.length)
            payload.stop_sequences = options.stopSequences;
        // --- Tool definitions ---
        const tools = this.convertToolDefs(options.tools);
        if (tools.length > 0) {
            payload.tools = tools;
            // Map toolChoice to Anthropic's format
            if (options.toolChoice) {
                payload.tool_choice = this.convertToolChoice(options.toolChoice);
            }
        }
        // Pass through any custom model params
        if (options.customModelParams) {
            Object.assign(payload, options.customModelParams);
        }
        return payload;
    }
    /**
     * Converts a single ChatMessage to Anthropic's message format.
     *
     * Handles three cases:
     * 1. Assistant messages with tool_calls → content blocks with tool_use entries
     * 2. Tool-role messages → content blocks with tool_result entries
     * 3. Standard user/assistant text or multimodal messages
     *
     * @param {ChatMessage} msg - The source message.
     * @returns {Record<string, unknown>} Anthropic-formatted message.
     * @private
     */
    toAnthropicMessage(msg) {
        // --- Assistant with tool_calls ---
        if (msg.role === 'assistant' && msg.tool_calls?.length) {
            const content = [];
            // Include any text content first
            if (typeof msg.content === 'string' && msg.content) {
                content.push({ type: 'text', text: msg.content });
            }
            // Add tool_use blocks
            for (const tc of msg.tool_calls) {
                let parsedInput;
                try {
                    parsedInput = typeof tc.function.arguments === 'string'
                        ? JSON.parse(tc.function.arguments)
                        : tc.function.arguments ?? {};
                }
                catch {
                    parsedInput = {};
                }
                content.push({
                    type: 'tool_use',
                    id: tc.id,
                    name: tc.function.name,
                    input: parsedInput,
                });
            }
            return { role: 'assistant', content };
        }
        // --- Tool result messages ---
        if (msg.role === 'tool') {
            const resultContent = typeof msg.content === 'string'
                ? msg.content
                : JSON.stringify(msg.content ?? '');
            return {
                role: 'user',
                content: [{
                        type: 'tool_result',
                        tool_use_id: msg.tool_call_id ?? 'unknown',
                        content: resultContent,
                    }],
            };
        }
        // --- Multimodal content (vision) ---
        if (Array.isArray(msg.content)) {
            const anthropicContent = [];
            for (const part of msg.content) {
                if (part.type === 'text') {
                    anthropicContent.push({ type: 'text', text: part.text });
                }
                else if (part.type === 'image_url') {
                    const url = part.image_url.url;
                    // Extract base64 data from data: URLs
                    const dataMatch = url.match(/^data:(image\/\w+);base64,(.+)$/);
                    if (dataMatch) {
                        anthropicContent.push({
                            type: 'image',
                            source: {
                                type: 'base64',
                                media_type: dataMatch[1],
                                data: dataMatch[2],
                            },
                        });
                    }
                    else {
                        // For external URLs, Anthropic supports URL source type
                        anthropicContent.push({
                            type: 'image',
                            source: { type: 'url', url },
                        });
                    }
                }
            }
            return { role: msg.role, content: anthropicContent };
        }
        // --- Simple text ---
        return {
            role: msg.role,
            content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content ?? ''),
        };
    }
    /**
     * Converts OpenAI-style tool definitions to Anthropic's format.
     *
     * OpenAI uses `{ type: 'function', function: { name, description, parameters } }`
     * while Anthropic uses `{ name, description, input_schema }`.
     *
     * @param {Array<Record<string, unknown>>} [tools] - OpenAI-formatted tool defs.
     * @returns {AnthropicToolDef[]} Anthropic-formatted tool definitions.
     * @private
     */
    convertToolDefs(tools) {
        if (!tools || tools.length === 0)
            return [];
        return tools.map(tool => {
            // OpenAI format: { type: 'function', function: { name, description, parameters } }
            const fn = tool?.function;
            if (fn?.name) {
                return {
                    name: fn.name,
                    description: (fn.description ?? ''),
                    // Anthropic calls it input_schema, OpenAI calls it parameters
                    input_schema: fn.parameters ?? { type: 'object' },
                };
            }
            // AgentOS ITool format: { name, description, inputSchema }
            return {
                name: tool.name ?? 'unknown',
                description: tool.description ?? '',
                input_schema: tool.inputSchema ?? tool.parameters ?? { type: 'object' },
            };
        });
    }
    /**
     * Converts an OpenAI-style toolChoice value to Anthropic's tool_choice format.
     *
     * @param {string | Record<string, unknown>} choice - OpenAI tool choice.
     * @returns {Record<string, unknown>} Anthropic tool_choice value.
     * @private
     */
    convertToolChoice(choice) {
        if (typeof choice === 'string') {
            // "auto" → { type: "auto" }, "none" → { type: "auto" } (no direct "none" in Anthropic),
            // "required" → { type: "any" }
            if (choice === 'required')
                return { type: 'any' };
            return { type: 'auto' };
        }
        // Object form: { type: "function", function: { name: "..." } } → { type: "tool", name: "..." }
        const fn = choice?.function;
        if (fn?.name) {
            return { type: 'tool', name: fn.name };
        }
        return { type: 'auto' };
    }
    // -------------------------------------------------------------------------
    // Response mapping
    // -------------------------------------------------------------------------
    /**
     * Maps a non-streaming Anthropic Messages response to IProvider format.
     *
     * Extracts text content, tool_use blocks, and usage metrics, then normalizes
     * the stop reason from Anthropic's vocabulary to IProvider conventions.
     *
     * @param {AnthropicMessagesResponse} apiResponse - Raw Anthropic response.
     * @returns {ModelCompletionResponse} Normalized completion response.
     * @private
     */
    mapResponseToCompletion(apiResponse) {
        // Collect text content
        const textParts = apiResponse.content
            .filter(block => block.type === 'text' && block.text)
            .map(block => block.text);
        const fullText = textParts.join('');
        // Collect tool_use blocks and convert to OpenAI-style tool_calls
        const toolCalls = apiResponse.content
            .filter(block => block.type === 'tool_use')
            .map(block => ({
            id: block.id,
            type: 'function',
            function: {
                name: block.name,
                arguments: JSON.stringify(block.input ?? {}),
            },
        }));
        const hasToolCalls = toolCalls.length > 0;
        const finishReason = this.mapStopReason(apiResponse.stop_reason);
        const usage = {
            promptTokens: apiResponse.usage.input_tokens,
            completionTokens: apiResponse.usage.output_tokens,
            totalTokens: apiResponse.usage.input_tokens + apiResponse.usage.output_tokens,
            costUSD: this.estimateCost(apiResponse.usage.input_tokens, apiResponse.usage.output_tokens, apiResponse.model, apiResponse.usage.cache_read_input_tokens, apiResponse.usage.cache_creation_input_tokens),
            cacheCreationInputTokens: apiResponse.usage.cache_creation_input_tokens,
            cacheReadInputTokens: apiResponse.usage.cache_read_input_tokens,
        };
        const choice = {
            index: 0,
            message: {
                role: 'assistant',
                content: fullText || null,
                ...(hasToolCalls && { tool_calls: toolCalls }),
            },
            finishReason,
        };
        return {
            id: apiResponse.id,
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            modelId: apiResponse.model,
            choices: [choice],
            usage,
        };
    }
    /**
     * Maps Anthropic stop reasons to IProvider-convention finish reasons.
     *
     * - `end_turn` → `"stop"` (natural completion)
     * - `tool_use` → `"tool_calls"` (model wants to invoke tools)
     * - `max_tokens` → `"length"` (hit token limit)
     * - `stop_sequence` → `"stop"` (hit a caller-specified stop sequence)
     *
     * @param {string | null} stopReason - Anthropic's stop_reason value.
     * @returns {string} Normalized finish reason.
     * @private
     */
    mapStopReason(stopReason) {
        switch (stopReason) {
            case 'end_turn': return 'stop';
            case 'tool_use': return 'tool_calls';
            case 'max_tokens': return 'length';
            case 'stop_sequence': return 'stop';
            default: return stopReason ?? 'stop';
        }
    }
    /**
     * Assembles completed tool calls from the streaming accumulator.
     *
     * @param {Map<number, { id: string; name: string; argsJson: string }>} accum - Tool call accumulators.
     * @returns {NonNullable<ChatMessage['tool_calls']>} Assembled tool calls array.
     * @private
     */
    assembleToolCalls(accum) {
        if (accum.size === 0)
            return [];
        return Array.from(accum.values()).map(tc => ({
            id: tc.id,
            type: 'function',
            function: {
                name: tc.name,
                arguments: tc.argsJson || '{}',
            },
        }));
    }
    /**
     * Estimates USD cost for a given model and token counts.
     *
     * Looks up pricing from the static model catalog. Returns undefined
     * if the model is not found in the catalog.
     *
     * @param {number} inputTokens - Number of input tokens.
     * @param {number} outputTokens - Number of output tokens.
     * @param {string} modelId - Model identifier for pricing lookup.
     * @returns {number | undefined} Estimated cost in USD.
     * @private
     */
    /**
     * Estimate cost in USD for a completion, including Anthropic's prompt-
     * caching tier pricing.
     *
     * Anthropic billing tiers (as of 2025):
     *   input_tokens            × 1.00 × base input rate  (non-cached input)
     *   cache_read_input_tokens × 0.10 × base input rate  (cache hit)
     *   cache_creation_input_tokens × 1.25 × base input rate  (5-min TTL write)
     *   output_tokens           × 1.00 × base output rate
     *
     * The API's `input_tokens` field already EXCLUDES cached tokens, so we
     * sum three separate components for total input cost. Previous
     * implementation used only `input_tokens` × rate, which happened to
     * be correct for the non-cached portion but hid cache creation cost
     * and ignored cache read cost entirely — meaning reported costUSD
     * was always BELOW true billed amount whenever caching was active.
     *
     * 1-hour TTL cache-creation rate is 2× the base input rate, not 1.25×.
     * We can't tell which TTL was used from the response, so we assume
     * the default 5-minute tier. For long-lived cached contexts the
     * reported cost will under-estimate by the 0.75× difference on
     * creation tokens (minor; mostly one-shot at run start).
     */
    estimateCost(inputTokens, outputTokens, modelId, cacheReadTokens, cacheCreationTokens) {
        const info = ANTHROPIC_MODELS.find(m => m.modelId === modelId);
        if (!info?.pricePer1MTokensInput || !info?.pricePer1MTokensOutput)
            return undefined;
        const inputPrice = info.pricePer1MTokensInput;
        const outputPrice = info.pricePer1MTokensOutput;
        const nonCachedInput = (inputTokens / 1000000) * inputPrice;
        const cachedRead = ((cacheReadTokens ?? 0) / 1000000) * inputPrice * 0.10;
        const cachedCreate = ((cacheCreationTokens ?? 0) / 1000000) * inputPrice * 1.25;
        const output = (outputTokens / 1000000) * outputPrice;
        return nonCachedInput + cachedRead + cachedCreate + output;
    }
    /**
     * Builds an abort chunk for early stream termination.
     *
     * @param {string} modelId - The model ID for the response.
     * @returns {ModelCompletionResponse} A terminal chunk with abort error.
     * @private
     */
    buildAbortChunk(modelId) {
        return {
            id: `anthropic-abort-${Date.now()}`,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            modelId,
            choices: [],
            error: { message: 'Stream aborted by caller', type: 'abort' },
            isFinal: true,
        };
    }
    // -------------------------------------------------------------------------
    // HTTP transport
    // -------------------------------------------------------------------------
    /**
     * Makes a non-streaming API request to Anthropic's API with retry logic.
     *
     * Uses the `x-api-key` header (Anthropic's auth mechanism) and the required
     * `anthropic-version` header for API versioning.
     *
     * @template T The expected response type.
     * @param {string} endpoint - API endpoint path (e.g., "/v1/messages").
     * @param {'POST'} method - HTTP method (Anthropic Messages API is POST-only).
     * @param {Record<string, unknown>} body - Request body.
     * @returns {Promise<T>} Parsed JSON response.
     * @throws {AnthropicProviderError} On authentication, validation, rate-limit, or network errors.
     * @private
     */
    async makeApiRequest(endpoint, method, body) {
        const url = `${this.config.baseURL}${endpoint}`;
        const headers = this.buildHeaders();
        let lastError = new AnthropicProviderError('Request failed after all retries.', 'MAX_RETRIES_REACHED');
        for (let attempt = 0; attempt < this.config.maxRetries; attempt++) {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), this.config.requestTimeout);
            try {
                const response = await fetch(url, {
                    method,
                    headers: { ...headers, 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                    signal: controller.signal,
                });
                clearTimeout(timeoutId);
                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({}));
                    const errorMessage = errorData.error?.message || `HTTP ${response.status}: ${response.statusText}`;
                    const errorType = errorData.error?.type;
                    // Non-retryable client errors
                    if (response.status === 401 || response.status === 403 || response.status === 400 || response.status === 404) {
                        throw new AnthropicProviderError(errorMessage, 'API_CLIENT_ERROR', response.status, errorType, errorData);
                    }
                    // Rate limit — respect Retry-After header
                    if (response.status === 429) {
                        lastError = new AnthropicProviderError(errorMessage, 'RATE_LIMIT_EXCEEDED', 429, errorType, errorData);
                        const retryAfter = response.headers.get('retry-after');
                        const retryAfterMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : (2 ** attempt) * 1000;
                        await new Promise(resolve => setTimeout(resolve, retryAfterMs));
                        continue;
                    }
                    // Retryable server errors (5xx)
                    if (response.status >= 500) {
                        lastError = new AnthropicProviderError(errorMessage, 'API_SERVER_ERROR', response.status, errorType, errorData);
                        await new Promise(resolve => setTimeout(resolve, (2 ** attempt) * 1000));
                        continue;
                    }
                    throw new AnthropicProviderError(errorMessage, 'API_REQUEST_FAILED', response.status, errorType, errorData);
                }
                return (await response.json());
            }
            catch (error) {
                clearTimeout(timeoutId);
                if (error instanceof AnthropicProviderError) {
                    if (error.code === 'API_CLIENT_ERROR')
                        throw error;
                    lastError = error;
                }
                else if (error instanceof Error && error.name === 'AbortError') {
                    lastError = new AnthropicProviderError(`Request timed out after ${this.config.requestTimeout}ms.`, 'REQUEST_TIMEOUT');
                }
                else {
                    lastError = new AnthropicProviderError(error instanceof Error ? error.message : 'Network or unknown error', 'NETWORK_ERROR');
                }
                if (attempt === this.config.maxRetries - 1)
                    break;
                const delay = Math.min(30000, (1000 * (2 ** attempt)) + Math.random() * 1000);
                console.warn(`[AnthropicProvider] Retry ${attempt + 1}/${this.config.maxRetries - 1} in ${(delay / 1000).toFixed(1)}s`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
        throw lastError;
    }
    /**
     * Makes a streaming API request and returns the raw ReadableStream.
     *
     * @param {string} endpoint - API endpoint.
     * @param {Record<string, unknown>} body - Request body (must include `stream: true`).
     * @returns {Promise<ReadableStream<Uint8Array>>} The response body stream.
     * @throws {AnthropicProviderError} On connection errors.
     * @private
     */
    async makeStreamRequest(endpoint, body) {
        const url = `${this.config.baseURL}${endpoint}`;
        const headers = this.buildHeaders();
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.config.requestTimeout);
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { ...headers, 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                signal: controller.signal,
            });
            clearTimeout(timeoutId);
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                const errorMessage = errorData.error?.message || `HTTP ${response.status}: ${response.statusText}`;
                throw new AnthropicProviderError(errorMessage, 'STREAM_CONNECTION_FAILED', response.status, errorData.error?.type, errorData);
            }
            if (!response.body) {
                throw new AnthropicProviderError('Expected a stream response but body was null.', 'STREAM_BODY_NULL');
            }
            return response.body;
        }
        catch (error) {
            clearTimeout(timeoutId);
            if (error instanceof AnthropicProviderError)
                throw error;
            throw new AnthropicProviderError(error instanceof Error ? error.message : 'Failed to connect to Anthropic stream.', 'STREAM_CONNECTION_FAILED');
        }
    }
    /**
     * Builds the common headers for all Anthropic API requests.
     *
     * Includes the `x-api-key` authentication header and the required
     * `anthropic-version` header that pins the API behavior.
     *
     * @returns {Record<string, string>} Request headers.
     * @private
     */
    buildHeaders() {
        return {
            'x-api-key': this.keyPool?.hasKeys ? this.keyPool.next() : this.config.apiKey,
            'anthropic-version': '2023-06-01',
            'User-Agent': 'AgentOS/1.0 (AnthropicProvider)',
        };
    }
    // -------------------------------------------------------------------------
    // SSE parsing
    // -------------------------------------------------------------------------
    /**
     * Parses an SSE (Server-Sent Events) stream from Anthropic.
     *
     * Anthropic SSE events follow the format:
     * ```
     * event: <event_type>
     * data: <json_payload>
     * ```
     *
     * This parser extracts the `data:` line content for each event and yields
     * the raw JSON strings for the caller to parse and dispatch.
     *
     * @param {ReadableStream<Uint8Array>} stream - The raw SSE byte stream.
     * @returns {AsyncGenerator<string>} Yields JSON string payloads.
     * @private
     */
    async *parseSseStream(stream) {
        const reader = stream.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done)
                    break;
                buffer += decoder.decode(value, { stream: true });
                // SSE events are separated by double newlines
                let eolIndex;
                while ((eolIndex = buffer.indexOf('\n\n')) >= 0) {
                    const messageBlock = buffer.substring(0, eolIndex);
                    buffer = buffer.substring(eolIndex + 2);
                    // Extract data: lines from the event block
                    const lines = messageBlock.split('\n');
                    for (const line of lines) {
                        if (line.startsWith('data: ')) {
                            const dataContent = line.substring('data: '.length).trim();
                            if (dataContent)
                                yield dataContent;
                        }
                    }
                }
            }
            // Process any trailing content in the buffer
            if (buffer.trim()) {
                const lines = buffer.split('\n');
                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const dataContent = line.substring('data: '.length).trim();
                        if (dataContent)
                            yield dataContent;
                    }
                }
            }
        }
        catch (error) {
            const message = error instanceof Error ? error.message : 'SSE stream parsing error';
            console.error('AnthropicProvider: Error reading SSE stream:', message);
            throw new AnthropicProviderError(message, 'STREAM_PARSING_ERROR');
        }
        finally {
            // Ensure the reader is released
            try {
                await reader.cancel();
            }
            catch { /* swallow cleanup errors */ }
        }
    }
}
//# sourceMappingURL=AnthropicProvider.js.map