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

const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 300;
const DEFAULT_MAX_RETRY_DELAY_MS = 5000;
const DEFAULT_TIMEOUT_MS = 15000;

const defaultRetryStatus = (status: number): boolean => status === 429 || status >= 500;

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Base class for social channel service layers.
 *
 * Adds:
 * - request rate-limiting
 * - retry with exponential backoff on retryable failures
 * - JSON request/response helpers
 * - OAuth scope assertion helper
 */
export abstract class SocialAbstractService {
  private readonly minRequestIntervalMs: number;
  private readonly defaultMaxRetries: number;
  private readonly defaultRetryDelayMs: number;
  private readonly defaultTimeoutMs: number;
  private lastRequestAt = 0;
  private rateLimiter: Promise<void> = Promise.resolve();

  protected constructor(config: SocialServiceConfig = {}) {
    this.minRequestIntervalMs = Math.max(0, config.minRequestIntervalMs ?? 0);
    this.defaultMaxRetries = Math.max(0, config.defaultMaxRetries ?? DEFAULT_MAX_RETRIES);
    this.defaultRetryDelayMs = Math.max(1, config.defaultRetryDelayMs ?? DEFAULT_RETRY_DELAY_MS);
    this.defaultTimeoutMs = Math.max(1, config.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS);
  }

  protected async fetchJson<T>(
    url: string,
    init: RequestInit = {},
    options: SocialRequestOptions = {},
  ): Promise<T> {
    const res = await this.fetchWithRetry(url, init, options);
    const contentType = (res.headers.get('content-type') ?? '').toLowerCase();
    if (contentType.includes('application/json')) {
      return (await res.json()) as T;
    }

    const text = await res.text();
    return text as unknown as T;
  }

  protected async fetchText(
    url: string,
    init: RequestInit = {},
    options: SocialRequestOptions = {},
  ): Promise<string> {
    const res = await this.fetchWithRetry(url, init, options);
    return res.text();
  }

  protected async fetchWithRetry(
    url: string,
    init: RequestInit = {},
    options: SocialRequestOptions = {},
  ): Promise<Response> {
    const maxRetries = options.maxRetries ?? this.defaultMaxRetries;
    const retryDelayMs = options.retryDelayMs ?? this.defaultRetryDelayMs;
    const maxRetryDelayMs = options.maxRetryDelayMs ?? DEFAULT_MAX_RETRY_DELAY_MS;
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;
    const shouldRetryStatus = options.shouldRetryStatus ?? defaultRetryStatus;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      let response: Response | null = null;
      try {
        await this.waitForRateLimit();
        response = await this.fetchOnce(url, init, timeoutMs);
      } catch (err) {
        if (attempt >= maxRetries) {
          throw err instanceof Error ? err : new Error(String(err));
        }
        await wait(this.computeBackoff(attempt, retryDelayMs, maxRetryDelayMs));
        continue;
      }

      if (response.ok) return response;

      if (attempt < maxRetries && shouldRetryStatus(response.status)) {
        await wait(this.computeBackoff(attempt, retryDelayMs, maxRetryDelayMs));
        continue;
      }

      const body = await response.text().catch(() => '');
      throw new Error(
        `HTTP ${response.status} ${response.statusText}${body ? `: ${body}` : ''}`,
      );
    }

    throw new Error('Request failed after retry attempts were exhausted.');
  }

  protected assertScopes(requiredScopes: string[], grantedScopes: string[] = []): void {
    const granted = new Set(grantedScopes);
    const missing = requiredScopes.filter((scope) => !granted.has(scope));
    if (missing.length === 0) return;

    throw new Error(`Missing required OAuth scopes: ${missing.join(', ')}`);
  }

  private async fetchOnce(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const normalizedInit: RequestInit = {
        ...init,
        signal: controller.signal,
      };

      if (
        normalizedInit.body &&
        typeof normalizedInit.body === 'object' &&
        !(normalizedInit.body instanceof URLSearchParams) &&
        !(normalizedInit.body instanceof FormData) &&
        !(normalizedInit.body instanceof Blob) &&
        !(normalizedInit.body instanceof ArrayBuffer)
      ) {
        normalizedInit.body = JSON.stringify(normalizedInit.body);
        const headers = new Headers(normalizedInit.headers ?? {});
        if (!headers.has('content-type')) {
          headers.set('content-type', 'application/json');
        }
        normalizedInit.headers = headers;
      }

      return await fetch(url, normalizedInit);
    } finally {
      clearTimeout(timeout);
    }
  }

  private async waitForRateLimit(): Promise<void> {
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

  private computeBackoff(attempt: number, baseMs: number, capMs: number): number {
    const raw = baseMs * 2 ** attempt;
    return Math.min(capMs, raw);
  }
}
