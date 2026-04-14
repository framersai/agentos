// File: backend/agentos/core/llm/providers/implementations/OpenRouterProvider.ts
// @ts-nocheck
/**
 * @fileoverview Implements the IProvider interface for OpenRouter, a service that
 * provides access to a wide variety of LLMs from different providers through a unified API.
 * This provider handles routing requests to the specified models via OpenRouter.
 * @module backend/agentos/core/llm/providers/implementations/OpenRouterProvider
 * @implements {IProvider}
 */
import axios from 'axios';
import { OpenRouterProviderError } from '../errors/OpenRouterProviderError.js';
import { ApiKeyPool } from '../../../providers/ApiKeyPool.js';
import { createGMIErrorFromError, GMIErrorCode } from '../../../../core/utils/errors.js'; // Corrected import path
export class OpenRouterProvider {
    constructor() {
        this.providerId = 'openrouter';
        this.isInitialized = false;
        this.keyPool = null;
        this.availableModelsCache = new Map();
    }
    async initialize(config) {
        if (!config.apiKey) {
            throw new OpenRouterProviderError('OpenRouter API key (apiKey) is required for initialization.', 'INIT_FAILED_MISSING_API_KEY');
        }
        // Corrected: Ensure all properties of Required<OpenRouterProviderConfig> are present
        // by providing defaults for optional fields before freezing.
        this.config = Object.freeze({
            apiKey: config.apiKey,
            baseURL: config.baseURL || 'https://openrouter.ai/api/v1',
            defaultModelId: config.defaultModelId, // Can be undefined, but this.defaultModelId will store it
            siteUrl: config.siteUrl, // Can be undefined
            appName: config.appName, // Can be undefined
            requestTimeout: config.requestTimeout || 60000,
            streamRequestTimeout: config.streamRequestTimeout || 180000,
        });
        this.keyPool = new ApiKeyPool(config.apiKey);
        this.defaultModelId = this.config.defaultModelId; // Store the potentially undefined value
        const headers = {
            'Authorization': `Bearer ${this.keyPool.next()}`,
            'Content-Type': 'application/json',
            'User-Agent': `AgentOS/1.0 (OpenRouterProvider; ${this.config.appName || 'UnknownApp'})`,
        };
        if (this.config.siteUrl) {
            headers['HTTP-Referer'] = this.config.siteUrl;
        }
        if (this.config.appName) {
            headers['X-Title'] = this.config.appName;
        }
        this.client = axios.create({
            baseURL: this.config.baseURL,
            headers,
        });
        try {
            await this.refreshAvailableModels();
            this.isInitialized = true;
            console.log(`OpenRouterProvider initialized. Default Model: ${this.defaultModelId || 'Not set'}. Found ${this.availableModelsCache.size} models via OpenRouter.`);
        }
        catch (error) {
            this.isInitialized = false;
            const initError = error instanceof OpenRouterProviderError ? error :
                createGMIErrorFromError(// Corrected: use imported createGMIErrorFromError
                error instanceof Error ? error : new Error(String(error)), GMIErrorCode.LLM_PROVIDER_ERROR, // Corrected: use imported GMIErrorCode
                { providerId: this.providerId }, `OpenRouterProvider failed to initialize: ${error instanceof Error ? error.message : String(error)}`);
            console.error(initError.message, initError.details || initError);
            throw initError;
        }
    }
    async refreshAvailableModels() {
        const responseData = await this.makeApiRequest('/models', 'GET', this.config.requestTimeout);
        this.availableModelsCache.clear();
        if (responseData && Array.isArray(responseData.data)) {
            responseData.data.forEach((apiModel) => {
                const modelInfo = this.mapApiToModelInfo(apiModel);
                this.availableModelsCache.set(modelInfo.modelId, modelInfo);
            });
        }
        else {
            console.warn("OpenRouterProvider: Received no model data or malformed response from /models endpoint.");
        }
    }
    mapApiToModelInfo(apiModel) {
        const capabilities = ['chat', 'completion'];
        if (apiModel.architecture?.modality === 'multimodal') {
            capabilities.push('vision_input');
        }
        const knownAdvancedModelPatterns = ['gpt-3.5', 'gpt-4', 'claude-2', 'claude-3', 'gemini', 'mistral', 'llama'];
        if (knownAdvancedModelPatterns.some(pattern => apiModel.id.toLowerCase().includes(pattern))) {
            capabilities.push('tool_use', 'json_mode');
        }
        if (apiModel.id.includes('embedding') || apiModel.id.includes('embed')) {
            capabilities.push('embeddings');
        }
        const parsePrice = (priceStr, tokensFactor = 1000000) => {
            if (typeof priceStr !== 'string')
                return undefined;
            const price = parseFloat(priceStr);
            return isNaN(price) ? undefined : price * tokensFactor;
        };
        return {
            modelId: apiModel.id,
            providerId: this.providerId,
            displayName: apiModel.name,
            description: apiModel.description,
            capabilities: Array.from(new Set(capabilities)),
            contextWindowSize: apiModel.context_length || undefined,
            pricePer1MTokensInput: parsePrice(apiModel.pricing.prompt),
            pricePer1MTokensOutput: parsePrice(apiModel.pricing.completion),
            supportsStreaming: true,
            status: 'active',
        };
    }
    ensureInitialized() {
        if (!this.isInitialized) {
            throw new OpenRouterProviderError('OpenRouterProvider is not initialized. Please call the initialize() method first.', 'PROVIDER_NOT_INITIALIZED');
        }
    }
    mapToOpenRouterMessages(messages) {
        return messages.map(msg => {
            const mappedMsg = { role: msg.role, content: msg.content };
            if (msg.name)
                mappedMsg.name = msg.name;
            if (msg.tool_calls)
                mappedMsg.tool_calls = msg.tool_calls;
            if (msg.tool_call_id)
                mappedMsg.tool_call_id = msg.tool_call_id;
            return mappedMsg;
        });
    }
    async generateCompletion(modelId, messages, options) {
        this.ensureInitialized();
        const openRouterMessages = this.mapToOpenRouterMessages(messages);
        const payload = {
            model: modelId,
            messages: openRouterMessages,
            stream: false,
            ...(options.temperature !== undefined && { temperature: options.temperature }),
            ...(options.topP !== undefined && { top_p: options.topP }),
            ...(options.maxTokens !== undefined && { max_tokens: options.maxTokens }),
            ...(options.presencePenalty !== undefined && { presence_penalty: options.presencePenalty }),
            ...(options.frequencyPenalty !== undefined && { frequency_penalty: options.frequencyPenalty }),
            ...(options.stopSequences !== undefined && { stop: options.stopSequences }),
            ...(options.userId !== undefined && { user: options.userId }),
            ...(options.tools !== undefined && { tools: options.tools }),
            ...(options.toolChoice !== undefined && { tool_choice: options.toolChoice }),
            ...(options.responseFormat?.type === 'json_object' && { response_format: { type: 'json_object' } }),
            ...(options.customModelParams || {}),
        };
        const apiResponseData = await this.makeApiRequest('/chat/completions', 'POST', this.config.requestTimeout, payload);
        return this.mapApiToCompletionResponse(apiResponseData, modelId);
    }
    async *generateCompletionStream(modelId, messages, options) {
        this.ensureInitialized();
        const openRouterMessages = this.mapToOpenRouterMessages(messages);
        const payload = {
            model: modelId,
            messages: openRouterMessages,
            stream: true,
            ...(options.temperature !== undefined && { temperature: options.temperature }),
            ...(options.topP !== undefined && { top_p: options.topP }),
            ...(options.maxTokens !== undefined && { max_tokens: options.maxTokens }),
            ...(options.presencePenalty !== undefined && { presence_penalty: options.presencePenalty }),
            ...(options.frequencyPenalty !== undefined && { frequency_penalty: options.frequencyPenalty }),
            ...(options.stopSequences !== undefined && { stop: options.stopSequences }),
            ...(options.userId !== undefined && { user: options.userId }),
            ...(options.tools !== undefined && { tools: options.tools }),
            ...(options.toolChoice !== undefined && { tool_choice: options.toolChoice }),
            ...(options.responseFormat?.type === 'json_object' && { response_format: { type: 'json_object' } }),
            ...(options.customModelParams || {}),
        };
        const stream = await this.makeApiRequest('/chat/completions', 'POST', this.config.streamRequestTimeout, payload, true);
        const accumulatedToolCalls = new Map();
        const abortSignal = options.abortSignal;
        if (abortSignal?.aborted) {
            yield { id: `openrouter-abort-${Date.now()}`, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), modelId, choices: [], error: { message: 'Stream aborted prior to first chunk', type: 'abort' }, isFinal: true };
            return;
        }
        const abortHandler = () => { };
        abortSignal?.addEventListener('abort', abortHandler, { once: true });
        for await (const rawChunk of this.parseSseStream(stream)) {
            if (abortSignal?.aborted) {
                yield { id: `openrouter-abort-${Date.now()}`, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), modelId, choices: [], error: { message: 'Stream aborted by caller', type: 'abort' }, isFinal: true };
                break;
            }
            if (rawChunk.startsWith('data: ') && rawChunk.includes('[DONE]')) {
                const doneData = rawChunk.substring('data: '.length).trim();
                if (doneData === '[DONE]')
                    break;
            }
            if (rawChunk === 'data: [DONE]') {
                break;
            }
            if (rawChunk.startsWith('data: ')) {
                const jsonData = rawChunk.substring('data: '.length);
                try {
                    const apiChunk = JSON.parse(jsonData);
                    yield this.mapApiToStreamChunkResponse(apiChunk, modelId, accumulatedToolCalls);
                    if (apiChunk.choices[0]?.finish_reason) {
                        break;
                    }
                }
                catch (error) {
                    console.warn('OpenRouterProvider: Failed to parse stream chunk JSON, skipping chunk. Data:', jsonData, 'Error:', error);
                }
            }
        }
        abortSignal?.removeEventListener('abort', abortHandler);
    }
    async generateEmbeddings(modelId, texts, options) {
        this.ensureInitialized();
        if (!texts || texts.length === 0) {
            throw new OpenRouterProviderError('Input texts array cannot be empty for generating embeddings.', 'EMBEDDING_NO_INPUT');
        }
        const modelInfo = await this.getModelInfo(modelId);
        if (modelInfo && !modelInfo.capabilities.includes('embeddings')) {
            console.warn(`OpenRouterProvider: Model '${modelId}' is not explicitly listed with embedding capabilities. Attempting anyway.`);
        }
        const payload = {
            model: modelId,
            input: texts,
            ...(options?.encodingFormat && { encoding_format: options.encodingFormat }),
            ...(options?.dimensions && { dimensions: options.dimensions }),
            ...(options?.customModelParams || {}),
        };
        if (options?.inputType && payload.customModelParams && typeof payload.customModelParams === 'object') {
            payload.customModelParams.input_type = options.inputType;
        }
        else if (options?.inputType) {
            payload.customModelParams = { input_type: options.inputType };
        }
        const apiResponseData = await this.makeApiRequest('/embeddings', 'POST', this.config.requestTimeout, payload);
        return {
            object: 'list',
            data: apiResponseData.data.map(d => ({
                object: 'embedding',
                embedding: d.embedding,
                index: d.index,
            })),
            model: apiResponseData.model,
            usage: {
                prompt_tokens: apiResponseData.usage.prompt_tokens,
                total_tokens: apiResponseData.usage.total_tokens,
            },
        };
    }
    async listAvailableModels(filter) {
        this.ensureInitialized();
        if (this.availableModelsCache.size === 0) {
            try {
                await this.refreshAvailableModels();
            }
            catch (refreshError) {
                console.warn("OpenRouterProvider: Failed to refresh models during listAvailableModels call after finding empty cache:", refreshError);
            }
        }
        const models = Array.from(this.availableModelsCache.values());
        if (filter?.capability) {
            return models.filter(m => m.capabilities.includes(filter.capability));
        }
        return models;
    }
    async getModelInfo(modelId) {
        this.ensureInitialized();
        if (!this.availableModelsCache.has(modelId)) {
            try {
                console.log(`OpenRouterProvider: Model ${modelId} not in cache. Refreshing model list.`);
                await this.refreshAvailableModels();
            }
            catch (error) {
                console.warn(`OpenRouterProvider: Failed to refresh models list while trying to get info for ${modelId}:`, error);
            }
        }
        return this.availableModelsCache.get(modelId);
    }
    async checkHealth() {
        if (!this.client) {
            return { isHealthy: false, details: { message: "OpenRouterProvider not initialized (HTTP client missing)." } };
        }
        try {
            await this.client.get('/models', { timeout: Math.min(this.config.requestTimeout || 10000, 10000) });
            return { isHealthy: true, details: { message: "Successfully connected to OpenRouter /models endpoint." } };
        }
        catch (error) {
            const err = error;
            return {
                isHealthy: false,
                details: {
                    message: `OpenRouter health check failed: ${err.message}`,
                    status: err.response?.status,
                    responseData: err.response?.data,
                },
            };
        }
    }
    async shutdown() {
        this.isInitialized = false;
        this.availableModelsCache.clear();
        console.log('OpenRouterProvider shutdown: Instance marked as uninitialized and cache cleared.');
    }
    mapApiToCompletionResponse(apiResponse, requestedModelId) {
        const choice = apiResponse.choices[0];
        if (!choice) {
            throw new OpenRouterProviderError("Received empty choices array from OpenRouter.", "API_RESPONSE_MALFORMED", apiResponse.id);
        }
        const usage = apiResponse.usage ? {
            promptTokens: apiResponse.usage.prompt_tokens,
            completionTokens: apiResponse.usage.completion_tokens,
            totalTokens: apiResponse.usage.total_tokens,
            costUSD: apiResponse.usage.cost,
        } : undefined;
        return {
            id: apiResponse.id,
            object: apiResponse.object,
            created: apiResponse.created,
            modelId: apiResponse.model || requestedModelId,
            choices: apiResponse.choices.map(c => ({
                index: c.index,
                message: {
                    role: c.message.role,
                    content: c.message.content,
                    tool_calls: c.message.tool_calls,
                },
                finishReason: c.finish_reason,
                logprobs: c.logprobs,
            })),
            usage,
        };
    }
    mapApiToStreamChunkResponse(apiChunk, requestedModelId, accumulatedToolCalls) {
        const choice = apiChunk.choices[0];
        if (!choice) {
            return {
                id: apiChunk.id, object: apiChunk.object, created: apiChunk.created,
                modelId: apiChunk.model || requestedModelId, choices: [], isFinal: true,
                error: { message: "Stream chunk contained no choices.", type: "invalid_response" }
            };
        }
        let responseTextDelta;
        let toolCallsDeltas;
        if (choice.delta?.content) {
            responseTextDelta = choice.delta.content;
        }
        if (choice.delta?.tool_calls) {
            toolCallsDeltas = [];
            choice.delta.tool_calls.forEach(tcDelta => {
                let currentToolCallState = accumulatedToolCalls.get(tcDelta.index);
                if (!currentToolCallState) {
                    currentToolCallState = { function: { name: '', arguments: '' } };
                }
                if (tcDelta.id)
                    currentToolCallState.id = tcDelta.id;
                if (tcDelta.type)
                    currentToolCallState.type = tcDelta.type;
                if (tcDelta.function?.name)
                    currentToolCallState.function.name = (currentToolCallState.function.name || '') + tcDelta.function.name;
                if (tcDelta.function?.arguments)
                    currentToolCallState.function.arguments = (currentToolCallState.function.arguments || '') + tcDelta.function.arguments;
                accumulatedToolCalls.set(tcDelta.index, currentToolCallState);
                toolCallsDeltas.push({
                    index: tcDelta.index,
                    id: tcDelta.id,
                    type: tcDelta.type,
                    function: tcDelta.function ? {
                        name: tcDelta.function.name,
                        arguments_delta: tcDelta.function.arguments
                    } : undefined,
                });
            });
        }
        const isFinal = !!choice.finish_reason;
        let finalUsage;
        const finalChoices = [];
        if (isFinal) {
            if (apiChunk.usage) {
                finalUsage = {
                    promptTokens: apiChunk.usage.prompt_tokens,
                    completionTokens: apiChunk.usage.completion_tokens,
                    totalTokens: apiChunk.usage.total_tokens,
                    costUSD: apiChunk.usage.cost,
                };
            }
            const finalMessage = {
                role: choice.delta?.role || accumulatedToolCalls.size > 0 ? 'assistant' : (choice.message?.role || 'assistant'),
                content: responseTextDelta || (choice.message?.content || null),
                tool_calls: Array.from(accumulatedToolCalls.values())
                    .filter(tc => tc.id && tc.function?.name)
                    .map(accTc => ({
                    id: accTc.id,
                    type: accTc.type,
                    function: { name: accTc.function.name, arguments: accTc.function.arguments }
                })),
            };
            if (!finalMessage.tool_calls || finalMessage.tool_calls.length === 0) {
                delete finalMessage.tool_calls;
            }
            if (responseTextDelta && !choice.message?.content && accumulatedToolCalls.size === 0) {
                finalMessage.content = responseTextDelta;
            }
            else if (accumulatedToolCalls.size > 0 && !responseTextDelta && !choice.message?.content) {
                finalMessage.content = null;
            }
            finalChoices.push({
                index: choice.index,
                message: finalMessage,
                finishReason: choice.finish_reason,
                logprobs: choice.logprobs,
            });
        }
        else {
            finalChoices.push({
                index: choice.index,
                message: {
                    role: choice.delta?.role || 'assistant',
                    content: responseTextDelta || null,
                },
                finishReason: null,
            });
        }
        return {
            id: apiChunk.id,
            object: apiChunk.object,
            created: apiChunk.created,
            modelId: apiChunk.model || requestedModelId,
            choices: finalChoices,
            responseTextDelta: isFinal ? undefined : responseTextDelta,
            toolCallsDeltas: isFinal ? undefined : toolCallsDeltas,
            isFinal,
            usage: finalUsage,
        };
    }
    async makeApiRequest(endpoint, method, timeout, body, expectStream = false) {
        try {
            const response = await this.client.request({
                url: endpoint,
                method,
                data: body,
                timeout: timeout,
                responseType: expectStream ? 'stream' : 'json',
            });
            return response.data;
        }
        catch (error) {
            let statusCode;
            let errorData;
            let errorMessage = 'Unknown OpenRouter API error';
            let errorType = 'UNKNOWN_API_ERROR';
            if (axios.isAxiosError(error)) {
                statusCode = error.response?.status;
                errorData = error.response?.data;
                if (errorData?.error && typeof errorData.error === 'object') {
                    errorMessage = errorData.error.message || errorMessage;
                    errorType = errorData.error.type || errorType;
                }
                else if (typeof errorData === 'string') {
                    errorMessage = errorData;
                }
                else if (error.message) {
                    errorMessage = error.message;
                }
            }
            else if (error instanceof Error) {
                errorMessage = error.message;
            }
            throw new OpenRouterProviderError(errorMessage, 'API_REQUEST_FAILED', statusCode, errorType, { requestEndpoint: endpoint, requestBodyPreview: body ? JSON.stringify(body).substring(0, 200) + '...' : undefined, responseData: errorData, underlyingError: error });
        }
    }
    async *parseSseStream(stream) {
        let buffer = '';
        const readableStream = stream;
        try {
            for await (const chunk of readableStream) {
                buffer += chunk.toString();
                let eolIndex;
                while ((eolIndex = buffer.indexOf('\n')) >= 0) {
                    const line = buffer.substring(0, eolIndex).trim();
                    buffer = buffer.substring(eolIndex + 1);
                    if (line) {
                        yield line;
                    }
                }
            }
            if (buffer.trim()) {
                yield buffer.trim();
            }
        }
        catch (error) {
            const message = error instanceof Error ? error.message : "OpenRouter stream parsing/reading error";
            console.error("OpenRouterProvider: Error reading or parsing SSE stream:", message, error);
            if (error instanceof OpenRouterProviderError)
                throw error;
            throw new OpenRouterProviderError(message, 'STREAM_PARSING_ERROR', undefined, undefined, error);
        }
        finally {
            if (typeof readableStream.destroy === 'function') {
                readableStream.destroy();
            }
            else if (typeof readableStream.close === 'function') {
                readableStream.close();
            }
        }
    }
}
//# sourceMappingURL=OpenRouterProvider.js.map