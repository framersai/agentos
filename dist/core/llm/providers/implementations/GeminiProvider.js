// @ts-nocheck
// File: backend/agentos/core/llm/providers/implementations/GeminiProvider.ts
import { GeminiProviderError } from '../errors/GeminiProviderError.js';
import { ApiKeyPool } from '../../../providers/ApiKeyPool.js';
// ---------------------------------------------------------------------------
// Known model catalog
// ---------------------------------------------------------------------------
/** Static catalog of well-known Gemini models and their metadata. */
const GEMINI_MODELS = [
    {
        modelId: 'gemini-2.5-flash',
        providerId: 'gemini',
        displayName: 'Gemini 2.5 Flash',
        description: 'Fast, cost-effective model with strong reasoning and multimodal capabilities.',
        capabilities: ['chat', 'tool_use', 'vision_input', 'json_mode'],
        contextWindowSize: 1048576,
        outputTokenLimit: 65536,
        pricePer1MTokensInput: 0.15,
        pricePer1MTokensOutput: 0.60,
        supportsStreaming: true,
        status: 'active',
    },
    {
        modelId: 'gemini-2.5-pro',
        providerId: 'gemini',
        displayName: 'Gemini 2.5 Pro',
        description: 'Most capable Gemini model for complex reasoning and analysis.',
        capabilities: ['chat', 'tool_use', 'vision_input', 'json_mode'],
        contextWindowSize: 1048576,
        outputTokenLimit: 65536,
        pricePer1MTokensInput: 1.25,
        pricePer1MTokensOutput: 10.00,
        supportsStreaming: true,
        status: 'active',
    },
    {
        modelId: 'gemini-2.0-flash',
        providerId: 'gemini',
        displayName: 'Gemini 2.0 Flash',
        description: 'Previous-generation fast model with strong performance.',
        capabilities: ['chat', 'tool_use', 'vision_input', 'json_mode'],
        contextWindowSize: 1048576,
        outputTokenLimit: 8192,
        pricePer1MTokensInput: 0.10,
        pricePer1MTokensOutput: 0.40,
        supportsStreaming: true,
        status: 'active',
    },
    {
        modelId: 'gemini-1.5-pro',
        providerId: 'gemini',
        displayName: 'Gemini 1.5 Pro',
        description: 'Stable model with 2M context window for long-document tasks.',
        capabilities: ['chat', 'tool_use', 'vision_input', 'json_mode'],
        contextWindowSize: 2097152,
        outputTokenLimit: 8192,
        pricePer1MTokensInput: 1.25,
        pricePer1MTokensOutput: 5.00,
        supportsStreaming: true,
        status: 'active',
    },
];
// ---------------------------------------------------------------------------
// Provider implementation
// ---------------------------------------------------------------------------
/**
 * @class GeminiProvider
 * @implements {IProvider}
 *
 * Provides native integration with Google's Gemini REST API.
 *
 * Handles the structural differences between Gemini's API and the OpenAI-style
 * conventions used by IProvider: role mapping (`assistant` -> `model`), system
 * instruction extraction, tool schema translation, and finish reason normalization.
 *
 * @example
 * const provider = new GeminiProvider();
 * await provider.initialize({ apiKey: 'AIzaSy...' });
 * const response = await provider.generateCompletion(
 *   'gemini-2.5-flash',
 *   [{ role: 'user', content: 'Hello!' }],
 *   { maxTokens: 1024 },
 * );
 */
