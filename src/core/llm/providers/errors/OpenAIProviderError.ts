// File: backend/agentos/core/llm/providers/errors/OpenAIProviderError.ts
/**
 * @fileoverview Defines a custom error class for OpenAI-specific provider errors.
 * This extends the base {@link ProviderError} to include details specific to OpenAI API interactions.
 * @module backend/agentos/core/llm/providers/errors/OpenAIProviderError
 * @see {@link ./ProviderError.ts}
 */

import { ProviderError } from './ProviderError';

/**
 * Represents an error specific to the OpenAI provider.
 * It includes additional context like OpenAI-specific error codes, types, and HTTP status.
 *
 * @example
 * try {
 * // OpenAI API call
 * } catch (error) {
 * if (error instanceof OpenAIProviderError) {
 * console.error(`OpenAI Error (${error.openaiErrorCode || 'N/A'}): ${error.message}`);
 * // Handle OpenAI-specific error properties
 * } else {
 * // Handle other errors
 * }
 * }
 */
export class OpenAIProviderError extends ProviderError {
  /** OpenAI-specific error code from the API response (e.g., "invalid_api_key", "rate_limit_exceeded"). */
  public readonly openaiErrorCode?: string;

  /** OpenAI error type classification (e.g., "invalid_request_error", "api_error"). */
  public readonly openaiErrorType?: string;

  /** HTTP status code from the API response (e.g., 400, 401, 429, 500). */
  public readonly httpStatus?: number;

  /**
   * Creates an instance of OpenAIProviderError.
   * @param {string} message - A human-readable description of the error.
   * @param {string} code - A unique AgentOS internal code identifying the type of error (e.g., 'API_REQUEST_FAILED', 'AUTHENTICATION_ERROR').
   * @param {string} [openaiErrorCode] - OpenAI-specific error code from the API response.
   * @param {string} [openaiErrorType] - OpenAI error type classification.
   * @param {number} [httpStatus] - HTTP status code from the API response.
   * @param {unknown} [details] - Optional underlying error object or additional context.
   */
  constructor(
    message: string,
    code: string,
    openaiErrorCode?: string,
    openaiErrorType?: string,
    httpStatus?: number,
    details?: unknown
  ) {
    super(message, code, 'openai', details); // ProviderId is 'openai'
    this.name = 'OpenAIProviderError';
    this.openaiErrorCode = openaiErrorCode;
    this.openaiErrorType = openaiErrorType;
    this.httpStatus = httpStatus;

    Object.setPrototypeOf(this, OpenAIProviderError.prototype);
  }
}