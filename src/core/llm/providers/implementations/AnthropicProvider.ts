// File: backend/agentos/core/llm/providers/implementations/AnthropicProvider.ts

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

import {
  IProvider,
  ChatMessage,
  MessageContentPart,
  ModelCompletionOptions,
  ModelCompletionResponse,
  ModelCompletionChoice,
  ModelInfo,
  ModelUsage,
  ProviderEmbeddingOptions,
  ProviderEmbeddingResponse,
} from '../IProvider';
import { AnthropicProviderError } from '../errors/AnthropicProviderError';
import { ApiKeyPool } from '../../../providers/ApiKeyPool.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Anthropic API types
// ---------------------------------------------------------------------------

/** A single content block in an Anthropic message (text, tool_use, or tool_result). */
interface AnthropicContentBlock {
  type: 'text' | 'tool_use' | 'tool_result' | 'image';
  /** Present when type === 'text'. */
  text?: string;
  /** Present when type === 'tool_use'. */
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  /** Present when type === 'tool_result'. */
  tool_use_id?: string;
  content?: string | Array<{ type: string; text?: string }>;
  is_error?: boolean;
  /** Present when type === 'image'. */
  source?: { type: 'base64'; media_type: string; data: string };
}

/** The Anthropic Messages API response shape. */
interface AnthropicMessagesResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  content: AnthropicContentBlock[];
  model: string;
  stop_reason: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use' | null;
  stop_sequence: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

/** An Anthropic tool definition sent in the request body. */
interface AnthropicToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

/** Anthropic API error envelope. */
interface AnthropicAPIError {
  type: 'error';
  error: {
    type: string;
    message: string;
  };
}

// ---------------------------------------------------------------------------
// SSE event types for streaming
// ---------------------------------------------------------------------------

interface AnthropicStreamMessageStart {
  type: 'message_start';
  message: AnthropicMessagesResponse;
}

interface AnthropicStreamContentBlockStart {
  type: 'content_block_start';
  index: number;
  content_block: AnthropicContentBlock;
}

interface AnthropicStreamContentBlockDelta {
  type: 'content_block_delta';
  index: number;
  delta: {
    type: 'text_delta' | 'input_json_delta';
    text?: string;
    partial_json?: string;
  };
}

interface AnthropicStreamContentBlockStop {
  type: 'content_block_stop';
  index: number;
}

interface AnthropicStreamMessageDelta {
  type: 'message_delta';
  delta: {
    stop_reason: string | null;
    stop_sequence: string | null;
  };
  usage: {
    output_tokens: number;
  };
}

interface AnthropicStreamMessageStop {
  type: 'message_stop';
}

type AnthropicStreamEvent =
  | AnthropicStreamMessageStart
  | AnthropicStreamContentBlockStart
  | AnthropicStreamContentBlockDelta
  | AnthropicStreamContentBlockStop
  | AnthropicStreamMessageDelta
  | AnthropicStreamMessageStop
  | { type: 'ping' }
  | { type: 'error'; error: { type: string; message: string } };

// ---------------------------------------------------------------------------
// Known model catalog — used by listAvailableModels / getModelInfo
// ---------------------------------------------------------------------------

