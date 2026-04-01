/**
 * @fileoverview Shared HTTP primitives for social channel services.
 * @module @framers/agentos/social-posting/SocialAbstractService
 */
export interface SocialRequestOptions {
    /** Retry attempts after the initial request. */
    maxRetries?: number;
    /** Base delay for exponential backoff (ms). */
    retryDelayMs?: number;
    /** Max delay cap for backoff (ms). */
    maxRetryDelayMs?: number;
    /** Request timeout (ms). */
    timeoutMs?: number;
    /** Optional override for retryable HTTP status logic. */
    shouldRetryStatus?: (status: number) => boolean;
}
export interface SocialServiceConfig {
    /** Minimum spacing between outbound API requests. */
    minRequestIntervalMs?: number;
    /** Default retry attempts after initial request. */
    defaultMaxRetries?: number;
    /** Default base retry delay (ms). */
    defaultRetryDelayMs?: number;
    /** Default request timeout (ms). */
    defaultTimeoutMs?: number;
}
/**
 * Base class for social channel service layers.
 *
 * Adds:
 * - request rate-limiting
 * - retry with exponential backoff on retryable failures
 * - JSON request/response helpers
 * - OAuth scope assertion helper
 */
export declare abstract class SocialAbstractService {
    private readonly minRequestIntervalMs;
    private readonly defaultMaxRetries;
    private readonly defaultRetryDelayMs;
    private readonly defaultTimeoutMs;
    private lastRequestAt;
    private rateLimiter;
    protected constructor(config?: SocialServiceConfig);
    protected fetchJson<T>(url: string, init?: RequestInit, options?: SocialRequestOptions): Promise<T>;
    protected fetchText(url: string, init?: RequestInit, options?: SocialRequestOptions): Promise<string>;
    protected fetchWithRetry(url: string, init?: RequestInit, options?: SocialRequestOptions): Promise<Response>;
    protected assertScopes(requiredScopes: string[], grantedScopes?: string[]): void;
    private fetchOnce;
    private waitForRateLimit;
    private computeBackoff;
}
//# sourceMappingURL=SocialAbstractService.d.ts.map