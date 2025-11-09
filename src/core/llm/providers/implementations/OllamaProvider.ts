// File: backend/agentos/core/llm/providers/implementations/OllamaProvider.ts

/**
 * @fileoverview Implements the IProvider interface for Ollama, enabling interaction
 * with locally hosted large language models. This provider supports chat completions,
 * streaming, embedding generation (if the Ollama model supports it), and model introspection.
 *
 * Key features:
 * - Connects to a specified Ollama instance.
 * - Standardized chat completion and streaming API.
 * - Embedding generation via Ollama's `/api/embeddings` endpoint.
 * - Listing of available local models.
 * - Health checks for the Ollama service.
 * - Adherence to AgentOS architectural principles, including custom error handling and comprehensive JSDoc.
 *
 * @module backend/agentos/core/llm/providers/implementations/OllamaProvider
 * @implements {IProvider}
 */

import axios, { AxiosInstance, AxiosError } from 'axios';
import {
  IProvider,
  ChatMessage,
  MessageContentPart,
  ModelCompletionOptions,
  ModelCompletionResponse,
  ModelInfo,
  ModelUsage,
  ProviderEmbeddingOptions,
  ProviderEmbeddingResponse,
  EmbeddingObject,
} from '../IProvider';
import { OllamaProviderError } from '../errors/OllamaProviderError';

/**
 * Configuration specific to the OllamaProvider.
 */
export interface OllamaProviderConfig {
  /**
   * The base URL of the Ollama API.
   * @example "http://localhost:11434" (Ollama's default)
   */
  baseURL: string;
  /**
   * Default model ID to use if not specified in a request (e.g., "llama3:latest").
   * This model must be available in the connected Ollama instance.
   */
  defaultModelId?: string;
  /**
   * Timeout for API requests to Ollama in milliseconds.
   * @default 60000 (60 seconds)
   */
  requestTimeout?: number;
  /**
   * Optional API key if the Ollama instance is secured (not common for local instances).
   * Currently, Ollama itself does not use API keys for authentication.
   */
  apiKey?: string; // Placeholder for future Ollama versions or secured proxies
}

// --- Ollama Specific API Types ---

/**
 * Represents the structure of a chat message as expected by Ollama's /api/chat.
 */
interface OllamaChatMessage {
  role: ChatMessage['role'];
  content: string;
  images?: string[]; // Base64 encoded images, if the model supports vision
}

/**
 * Represents the response structure from Ollama's /api/chat endpoint (non-streaming and streaming chunks).
 */
interface OllamaChatResponseChunk {
  model: string;
  created_at: string;
  message?: { // Present in each stream chunk containing a message delta
    role: ChatMessage['role'];
    content: string;
    // Ollama does not yet officially support tool_calls in the same way as OpenAI.
    // This might be added in future versions or specific model implementations.
  };
  done: boolean; // True for the final non-streaming response or the final stream chunk
  // Usage stats from Ollama, often present in the final chunk of a stream or in non-streaming response
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number; // Tokens in the prompt
  prompt_eval_duration?: number;
  eval_count?: number;       // Tokens in the completion
  eval_duration?: number;
  // Error field might appear in a chunk if an error occurs mid-stream or for a request.
  error?: string;
}

const extractErrorMessage = (data: unknown): string | undefined => {
  if (!data || typeof data !== 'object') {
    return undefined;
  }
  const candidate = (data as { error?: unknown }).error;
  return typeof candidate === 'string' ? candidate : undefined;
};

/**
 * Represents the request structure for Ollama's /api/embeddings endpoint.
 */
interface OllamaEmbeddingRequest {
  model: string;
  prompt: string; // Ollama takes a single text prompt for embedding
  options?: Record<string, unknown>; // Model-specific options
}

/**
 * Represents the response structure from Ollama's /api/embeddings endpoint.
 */
interface OllamaEmbeddingResponse {
  embedding: number[];
  // Ollama currently does not provide usage tokens for embeddings.
}

type TextContentPart = Extract<MessageContentPart, { type: 'text' }>;

const isTextContentPart = (part: MessageContentPart): part is TextContentPart =>
  part.type === 'text' && typeof (part as Record<string, unknown>).text === 'string';

