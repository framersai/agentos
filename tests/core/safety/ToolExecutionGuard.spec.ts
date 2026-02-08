import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  ToolExecutionGuard,
  ToolTimeoutError,
} from '../../../src/core/safety/ToolExecutionGuard';

describe('ToolExecutionGuard', () => {
  it('successful execution returns correct result', async () => {
    const guard = new ToolExecutionGuard();
    const result = await guard.execute('my-tool', async () => 'hello');

    expect(result.success).toBe(true);
    expect(result.result).toBe('hello');
    expect(result.timedOut).toBe(false);
    expect(result.toolName).toBe('my-tool');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('failed execution returns error info', async () => {
    const guard = new ToolExecutionGuard();
    const result = await guard.execute('my-tool', async () => {
      throw new Error('boom');
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('boom');
    expect(result.timedOut).toBe(false);
    expect(result.toolName).toBe('my-tool');
  });

  it('timeout returns timedOut true', async () => {
    const guard = new ToolExecutionGuard({ defaultTimeoutMs: 50 });

    const result = await guard.execute('slow-tool', () => {
      return new Promise((resolve) => {
        setTimeout(() => resolve('too late'), 200);
      });
    });

    expect(result.success).toBe(false);
    expect(result.timedOut).toBe(true);
    expect(result.error).toContain('timed out');
    expect(result.toolName).toBe('slow-tool');
  });

  it('per-tool timeout override works', async () => {
    const guard = new ToolExecutionGuard({
      defaultTimeoutMs: 5_000,
      toolTimeouts: { slow_tool: 50 },
    });

    const result = await guard.execute('slow_tool', () => {
      return new Promise((resolve) => {
        setTimeout(() => resolve('too late'), 200);
      });
    });

    expect(result.success).toBe(false);
    expect(result.timedOut).toBe(true);
  });

  it('circuit breaker triggers after repeated failures', async () => {
    const guard = new ToolExecutionGuard({
      defaultTimeoutMs: 5_000,
      enableCircuitBreaker: true,
      circuitBreakerConfig: {
        failureThreshold: 5,
        failureWindowMs: 60_000,
        cooldownMs: 30_000,
      },
    });

    // 5 failures to open the circuit
    for (let i = 0; i < 5; i++) {
      await guard.execute('flaky-tool', async () => {
        throw new Error('fail');
      });
    }

    // Next call should be rejected by the circuit breaker
    const result = await guard.execute('flaky-tool', async () => 'ok');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Circuit breaker open');
  });

  it('circuit breaker disabled means no circuit breaking', async () => {
    const guard = new ToolExecutionGuard({
      enableCircuitBreaker: false,
    });

    // 10 failures - should still not circuit break
    for (let i = 0; i < 10; i++) {
      await guard.execute('tool', async () => {
        throw new Error('fail');
      });
    }

    // Should still attempt execution (and fail from the fn, not circuit breaker)
    const result = await guard.execute('tool', async () => {
      throw new Error('still trying');
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe('still trying');
    // No circuit breaker message
    expect(result.error).not.toContain('Circuit breaker');
  });

  it('getToolHealth() returns accurate stats', async () => {
    const guard = new ToolExecutionGuard();

    await guard.execute('tool-a', async () => 'ok');
    await guard.execute('tool-a', async () => {
      throw new Error('fail');
    });

    const health = guard.getToolHealth('tool-a');
    expect(health.toolName).toBe('tool-a');
    expect(health.totalCalls).toBe(2);
    expect(health.failures).toBe(1);
    expect(health.timeouts).toBe(0);
    expect(health.avgDurationMs).toBeGreaterThanOrEqual(0);
  });

  it('getToolHealth() for unknown tool returns zeroed report', () => {
    const guard = new ToolExecutionGuard();
    const health = guard.getToolHealth('nonexistent');

    expect(health.toolName).toBe('nonexistent');
    expect(health.totalCalls).toBe(0);
    expect(health.failures).toBe(0);
    expect(health.timeouts).toBe(0);
    expect(health.avgDurationMs).toBe(0);
  });

  it('getAllToolHealth() returns all tracked tools', async () => {
    const guard = new ToolExecutionGuard();

    await guard.execute('tool-a', async () => 'ok');
    await guard.execute('tool-b', async () => 'ok');
    await guard.execute('tool-c', async () => 'ok');

    const allHealth = guard.getAllToolHealth();
    expect(allHealth).toHaveLength(3);

    const names = allHealth.map((h) => h.toolName);
    expect(names).toContain('tool-a');
    expect(names).toContain('tool-b');
    expect(names).toContain('tool-c');
  });

  it('resetTool() clears stats for specific tool', async () => {
    const guard = new ToolExecutionGuard();

    await guard.execute('tool-a', async () => 'ok');
    await guard.execute('tool-a', async () => 'ok');
    await guard.execute('tool-b', async () => 'ok');

    guard.resetTool('tool-a');

    const healthA = guard.getToolHealth('tool-a');
    expect(healthA.totalCalls).toBe(0);
    expect(healthA.failures).toBe(0);

    // tool-b unaffected
    const healthB = guard.getToolHealth('tool-b');
    expect(healthB.totalCalls).toBe(1);
  });

  it('resetAll() clears all tool stats', async () => {
    const guard = new ToolExecutionGuard();

    await guard.execute('tool-a', async () => 'ok');
    await guard.execute('tool-b', async () => 'ok');

    guard.resetAll();

    const healthA = guard.getToolHealth('tool-a');
    const healthB = guard.getToolHealth('tool-b');
    expect(healthA.totalCalls).toBe(0);
    expect(healthB.totalCalls).toBe(0);
  });

  it('ToolTimeoutError has correct fields', () => {
    const error = new ToolTimeoutError('my-tool', 5000);

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('ToolTimeoutError');
    expect(error.toolName).toBe('my-tool');
    expect(error.timeoutMs).toBe(5000);
    expect(error.message).toContain('my-tool');
    expect(error.message).toContain('5000');
  });
});
