/**
 * @module core/providers/quotaErrors
 *
 * Detects quota-exhaustion and rate-limit errors across all provider APIs.
 * Used by providers to decide when to rotate to the next API key.
 */
/** Status codes that always indicate quota/rate-limit exhaustion. */
const QUOTA_STATUS_CODES = new Set([429, 402, 456]);
/** Substrings in response bodies that indicate quota exhaustion. */
const QUOTA_BODY_SIGNALS = [
    'quota_exceeded',
    'rate_limit_exceeded',
    'insufficient_quota',
    'overloaded_error',
    'resource_exhausted',
    'rate_limit',
];
/**
 * Check if an HTTP error response indicates quota exhaustion or rate limiting.
 *
 * @param status - HTTP status code from the response.
 * @param body - Response body text (can be empty).
 * @returns `true` if this looks like a quota/rate-limit error.
 */
export function isQuotaError(status, body) {
    if (QUOTA_STATUS_CODES.has(status))
        return true;
    if (!body)
        return false;
    const lower = body.toLowerCase();
    return QUOTA_BODY_SIGNALS.some((signal) => lower.includes(signal));
}
//# sourceMappingURL=quotaErrors.js.map