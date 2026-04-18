/**
 * @module core/providers/quotaErrors
 *
 * Detects quota-exhaustion and rate-limit errors across all provider APIs.
 * Used by providers to decide when to rotate to the next API key.
 */
/**
 * Check if an HTTP error response indicates quota exhaustion or rate limiting.
 *
 * @param status - HTTP status code from the response.
 * @param body - Response body text (can be empty).
 * @returns `true` if this looks like a quota/rate-limit error.
 */
export declare function isQuotaError(status: number, body: string): boolean;
//# sourceMappingURL=quotaErrors.d.ts.map