/**
 * @file ToolExecutionGuard.ts
 * @description Wraps tool execution with a timeout, per-tool failure tracking,
 * and optional circuit breaking. Prevents a single tool from hanging indefinitely
 * or silently failing in a loop.
 */
import { type CircuitBreakerConfig, type CircuitState } from './CircuitBreaker.js';
export interface ToolExecutionGuardConfig {
    /** Default timeout per tool execution in ms. @default 30000 */
    defaultTimeoutMs: number;
    /** Per-tool timeout overrides. */
    toolTimeouts?: Record<string, number>;
    /** Whether to enable per-tool circuit breakers. @default true */
    enableCircuitBreaker: boolean;
    /** Circuit breaker config applied to each tool. */
    circuitBreakerConfig?: Partial<Omit<CircuitBreakerConfig, 'name'>>;
}
export interface GuardedToolResult<T = unknown> {
    success: boolean;
    result?: T;
    error?: string;
    durationMs: number;
    timedOut: boolean;
    toolName: string;
}
export interface ToolHealthReport {
    toolName: string;
    totalCalls: number;
    failures: number;
    timeouts: number;
    avgDurationMs: number;
    circuitState: CircuitState | 'disabled';
}
export declare class ToolTimeoutError extends Error {
    readonly toolName: string;
    readonly timeoutMs: number;
    constructor(toolName: string, timeoutMs: number);
}
export declare class ToolExecutionGuard {
    private tools;
    private config;
    constructor(config?: Partial<ToolExecutionGuardConfig>);
    execute<T>(toolName: string, fn: () => Promise<T>): Promise<GuardedToolResult<T>>;
    getToolHealth(toolName: string): ToolHealthReport;
    getAllToolHealth(): ToolHealthReport[];
    resetTool(toolName: string): void;
    resetAll(): void;
    private getOrCreateStats;
    private withTimeout;
}
//# sourceMappingURL=ToolExecutionGuard.d.ts.map