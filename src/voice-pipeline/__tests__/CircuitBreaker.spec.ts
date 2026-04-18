import { describe, it, expect, vi } from 'vitest';
import { CircuitBreaker } from '../CircuitBreaker.js';

function mkBreaker() {
  return new CircuitBreaker({
    failureThreshold: 3,
    windowMs: 60_000,
    cooldownMs: 60_000,
    now: () => Date.now(),
  });
}

describe('CircuitBreaker', () => {
  it('starts healthy', () => {
    const b = mkBreaker();
    expect(b.state('deepgram')).toBe('healthy');
    expect(b.isAvailable('deepgram')).toBe(true);
  });

  it('trips after failureThreshold failures in window', () => {
    const b = mkBreaker();
    b.recordFailure('deepgram', 'network');
    b.recordFailure('deepgram', 'network');
    expect(b.state('deepgram')).toBe('healthy');
    b.recordFailure('deepgram', 'network');
    expect(b.state('deepgram')).toBe('tripped');
    expect(b.isAvailable('deepgram')).toBe(false);
  });

  it('auth failures trip immediately and do not auto-recover', () => {
    const b = mkBreaker();
    b.recordFailure('deepgram', 'auth');
    expect(b.state('deepgram')).toBe('tripped');
    b.tick(Date.now() + 10 * 60_000);
    expect(b.state('deepgram')).toBe('tripped');
  });

  it('recovers after cooldown', () => {
    const nowRef = { t: 1_000_000 };
    const b = new CircuitBreaker({
      failureThreshold: 1,
      windowMs: 60_000,
      cooldownMs: 60_000,
      now: () => nowRef.t,
    });
    b.recordFailure('eleven', 'service');
    expect(b.state('eleven')).toBe('tripped');
    nowRef.t += 30_000;
    expect(b.state('eleven')).toBe('tripped');
    nowRef.t += 31_000;
    expect(b.state('eleven')).toBe('healthy');
  });

  it('recordSuccess clears failure counter', () => {
    const b = mkBreaker();
    b.recordFailure('deepgram', 'network');
    b.recordFailure('deepgram', 'network');
    b.recordSuccess('deepgram');
    b.recordFailure('deepgram', 'network');
    b.recordFailure('deepgram', 'network');
    expect(b.state('deepgram')).toBe('healthy');
  });

  it('notifies subscribers on state transitions', () => {
    const b = mkBreaker();
    const onChange = vi.fn();
    b.onStateChange(onChange);
    b.recordFailure('deepgram', 'auth');
    expect(onChange).toHaveBeenCalledWith({
      providerId: 'deepgram',
      from: 'healthy',
      to: 'tripped',
      reason: 'auth',
    });
  });

  it('only counts failures within window', () => {
    const nowRef = { t: 1_000_000 };
    const b = new CircuitBreaker({
      failureThreshold: 3,
      windowMs: 10_000,
      cooldownMs: 60_000,
      now: () => nowRef.t,
    });
    b.recordFailure('eleven', 'network');
    nowRef.t += 11_000;
    b.recordFailure('eleven', 'network');
    b.recordFailure('eleven', 'network');
    // Only 2 failures inside the 10s window — still healthy.
    expect(b.state('eleven')).toBe('healthy');
  });
});
