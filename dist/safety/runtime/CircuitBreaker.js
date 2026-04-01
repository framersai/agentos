/**
 * @file CircuitBreaker.ts
 * @description Classic three-state circuit breaker (closed → open → half-open → closed)
 * that wraps any async operation. When failures exceed a threshold within a window,
 * the circuit opens and rejects calls immediately for a cooldown period.
 */
export class CircuitOpenError extends Error {
    constructor(breakerName, cooldownRemainingMs) {
        super(`Circuit breaker '${breakerName}' is open. Retry after ${cooldownRemainingMs}ms.`);
        this.breakerName = breakerName;
        this.cooldownRemainingMs = cooldownRemainingMs;
        this.name = 'CircuitOpenError';
    }
}
const DEFAULT_CONFIG = {
    failureThreshold: 5,
    failureWindowMs: 60000,
    cooldownMs: 30000,
    halfOpenSuccessThreshold: 2,
};
export class CircuitBreaker {
    constructor(config) {
        this.state = 'closed';
        this.failures = [];
        this.halfOpenSuccesses = 0;
        this.lastStateChangeAt = Date.now();
        this.totalTripped = 0;
        this.lastFailureAt = null;
        this.successCount = 0;
        this.config = { ...DEFAULT_CONFIG, ...config };
    }
    async execute(fn) {
        this.pruneOldFailures();
        if (this.state === 'open') {
            const elapsed = Date.now() - this.lastStateChangeAt;
            if (elapsed >= this.config.cooldownMs) {
                this.transition('half-open');
            }
            else {
                throw new CircuitOpenError(this.config.name, this.config.cooldownMs - elapsed);
            }
        }
        try {
            const result = await fn();
            this.recordSuccess();
            return result;
        }
        catch (error) {
            this.recordFailure();
            throw error;
        }
    }
    recordFailure() {
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
    recordSuccess() {
        this.successCount++;
        if (this.state === 'half-open') {
            this.halfOpenSuccesses++;
            if (this.halfOpenSuccesses >= this.config.halfOpenSuccessThreshold) {
                this.transition('closed');
            }
        }
    }
    forceState(state) {
        this.transition(state);
    }
    reset() {
        this.failures = [];
        this.halfOpenSuccesses = 0;
        this.successCount = 0;
        this.lastFailureAt = null;
        this.transition('closed');
    }
    getState() {
        // Check if open circuit should auto-transition to half-open
        if (this.state === 'open') {
            const elapsed = Date.now() - this.lastStateChangeAt;
            if (elapsed >= this.config.cooldownMs) {
                this.transition('half-open');
            }
        }
        return this.state;
    }
    getStats() {
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
    transition(to) {
        const from = this.state;
        if (from === to)
            return;
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
    pruneOldFailures() {
        const cutoff = Date.now() - this.config.failureWindowMs;
        this.failures = this.failures.filter((ts) => ts > cutoff);
    }
}
//# sourceMappingURL=CircuitBreaker.js.map