// @ts-nocheck
/**
 * Represents a model listed by Ollama's /api/tags endpoint.
 */
interface OllamaModelTag {
  name: string; // Full model name including tag, e.g., "llama3:8b"
  model: string; // Base model name, e.g., "llama3"
  modified_at: string;
  size: number; // Size in bytes
  digest: string;
  details?: {
    parent_model: string;
    format: string;
    family: string;
    families: string[] | null;
    parameter_size: string; // e.g., "8B"
    quantization_level: string; // e.g., "Q4_0"
  };
}

/**
 * Represents the response from Ollama's /api/tags endpoint.
 */
interface OllamaListTagsResponse {
  models: OllamaModelTag[];
}


/**
 * @class OllamaProvider
 * @implements {IProvider}
 * Provides an interface to locally hosted LLMs through an Ollama instance.
 * It handles API requests for chat completions, streaming, embeddings, and model listing.
 */
export class OllamaProvider implements IProvider {
  /** @inheritdoc */
  public readonly providerId: string = 'ollama';
  /** @inheritdoc */
  public isInitialized: boolean = false;
  /** @inheritdoc */
  public defaultModelId?: string;

  private config!: OllamaProviderConfig;
  private client!: AxiosInstance;

  /**
   * Creates an instance of OllamaProvider.
   * The provider must be initialized using `initialize()` before use.
   */
  constructor() {}

  /** @inheritdoc */
  public async initialize(config: OllamaProviderConfig): Promise<void> {
    if (!config.baseURL) {
      throw new OllamaProviderError(
        'Ollama baseURL is required for initialization.',
        'INIT_FAILED_MISSING_BASEURL'
      );
    }
    this.config = {
      requestTimeout: 60000, // Default 60 seconds
      ...config,
    };
    this.defaultModelId = config.defaultModelId;

    this.client = axios.create({
      baseURL: this.config.baseURL.endsWith('/api') ? this.config.baseURL : `${this.config.baseURL}/api`,
      timeout: this.config.requestTimeout,
      headers: {
        'Content-Type': 'application/json',
        // Ollama typically does not require an API key for local instances.
        // If a proxy in front of Ollama needs one, it could be added here via config.apiKey.
        ...(this.config.apiKey ? { 'Authorization': `Bearer ${this.config.apiKey}` } : {}),
      },
    });

    try {
      // Verify connection by attempting to list local models or check base endpoint.
      await this.client.get('/'); // Ollama's base endpoint should return "Ollama is running"
      this.isInitialized = true;
      console.log(`OllamaProvider initialized successfully. Base URL: ${this.client.defaults.baseURL}. Default model: ${this.defaultModelId || 'Not set'}`);
    } catch (error: unknown) {
      this.isInitialized = false;
      const axiosError = error as AxiosError;
      const details = {
        baseURL: this.client.defaults.baseURL,
        status: axiosError.response?.status,
        data: axiosError.response?.data,
      };
      throw new OllamaProviderError(
        `OllamaProvider initialization failed: Could not connect to Ollama at ${this.client.defaults.baseURL}. Ensure Ollama is running and accessible. Error: ${axiosError.message}`,
        'INITIALIZATION_FAILED',
        axiosError.response?.status,
        details
      );
    }
  }

  /**
   * Ensures the provider is initialized.
   * @private
   * @throws {OllamaProviderError} If not initialized.
   */
  private ensureInitialized(): void {
    if (!this.isInitialized) {
      throw new OllamaProviderError(
        'OllamaProvider is not initialized. Call initialize() first.',
        'PROVIDER_NOT_INITIALIZED'
      );
    }
  }

  /**
   * Transforms standard ChatMessage array to Ollama's expected format.
   * @private
   */
  private mapToOllamaMessages(messages: ChatMessage[]): OllamaChatMessage[] {
    return messages.map(msg => {
      if (typeof msg.content !== 'string') {
        // Ollama primarily supports text content. Vision models might take base64 images.
        // For non-string content, we attempt to serialize or take the text part if multimodal.
        // This part needs careful handling based on specific Ollama model capabilities.
        console.warn(`OllamaProvider: Message content for role ${msg.role} is not a simple string. Attempting to use text part or serialize.`);
        if (Array.isArray(msg.content)) {
            const textPart = msg.content.find(isTextContentPart);
            // TODO: Handle image_url parts for vision-enabled Ollama models by converting to base64.
            return {
                role: msg.role,
                content: textPart?.text ?? JSON.stringify(msg.content), // Fallback to JSON string
            };
        }
        return { role: msg.role, content: JSON.stringify(msg.content) }; // Fallback
      }
      return {
        role: msg.role,
        content: msg.content,
        // images: msg.images_base64_if_supported_and_present // Handle multimodal if applicable
      };
    });
  }

