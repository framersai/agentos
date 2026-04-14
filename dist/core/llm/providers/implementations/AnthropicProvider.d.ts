/**
 * @fileoverview Implements the IProvider interface for Anthropic's Messages API.
 * This provider offers native integration with Anthropic's API, including:
 * - Chat completions via the Messages endpoint (streaming and non-streaming)
 * - Tool/function calling with Anthropic's `input_schema` format
 * - System prompt handling as a top-level field (not a message role)
 * - Proper stop reason mapping (`end_turn` / `tool_use` → IProvider conventions)
 *
 * Key differences from OpenAI that this provider handles:
 * - `system` is a top-level request field, NOT a message with role "system"
 * - `max_tokens` is REQUIRED (Anthropic will reject requests without it)
 * - Tool definitions use `input_schema` instead of `parameters`
 * - Stop reason is `end_turn` (not `stop`) and `tool_use` (not `tool_calls`)
 * - Streaming uses distinct SSE event types (`content_block_delta`, `message_delta`)
 *
 * @module backend/agentos/core/llm/providers/implementations/AnthropicProvider
 * @implements {IProvider}
 */
import { IProvider, ChatMessage, ModelCompletionOptions, ModelCompletionResponse, ModelInfo, ProviderEmbeddingOptions, ProviderEmbeddingResponse } from '../IProvider';
/**
 * Configuration specific to the AnthropicProvider.
 *
 * @example
 * const config: AnthropicProviderConfig = {
 *   apiKey: process.env.ANTHROPIC_API_KEY!,
 *   defaultModelId: 'claude-sonnet-4-20250514',
 *   maxRetries: 3,
 * };
 */
export interface AnthropicProviderConfig {
    /**
     * The API key for accessing Anthropic services.
     * Typically sourced from the `ANTHROPIC_API_KEY` environment variable.
     */
    apiKey: string;
    /**
     * Base URL for the Anthropic API.
     * @default "https://api.anthropic.com"
     */
    baseURL?: string;
    /**
     * Default model ID to use if not specified in a request.
     * @example "claude-sonnet-4-20250514"
     */
    defaultModelId?: string;
    /**
     * Maximum number of retry attempts for failed API requests.
     * @default 3
     */
    maxRetries?: number;
    /**
     * Timeout for API requests in milliseconds.
     * @default 120000 (120 seconds — Anthropic responses can be slow for large contexts)
     */
    requestTimeout?: number;
    /**
     * Default max_tokens value when the caller does not specify one.
     * Anthropic requires max_tokens on every request.
     * @default 4096
     */
    defaultMaxTokens?: number;
}
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
export declare class AnthropicProvider implements IProvider {
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
    initialize(config: AnthropicProviderConfig): Promise<void>;
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
    generateCompletion(modelId: string, messages: ChatMessage[], options: ModelCompletionOptions): Promise<ModelCompletionResponse>;
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
    generateCompletionStream(modelId: string, messages: ChatMessage[], options: ModelCompletionOptions): AsyncGenerator<ModelCompletionResponse, void, undefined>;
    /**
     * Anthropic does not offer an embeddings API. This method always throws.
     *
     * @param {string} _modelId - Unused.
     * @param {string[]} _texts - Unused.
     * @param {ProviderEmbeddingOptions} [_options] - Unused.
     * @returns {Promise<ProviderEmbeddingResponse>} Never returns.
     * @throws {AnthropicProviderError} Always — embeddings are not supported.
     */
    generateEmbeddings(_modelId: string, _texts: string[], _options?: ProviderEmbeddingOptions): Promise<ProviderEmbeddingResponse>;
    /**
     * Returns a static catalog of known Anthropic models.
     *
     * Anthropic does not expose a `/models` list endpoint, so this uses a
     * hardcoded catalog that is kept up-to-date with major releases.
     *
     * @param {{ capability?: string }} [filter] - Optional capability filter.
     * @returns {Promise<ModelInfo[]>} Array of known Anthropic models.
     */
    listAvailableModels(filter?: {
        capability?: string;
    }): Promise<ModelInfo[]>;
    /**
     * Retrieves metadata for a specific model from the static catalog.
     *
     * @param {string} modelId - Model identifier (e.g., "claude-sonnet-4-20250514").
     * @returns {Promise<ModelInfo | undefined>} Model info or undefined if not found.
     */
    getModelInfo(modelId: string): Promise<ModelInfo | undefined>;
    /**
     * Performs a lightweight health check by sending a minimal Messages request.
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
     * @private
     * @throws {AnthropicProviderError} If not initialized.
     */
    private ensureInitialized;
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
    private buildRequestPayload;
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
    private toAnthropicMessage;
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
    private convertToolDefs;
    /**
     * Converts an OpenAI-style toolChoice value to Anthropic's tool_choice format.
     *
     * @param {string | Record<string, unknown>} choice - OpenAI tool choice.
     * @returns {Record<string, unknown>} Anthropic tool_choice value.
     * @private
     */
    private convertToolChoice;
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
    private mapResponseToCompletion;
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
    private mapStopReason;
    /**
     * Assembles completed tool calls from the streaming accumulator.
     *
     * @param {Map<number, { id: string; name: string; argsJson: string }>} accum - Tool call accumulators.
     * @returns {NonNullable<ChatMessage['tool_calls']>} Assembled tool calls array.
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
    private makeApiRequest;
    /**
     * Makes a streaming API request and returns the raw ReadableStream.
     *
     * @param {string} endpoint - API endpoint.
     * @param {Record<string, unknown>} body - Request body (must include `stream: true`).
     * @returns {Promise<ReadableStream<Uint8Array>>} The response body stream.
     * @throws {AnthropicProviderError} On connection errors.
     * @private
     */
    private makeStreamRequest;
    /**
     * Builds the common headers for all Anthropic API requests.
     *
     * Includes the `x-api-key` authentication header and the required
     * `anthropic-version` header that pins the API behavior.
     *
     * @returns {Record<string, string>} Request headers.
     * @private
     */
    private buildHeaders;
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
    private parseSseStream;
}
//# sourceMappingURL=AnthropicProvider.d.ts.map