/**
 * @file CircuitBreaker.ts
 * @description Classic three-state circuit breaker (closed → open → half-open → closed)
 * that wraps any async operation. When failures exceed a threshold within a window,
 * the circuit opens and rejects calls immediately for a cooldown period.
 */

export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerConfig {
  /** Unique name for this breaker (for logging/metrics). */
  name: string;
  /** Number of failures before opening the circuit. @default 5 */
  failureThreshold: number;
  /** Time window in ms to count failures. @default 60000 */
  failureWindowMs: number;
  /** How long to stay open before trying half-open. @default 30000 */
  cooldownMs: number;
  /** Number of successful probes in half-open before closing. @default 2 */
  halfOpenSuccessThreshold: number;
  /** Optional callback when state transitions. */
  onStateChange?: (from: CircuitState, to: CircuitState, name: string) => void;
}

export interface CircuitBreakerStats {
  name: string;
  state: CircuitState;
  failureCount: number;
  successCount: number;
  lastFailureAt: number | null;
  lastStateChangeAt: number;
  totalTripped: number;
}

export class CircuitOpenError extends Error {
  constructor(
    public readonly breakerName: string,
    public readonly cooldownRemainingMs: number,
  ) {
    super(`Circuit breaker '${breakerName}' is open. Retry after ${cooldownRemainingMs}ms.`);
    this.name = 'CircuitOpenError';
  }
}

const DEFAULT_CONFIG: Omit<CircuitBreakerConfig, 'name'> = {
  failureThreshold: 5,
  failureWindowMs: 60_000,
  cooldownMs: 30_000,
  halfOpenSuccessThreshold: 2,
};

export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failures: number[] = [];
  private halfOpenSuccesses = 0;
  private lastStateChangeAt: number = Date.now();
  private totalTripped = 0;
  private lastFailureAt: number | null = null;
  private successCount = 0;
  private config: CircuitBreakerConfig;

  constructor(config: Partial<CircuitBreakerConfig> & { name: string }) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    this.pruneOldFailures();

    if (this.state === 'open') {
      const elapsed = Date.now() - this.lastStateChangeAt;
      if (elapsed >= this.config.cooldownMs) {
        this.transition('half-open');
      } else {
        throw new CircuitOpenError(this.config.name, this.config.cooldownMs - elapsed);
      }
    }

    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }

  recordFailure(): void {
    const now = Date.now();
    this.lastFailureAt = now;
    this.failures.push(now);
    this.pruneOldFailures();

    if (this.state === 'half-open') {
      this.halfOpenSuccesses = 0;
      this.transition('open');
      return;
    }

    if (this.state === 'closed' && this.failures.length >= this.config.failureThreshold) {
      this.transition('open');
    }
  }

  recordSuccess(): void {
    this.successCount++;

    if (this.state === 'half-open') {
      this.halfOpenSuccesses++;
      if (this.halfOpenSuccesses >= this.config.halfOpenSuccessThreshold) {
        this.transition('closed');
      }
    }
  }

  forceState(state: CircuitState): void {
    this.transition(state);
  }

  reset(): void {
    this.failures = [];
    this.halfOpenSuccesses = 0;
    this.successCount = 0;
    this.lastFailureAt = null;
    this.transition('closed');
  }

  getState(): CircuitState {
    // Check if open circuit should auto-transition to half-open
    if (this.state === 'open') {
      const elapsed = Date.now() - this.lastStateChangeAt;
      if (elapsed >= this.config.cooldownMs) {
        this.transition('half-open');
      }
    }
    return this.state;
  }

  getStats(): CircuitBreakerStats {
    this.pruneOldFailures();
    return {
      name: this.config.name,
      state: this.getState(),
      failureCount: this.failures.length,
      successCount: this.successCount,
      lastFailureAt: this.lastFailureAt,
      lastStateChangeAt: this.lastStateChangeAt,
      totalTripped: this.totalTripped,
    };
  }

  private transition(to: CircuitState): void {
    const from = this.state;
    if (from === to) return;

    this.state = to;
    this.lastStateChangeAt = Date.now();

    if (to === 'open') {
      this.totalTripped++;
    }
    if (to === 'closed') {
      this.failures = [];
      this.halfOpenSuccesses = 0;
    }
    if (to === 'half-open') {
      this.halfOpenSuccesses = 0;
    }

    this.config.onStateChange?.(from, to, this.config.name);
  }

  private pruneOldFailures(): void {
    const cutoff = Date.now() - this.config.failureWindowMs;
    this.failures = this.failures.filter((ts) => ts > cutoff);
  }
}