  /** @inheritdoc */
  public async generateCompletion(
    modelId: string,
    messages: ChatMessage[],
    options: ModelCompletionOptions
  ): Promise<ModelCompletionResponse> {
    this.ensureInitialized();
    const ollamaMessages = this.mapToOllamaMessages(messages);

    const payload: Record<string, unknown> = {
      model: modelId,
      messages: ollamaMessages,
      stream: false, // For non-streaming
      options: { // Ollama nests model parameters under 'options'
        ...(options.temperature !== undefined && { temperature: options.temperature }),
        ...(options.topP !== undefined && { top_p: options.topP }),
        ...(options.maxTokens !== undefined && { num_predict: options.maxTokens }), // Ollama uses 'num_predict'
        ...(options.presencePenalty !== undefined && { presence_penalty: options.presencePenalty }),
        ...(options.frequencyPenalty !== undefined && { frequency_penalty: options.frequencyPenalty }),
        ...(options.stopSequences !== undefined && { stop: options.stopSequences }),
      },
      format: options.responseFormat?.type === 'json_object' ? 'json' : undefined,
      // Ollama's tool support is not standardized like OpenAI's.
      // Pass custom params if any are known for specific Ollama models.
      ...(options.customModelParams || {}),
    };

    try {
      const response = await this.client.post('/chat', payload);
      const data = response.data as OllamaChatResponseChunk;

      if (data.error) {
        throw new OllamaProviderError(
            `Ollama API error for model ${modelId}: ${data.error}`,
            'API_ERROR',
            response.status,
            data
        );
      }

      const promptTokens = data.prompt_eval_count || 0;
      const completionTokens = data.eval_count || 0;
      const usage: ModelUsage = {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
        costUSD: 0, // Local models typically have no direct per-token cost.
      };

      return {
        id: `ollama-${modelId}-${Date.now()}`, // Generate a unique ID
        object: 'chat.completion',
        created: data.created_at ? new Date(data.created_at).getTime() / 1000 : Math.floor(Date.now() / 1000),
        modelId: data.model || modelId,
        choices: data.message ? [{
          index: 0,
          message: {
            role: data.message.role,
            content: data.message.content,
          },
          finishReason: data.done ? 'stop' : 'length', // Best guess for non-streaming
        }] : [],
        usage,
      };
    } catch (error: unknown) {
      const axiosError = error as AxiosError;
      const status = axiosError.response?.status;
      const errorData = axiosError.response?.data;
      const message = extractErrorMessage(errorData) || axiosError.message || 'Unknown Ollama API error';
      throw new OllamaProviderError(
        message,
        'API_REQUEST_FAILED',
        status,
        { requestPayload: payload, responseData: errorData }
      );
    }
  }

