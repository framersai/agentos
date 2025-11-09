// File: backend/agentos/core/llm/providers/errors/OpenRouterProviderError.ts
/**
 * @fileoverview Defines a custom error class for OpenRouter-specific provider errors.
 * This extends the base {@link ProviderError} to include details specific to OpenRouter API interactions.
 * @module backend/agentos/core/llm/providers/errors/OpenRouterProviderError
 * @see {@link ./ProviderError.ts}
 */

import { ProviderError } from './ProviderError';

/**
 * Represents an error specific to the OpenRouter provider.
 * It can include additional context like HTTP status codes or specific OpenRouter error messages.
 *
 * @example
 * try {
 * // OpenRouter API call
 * } catch (error) {
 * if (error instanceof OpenRouterProviderError) {
 * console.error(`OpenRouter Error (Status: ${error.httpStatus || 'N/A'}, Type: ${error.openRouterErrorType || 'N/A'}): ${error.message}`);
 * // Handle OpenRouter-specific error properties
 * } else {
 * // Handle other errors
 * }
 * }
 */
export class OpenRouterProviderError extends ProviderError {
  /** HTTP status code from the API response (e.g., 400, 401, 429, 500). */
  public readonly httpStatus?: number;

  /** OpenRouter specific error type, if available from the response. */
  public readonly openRouterErrorType?: string;

  /**
   * Creates an instance of OpenRouterProviderError.
   * @param {string} message - A human-readable description of the error.
   * @param {string} code - A unique AgentOS internal code identifying the type of error (e.g., 'API_REQUEST_FAILED', 'INVALID_ROUTE').
   * @param {number} [httpStatus] - HTTP status code from the API response.
   * @param {string} [openRouterErrorType] - OpenRouter specific error type.
   * @param {unknown} [details] - Optional underlying error object or additional context from OpenRouter.
   */
  constructor(
    message: string,
    code: string,
    httpStatus?: number,
    openRouterErrorType?: string,
    details?: unknown
  ) {
    super(message, code, 'openrouter', details); // ProviderId is 'openrouter'
    this.name = 'OpenRouterProviderError';
    this.httpStatus = httpStatus;
    this.openRouterErrorType = openRouterErrorType;

    Object.setPrototypeOf(this, OpenRouterProviderError.prototype);
  }
}