export class GeminiProvider {
    constructor() {
        /** @inheritdoc */
        this.providerId = 'gemini';
        /** @inheritdoc */
        this.isInitialized = false;
        this.keyPool = null;
    }
    // -------------------------------------------------------------------------
    // Lifecycle
    // -------------------------------------------------------------------------
    /**
     * Initialize the Gemini provider with the given configuration.
     *
     * Validates that an API key is present. Does NOT make a network call on
     * startup — Gemini does not have a lightweight health/models endpoint
     * that works without model-scoped paths.
     *
     * @param {GeminiProviderConfig} config - Provider configuration.
     * @returns {Promise<void>}
     * @throws {GeminiProviderError} If the API key is missing.
     */
    async initialize(config) {
        if (!config.apiKey) {
            throw new GeminiProviderError('API key is required for GeminiProvider initialization. Set GEMINI_API_KEY.', 'INIT_FAILED_MISSING_API_KEY');
        }
        this.config = {
            baseURL: 'https://generativelanguage.googleapis.com/v1beta',
            maxRetries: 3,
            requestTimeout: 60000,
            defaultModelId: 'gemini-2.5-flash',
            ...config,
        };
        this.keyPool = new ApiKeyPool(config.apiKey);
        this.defaultModelId = this.config.defaultModelId;
        this.isInitialized = true;
        console.log(`GeminiProvider initialized. Default model: ${this.defaultModelId || 'Not set'}.`);
    }
    // -------------------------------------------------------------------------
    // Chat completions (non-streaming)
    // -------------------------------------------------------------------------
    /**
     * Generates a non-streaming chat completion via Gemini's generateContent endpoint.
     *
     * Extracts system messages and places them in the `systemInstruction` field,
     * maps `assistant` role to `model`, converts tool definitions to Gemini's
     * `functionDeclarations` format, and normalizes the response back to
     * IProvider conventions.
     *
     * @param {string} modelId - The Gemini model to use (e.g., "gemini-2.5-flash").
     * @param {ChatMessage[]} messages - Conversation messages. System-role messages are
     *   extracted and sent as the `systemInstruction` field.
     * @param {ModelCompletionOptions} options - Completion options.
     * @returns {Promise<ModelCompletionResponse>} A normalized completion response.
     * @throws {GeminiProviderError} On authentication, validation, or network errors.
     *
     * @example
     * const resp = await provider.generateCompletion('gemini-2.5-flash', [
     *   { role: 'system', content: 'You are a helpful assistant.' },
     *   { role: 'user', content: 'Explain quantum computing in one sentence.' },
     * ], { maxTokens: 256 });
     * console.log(resp.choices[0].message.content);
     */
    async generateCompletion(modelId, messages, options) {
        this.ensureInitialized();
        const payload = this.buildRequestPayload(modelId, messages, options);
        // Gemini uses model-scoped endpoints: /models/{model}:generateContent
        const endpoint = `/models/${modelId}:generateContent`;
        const apiResponse = await this.makeApiRequest(endpoint, payload);
        return this.mapResponseToCompletion(apiResponse, modelId);
    }
    // -------------------------------------------------------------------------
    // Chat completions (streaming)
    // -------------------------------------------------------------------------
    /**
     * Generates a streaming chat completion via Gemini's streamGenerateContent endpoint.
     *
     * Gemini streaming uses SSE with `alt=sse` query parameter. Each SSE data line
     * contains a JSON object with `candidates[].content.parts[].text` for text deltas
     * and `candidates[].content.parts[].functionCall` for tool invocations.
     *
     * Normalizes all events into the IProvider streaming contract with
     * `responseTextDelta`, `toolCallsDeltas`, and `isFinal`.
     *
     * @param {string} modelId - The Gemini model to use.
     * @param {ChatMessage[]} messages - Conversation messages.
     * @param {ModelCompletionOptions} options - Completion options.
     * @returns {AsyncGenerator<ModelCompletionResponse>} Incremental response chunks.
     * @throws {GeminiProviderError} On connection or stream errors.
     */
    async *generateCompletionStream(modelId, messages, options) {
        this.ensureInitialized();
        const payload = this.buildRequestPayload(modelId, messages, options);
        const responseId = `gemini-${modelId}-${Date.now()}`;
        // Handle pre-aborted signals
        const abortSignal = options.abortSignal;
        if (abortSignal?.aborted) {
            yield this.buildAbortChunk(modelId);
            return;
        }
        // Streaming endpoint uses ?alt=sse and the API key query param
        const endpoint = `/models/${modelId}:streamGenerateContent`;
        const stream = await this.makeStreamRequest(endpoint, payload);
        // Accumulators for building the complete response
        let accumulatedContent = '';
        let lastFinishReason = null;
        let lastUsage;
        /** Map from part index -> tool call accumulator */
        const toolCallAccum = new Map();
        let toolCallIndex = 0;
        const abortHandler = () => { };
        abortSignal?.addEventListener('abort', abortHandler, { once: true });
        try {
            for await (const rawData of this.parseSseStream(stream)) {
                if (abortSignal?.aborted) {
                    yield this.buildAbortChunk(modelId);
                    break;
                }
                let chunk;
                try {
                    chunk = JSON.parse(rawData);
                }
                catch {
                    // Malformed JSON — skip
                    console.warn('GeminiProvider: Could not parse SSE event JSON:', rawData);
                    continue;
                }
                // Handle API-level errors in the stream
                if (chunk.error) {
                    yield {
                        id: responseId,
                        object: 'chat.completion.chunk',
                        created: Math.floor(Date.now() / 1000),
                        modelId,
                        choices: [],
                        error: {
                            message: chunk.error.message,
                            type: chunk.error.status,
                            code: chunk.error.code,
                        },
                        isFinal: true,
                    };
                    return;
                }
                // Track usage from every chunk — the last one will have final totals
                if (chunk.usageMetadata) {
                    lastUsage = chunk.usageMetadata;
                }
                const candidate = chunk.candidates?.[0];
                if (!candidate)
                    continue;
                if (candidate.finishReason) {
                    lastFinishReason = candidate.finishReason;
                }
                const parts = candidate.content?.parts ?? [];
                for (const part of parts) {
                    if (part.text !== undefined) {
                        // Text delta
                        accumulatedContent += part.text;
                        yield {
                            id: responseId,
                            object: 'chat.completion.chunk',
                            created: Math.floor(Date.now() / 1000),
                            modelId,
                            choices: [{
                                    index: 0,
                                    message: { role: 'assistant', content: part.text },
                                    finishReason: null,
                                }],
                            responseTextDelta: part.text,
                        };
                    }
                    else if (part.functionCall) {
                        // Tool call — Gemini delivers function calls as complete objects,
                        // not incremental deltas. We emit them as a single delta per call.
                        const idx = toolCallIndex++;
                        toolCallAccum.set(idx, {
                            name: part.functionCall.name,
                            args: part.functionCall.args,
                        });
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
                                    index: idx,
                                    id: `call_gemini_${Date.now()}_${idx}`,
                                    type: 'function',
                                    function: {
                                        name: part.functionCall.name,
                                        // Gemini delivers complete args, so emit them as a single delta
                                        arguments_delta: JSON.stringify(part.functionCall.args),
                                    },
                                }],
                        };
                    }
                }
            }
            // Emit final chunk with usage and finish reason
            const toolCalls = this.assembleToolCalls(toolCallAccum);
            const hasToolCalls = toolCalls.length > 0;
            const usage = this.mapUsage(lastUsage, modelId);
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
                        finishReason: this.mapFinishReason(lastFinishReason),
                    }],
                usage,
                isFinal: true,
            };
        }
        catch (streamError) {
            const message = streamError instanceof Error
                ? streamError.message
                : 'Gemini stream processing error';
            console.error(`GeminiProvider stream error for model ${modelId}:`, message);
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
    // Embeddings
    // -------------------------------------------------------------------------
    /**
     * Generates embeddings using Gemini's embedding models.
     *
     * Uses the `models/{model}:embedContent` endpoint. Currently Gemini
     * supports embedding one text at a time, so we batch sequentially.
     *
     * @param {string} modelId - Embedding model (e.g., "text-embedding-004").
     * @param {string[]} texts - Input texts to embed.
     * @param {ProviderEmbeddingOptions} [options] - Optional embedding parameters.
     * @returns {Promise<ProviderEmbeddingResponse>} Embedding vectors.
     * @throws {GeminiProviderError} On API errors.
     */
    async generateEmbeddings(modelId, texts, options) {
        this.ensureInitialized();
        // Gemini's batch embedding endpoint
        const endpoint = `/models/${modelId}:batchEmbedContents`;
        const requests = texts.map(text => ({
            model: `models/${modelId}`,
            content: { parts: [{ text }] },
        }));
        const apiResponse = await this.makeApiRequest(endpoint, { requests });
        return {
            object: 'list',
            data: apiResponse.embeddings.map((emb, index) => ({
                object: 'embedding',
                embedding: emb.values,
                index,
            })),
            model: modelId,
            usage: {
                prompt_tokens: 0, // Gemini does not report embedding token counts
                total_tokens: 0,
            },
        };
    }
    // -------------------------------------------------------------------------
    // Introspection
    // -------------------------------------------------------------------------
    /**
     * Returns a static catalog of known Gemini models.
     *
     * Uses a hardcoded catalog kept up-to-date with major releases, since
     * the Gemini models list endpoint requires iterating over all models.
     *
     * @param {{ capability?: string }} [filter] - Optional capability filter.
     * @returns {Promise<ModelInfo[]>} Array of known Gemini models.
     */
    async listAvailableModels(filter) {
        this.ensureInitialized();
        if (filter?.capability) {
            return GEMINI_MODELS.filter(m => m.capabilities.includes(filter.capability));
        }
        return [...GEMINI_MODELS];
    }
    /**
     * Retrieves metadata for a specific Gemini model from the static catalog.
     *
     * @param {string} modelId - Model identifier (e.g., "gemini-2.5-flash").
     * @returns {Promise<ModelInfo | undefined>} Model info or undefined if not found.
     */
    async getModelInfo(modelId) {
        this.ensureInitialized();
        return GEMINI_MODELS.find(m => m.modelId === modelId);
    }
    /**
     * Performs a lightweight health check by sending a minimal generateContent request.
     *
     * @returns {Promise<{ isHealthy: boolean; details?: unknown }>} Health status.
     */
    async checkHealth() {
        try {
            const model = this.defaultModelId || 'gemini-2.5-flash';
            await this.makeApiRequest(`/models/${model}:generateContent`, {
                contents: [{ role: 'user', parts: [{ text: 'ping' }] }],
                generationConfig: { maxOutputTokens: 1 },
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
        console.log('GeminiProvider shutdown complete.');
    }
    // =========================================================================
    // Private helpers
    // =========================================================================
    /**
     * Guard that throws if the provider has not been initialized.
     *
     * @private
     * @throws {GeminiProviderError} If not initialized.
     */
    ensureInitialized() {
        if (!this.isInitialized) {
            throw new GeminiProviderError('GeminiProvider is not initialized. Call initialize() first.', 'PROVIDER_NOT_INITIALIZED');
        }
    }
    // -------------------------------------------------------------------------
    // Payload construction
    // -------------------------------------------------------------------------
    /**
     * Builds the Gemini API request payload from IProvider inputs.
     *
     * The key transformations are:
     * 1. System messages extracted to `systemInstruction` (Gemini has no system role).
     * 2. `assistant` role mapped to `model` (Gemini's convention).
     * 3. Tool messages mapped to `functionResponse` parts within user turns.
     * 4. OpenAI-style tool definitions converted to `functionDeclarations`.
     *
     * @param {string} _modelId - Target model (used for endpoint, not in body).
     * @param {ChatMessage[]} messages - Conversation messages.
     * @param {ModelCompletionOptions} options - Completion options.
     * @returns {Record<string, unknown>} The request body for Gemini's API.
     * @private
     */
    buildRequestPayload(_modelId, messages, options) {
        // --- Extract system messages into systemInstruction ---
        // Gemini treats system instructions as a separate top-level field,
        // similar to Anthropic but with a `parts` array wrapper.
        const systemParts = [];
        const conversationMessages = [];
        for (const msg of messages) {
            if (msg.role === 'system') {
                const text = typeof msg.content === 'string'
                    ? msg.content
                    : Array.isArray(msg.content)
                        ? msg.content.filter(p => p.type === 'text').map(p => p.text).join('\n')
                        : '';
                if (text)
                    systemParts.push(text);
            }
            else {
                conversationMessages.push(msg);
            }
        }
        // --- Convert messages to Gemini content format ---
        const contents = this.convertMessages(conversationMessages);
        const payload = {
            contents,
        };
        // Include systemInstruction only if there's system content
        if (systemParts.length > 0) {
            payload.systemInstruction = {
                parts: [{ text: systemParts.join('\n\n') }],
            };
        }
        // --- Generation config ---
        const generationConfig = {};
        if (options.temperature !== undefined)
            generationConfig.temperature = options.temperature;
        if (options.maxTokens !== undefined)
            generationConfig.maxOutputTokens = options.maxTokens;
        if (options.topP !== undefined)
            generationConfig.topP = options.topP;
        if (options.stopSequences?.length)
            generationConfig.stopSequences = options.stopSequences;
        // JSON mode: Gemini uses responseMimeType to enforce JSON output
        if (options.responseFormat?.type === 'json_object') {
            generationConfig.responseMimeType = 'application/json';
        }
        // topK support via customModelParams
        if (options.customModelParams?.topK !== undefined) {
            generationConfig.topK = options.customModelParams.topK;
        }
        if (Object.keys(generationConfig).length > 0) {
            payload.generationConfig = generationConfig;
        }
        // --- Tool definitions ---
        const tools = this.convertToolDefs(options.tools);
        if (tools.length > 0) {
            payload.tools = [{ functionDeclarations: tools }];
        }
        // Pass through custom model params (excluding ones we already handle)
        if (options.customModelParams) {
            const { topK, ...rest } = options.customModelParams;
            if (Object.keys(rest).length > 0) {
                Object.assign(payload, rest);
            }
        }
        return payload;
    }
    /**
     * Converts an array of ChatMessages to Gemini's content format.
     *
     * Maps IProvider roles to Gemini roles:
     * - `user` -> `user`
     * - `assistant` -> `model` (Gemini uses "model" instead of "assistant")
     * - `tool` -> `user` with `functionResponse` parts
     *
     * @param {ChatMessage[]} messages - IProvider-format messages.
     * @returns {GeminiContent[]} Gemini-format content array.
     * @private
     */
    convertMessages(messages) {
        const contents = [];
        for (const msg of messages) {
            if (msg.role === 'assistant') {
                // --- Assistant messages map to "model" role ---
                const parts = [];
                // Add text content if present
                if (typeof msg.content === 'string' && msg.content) {
                    parts.push({ text: msg.content });
                }
                // Convert tool_calls to functionCall parts
                if (msg.tool_calls?.length) {
                    for (const tc of msg.tool_calls) {
                        let parsedArgs;
                        try {
                            parsedArgs = typeof tc.function.arguments === 'string'
                                ? JSON.parse(tc.function.arguments)
                                : tc.function.arguments ?? {};
                        }
                        catch {
                            parsedArgs = {};
                        }
                        parts.push({
                            functionCall: { name: tc.function.name, args: parsedArgs },
                        });
                    }
                }
                // Ensure at least one part — Gemini requires non-empty parts
                if (parts.length === 0) {
                    parts.push({ text: '' });
                }
                contents.push({ role: 'model', parts });
            }
            else if (msg.role === 'tool') {
                // --- Tool result messages become user-role functionResponse ---
                // Gemini expects tool results as functionResponse parts in a user turn.
                let responseData;
                try {
                    const raw = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content ?? '');
                    responseData = typeof msg.content === 'string'
                        ? JSON.parse(raw)
                        : { result: raw };
                }
                catch {
                    // If the tool result isn't valid JSON, wrap it
                    responseData = { result: typeof msg.content === 'string' ? msg.content : String(msg.content) };
                }
                contents.push({
                    role: 'user',
                    parts: [{
                            functionResponse: {
                                name: msg.name || 'unknown',
                                response: responseData,
                            },
                        }],
                });
            }
            else {
                // --- User messages ---
                const parts = [];
                if (typeof msg.content === 'string') {
                    parts.push({ text: msg.content });
                }
                else if (Array.isArray(msg.content)) {
                    // Multimodal content — extract text parts
                    for (const part of msg.content) {
                        if (part.type === 'text') {
                            parts.push({ text: part.text });
                        }
                        // Image support could be added here via inlineData parts
                    }
                }
                if (parts.length === 0) {
                    parts.push({ text: '' });
                }
                contents.push({ role: 'user', parts });
            }
        }
        return contents;
    }
    /**
     * Converts OpenAI-style tool definitions to Gemini's functionDeclarations format.
     *
     * OpenAI uses `{ type: 'function', function: { name, description, parameters } }`
     * while Gemini uses `{ name, description, parameters }` inside a `functionDeclarations` array.
     *
     * @param {Array<Record<string, unknown>>} [tools] - OpenAI-formatted tool defs.
     * @returns {GeminiFunctionDeclaration[]} Gemini-formatted function declarations.
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
                    // Gemini uses the same "parameters" field name as OpenAI, unlike Anthropic's input_schema
                    parameters: fn.parameters,
                };
            }
            // AgentOS ITool format: { name, description, inputSchema }
            return {
                name: tool.name ?? 'unknown',
                description: tool.description ?? '',
                parameters: tool.inputSchema ?? tool.parameters,
            };
        });
    }
    // -------------------------------------------------------------------------
    // Response mapping
    // -------------------------------------------------------------------------
    /**
     * Maps a non-streaming Gemini response to IProvider format.
     *
     * Extracts text from `candidates[0].content.parts`, converts `functionCall`
     * parts to OpenAI-style `tool_calls`, and normalizes usage metadata.
     *
     * @param {GeminiResponse} apiResponse - Raw Gemini API response.
     * @param {string} modelId - The model ID used for the request.
     * @returns {ModelCompletionResponse} Normalized completion response.
     * @private
     */
    mapResponseToCompletion(apiResponse, modelId) {
        const candidate = apiResponse.candidates?.[0];
        const parts = candidate?.content?.parts ?? [];
        // Collect text from all text parts
        const textParts = parts
            .filter(p => p.text !== undefined)
            .map(p => p.text);
        const fullText = textParts.join('');
        // Collect function calls and convert to OpenAI-style tool_calls
        const toolCalls = parts
            .filter(p => p.functionCall)
            .map((p, idx) => ({
            id: `call_gemini_${Date.now()}_${idx}`,
            type: 'function',
            function: {
                name: p.functionCall.name,
                arguments: JSON.stringify(p.functionCall.args ?? {}),
            },
        }));
        const hasToolCalls = toolCalls.length > 0;
        const finishReason = this.mapFinishReason(candidate?.finishReason ?? null);
        const usage = this.mapUsage(apiResponse.usageMetadata, modelId);
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
            id: `gemini-${modelId}-${Date.now()}`,
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            modelId,
            choices: [choice],
            usage,
        };
    }
    /**
     * Maps Gemini finish reasons to IProvider-convention finish reasons.
     *
     * Gemini uses uppercase enum strings:
     * - `STOP` -> `"stop"` (natural completion)
     * - `MAX_TOKENS` -> `"length"` (hit token limit)
     * - `SAFETY` -> `"content_filter"` (blocked by safety filters)
     * - `RECITATION` -> `"content_filter"` (blocked by recitation check)
     *
     * @param {string | null} finishReason - Gemini's finish reason value.
     * @returns {string} Normalized finish reason.
     * @private
     */
    mapFinishReason(finishReason) {
        switch (finishReason) {
            case 'STOP': return 'stop';
            case 'MAX_TOKENS': return 'length';
            case 'SAFETY': return 'content_filter';
            case 'RECITATION': return 'content_filter';
            default: return finishReason?.toLowerCase() ?? 'stop';
        }
    }
    /**
     * Maps Gemini usage metadata to IProvider's ModelUsage format.
     *
     * @param {GeminiUsageMetadata} [meta] - Gemini usage metadata.
     * @param {string} modelId - Model ID for cost estimation.
     * @returns {ModelUsage} Normalized usage metrics.
     * @private
     */
    mapUsage(meta, modelId) {
        const promptTokens = meta?.promptTokenCount ?? 0;
        const completionTokens = meta?.candidatesTokenCount ?? 0;
        const totalTokens = meta?.totalTokenCount ?? (promptTokens + completionTokens);
        return {
            promptTokens,
            completionTokens,
            totalTokens,
            costUSD: this.estimateCost(promptTokens, completionTokens, modelId),
        };
    }
    /**
     * Assembles completed tool calls from the streaming accumulator.
     *
     * @param {Map<number, { name: string; args: Record<string, unknown> }>} accum - Accumulated tool calls.
     * @returns {NonNullable<ChatMessage['tool_calls']>} OpenAI-style tool_calls array.
     * @private
     */
    assembleToolCalls(accum) {
        if (accum.size === 0)
            return [];
        return Array.from(accum.entries()).map(([idx, tc]) => ({
            id: `call_gemini_${Date.now()}_${idx}`,
            type: 'function',
            function: {
                name: tc.name,
                arguments: JSON.stringify(tc.args ?? {}),
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
    estimateCost(inputTokens, outputTokens, modelId) {
        const info = GEMINI_MODELS.find(m => m.modelId === modelId);
        if (!info?.pricePer1MTokensInput || !info?.pricePer1MTokensOutput)
            return undefined;
        return ((inputTokens / 1000000) * info.pricePer1MTokensInput +
            (outputTokens / 1000000) * info.pricePer1MTokensOutput);
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
            id: `gemini-abort-${Date.now()}`,
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
     * Makes a non-streaming API request to the Gemini API with retry logic.
     *
     * Authentication uses a `?key=` query parameter (Gemini's auth mechanism),
     * NOT a header-based approach like OpenAI or Anthropic.
     *
     * @template T The expected response type.
     * @param {string} endpoint - API endpoint path (e.g., "/models/gemini-2.5-flash:generateContent").
     * @param {Record<string, unknown>} body - Request body.
     * @returns {Promise<T>} Parsed JSON response.
     * @throws {GeminiProviderError} On authentication, validation, rate-limit, or network errors.
     * @private
     */
    async makeApiRequest(endpoint, body) {
        // API key is passed as query parameter — Gemini's auth convention
        const url = `${this.config.baseURL}${endpoint}?key=${this.keyPool?.hasKeys ? this.keyPool.next() : this.config.apiKey}`;
        const headers = {
            'Content-Type': 'application/json',
            'User-Agent': 'AgentOS/1.0 (GeminiProvider)',
        };
        let lastError = new GeminiProviderError('Request failed after all retries.', 'MAX_RETRIES_REACHED');
        for (let attempt = 0; attempt < this.config.maxRetries; attempt++) {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), this.config.requestTimeout);
            try {
                const response = await fetch(url, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(body),
                    signal: controller.signal,
                });
                clearTimeout(timeoutId);
                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({}));
                    const errorMessage = errorData.error?.message || `HTTP ${response.status}: ${response.statusText}`;
                    const errorStatus = errorData.error?.status;
                    // Non-retryable client errors (auth, bad request, not found)
                    if (response.status === 400 || response.status === 401 || response.status === 403 || response.status === 404) {
                        throw new GeminiProviderError(errorMessage, 'API_CLIENT_ERROR', response.status, errorStatus, errorData);
                    }
                    // Rate limit — respect Retry-After header
                    if (response.status === 429) {
                        lastError = new GeminiProviderError(errorMessage, 'RATE_LIMIT_EXCEEDED', 429, errorStatus, errorData);
                        const retryAfter = response.headers.get('retry-after');
                        const retryAfterMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : (2 ** attempt) * 1000;
                        await new Promise(resolve => setTimeout(resolve, retryAfterMs));
                        continue;
                    }
                    // Retryable server errors (5xx)
                    if (response.status >= 500) {
                        lastError = new GeminiProviderError(errorMessage, 'API_SERVER_ERROR', response.status, errorStatus, errorData);
                        await new Promise(resolve => setTimeout(resolve, (2 ** attempt) * 1000));
                        continue;
                    }
                    throw new GeminiProviderError(errorMessage, 'API_REQUEST_FAILED', response.status, errorStatus, errorData);
                }
                return (await response.json());
            }
            catch (error) {
                clearTimeout(timeoutId);
                if (error instanceof GeminiProviderError) {
                    if (error.code === 'API_CLIENT_ERROR')
                        throw error;
                    lastError = error;
                }
                else if (error instanceof Error && error.name === 'AbortError') {
                    lastError = new GeminiProviderError(`Request timed out after ${this.config.requestTimeout}ms.`, 'REQUEST_TIMEOUT');
                }
                else {
                    lastError = new GeminiProviderError(error instanceof Error ? error.message : 'Network or unknown error', 'NETWORK_ERROR');
                }
                if (attempt === this.config.maxRetries - 1)
                    break;
                const delay = Math.min(30000, (1000 * (2 ** attempt)) + Math.random() * 1000);
                console.warn(`[GeminiProvider] Retry ${attempt + 1}/${this.config.maxRetries - 1} in ${(delay / 1000).toFixed(1)}s`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
        throw lastError;
    }
    /**
     * Makes a streaming API request and returns the raw ReadableStream.
     *
     * Uses the `?alt=sse` query parameter to enable SSE streaming,
     * combined with the `?key=` query parameter for authentication.
     *
     * @param {string} endpoint - API endpoint (e.g., "/models/gemini-2.5-flash:streamGenerateContent").
     * @param {Record<string, unknown>} body - Request body.
     * @returns {Promise<ReadableStream<Uint8Array>>} The response body stream.
     * @throws {GeminiProviderError} On connection errors.
     * @private
     */
    async makeStreamRequest(endpoint, body) {
        // Both alt=sse and key= are query params
        const url = `${this.config.baseURL}${endpoint}?alt=sse&key=${this.keyPool?.hasKeys ? this.keyPool.next() : this.config.apiKey}`;
        const headers = {
            'Content-Type': 'application/json',
            'User-Agent': 'AgentOS/1.0 (GeminiProvider)',
        };
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.config.requestTimeout);
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers,
                body: JSON.stringify(body),
                signal: controller.signal,
            });
            clearTimeout(timeoutId);
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                const errorMessage = errorData.error?.message || `HTTP ${response.status}: ${response.statusText}`;
                throw new GeminiProviderError(errorMessage, 'STREAM_CONNECTION_FAILED', response.status, errorData.error?.status, errorData);
            }
            if (!response.body) {
                throw new GeminiProviderError('Expected a stream response but body was null.', 'STREAM_BODY_NULL');
            }
            return response.body;
        }
        catch (error) {
            clearTimeout(timeoutId);
            if (error instanceof GeminiProviderError)
                throw error;
            throw new GeminiProviderError(error instanceof Error ? error.message : 'Failed to connect to Gemini stream.', 'STREAM_CONNECTION_FAILED');
        }
    }
    // -------------------------------------------------------------------------
    // SSE parsing
    // -------------------------------------------------------------------------
    /**
     * Parses an SSE (Server-Sent Events) stream from Gemini.
     *
     * Gemini SSE events follow the standard format:
     * ```
     * data: <json_payload>
     *
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
                // Process complete events (separated by double newlines)
                const events = buffer.split('\n\n');
                // Keep the last incomplete chunk in the buffer
                buffer = events.pop() || '';
                for (const event of events) {
                    const trimmed = event.trim();
                    if (!trimmed)
                        continue;
                    // Extract content after "data: " prefix
                    // Events may have multi-line data (though Gemini typically uses single-line)
                    const lines = trimmed.split('\n');
                    const dataLines = [];
                    for (const line of lines) {
                        if (line.startsWith('data: ')) {
                            dataLines.push(line.slice(6));
                        }
                        else if (line.startsWith('data:')) {
                            dataLines.push(line.slice(5));
                        }
                    }
                    if (dataLines.length > 0) {
                        const data = dataLines.join('\n').trim();
                        // Skip empty data or the [DONE] signal
                        if (data && data !== '[DONE]') {
                            yield data;
                        }
                    }
                }
            }
            // Process any remaining buffer content
            if (buffer.trim()) {
                const lines = buffer.trim().split('\n');
                const dataLines = [];
                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        dataLines.push(line.slice(6));
                    }
                    else if (line.startsWith('data:')) {
                        dataLines.push(line.slice(5));
                    }
                }
                if (dataLines.length > 0) {
                    const data = dataLines.join('\n').trim();
                    if (data && data !== '[DONE]') {
                        yield data;
                    }
                }
            }
        }
        finally {
            reader.releaseLock();
        }
    }
}
//# sourceMappingURL=GeminiProvider.js.map