  /** @inheritdoc */
  public async *generateCompletionStream(
    modelId: string,
    messages: ChatMessage[],
    options: ModelCompletionOptions
  ): AsyncGenerator<ModelCompletionResponse, void, undefined> {
    this.ensureInitialized();
    const ollamaMessages = this.mapToOllamaMessages(messages);

    const payload: Record<string, unknown> = {
      model: modelId,
      messages: ollamaMessages,
      stream: true,
      options: {
        ...(options.temperature !== undefined && { temperature: options.temperature }),
        ...(options.topP !== undefined && { top_p: options.topP }),
        ...(options.maxTokens !== undefined && { num_predict: options.maxTokens }),
        ...(options.presencePenalty !== undefined && { presence_penalty: options.presencePenalty }),
        ...(options.frequencyPenalty !== undefined && { frequency_penalty: options.frequencyPenalty }),
        ...(options.stopSequences !== undefined && { stop: options.stopSequences }),
      },
      format: options.responseFormat?.type === 'json_object' ? 'json' : undefined,
      ...(options.customModelParams || {}),
    };

    let responseStream;
    try {
      responseStream = await this.client.post('/chat', payload, { responseType: 'stream' });
    } catch (error: unknown) {
      const axiosError = error as AxiosError;
      const status = axiosError.response?.status;
      const errorData = axiosError.response?.data as (OllamaChatResponseChunk | undefined);
      const message = extractErrorMessage(errorData) || axiosError.message || 'Failed to connect to Ollama stream.';
      throw new OllamaProviderError(
        message,
        'STREAM_CONNECTION_FAILED',
        status,
        { requestPayload: payload, responseData: errorData }
      );
    }

    const stream = responseStream.data as NodeJS.ReadableStream & { destroy?: () => void };
    let accumulatedContent = "";
    let finalUsage: ModelUsage | undefined;
    let responseId = `ollama-stream-${modelId}-${Date.now()}`; // Initial ID

    const abortSignal = options.abortSignal;
    if (abortSignal?.aborted) {
      yield { id: `ollama-abort-${Date.now()}`, object: 'chat.completion.chunk', created: Math.floor(Date.now()/1000), modelId, choices: [], error: { message: 'Stream aborted prior to first chunk', type: 'abort' }, isFinal: true };
      return;
    }
    const abortHandler = () => {
      // We rely on loop check to emit final chunk; no direct stream destroy to keep portability.
    };
    abortSignal?.addEventListener('abort', abortHandler, { once: true });

    try {
      for await (const chunk of stream) {
        if (abortSignal?.aborted) {
          yield { id: `ollama-abort-${Date.now()}`, object: 'chat.completion.chunk', created: Math.floor(Date.now()/1000), modelId, choices: [], error: { message: 'Stream aborted by caller', type: 'abort' }, isFinal: true };
          break;
        }
        const chunkString = chunk.toString();
        // Ollama stream sends multiple JSON objects, newline-separated.
        const jsonObjects = chunkString.split('\n').filter(Boolean);

        for (const jsonObjStr of jsonObjects) {
          try {
            const parsedChunk = JSON.parse(jsonObjStr) as OllamaChatResponseChunk;
            responseId = `ollama-stream-${parsedChunk.model || modelId}-${new Date(parsedChunk.created_at).getTime()}`;

            if (parsedChunk.error) {
                yield {
                    id: responseId, object: 'chat.completion.chunk', created: new Date(parsedChunk.created_at).getTime()/1000,
                    modelId: parsedChunk.model || modelId, choices: [], isFinal: true,
                    error: { message: parsedChunk.error, type: 'ollama_api_error' }
                };
                return; // Terminate stream on error
            }

            const deltaContent = parsedChunk.message?.content || "";
            if (deltaContent) accumulatedContent += deltaContent;

            const isFinalChunk = parsedChunk.done;
            if (isFinalChunk) {
              const promptTokens = parsedChunk.prompt_eval_count || 0;
              const completionTokens = parsedChunk.eval_count || 0;
              finalUsage = {
                promptTokens,
                completionTokens,
                totalTokens: promptTokens + completionTokens,
                costUSD: 0,
              };
            }

            yield {
              id: responseId,
              object: 'chat.completion.chunk',
              created: new Date(parsedChunk.created_at).getTime() / 1000,
              modelId: parsedChunk.model || modelId,
              choices: parsedChunk.message ? [{
                index: 0,
                message: { // Role usually not in delta, content is the delta
                  role: parsedChunk.message.role || 'assistant', // Or infer from previous state
                  content: accumulatedContent, // Full accumulated content for this chunk's choice
                },
                finishReason: isFinalChunk ? 'stop' : null,
              }] : [],
              responseTextDelta: deltaContent,
              isFinal: isFinalChunk,
              usage: isFinalChunk ? finalUsage : undefined,
            };

            if (isFinalChunk) return; // End stream explicitly
          } catch (parseError: unknown) {
            console.warn('OllamaProvider: Could not parse stream chunk JSON:', jsonObjStr, parseError);
            // Optionally yield an error chunk or decide to continue
          }
        }
      }
    } catch (streamError: unknown) {
      const message = streamError instanceof Error ? streamError.message : 'Ollama stream processing error';
      console.error(`OllamaProvider stream error for model ${modelId}:`, message, streamError);
      // Yield a final error chunk to the consumer
      yield {
        id: responseId, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000),
        modelId: modelId, choices: [], isFinal: true,
        error: { message, type: 'STREAM_PROCESSING_ERROR' }
      };
    } finally {
        stream?.destroy?.();
    }
  abortSignal?.removeEventListener('abort', abortHandler);
  }

  /** @inheritdoc */
  public async generateEmbeddings(
    modelId: string,
    texts: string[],
    options?: ProviderEmbeddingOptions
  ): Promise<ProviderEmbeddingResponse> {
    this.ensureInitialized();
    if (!texts || texts.length === 0) {
      throw new OllamaProviderError('Input texts array cannot be empty for embeddings.', 'EMBEDDING_NO_INPUT');
    }
    // Ollama's /api/embeddings endpoint currently takes one prompt (text) at a time.
    // We need to batch these requests if multiple texts are provided.
    const embeddingsData: EmbeddingObject[] = [];
    let totalPromptTokens = 0; // Ollama doesn't provide token counts for embeddings yet.

    for (let i = 0; i < texts.length; i++) {
      const text = texts[i];
      const payload: OllamaEmbeddingRequest = {
        model: modelId,
        prompt: text,
        options: options?.customModelParams, // Pass through any custom model options
      };

      try {
        const response = await this.client.post('/embeddings', payload);
        const embeddingResponse = response.data as OllamaEmbeddingResponse;
        embeddingsData.push({
          object: 'embedding',
          embedding: embeddingResponse.embedding,
          index: i,
        });
        // totalPromptTokens += calculate_tokens_for(text); // Hypothetical token calculation
      } catch (error: unknown) {
        const axiosError = error as AxiosError;
        const status = axiosError.response?.status;
        const errorData = axiosError.response?.data as Record<string, unknown> | undefined;
        const message =
          extractErrorMessage(errorData) || axiosError.message || `Failed to generate embedding for text index ${i}`;
        throw new OllamaProviderError(
          message,
          'EMBEDDING_FAILED',
          status,
          { requestPayload: payload, textIndex: i, responseData: errorData }
        );
      }
    }

    return {
      object: 'list',
      data: embeddingsData,
      model: modelId,
      usage: {
        prompt_tokens: totalPromptTokens, // This will be 0 until Ollama provides this info or we add local tokenization
        total_tokens: totalPromptTokens,
        costUSD: 0, // Local embeddings
      },
    };
  }

  /** @inheritdoc */
  public async listAvailableModels(filter?: { capability?: string }): Promise<ModelInfo[]> {
    this.ensureInitialized();
    try {
      const response = await this.client.get('/tags');
      const apiModels = (response.data as OllamaListTagsResponse).models;

      const modelInfos: ModelInfo[] = apiModels.map((model: OllamaModelTag) => {
        const capabilities: ModelInfo['capabilities'] = ['chat', 'completion']; // Base capabilities for most Ollama models
        if (model.details?.families?.includes('clip') || model.name.includes('llava') || model.name.includes('bakllava')) {
            capabilities.push('vision_input');
        }
        // Embedding capability is harder to infer universally, usually specific models.
        // Assume any model *can* be used with /api/embeddings, but quality varies.
        // For AgentOS, we might want to explicitly tag known good embedding models.
        // capabilities.push('embeddings');


        // Rough estimation of context window based on common model families
        let contextWindow: number | undefined = 4096; // Default
        const family = model.details?.family?.toLowerCase();
        const paramSize = model.details?.parameter_size?.toLowerCase();

        if (family) {
            if (family.includes("llama3") || family.includes("llama-3")) contextWindow = 8192;
            else if (family.includes("llama2") || family.includes("llama-2")) contextWindow = 4096;
            else if (family.includes("codellama")) contextWindow = 16000;
            else if (family.includes("mistral") && (paramSize?.includes("7b") || paramSize?.includes("8x7b"))) contextWindow = 32768; // Mistral-7B, Mixtral-8x7B
            else if (family.includes("phi3") || family.includes("phi-3")) {
                if (paramSize?.includes("mini") && (paramSize?.includes("128k") || model.name.includes("128k"))) contextWindow = 131072;
                else if (paramSize?.includes("mini") && (paramSize?.includes("4k") || model.name.includes("4k"))) contextWindow = 4096;
                else if (paramSize?.includes("small")) contextWindow = 8192; // Phi-3 Small
                else if (paramSize?.includes("medium")) contextWindow = 131072; // Phi-3 Medium (can be 4k or 128k variant)
            }
        }


        return {
          modelId: model.name, // e.g., "llama3:latest", "mistral:7b-instruct-q4_0"
          providerId: this.providerId,
          displayName: model.name,
          description: `Ollama model: ${model.details?.family || model.model} (${model.details?.parameter_size || 'size unknown'}), Format: ${model.details?.format || 'unknown'}`,
          capabilities,
          contextWindowSize: contextWindow,
          // Output/Input token limits are often the same as context window for Ollama models.
          // Pricing is not applicable for local Ollama models.
          pricePer1MTokensInput: 0,
          pricePer1MTokensOutput: 0,
          supportsStreaming: true, // Most Ollama chat models support streaming
          lastUpdated: model.modified_at,
          status: 'active',
        };
      });

      if (filter?.capability) {
        return modelInfos.filter(m => m.capabilities.includes(filter.capability!));
      }
      return modelInfos;

    } catch (error: unknown) {
      const axiosError = error as AxiosError;
      const status = axiosError.response?.status;
      throw new OllamaProviderError(
        `Failed to list available Ollama models: ${axiosError.message}`,
        'LIST_MODELS_FAILED',
        status,
        axiosError.response?.data
      );
    }
  }

  /** @inheritdoc */
  public async getModelInfo(modelId: string): Promise<ModelInfo | undefined> {
    this.ensureInitialized();
    // Ollama's /api/show endpoint provides detailed info for a specific model
    try {
      const response = await this.client.post('/show', { name: modelId });
      const detailedInfo = response.data as { modelfile?: string; parameters?: string; template?: string; details?: any };
      const details = detailedInfo.details; // This structure can vary.

      // Attempt to map this to ModelInfo, might need more robust parsing
      const models = await this.listAvailableModels(); // Get the base info
      const baseInfo = models.find(m => m.modelId === modelId);
      if (!baseInfo) return undefined;

      // Enrich with details from /show if possible
      // For example, extract more specific parameter_size, quantization etc. from details if not already in baseInfo.description
      // This is highly dependent on the output of /api/show for the specific model.
      // As a simple step, we'll return the info from listAvailableModels as it's more standardized.
      // A more advanced version would merge data from /show into the ModelInfo.
      return {
          ...baseInfo,
          description: `${baseInfo.description}. Parameters: ${detailedInfo.parameters?.split('\n').filter(Boolean).join(', ') || 'N/A'}`
      };

    } catch (error: unknown) {
      const axiosError = error as AxiosError;
      if (axiosError.response?.status === 404) {
        return undefined; // Model not found
      }
      throw new OllamaProviderError(
        `Failed to get info for Ollama model '${modelId}': ${axiosError.message}`,
        'GET_MODEL_INFO_FAILED',
        axiosError.response?.status,
        axiosError.response?.data
      );
    }
  }

  /** @inheritdoc */
  public async checkHealth(): Promise<{ isHealthy: boolean; details?: unknown }> {
    this.ensureInitialized(); // Ensures client is created
    try {
      const response = await this.client.get('/'); // Check base Ollama endpoint
      // Ollama returns "Ollama is running" with a 200 OK on its root path.
      if (response.status === 200 && typeof response.data === 'string' && response.data.includes("Ollama is running")) {
        return { isHealthy: true, details: { message: response.data } };
      }
      return { isHealthy: false, details: { status: response.status, data: response.data } };
    } catch (error: unknown) {
      const axiosError = error as AxiosError;
      return {
        isHealthy: false,
        details: {
          message: `Ollama health check failed: ${axiosError.message}`,
          status: axiosError.response?.status,
          data: axiosError.response?.data,
        },
      };
    }
  }

  /** @inheritdoc */
  public async shutdown(): Promise<void> {
    // For OllamaProvider using Axios, there are no persistent connections to explicitly close.
    // Marking as uninitialized is sufficient.
    this.isInitialized = false;
    console.log('OllamaProvider shutdown complete.');
  }
}
