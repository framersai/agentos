/**
 * @fileoverview Error types for LLM output validation failures.
 *
 * {@link LlmOutputValidationError} is thrown when LLM output fails Zod
 * validation after all retry attempts. It carries the raw output, Zod
 * errors, retry count, and full retry history so callers can debug,
 * log, or surface the failure appropriately.
 *
 * @module agentos/core/validation/errors
 */

import type { ZodError } from 'zod';

/** A single retry attempt record for debugging and telemetry. */
export interface ValidationRetryRecord {
  /** Zero-based attempt index (0 = initial attempt). */
  attempt: number;
  /** Raw LLM output from this attempt. */
  rawOutput: string;
  /** Human-readable error description (parse error or Zod validation error). */
  error: string;
}

/**
 * Thrown when LLM output fails Zod validation after all retry attempts.
 *
 * Contains the raw LLM response, Zod validation errors, retry count,
 * and full retry history for debugging and telemetry. Callers can
 * inspect `retryHistory` to understand what the LLM produced on each
 * attempt and why it failed.
 *
 * @example
 * ```ts
 * try {
 *   const result = await validatedInvoker(system, user);
 * } catch (err) {
 *   if (err instanceof LlmOutputValidationError) {
 *     console.error('Validation failed after', err.retryCount, 'retries');
 *     console.error('Zod errors:', err.zodErrors);
 *     console.error('Raw output:', err.rawOutput);
 *   }
 * }
 * ```
 */
export class LlmOutputValidationError extends Error {
  /** Raw LLM output from the final attempt. */
  readonly rawOutput: string;
  /** Zod validation errors from the final attempt. */
  readonly zodErrors: ZodError;
  /** Number of retry attempts made (0 = failed on first try with no retries configured). */
  readonly retryCount: number;
  /** Full retry history for debugging — each attempt's raw output and error message. */
  readonly retryHistory: ValidationRetryRecord[];

  constructor(
    message: string,
    rawOutput: string,
    zodErrors: ZodError,
    retryCount: number,
    retryHistory: ValidationRetryRecord[],
  ) {
    super(message);
    this.name = 'LlmOutputValidationError';
    this.rawOutput = rawOutput;
    this.zodErrors = zodErrors;
    this.retryCount = retryCount;
    this.retryHistory = retryHistory;
  }
}
