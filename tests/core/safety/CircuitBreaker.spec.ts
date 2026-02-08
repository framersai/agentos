import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  CircuitBreaker,
  CircuitOpenError,
  type CircuitState,
} from '../../../src/core/safety/CircuitBreaker';

describe('CircuitBreaker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts closed', () => {
    const breaker = new CircuitBreaker({ name: 'test' });
    expect(breaker.getState()).toBe('closed');
  });

  it('passes through in closed state', async () => {
    const breaker = new CircuitBreaker({ name: 'test' });
    const result = await breaker.execute(async () => 42);
    expect(result).toBe(42);
  });

  it('records failures and opens after threshold', () => {
    const breaker = new CircuitBreaker({
      name: 'test',
      failureThreshold: 5,
      failureWindowMs: 60_000,
    });

    for (let i = 0; i < 4; i++) {
      breaker.recordFailure();
      expect(breaker.getState()).toBe('closed');
    }

    breaker.recordFailure();
    expect(breaker.getState()).toBe('open');
  });

  it('throws CircuitOpenError when open', async () => {
    const breaker = new CircuitBreaker({
      name: 'my-breaker',
      failureThreshold: 5,
      cooldownMs: 30_000,
    });

    for (let i = 0; i < 5; i++) {
      breaker.recordFailure();
    }
    expect(breaker.getState()).toBe('open');

    try {
      await breaker.execute(async () => 'nope');
      expect.unreachable('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(CircuitOpenError);
      const error = err as CircuitOpenError;
      expect(error.breakerName).toBe('my-breaker');
      expect(error.cooldownRemainingMs).toBeGreaterThan(0);
      expect(error.cooldownRemainingMs).toBeLessThanOrEqual(30_000);
    }
  });

  it('transitions to half-open after cooldown', () => {
    const breaker = new CircuitBreaker({
      name: 'test',
      failureThreshold: 5,
      cooldownMs: 30_000,
    });

    for (let i = 0; i < 5; i++) {
      breaker.recordFailure();
    }
    expect(breaker.getState()).toBe('open');

    vi.advanceTimersByTime(30_001);
    expect(breaker.getState()).toBe('half-open');
  });

  it('closes after halfOpenSuccessThreshold successes', async () => {
    const breaker = new CircuitBreaker({
      name: 'test',
      failureThreshold: 5,
      cooldownMs: 30_000,
      halfOpenSuccessThreshold: 2,
    });

    // Open the circuit
    for (let i = 0; i < 5; i++) {
      breaker.recordFailure();
    }
    expect(breaker.getState()).toBe('open');

    // Advance past cooldown to get to half-open
    vi.advanceTimersByTime(30_001);
    expect(breaker.getState()).toBe('half-open');

    // First success keeps it half-open
    await breaker.execute(async () => 'ok');
    expect(breaker.getState()).toBe('half-open');

    // Second success closes it
    await breaker.execute(async () => 'ok');
    expect(breaker.getState()).toBe('closed');
  });

  it('re-opens from half-open on failure', async () => {
    const breaker = new CircuitBreaker({
      name: 'test',
      failureThreshold: 5,
      cooldownMs: 30_000,
    });

    // Open the circuit
    for (let i = 0; i < 5; i++) {
      breaker.recordFailure();
    }
    expect(breaker.getState()).toBe('open');

    // Move to half-open
    vi.advanceTimersByTime(30_001);
    expect(breaker.getState()).toBe('half-open');

    // Single failure re-opens
    try {
      await breaker.execute(async () => {
        throw new Error('fail');
      });
    } catch {
      // expected
    }
    expect(breaker.getState()).toBe('open');
  });

  it('prunes old failures outside window', () => {
    const breaker = new CircuitBreaker({
      name: 'test',
      failureThreshold: 5,
      failureWindowMs: 10_000,
    });

    // Record 4 failures
    for (let i = 0; i < 4; i++) {
      breaker.recordFailure();
    }

    // Advance past the window so those 4 expire
    vi.advanceTimersByTime(11_000);

    // Record 1 more failure - should NOT open since old ones are pruned
    breaker.recordFailure();
    expect(breaker.getState()).toBe('closed');
  });

  it('forceState() works', () => {
    const breaker = new CircuitBreaker({ name: 'test' });

    breaker.forceState('open');
    expect(breaker.getState()).toBe('open');

    breaker.forceState('half-open');
    expect(breaker.getState()).toBe('half-open');

    breaker.forceState('closed');
    expect(breaker.getState()).toBe('closed');
  });

  it('reset() clears all state', () => {
    const breaker = new CircuitBreaker({
      name: 'test',
      failureThreshold: 5,
    });

    // Record some failures and open
    for (let i = 0; i < 5; i++) {
      breaker.recordFailure();
    }
    expect(breaker.getState()).toBe('open');

    breaker.reset();
    expect(breaker.getState()).toBe('closed');

    const stats = breaker.getStats();
    expect(stats.failureCount).toBe(0);
    expect(stats.successCount).toBe(0);
    expect(stats.lastFailureAt).toBeNull();
  });

  it('getStats() returns accurate data', () => {
    const breaker = new CircuitBreaker({
      name: 'stats-breaker',
      failureThreshold: 5,
    });

    const stats = breaker.getStats();
    expect(stats.name).toBe('stats-breaker');
    expect(stats.state).toBe('closed');
    expect(stats.failureCount).toBe(0);
    expect(stats.successCount).toBe(0);
    expect(stats.totalTripped).toBe(0);

    // Trip the breaker
    for (let i = 0; i < 5; i++) {
      breaker.recordFailure();
    }
    const trippedStats = breaker.getStats();
    expect(trippedStats.totalTripped).toBe(1);

    // Reset and trip again
    breaker.reset();
    for (let i = 0; i < 5; i++) {
      breaker.recordFailure();
    }
    const stats2 = breaker.getStats();
    expect(stats2.totalTripped).toBe(2);
  });

  it('onStateChange callback fires', () => {
    const onChange = vi.fn();
    const breaker = new CircuitBreaker({
      name: 'callback-breaker',
      failureThreshold: 5,
      onStateChange: onChange,
    });

    for (let i = 0; i < 5; i++) {
      breaker.recordFailure();
    }

    expect(onChange).toHaveBeenCalledWith('closed', 'open', 'callback-breaker');
  });

  it('custom config thresholds work', () => {
    const breaker = new CircuitBreaker({
      name: 'custom',
      failureThreshold: 2,
      failureWindowMs: 5_000,
      cooldownMs: 1_000,
      halfOpenSuccessThreshold: 1,
    });

    // Only 2 failures needed to open
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.getState()).toBe('open');

    // Only 1s cooldown
    vi.advanceTimersByTime(1_001);
    expect(breaker.getState()).toBe('half-open');

    // Only 1 success needed to close
    breaker.recordSuccess();
    expect(breaker.getState()).toBe('closed');
  });
});
