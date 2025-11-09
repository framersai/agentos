/**
 * @fileoverview Defines the interface for the EmbeddingManager, responsible for
 * generating vector embeddings for textual content. It outlines the contract for
 * managing various embedding models, orchestrating embedding generation (potentially
 * with caching and dynamic model selection), and providing information about
 * available models.
 *
 * The EmbeddingManager relies on configurations defined in
 * `../config/EmbeddingManagerConfiguration.ts` and interacts with
 * `../core/llm/providers/AIModelProviderManager` to communicate with actual
 * Large Language Model (LLM) providers for embedding generation.
 *
 * @module backend/agentos/rag/IEmbeddingManager
 * @see ../config/EmbeddingManagerConfiguration.ts
 * @see ../core/llm/providers/AIModelProviderManager.ts
 * @see ./EmbeddingManager.ts for a concrete implementation.
 */

import { AIModelProviderManager } from '../core/llm/providers/AIModelProviderManager';
import {
  EmbeddingManagerConfig,
  EmbeddingModelConfig,
} from '../config/EmbeddingManagerConfiguration.js';

/**
 * Represents a request to generate embeddings.
 * This structure encapsulates the text(s) to be embedded and any parameters
 * that might influence the embedding process, such as model selection hints
 * or user context.
 *
 * @interface EmbeddingRequest
 */
export interface EmbeddingRequest {
  /**
   * The text content to be embedded. Can be a single string or an array of strings
   * for batch processing.
   * @type {string | string[]}
   * @example
   * // Single text
   * const requestOne: EmbeddingRequest = { texts: "Hello, world!" };
   * // Batch of texts
   * const requestBatch: EmbeddingRequest = { texts: ["First document.", "Second document."] };
   */
  texts: string | string[];

  /**
   * Optional: The explicit ID of the embedding model to use.
   * If not provided, the EmbeddingManager will select a model based on its
   * configured strategy (e.g., default model, dynamic selection).
   * @type {string}
   * @optional
   * @example "text-embedding-3-small"
   */
  modelId?: string;

  /**
   * Optional: The explicit ID of the LLM provider to use.
   * This is typically used in conjunction with `modelId`. If `modelId` is provided
   * and has a configured provider, this field might be used for validation or override
   * if the architecture supports it. Generally, the model's configured provider is preferred.
   * @type {string}
   * @optional
   * @example "openai"
   */
  providerId?: string;

  /**
   * Optional: Identifier for the user making the request.
   * This can be used for logging, auditing, or if the underlying LLM provider
   * requires user-specific API keys or applies user-based rate limits.
   * @type {string}
   * @optional
   * @example "user-12345"
   */
  userId?: string;

  /**
   * Optional: Identifier for a data collection or namespace.
   * This can be used by dynamic model selection strategies (e.g.,
   * 'dynamic_collection_preference') to choose a model best suited
   * for the content of a specific collection.
   * @type {string}
   * @optional
   * @example "financial_reports_q3_2024"
   */
  collectionId?: string;

  /**
   * Optional: Custom parameters to pass through to the embedding generation process.
   * This could include provider-specific options or hints for the EmbeddingManager.
   * The exact interpretation of these parameters is implementation-dependent.
   * @type {Record<string, any>}
   * @optional
   * @example { "priority": "high", "target_latency_ms": 500 }
   */
  customParameters?: Record<string, any>;
}

/**
 * Represents the response from an embedding generation request.
 * This structure includes the generated embeddings, information about the model
 * and provider used, token usage details, and any errors encountered during
 * processing (especially relevant for batch requests).
 *
 * @interface EmbeddingResponse
 */
export interface EmbeddingResponse {
  /**
   * An array of embedding vectors. Each inner array (`number[]`) corresponds
   * to an input text from the `EmbeddingRequest`. The order is preserved.
   * If an error occurred for a specific text in a batch, its corresponding
   * entry might be missing, or represented by a specific error object if partial
   * results are supported differently. The `errors` array should be checked.
   * @type {number[][]}
   * @example [[0.1, 0.2, ...], [0.3, 0.4, ...]]
   */
  embeddings: number[][];

  /**
   * The ID of the embedding model that was actually used to generate the embeddings.
   * This is important for consistency, especially if model selection was dynamic.
   * @type {string}
   * @example "text-embedding-3-small"
   */
  modelId: string;

  /**
   * The ID of the LLM provider that was used.
   * @type {string}
   * @example "openai"
   */
  providerId: string;

  /**
   * Information about token usage and cost for the embedding generation.
   * @type {object}
   * @property {number} [inputTokens] - The number of tokens in the input text(s).
   * This corresponds to `prompt_tokens` from the provider.
   * @property {number} totalTokens - The total number of tokens processed by the model.
   * For many embedding models, `totalTokens` will be equal to `inputTokens`.
   * @property {number} [costUSD] - Estimated cost of the embedding operation in USD, if available.
   */
  usage: {
    inputTokens?: number;
    totalTokens: number;
    costUSD?: number;
  };

  /**
   * Optional: An array of error objects, relevant if processing a batch of texts
   * and some individual texts failed. If the entire request failed catastrophically,
   * the `generateEmbeddings` method itself should throw an error.
   * @type {Array<{ textIndex: number; message: string; details?: any }>}
   * @optional
   * @property {number} textIndex - The original 0-based index of the text in the input `EmbeddingRequest.texts` array that failed.
   * @property {string} message - A human-readable error message.
   * @property {any} [details] - Additional error details or the raw error object from the provider.
   * @example
   * errors: [{ textIndex: 1, message: "Content policy violation", details: { reason: "unsafe_content" } }]
   */
  errors?: Array<{
    textIndex: number;
    message: string;
    details?: any;
  }>;
}

