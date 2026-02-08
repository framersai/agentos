import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { StuckDetector } from '../../../src/core/safety/StuckDetector';

describe('StuckDetector', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('first output is not stuck', () => {
    const detector = new StuckDetector();
    const result = detector.recordOutput('agent-1', 'hello world');
    expect(result.isStuck).toBe(false);
  });

  it('repeated outputs trigger stuck', () => {
    const detector = new StuckDetector({ repetitionThreshold: 3 });

    detector.recordOutput('agent-1', 'same output');
    detector.recordOutput('agent-1', 'same output');
    const result = detector.recordOutput('agent-1', 'same output');

    expect(result.isStuck).toBe(true);
    expect(result.reason).toBe('repeated_output');
    expect(result.repetitionCount).toBe(3);
  });

  it('different outputs are fine', () => {
    const detector = new StuckDetector();

    const r1 = detector.recordOutput('agent-1', 'output A');
    const r2 = detector.recordOutput('agent-1', 'output B');
    const r3 = detector.recordOutput('agent-1', 'output C');
    const r4 = detector.recordOutput('agent-1', 'output D');

    expect(r1.isStuck).toBe(false);
    expect(r2.isStuck).toBe(false);
    expect(r3.isStuck).toBe(false);
    expect(r4.isStuck).toBe(false);
  });

  it('oscillation detection (A,B,A,B)', () => {
    const detector = new StuckDetector();

    detector.recordOutput('agent-1', 'A');
    detector.recordOutput('agent-1', 'B');
    detector.recordOutput('agent-1', 'A');
    const result = detector.recordOutput('agent-1', 'B');

    expect(result.isStuck).toBe(true);
    expect(result.reason).toBe('oscillating');
  });

  it('error repetition detection', () => {
    const detector = new StuckDetector({ errorRepetitionThreshold: 3 });

    detector.recordError('agent-1', 'connection refused');
    detector.recordError('agent-1', 'connection refused');
    const result = detector.recordError('agent-1', 'connection refused');

    expect(result.isStuck).toBe(true);
    expect(result.reason).toBe('repeated_error');
    expect(result.repetitionCount).toBe(3);
  });

  it('entries expire after windowMs', () => {
    const detector = new StuckDetector({
      repetitionThreshold: 3,
      windowMs: 5_000,
    });

    detector.recordOutput('agent-1', 'same');
    detector.recordOutput('agent-1', 'same');

    // Advance past the window
    vi.advanceTimersByTime(6_000);

    // This should NOT be stuck because previous entries expired
    const result = detector.recordOutput('agent-1', 'same');
    expect(result.isStuck).toBe(false);
  });

  it('clearAgent() resets for that agent', () => {
    const detector = new StuckDetector({ repetitionThreshold: 3 });

    detector.recordOutput('agent-1', 'same');
    detector.recordOutput('agent-1', 'same');

    detector.clearAgent('agent-1');

    // After clearing, 2 prior records are gone; this is only the 1st
    const result = detector.recordOutput('agent-1', 'same');
    expect(result.isStuck).toBe(false);
  });

  it('clearAll() resets everything', () => {
    const detector = new StuckDetector({ repetitionThreshold: 3 });

    detector.recordOutput('agent-1', 'same');
    detector.recordOutput('agent-1', 'same');
    detector.recordOutput('agent-2', 'other');
    detector.recordOutput('agent-2', 'other');

    detector.clearAll();

    const r1 = detector.recordOutput('agent-1', 'same');
    const r2 = detector.recordOutput('agent-2', 'other');
    expect(r1.isStuck).toBe(false);
    expect(r2.isStuck).toBe(false);
  });

  it('custom thresholds trigger earlier', () => {
    const detector = new StuckDetector({ repetitionThreshold: 2 });

    detector.recordOutput('agent-1', 'output');
    const result = detector.recordOutput('agent-1', 'output');

    expect(result.isStuck).toBe(true);
    expect(result.reason).toBe('repeated_output');
    expect(result.repetitionCount).toBe(2);
  });

  it('different agents do not interfere', () => {
    const detector = new StuckDetector({ repetitionThreshold: 3 });

    detector.recordOutput('agent-1', 'same');
    detector.recordOutput('agent-1', 'same');
    detector.recordOutput('agent-2', 'same');
    detector.recordOutput('agent-2', 'same');

    // Neither should be stuck yet (only 2 each)
    const r1 = detector.recordOutput('agent-1', 'different');
    const r2 = detector.recordOutput('agent-2', 'different');
    expect(r1.isStuck).toBe(false);
    expect(r2.isStuck).toBe(false);

    // Now agent-1 hits threshold independently
    detector.recordOutput('agent-1', 'boom');
    detector.recordOutput('agent-1', 'boom');
    const r3 = detector.recordOutput('agent-1', 'boom');
    expect(r3.isStuck).toBe(true);

    // agent-2 still not stuck
    const r4 = detector.recordOutput('agent-2', 'fine');
    expect(r4.isStuck).toBe(false);
  });
});
