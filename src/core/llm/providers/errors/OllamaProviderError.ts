// File: backend/agentos/core/llm/providers/errors/OllamaProviderError.ts
/**
 * @fileoverview Defines a custom error class for Ollama-specific provider errors.
 * This extends the base {@link ProviderError} to include details specific to Ollama API interactions.
 * @module backend/agentos/core/llm/providers/errors/OllamaProviderError
 * @see {@link ./ProviderError.ts}
 */

import { ProviderError } from './ProviderError';

/**
 * Represents an error specific to the Ollama provider.
 * It can include additional context like HTTP status codes or specific Ollama error messages.
 *
 * @example
 * try {
 * // Ollama API call
 * } catch (error) {
 * if (error instanceof OllamaProviderError) {
 * console.error(`Ollama Error (Status: ${error.httpStatus || 'N/A'}): ${error.message}`);
 * // Handle Ollama-specific error properties
 * } else {
 * // Handle other errors
 * }
 * }
 */
export class OllamaProviderError extends ProviderError {
  /** HTTP status code from the API response (e.g., 400, 404, 500). */
  public readonly httpStatus?: number;

  /**
   * Creates an instance of OllamaProviderError.
   * @param {string} message - A human-readable description of the error.
   * @param {string} code - A unique AgentOS internal code identifying the type of error (e.g., 'CONNECTION_FAILED', 'API_ERROR').
   * @param {number} [httpStatus] - HTTP status code from the API response.
   * @param {unknown} [details] - Optional underlying error object or additional context from Ollama.
   */
  constructor(
    message: string,
    code: string,
    httpStatus?: number,
    details?: unknown
  ) {
    super(message, code, 'ollama', details); // ProviderId is 'ollama'
    this.name = 'OllamaProviderError';
    this.httpStatus = httpStatus;

    Object.setPrototypeOf(this, OllamaProviderError.prototype);
  }
}