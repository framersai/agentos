// File: backend/agentos/core/llm/providers/errors/AnthropicProviderError.ts
/**
 * @fileoverview Defines a custom error class for Anthropic-specific provider errors.
 * This extends the base {@link ProviderError} to include details specific to
 * Anthropic Messages API interactions, such as HTTP status codes and
 * Anthropic-specific error types.
 *
 * @module backend/agentos/core/llm/providers/errors/AnthropicProviderError
 * @see {@link ProviderError}
 */

import { ProviderError } from './ProviderError';

/**
 * Represents an error specific to the Anthropic provider.
 * It includes additional context like HTTP status codes and Anthropic-specific
 * error types returned in the API error envelope.
 *
 * @example
 * try {
 *   // Anthropic API call
 * } catch (error) {
 *   if (error instanceof AnthropicProviderError) {
 *     console.error(`Anthropic Error (Status: ${error.httpStatus || 'N/A'}): ${error.message}`);
 *   }
 * }
 */
export class AnthropicProviderError extends ProviderError {
  /** HTTP status code from the API response (e.g., 400, 401, 429, 500). */
  public readonly httpStatus?: number;

  /** Anthropic-specific error type from the API response (e.g., "invalid_request_error", "authentication_error"). */
  public readonly anthropicErrorType?: string;

  /**
   * Creates an instance of AnthropicProviderError.
   *
   * @param {string} message - A human-readable description of the error.
   * @param {string} code - A unique AgentOS internal code identifying the type of error
   *   (e.g., 'API_REQUEST_FAILED', 'AUTHENTICATION_ERROR', 'RATE_LIMIT_EXCEEDED').
   * @param {number} [httpStatus] - HTTP status code from the API response.
   * @param {string} [anthropicErrorType] - Anthropic-specific error type classification.
   * @param {unknown} [details] - Optional underlying error object or additional context.
   */
  constructor(
    message: string,
    code: string,
    httpStatus?: number,
    anthropicErrorType?: string,
    details?: unknown
  ) {
    super(message, code, 'anthropic', details);
    this.name = 'AnthropicProviderError';
    this.httpStatus = httpStatus;
    this.anthropicErrorType = anthropicErrorType;

    Object.setPrototypeOf(this, AnthropicProviderError.prototype);
  }
}
