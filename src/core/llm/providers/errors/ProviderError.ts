// File: backend/agentos/core/llm/providers/errors/ProviderError.ts
/**
 * @fileoverview Defines the base error class for AI Model Provider related errors.
 * This class provides a common structure for errors originating from provider interactions,
 * allowing for consistent error handling and identification across different provider implementations.
 * @module backend/agentos/core/llm/providers/errors/ProviderError
 */

/**
 * Represents a generic error that occurred within an AI Model Provider.
 * Specific provider implementations should extend this class to provide
 * more detailed error information.
 */
export class ProviderError extends Error {
  /**
   * A unique code identifying the type of error.
   * e.g., 'INITIALIZATION_FAILED', 'API_REQUEST_FAILED', 'AUTHENTICATION_ERROR'.
   */
  public readonly code: string;

  /**
   * The identifier of the provider where the error originated.
   * e.g., 'openai', 'ollama', 'openrouter'.
   */
  public readonly providerId?: string;

  /**
   * Optional details or context about the error, which could be provider-specific.
   * This might include things like HTTP status codes, underlying error objects, or request IDs.
   */
  public readonly details?: unknown;

  /**
   * Creates an instance of ProviderError.
   * @param {string} message - A human-readable description of the error.
   * @param {string} code - A unique code identifying the type of error.
   * @param {string} [providerId] - The identifier of the provider where the error originated.
   * @param {unknown} [details] - Optional details or context about the error.
   */
  constructor(message: string, code: string, providerId?: string, details?: unknown) {
    super(message);
    this.name = this.constructor.name; // Ensures the name property is the subclass name
    this.code = code;
    this.providerId = providerId;
    this.details = details;

    // This line is to make the stack trace more readable and skip the ProviderError constructor
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, this.constructor);
    } else {
      this.stack = new Error(message).stack;
    }
  }
}