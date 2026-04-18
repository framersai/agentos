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
    constructor(message, rawOutput, zodErrors, retryCount, retryHistory) {
        super(message);
        this.name = 'LlmOutputValidationError';
        this.rawOutput = rawOutput;
        this.zodErrors = zodErrors;
        this.retryCount = retryCount;
        this.retryHistory = retryHistory;
    }
}
//# sourceMappingURL=errors.js.map