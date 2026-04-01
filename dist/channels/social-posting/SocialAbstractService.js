/**
 * @fileoverview Shared HTTP primitives for social channel services.
 * @module @framers/agentos/social-posting/SocialAbstractService
 */
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 300;
const DEFAULT_MAX_RETRY_DELAY_MS = 5000;
const DEFAULT_TIMEOUT_MS = 15000;
const defaultRetryStatus = (status) => status === 429 || status >= 500;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/**
 * Base class for social channel service layers.
 *
 * Adds:
 * - request rate-limiting
 * - retry with exponential backoff on retryable failures
 * - JSON request/response helpers
 * - OAuth scope assertion helper
 */
export class SocialAbstractService {
    constructor(config = {}) {
        this.lastRequestAt = 0;
        this.rateLimiter = Promise.resolve();
        this.minRequestIntervalMs = Math.max(0, config.minRequestIntervalMs ?? 0);
        this.defaultMaxRetries = Math.max(0, config.defaultMaxRetries ?? DEFAULT_MAX_RETRIES);
        this.defaultRetryDelayMs = Math.max(1, config.defaultRetryDelayMs ?? DEFAULT_RETRY_DELAY_MS);
        this.defaultTimeoutMs = Math.max(1, config.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS);
    }
    async fetchJson(url, init = {}, options = {}) {
        const res = await this.fetchWithRetry(url, init, options);
        const contentType = (res.headers.get('content-type') ?? '').toLowerCase();
        if (contentType.includes('application/json')) {
            return (await res.json());
        }
        const text = await res.text();
        return text;
    }
    async fetchText(url, init = {}, options = {}) {
        const res = await this.fetchWithRetry(url, init, options);
        return res.text();
    }
    async fetchWithRetry(url, init = {}, options = {}) {
        const maxRetries = options.maxRetries ?? this.defaultMaxRetries;
        const retryDelayMs = options.retryDelayMs ?? this.defaultRetryDelayMs;
        const maxRetryDelayMs = options.maxRetryDelayMs ?? DEFAULT_MAX_RETRY_DELAY_MS;
        const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;
        const shouldRetryStatus = options.shouldRetryStatus ?? defaultRetryStatus;
        for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
            let response = null;
            try {
                await this.waitForRateLimit();
                response = await this.fetchOnce(url, init, timeoutMs);
            }
            catch (err) {
                if (attempt >= maxRetries) {
                    throw err instanceof Error ? err : new Error(String(err));
                }
                await wait(this.computeBackoff(attempt, retryDelayMs, maxRetryDelayMs));
                continue;
            }
            if (response.ok)
                return response;
            if (attempt < maxRetries && shouldRetryStatus(response.status)) {
                await wait(this.computeBackoff(attempt, retryDelayMs, maxRetryDelayMs));
                continue;
            }
            const body = await response.text().catch(() => '');
            throw new Error(`HTTP ${response.status} ${response.statusText}${body ? `: ${body}` : ''}`);
        }
        throw new Error('Request failed after retry attempts were exhausted.');
    }
    assertScopes(requiredScopes, grantedScopes = []) {
        const granted = new Set(grantedScopes);
        const missing = requiredScopes.filter((scope) => !granted.has(scope));
        if (missing.length === 0)
            return;
        throw new Error(`Missing required OAuth scopes: ${missing.join(', ')}`);
    }
    async fetchOnce(url, init, timeoutMs) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const normalizedInit = {
                ...init,
                signal: controller.signal,
            };
            if (normalizedInit.body &&
                typeof normalizedInit.body === 'object' &&
                !(normalizedInit.body instanceof URLSearchParams) &&
                !(normalizedInit.body instanceof FormData) &&
                !(normalizedInit.body instanceof Blob) &&
                !(normalizedInit.body instanceof ArrayBuffer)) {
                normalizedInit.body = JSON.stringify(normalizedInit.body);
                const headers = new Headers(normalizedInit.headers ?? {});
                if (!headers.has('content-type')) {
                    headers.set('content-type', 'application/json');
                }
                normalizedInit.headers = headers;
            }
            return await fetch(url, normalizedInit);
        }
        finally {
            clearTimeout(timeout);
        }
    }
    async waitForRateLimit() {
        this.rateLimiter = this.rateLimiter.then(async () => {
            if (this.minRequestIntervalMs <= 0) {
                this.lastRequestAt = Date.now();
                return;
            }
            const now = Date.now();
            const delta = now - this.lastRequestAt;
            const waitMs = Math.max(0, this.minRequestIntervalMs - delta);
            if (waitMs > 0) {
                await wait(waitMs);
            }
            this.lastRequestAt = Date.now();
        });
        return this.rateLimiter;
    }
    computeBackoff(attempt, baseMs, capMs) {
        const raw = baseMs * 2 ** attempt;
        return Math.min(capMs, raw);
    }
}
//# sourceMappingURL=SocialAbstractService.js.map