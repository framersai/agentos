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
export declare class CircuitOpenError extends Error {
    readonly breakerName: string;
    readonly cooldownRemainingMs: number;
    constructor(breakerName: string, cooldownRemainingMs: number);
}
export declare class CircuitBreaker {
    private state;
    private failures;
    private halfOpenSuccesses;
    private lastStateChangeAt;
    private totalTripped;
    private lastFailureAt;
    private successCount;
    private config;
    constructor(config: Partial<CircuitBreakerConfig> & {
        name: string;
    });
    execute<T>(fn: () => Promise<T>): Promise<T>;
    recordFailure(): void;
    recordSuccess(): void;
    forceState(state: CircuitState): void;
    reset(): void;
    getState(): CircuitState;
    getStats(): CircuitBreakerStats;
    private transition;
    private pruneOldFailures;
}
//# sourceMappingURL=CircuitBreaker.d.ts.map