/** Static catalog of well-known Anthropic models and their metadata. */
const ANTHROPIC_MODELS: ModelInfo[] = [
  {
    modelId: 'claude-opus-4-20250514',
    providerId: 'anthropic',
    displayName: 'Claude Opus 4',
    description: 'Most capable model for complex reasoning and analysis.',
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
    displayName: 'Claude Sonnet 4',
    description: 'Best balance of speed and intelligence for everyday tasks.',
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
    description: 'Fastest and most cost-effective model for lightweight tasks.',
    capabilities: ['chat', 'tool_use', 'vision_input'],
    contextWindowSize: 200000,
    outputTokenLimit: 8192,
    pricePer1MTokensInput: 0.80,
    pricePer1MTokensOutput: 4,
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
export class AnthropicProvider implements IProvider {
  /** @inheritdoc */
  public readonly providerId: string = 'anthropic';
  /** @inheritdoc */
  public isInitialized: boolean = false;
  /** @inheritdoc */
  public defaultModelId?: string;

  private config!: AnthropicProviderConfig;
  private keyPool: ApiKeyPool | null = null;

  constructor() {}

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
  public async initialize(config: AnthropicProviderConfig): Promise<void> {
    if (!config.apiKey) {
      throw new AnthropicProviderError(
        'API key is required for AnthropicProvider initialization. Set ANTHROPIC_API_KEY.',
        'INIT_FAILED_MISSING_API_KEY',
      );
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

    console.log(
      `AnthropicProvider initialized. Default model: ${this.defaultModelId || 'Not set'}.`,
    );
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
  public async generateCompletion(
    modelId: string,
    messages: ChatMessage[],
    options: ModelCompletionOptions,
  ): Promise<ModelCompletionResponse> {
    this.ensureInitialized();

    const payload = this.buildRequestPayload(modelId, messages, options, false);
    const apiResponse = await this.makeApiRequest<AnthropicMessagesResponse>(
      '/v1/messages',
      'POST',
      payload,
    );

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
  public async *generateCompletionStream(
    modelId: string,
    messages: ChatMessage[],
    options: ModelCompletionOptions,
  ): AsyncGenerator<ModelCompletionResponse, void, undefined> {
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
    const toolCallAccum: Map<number, { id: string; name: string; argsJson: string }> = new Map();

    const abortHandler = () => { /* consumer checks abortSignal each iteration */ };
    abortSignal?.addEventListener('abort', abortHandler, { once: true });

    try {
      for await (const rawEvent of this.parseSseStream(stream)) {
        if (abortSignal?.aborted) {
          yield this.buildAbortChunk(modelId);
          break;
        }

        let event: AnthropicStreamEvent;
        try {
          event = JSON.parse(rawEvent) as AnthropicStreamEvent;
        } catch {
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
            } else if (event.delta.type === 'input_json_delta' && event.delta.partial_json) {
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

            const usage: ModelUsage = {
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
    } catch (streamError: unknown) {
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
    } finally {
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
  public async generateEmbeddings(
    _modelId: string,
    _texts: string[],
    _options?: ProviderEmbeddingOptions,
  ): Promise<ProviderEmbeddingResponse> {
    throw new AnthropicProviderError(
      'Anthropic does not provide an embeddings API. Use a dedicated embedding provider (e.g., OpenAI, Voyage).',
      'EMBEDDINGS_NOT_SUPPORTED',
    );
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
  public async listAvailableModels(
    filter?: { capability?: string },
  ): Promise<ModelInfo[]> {
    this.ensureInitialized();
    if (filter?.capability) {
      return ANTHROPIC_MODELS.filter(m => m.capabilities.includes(filter.capability!));
    }
    return [...ANTHROPIC_MODELS];
  }

  /**
   * Retrieves metadata for a specific model from the static catalog.
   *
   * @param {string} modelId - Model identifier (e.g., "claude-sonnet-4-20250514").
   * @returns {Promise<ModelInfo | undefined>} Model info or undefined if not found.
   */
  public async getModelInfo(modelId: string): Promise<ModelInfo | undefined> {
    this.ensureInitialized();
    return ANTHROPIC_MODELS.find(m => m.modelId === modelId);
  }

  /**
   * Performs a lightweight health check by sending a minimal Messages request.
   *
   * @returns {Promise<{ isHealthy: boolean; details?: unknown }>} Health status.
   */
  public async checkHealth(): Promise<{ isHealthy: boolean; details?: unknown }> {
    try {
      // Anthropic has no /health or /models endpoint, so we send a tiny
      // completion request with max_tokens=1 to verify credentials + connectivity.
      await this.makeApiRequest<AnthropicMessagesResponse>('/v1/messages', 'POST', {
        model: this.defaultModelId || 'claude-haiku-4-5-20251001',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }],
      });
      return { isHealthy: true };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Health check failed';
      return { isHealthy: false, details: { message, error } };
    }
  }

  /** @inheritdoc */
  public async shutdown(): Promise<void> {
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
  private ensureInitialized(): void {
    if (!this.isInitialized) {
      throw new AnthropicProviderError(
        'AnthropicProvider is not initialized. Call initialize() first.',
        'PROVIDER_NOT_INITIALIZED',
      );
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
  private buildRequestPayload(
    modelId: string,
    messages: ChatMessage[],
    options: ModelCompletionOptions,
    stream: boolean,
  ): Record<string, unknown> {
    // --- Extract system messages into content blocks ---
    // Anthropic treats system as a top-level field, not a conversation role.
    // When cache_control markers are present on content parts, emit system
    // as an array of content blocks (required for Anthropic prompt caching).
    type SystemBlock = { type: 'text'; text: string; cache_control?: { type: 'ephemeral' } };
    const systemBlocks: SystemBlock[] = [];
    const conversationMessages: ChatMessage[] = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        if (typeof msg.content === 'string') {
          if (msg.content) systemBlocks.push({ type: 'text', text: msg.content });
        } else if (Array.isArray(msg.content)) {
          for (const part of msg.content as MessageContentPart[]) {
            if (part.type === 'text') {
              const block: SystemBlock = { type: 'text', text: (part as { text: string }).text };
              if ((part as any).cache_control) {
                block.cache_control = (part as any).cache_control;
              }
              systemBlocks.push(block);
            }
          }
        }
      } else {
        conversationMessages.push(msg);
      }
    }

    // --- Convert remaining messages to Anthropic format ---
    const anthropicMessages = conversationMessages.map(msg => this.toAnthropicMessage(msg));

    const payload: Record<string, unknown> = {
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
    if (options.temperature !== undefined) payload.temperature = options.temperature;
    if (options.topP !== undefined) payload.top_p = options.topP;
    if (options.stopSequences?.length) payload.stop_sequences = options.stopSequences;

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
  private toAnthropicMessage(msg: ChatMessage): Record<string, unknown> {
    // --- Assistant with tool_calls ---
    if (msg.role === 'assistant' && msg.tool_calls?.length) {
      const content: AnthropicContentBlock[] = [];
      // Include any text content first
      if (typeof msg.content === 'string' && msg.content) {
        content.push({ type: 'text', text: msg.content });
      }
      // Add tool_use blocks
      for (const tc of msg.tool_calls) {
        let parsedInput: Record<string, unknown>;
        try {
          parsedInput = typeof tc.function.arguments === 'string'
            ? JSON.parse(tc.function.arguments)
            : (tc.function.arguments as unknown as Record<string, unknown>) ?? {};
        } catch {
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
      const anthropicContent: Array<Record<string, unknown>> = [];
      for (const part of msg.content as MessageContentPart[]) {
        if (part.type === 'text') {
          anthropicContent.push({ type: 'text', text: (part as { text: string }).text });
        } else if (part.type === 'image_url') {
          const url = (part as { image_url: { url: string } }).image_url.url;
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
          } else {
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
  private convertToolDefs(tools?: Array<Record<string, unknown>>): AnthropicToolDef[] {
    if (!tools || tools.length === 0) return [];
    return tools.map(tool => {
      // OpenAI format: { type: 'function', function: { name, description, parameters } }
      const fn = (tool as any)?.function;
      if (fn?.name) {
        return {
          name: fn.name as string,
          description: (fn.description ?? '') as string,
          // Anthropic calls it input_schema, OpenAI calls it parameters
          input_schema: fn.parameters ?? { type: 'object' },
        };
      }
      // AgentOS ITool format: { name, description, inputSchema }
      return {
        name: (tool as any).name ?? 'unknown',
        description: (tool as any).description ?? '',
        input_schema: (tool as any).inputSchema ?? (tool as any).parameters ?? { type: 'object' },
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
  private convertToolChoice(choice: string | Record<string, unknown>): Record<string, unknown> {
    if (typeof choice === 'string') {
      // "auto" → { type: "auto" }, "none" → { type: "auto" } (no direct "none" in Anthropic),
      // "required" → { type: "any" }
      if (choice === 'required') return { type: 'any' };
      return { type: 'auto' };
    }
    // Object form: { type: "function", function: { name: "..." } } → { type: "tool", name: "..." }
    const fn = (choice as any)?.function;
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
  private mapResponseToCompletion(apiResponse: AnthropicMessagesResponse): ModelCompletionResponse {
    // Collect text content
    const textParts = apiResponse.content
      .filter(block => block.type === 'text' && block.text)
      .map(block => block.text!);
    const fullText = textParts.join('');

    // Collect tool_use blocks and convert to OpenAI-style tool_calls
    const toolCalls = apiResponse.content
      .filter(block => block.type === 'tool_use')
      .map(block => ({
        id: block.id!,
        type: 'function' as const,
        function: {
          name: block.name!,
          arguments: JSON.stringify(block.input ?? {}),
        },
      }));

    const hasToolCalls = toolCalls.length > 0;
    const finishReason = this.mapStopReason(apiResponse.stop_reason);

    const usage: ModelUsage = {
      promptTokens: apiResponse.usage.input_tokens,
      completionTokens: apiResponse.usage.output_tokens,
      totalTokens: apiResponse.usage.input_tokens + apiResponse.usage.output_tokens,
      costUSD: this.estimateCost(
        apiResponse.usage.input_tokens,
        apiResponse.usage.output_tokens,
        apiResponse.model,
      ),
      cacheCreationInputTokens: apiResponse.usage.cache_creation_input_tokens,
      cacheReadInputTokens: apiResponse.usage.cache_read_input_tokens,
    };

    const choice: ModelCompletionChoice = {
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
  private mapStopReason(stopReason: string | null): string {
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
  private assembleToolCalls(
    accum: Map<number, { id: string; name: string; argsJson: string }>,
  ): NonNullable<ChatMessage['tool_calls']> {
    if (accum.size === 0) return [];
    return Array.from(accum.values()).map(tc => ({
      id: tc.id,
      type: 'function' as const,
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
  private estimateCost(
    inputTokens: number,
    outputTokens: number,
    modelId: string,
  ): number | undefined {
    const info = ANTHROPIC_MODELS.find(m => m.modelId === modelId);
    if (!info?.pricePer1MTokensInput || !info?.pricePer1MTokensOutput) return undefined;
    return (
      (inputTokens / 1_000_000) * info.pricePer1MTokensInput +
      (outputTokens / 1_000_000) * info.pricePer1MTokensOutput
    );
  }

  /**
   * Builds an abort chunk for early stream termination.
   *
   * @param {string} modelId - The model ID for the response.
   * @returns {ModelCompletionResponse} A terminal chunk with abort error.
   * @private
   */
  private buildAbortChunk(modelId: string): ModelCompletionResponse {
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
  private async makeApiRequest<T>(
    endpoint: string,
    method: 'POST',
    body: Record<string, unknown>,
  ): Promise<T> {
    const url = `${this.config.baseURL}${endpoint}`;
    const headers = this.buildHeaders();

    let lastError: Error = new AnthropicProviderError(
      'Request failed after all retries.',
      'MAX_RETRIES_REACHED',
    );

    for (let attempt = 0; attempt < this.config.maxRetries!; attempt++) {
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
          const errorData = await response.json().catch(() => ({})) as Partial<AnthropicAPIError>;
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

        return (await response.json()) as T;
      } catch (error: unknown) {
        clearTimeout(timeoutId);
        if (error instanceof AnthropicProviderError) {
          if (error.code === 'API_CLIENT_ERROR') throw error;
          lastError = error;
        } else if (error instanceof Error && error.name === 'AbortError') {
          lastError = new AnthropicProviderError(
            `Request timed out after ${this.config.requestTimeout}ms.`,
            'REQUEST_TIMEOUT',
          );
        } else {
          lastError = new AnthropicProviderError(
            error instanceof Error ? error.message : 'Network or unknown error',
            'NETWORK_ERROR',
          );
        }

        if (attempt === this.config.maxRetries! - 1) break;
        const delay = Math.min(30000, (1000 * (2 ** attempt)) + Math.random() * 1000);
        console.warn(`[AnthropicProvider] Retry ${attempt + 1}/${this.config.maxRetries! - 1} in ${(delay / 1000).toFixed(1)}s`);
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
  private async makeStreamRequest(
    endpoint: string,
    body: Record<string, unknown>,
  ): Promise<ReadableStream<Uint8Array>> {
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
        const errorData = await response.json().catch(() => ({})) as Partial<AnthropicAPIError>;
        const errorMessage = errorData.error?.message || `HTTP ${response.status}: ${response.statusText}`;
        throw new AnthropicProviderError(
          errorMessage,
          'STREAM_CONNECTION_FAILED',
          response.status,
          errorData.error?.type,
          errorData,
        );
      }

      if (!response.body) {
        throw new AnthropicProviderError(
          'Expected a stream response but body was null.',
          'STREAM_BODY_NULL',
        );
      }

      return response.body;
    } catch (error: unknown) {
      clearTimeout(timeoutId);
      if (error instanceof AnthropicProviderError) throw error;
      throw new AnthropicProviderError(
        error instanceof Error ? error.message : 'Failed to connect to Anthropic stream.',
        'STREAM_CONNECTION_FAILED',
      );
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
  private buildHeaders(): Record<string, string> {
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
  private async *parseSseStream(
    stream: ReadableStream<Uint8Array>,
  ): AsyncGenerator<string, void, undefined> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

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
              if (dataContent) yield dataContent;
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
            if (dataContent) yield dataContent;
          }
        }
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'SSE stream parsing error';
      console.error('AnthropicProvider: Error reading SSE stream:', message);
      throw new AnthropicProviderError(message, 'STREAM_PARSING_ERROR');
    } finally {
      // Ensure the reader is released
      try { await reader.cancel(); } catch { /* swallow cleanup errors */ }
    }
  }
}
