/**
 * @file ToolExecutionGuard.ts
 * @description Wraps tool execution with a timeout, per-tool failure tracking,
 * and optional circuit breaking. Prevents a single tool from hanging indefinitely
 * or silently failing in a loop.
 */
import { CircuitBreaker } from './CircuitBreaker.js';
export class ToolTimeoutError extends Error {
    constructor(toolName, timeoutMs) {
        super(`Tool '${toolName}' timed out after ${timeoutMs}ms`);
        this.toolName = toolName;
        this.timeoutMs = timeoutMs;
        this.name = 'ToolTimeoutError';
    }
}
const DEFAULT_CONFIG = {
    defaultTimeoutMs: 30000,
    enableCircuitBreaker: true,
};
export class ToolExecutionGuard {
    constructor(config) {
        this.tools = new Map();
        this.config = { ...DEFAULT_CONFIG, ...config };
    }
    async execute(toolName, fn) {
        const stats = this.getOrCreateStats(toolName);
        stats.totalCalls++;
        const start = Date.now();
        // Circuit breaker check
        if (stats.breaker) {
            const state = stats.breaker.getState();
            if (state === 'open') {
                stats.failures++;
                return {
                    success: false,
                    error: `Circuit breaker open for tool '${toolName}'. Cooldown remaining.`,
                    durationMs: 0,
                    timedOut: false,
                    toolName,
                };
            }
        }
        const timeoutMs = this.config.toolTimeouts?.[toolName] ?? this.config.defaultTimeoutMs;
        try {
            const result = await this.withTimeout(fn, timeoutMs, toolName);
            const durationMs = Date.now() - start;
            stats.durations.push(durationMs);
            if (stats.durations.length > 100)
                stats.durations.shift();
            stats.breaker?.recordSuccess();
            return { success: true, result, durationMs, timedOut: false, toolName };
        }
        catch (error) {
            const durationMs = Date.now() - start;
            stats.durations.push(durationMs);
            if (stats.durations.length > 100)
                stats.durations.shift();
            const isTimeout = error instanceof ToolTimeoutError;
            if (isTimeout)
                stats.timeouts++;
            stats.failures++;
            stats.breaker?.recordFailure();
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
                durationMs,
                timedOut: isTimeout,
                toolName,
            };
        }
    }
    getToolHealth(toolName) {
        const stats = this.tools.get(toolName);
        if (!stats) {
            return {
                toolName,
                totalCalls: 0,
                failures: 0,
                timeouts: 0,
                avgDurationMs: 0,
                circuitState: this.config.enableCircuitBreaker ? 'closed' : 'disabled',
            };
        }
        const avgDuration = stats.durations.length > 0
            ? stats.durations.reduce((a, b) => a + b, 0) / stats.durations.length
            : 0;
        return {
            toolName,
            totalCalls: stats.totalCalls,
            failures: stats.failures,
            timeouts: stats.timeouts,
            avgDurationMs: Math.round(avgDuration),
            circuitState: stats.breaker ? stats.breaker.getState() : 'disabled',
        };
    }
    getAllToolHealth() {
        return Array.from(this.tools.keys()).map((name) => this.getToolHealth(name));
    }
    resetTool(toolName) {
        const stats = this.tools.get(toolName);
        if (stats) {
            stats.totalCalls = 0;
            stats.failures = 0;
            stats.timeouts = 0;
            stats.durations = [];
            stats.breaker?.reset();
        }
    }
    resetAll() {
        for (const name of this.tools.keys()) {
            this.resetTool(name);
        }
    }
    getOrCreateStats(toolName) {
        let stats = this.tools.get(toolName);
        if (!stats) {
            stats = {
                totalCalls: 0,
                failures: 0,
                timeouts: 0,
                durations: [],
            };
            if (this.config.enableCircuitBreaker) {
                stats.breaker = new CircuitBreaker({
                    name: `tool:${toolName}`,
                    failureThreshold: 5,
                    failureWindowMs: 60000,
                    cooldownMs: 30000,
                    halfOpenSuccessThreshold: 2,
                    ...this.config.circuitBreakerConfig,
                });
            }
            this.tools.set(toolName, stats);
        }
        return stats;
    }
    withTimeout(fn, timeoutMs, toolName) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                reject(new ToolTimeoutError(toolName, timeoutMs));
            }, timeoutMs);
            fn().then((result) => {
                clearTimeout(timer);
                resolve(result);
            }, (error) => {
                clearTimeout(timer);
                reject(error);
            });
        });
    }
}
//# sourceMappingURL=ToolExecutionGuard.js.map