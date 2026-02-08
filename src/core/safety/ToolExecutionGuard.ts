/**
 * @file ToolExecutionGuard.ts
 * @description Wraps tool execution with a timeout, per-tool failure tracking,
 * and optional circuit breaking. Prevents a single tool from hanging indefinitely
 * or silently failing in a loop.
 */

import { CircuitBreaker, type CircuitBreakerConfig, type CircuitState } from './CircuitBreaker.js';

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

export class ToolTimeoutError extends Error {
  constructor(
    public readonly toolName: string,
    public readonly timeoutMs: number,
  ) {
    super(`Tool '${toolName}' timed out after ${timeoutMs}ms`);
    this.name = 'ToolTimeoutError';
  }
}

interface ToolStats {
  totalCalls: number;
  failures: number;
  timeouts: number;
  durations: number[];
  breaker?: CircuitBreaker;
}

const DEFAULT_CONFIG: ToolExecutionGuardConfig = {
  defaultTimeoutMs: 30_000,
  enableCircuitBreaker: true,
};

export class ToolExecutionGuard {
  private tools: Map<string, ToolStats> = new Map();
  private config: ToolExecutionGuardConfig;

  constructor(config?: Partial<ToolExecutionGuardConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async execute<T>(toolName: string, fn: () => Promise<T>): Promise<GuardedToolResult<T>> {
    const stats = this.getOrCreateStats(toolName);
    stats.totalCalls++;
    const start = Date.now();

    // Circuit breaker check
    if (stats.breaker) {
      const state = stats.breaker.getState();
      if (state === 'open') {
        const cbStats = stats.breaker.getStats();
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
      if (stats.durations.length > 100) stats.durations.shift();
      stats.breaker?.recordSuccess();

      return { success: true, result, durationMs, timedOut: false, toolName };
    } catch (error) {
      const durationMs = Date.now() - start;
      stats.durations.push(durationMs);
      if (stats.durations.length > 100) stats.durations.shift();

      const isTimeout = error instanceof ToolTimeoutError;
      if (isTimeout) stats.timeouts++;
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

  getToolHealth(toolName: string): ToolHealthReport {
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

  getAllToolHealth(): ToolHealthReport[] {
    return Array.from(this.tools.keys()).map((name) => this.getToolHealth(name));
  }

  resetTool(toolName: string): void {
    const stats = this.tools.get(toolName);
    if (stats) {
      stats.totalCalls = 0;
      stats.failures = 0;
      stats.timeouts = 0;
      stats.durations = [];
      stats.breaker?.reset();
    }
  }

  resetAll(): void {
    for (const name of this.tools.keys()) {
      this.resetTool(name);
    }
  }

  private getOrCreateStats(toolName: string): ToolStats {
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
          failureWindowMs: 60_000,
          cooldownMs: 30_000,
          halfOpenSuccessThreshold: 2,
          ...this.config.circuitBreakerConfig,
        });
      }
      this.tools.set(toolName, stats);
    }
    return stats;
  }

  private withTimeout<T>(fn: () => Promise<T>, timeoutMs: number, toolName: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new ToolTimeoutError(toolName, timeoutMs));
      }, timeoutMs);

      fn().then(
        (result) => {
          clearTimeout(timer);
          resolve(result);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        },
      );
    });
  }
}
