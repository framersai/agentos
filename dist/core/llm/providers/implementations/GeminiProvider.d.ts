/**
 * @fileoverview Implements the IProvider interface for Google's Gemini API.
 *
 * This provider integrates with the Gemini REST API directly (no SDK dependency),
 * handling the structural differences between the Gemini API and the OpenAI-style
 * conventions used by IProvider:
 *
 * Key API differences from OpenAI:
 * - Auth: API key passed as `?key=` query parameter, NOT as a Bearer header.
 * - Roles: Gemini uses `user` / `model` (not `assistant`).
 * - System instruction: Separate `systemInstruction` field, not a role.
 * - Tool calling: Uses `functionDeclarations` under `tools[]`, response uses `functionCall`.
 * - Streaming: SSE via `streamGenerateContent?alt=sse` endpoint.
 * - Finish reasons: `STOP`, `MAX_TOKENS`, `SAFETY`, `RECITATION` (uppercase enum strings).
 * - Response shape: `candidates[0].content.parts[0].text` (not `choices[0].message.content`).
 * - Usage: `usageMetadata.promptTokenCount` / `candidatesTokenCount` / `totalTokenCount`.
 *
 * @module backend/agentos/core/llm/providers/implementations/GeminiProvider
 * @implements {IProvider}
 */
import { IProvider, ChatMessage, ModelCompletionOptions, ModelCompletionResponse, ModelInfo, ProviderEmbeddingOptions, ProviderEmbeddingResponse } from '../IProvider';
/**
 * Configuration for the GeminiProvider.
 *
 * @example
 * const config: GeminiProviderConfig = {
 *   apiKey: process.env.GEMINI_API_KEY!,
 *   defaultModelId: 'gemini-2.5-flash',
 * };
 */
export interface GeminiProviderConfig {
    /**
     * Google Gemini API key.
     * Typically sourced from the `GEMINI_API_KEY` environment variable.
     * Passed as a query parameter (`?key=...`), not as a header.
     */
    apiKey: string;
    /**
     * Base URL for the Gemini API.
     * @default "https://generativelanguage.googleapis.com/v1beta"
     */
    baseURL?: string;
    /**
     * Default model ID when none is specified per-request.
     * @default "gemini-2.5-flash"
     */
    defaultModelId?: string;
    /**
     * Maximum retry attempts for transient failures.
     * @default 3
     */
    maxRetries?: number;
    /**
     * Request timeout in milliseconds.
     * @default 60000
     */
    requestTimeout?: number;
}
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
export declare class GeminiProvider implements IProvider {
    /** @inheritdoc */
    readonly providerId: string;
    /** @inheritdoc */
    isInitialized: boolean;
    /** @inheritdoc */
    defaultModelId?: string;
    private config;
    private keyPool;
    constructor();
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
    initialize(config: GeminiProviderConfig): Promise<void>;
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
    generateCompletion(modelId: string, messages: ChatMessage[], options: ModelCompletionOptions): Promise<ModelCompletionResponse>;
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
    generateCompletionStream(modelId: string, messages: ChatMessage[], options: ModelCompletionOptions): AsyncGenerator<ModelCompletionResponse, void, undefined>;
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
    generateEmbeddings(modelId: string, texts: string[], options?: ProviderEmbeddingOptions): Promise<ProviderEmbeddingResponse>;
    /**
     * Returns a static catalog of known Gemini models.
     *
     * Uses a hardcoded catalog kept up-to-date with major releases, since
     * the Gemini models list endpoint requires iterating over all models.
     *
     * @param {{ capability?: string }} [filter] - Optional capability filter.
     * @returns {Promise<ModelInfo[]>} Array of known Gemini models.
     */
    listAvailableModels(filter?: {
        capability?: string;
    }): Promise<ModelInfo[]>;
    /**
     * Retrieves metadata for a specific Gemini model from the static catalog.
     *
     * @param {string} modelId - Model identifier (e.g., "gemini-2.5-flash").
     * @returns {Promise<ModelInfo | undefined>} Model info or undefined if not found.
     */
    getModelInfo(modelId: string): Promise<ModelInfo | undefined>;
    /**
     * Performs a lightweight health check by sending a minimal generateContent request.
     *
     * @returns {Promise<{ isHealthy: boolean; details?: unknown }>} Health status.
     */
    checkHealth(): Promise<{
        isHealthy: boolean;
        details?: unknown;
    }>;
    /** @inheritdoc */
    shutdown(): Promise<void>;
    /**
     * Guard that throws if the provider has not been initialized.
     *
     * @private
     * @throws {GeminiProviderError} If not initialized.
     */
    private ensureInitialized;
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
    private buildRequestPayload;
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
    private convertMessages;
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
    private convertToolDefs;
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
    private mapResponseToCompletion;
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
    private mapFinishReason;
    /**
     * Maps Gemini usage metadata to IProvider's ModelUsage format.
     *
     * @param {GeminiUsageMetadata} [meta] - Gemini usage metadata.
     * @param {string} modelId - Model ID for cost estimation.
     * @returns {ModelUsage} Normalized usage metrics.
     * @private
     */
    private mapUsage;
    /**
     * Assembles completed tool calls from the streaming accumulator.
     *
     * @param {Map<number, { name: string; args: Record<string, unknown> }>} accum - Accumulated tool calls.
     * @returns {NonNullable<ChatMessage['tool_calls']>} OpenAI-style tool_calls array.
     * @private
     */
    private assembleToolCalls;
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
    private estimateCost;
    /**
     * Builds an abort chunk for early stream termination.
     *
     * @param {string} modelId - The model ID for the response.
     * @returns {ModelCompletionResponse} A terminal chunk with abort error.
     * @private
     */
    private buildAbortChunk;
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
    private makeApiRequest;
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
    private makeStreamRequest;
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
    private parseSseStream;
}
//# sourceMappingURL=GeminiProvider.d.ts.map