/**
 * @interface IEmbeddingManager
 * @description Defines the contract for managing and utilizing embedding models.
 * Implementations of this interface are responsible for generating vector
 * embeddings from text, handling different model providers, and potentially
 * managing caching and model selection strategies.
 */
export interface IEmbeddingManager {
  /**
   * Initializes the EmbeddingManager with its configuration and necessary dependencies.
   * This method must be called before any other operations can be performed.
   * It sets up available embedding models, caching, and selection strategies.
   *
   * @async
   * @param {EmbeddingManagerConfig} config - The configuration object for the EmbeddingManager.
   * This includes details about available models,
   * caching, and default settings.
   * @param {AIModelProviderManager} providerManager - An instance of AIModelProviderManager,
   * used to interact with the actual LLM providers
   * that generate embeddings.
   * @returns {Promise<void>} A promise that resolves when initialization is complete.
   * @throws {GMIError | Error} If initialization fails due to invalid configuration,
   * inability to set up providers, or other critical errors.
   * A `GMIError` with a `code` like 'CONFIG_ERROR' or 'INITIALIZATION_FAILED'
   * is preferred.
   * @example
   * const manager = new EmbeddingManager();
   * await manager.initialize(embeddingManagerConfig, aiModelProviderManager);
   */
  initialize(
    config: EmbeddingManagerConfig,
    providerManager: AIModelProviderManager,
  ): Promise<void>;

  /**
   * Generates embeddings for the provided text(s) using an appropriate model.
   * This method handles model selection (if not explicitly specified in the request),
   * interaction with the LLM provider, and caching (if enabled).
   *
   * @async
   * @param {EmbeddingRequest} request - The request object containing the text(s) to embed
   * and any relevant options.
   * @returns {Promise<EmbeddingResponse>} A promise that resolves with the generated embeddings,
   * usage details, and information about the model used.
   * @throws {GMIError | Error} If the embedding generation process fails critically (e.g.,
   * provider unavailable, authentication error, invalid request parameters
   * not caught by initial validation). A `GMIError` with a `code` like
   * 'PROVIDER_ERROR', 'REQUEST_FAILED', or 'NOT_INITIALIZED' is preferred.
   * For batch requests, individual text failures might be reported in
   * `EmbeddingResponse.errors` instead of throwing.
   * @example
   * const response = await embeddingManager.generateEmbeddings({
   * texts: ["What is the capital of France?", "Explain quantum computing."],
   * userId: "user-xyz"
   * });
   * console.log(response.embeddings);
   */
  generateEmbeddings(request: EmbeddingRequest): Promise<EmbeddingResponse>;

  /**
   * Retrieves configuration information for a specific embedding model.
   * If no `modelId` is provided, it typically returns information for the
   * default configured embedding model.
   *
   * @async
   * @param {string} [modelId] - Optional: The ID of the model to get information for.
   * If omitted, the default model's info is returned.
   * @returns {Promise<EmbeddingModelConfig | undefined>} A promise that resolves with the
   * model's configuration object, or
   * `undefined` if the model is not found.
   * @throws {GMIError | Error} If the manager is not initialized.
   * @example
   * const modelInfo = await embeddingManager.getEmbeddingModelInfo("text-embedding-ada-002");
   * if (modelInfo) {
   * console.log(`Model Dimensions: ${modelInfo.dimension}`);
   * }
   */
  getEmbeddingModelInfo(
    modelId?: string,
  ): Promise<EmbeddingModelConfig | undefined>;

  /**
   * Gets the embedding dimension for a specific model, or the default system dimension.
   * This is crucial for configuring vector stores and other components that need to
   * know the size of the embedding vectors.
   *
   * @async
   * @param {string} [modelId] - Optional: The ID of the model. If omitted, tries to return
   * the dimension of the default model, or a system-wide default
   * embedding dimension if configured.
   * @returns {Promise<number>} A promise that resolves with the embedding dimension.
   * @throws {GMIError | Error} If the dimension cannot be determined (e.g., model not found
   * and no default dimension configured). A `GMIError` with code
   * 'CONFIG_ERROR' or 'NOT_FOUND' is preferred.
   * @example
   * const dimension = await embeddingManager.getEmbeddingDimension("text-embedding-3-small");
   * console.log(`Embeddings will have ${dimension} dimensions.`);
   */
  getEmbeddingDimension(modelId?: string): Promise<number>;

  /**
   * Checks the operational health of the EmbeddingManager.
   * This may involve verifying its initialization status and, potentially, the
   * health of its connections to default or critical LLM providers.
   *
   * @async
   * @returns {Promise<{ isHealthy: boolean; details?: any }>} A promise that resolves with
   * an object indicating health status
   * and optionally providing more details
   * (e.g., status of providers, cache).
   * @example
   * const health = await embeddingManager.checkHealth();
   * if (health.isHealthy) {
   * console.log("EmbeddingManager is healthy.");
   * } else {
   * console.error("EmbeddingManager health check failed:", health.details);
   * }
   */
  checkHealth(): Promise<{ isHealthy: boolean; details?: any }>;

  /**
   * Gracefully shuts down the EmbeddingManager, releasing any resources it holds.
   * This could include clearing caches, closing persistent connections if any were
   * managed directly (though typically provider connections are managed by AIModelProviderManager).
   *
   * @async
   * @returns {Promise<void>} A promise that resolves when shutdown is complete.
   * @example
   * await embeddingManager.shutdown();
   */
  shutdown?(): Promise<void>;
}