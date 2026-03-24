/**
 * @file AcousticEndpointDetector.spec.ts
 *
 * Unit tests for the AcousticEndpointDetector voice-pipeline component.
 * All timer-based behaviour is validated with vitest fake timers to avoid
 * real-time delays in CI.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AcousticEndpointDetector } from '../AcousticEndpointDetector.js';
import type { TurnCompleteEvent, VadEvent, TranscriptEvent } from '../types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal VadEvent at the given timestamp (defaults to Date.now()). */
function makeVad(type: VadEvent['type'], timestamp = Date.now()): VadEvent {
  return { type, timestamp };
}

/** Convenience: advance fake timers AND flush microtask queue. */
async function advance(ms: number): Promise<void> {
  vi.advanceTimersByTime(ms);
  // Let any queued promise callbacks settle.
  await Promise.resolve();
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('AcousticEndpointDetector', () => {
  let detector: AcousticEndpointDetector;

  beforeEach(() => {
    vi.useFakeTimers();
    detector = new AcousticEndpointDetector({
      significantPauseThresholdMs: 500,
      utteranceEndThresholdMs: 1000,
    });
  });

  afterEach(() => {
    detector.reset();
    vi.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // Basic properties
  // -------------------------------------------------------------------------

  it('exposes mode === "acoustic"', () => {
    expect(detector.mode).toBe('acoustic');
  });

  // -------------------------------------------------------------------------
  // turn_complete after silence
  // -------------------------------------------------------------------------

  it('emits turn_complete with reason "silence_timeout" after utteranceEndThresholdMs of silence', async () => {
    const handler = vi.fn<[TurnCompleteEvent], void>();
    detector.on('turn_complete', handler);

    const now = 1_000_000;
    vi.setSystemTime(now);

    detector.pushVadEvent(makeVad('speech_start', now));
    detector.pushVadEvent(makeVad('speech_end', now + 200));

    // Advance past the utteranceEndThresholdMs (1000 ms) + polling interval headroom
    await advance(1500);

    expect(handler).toHaveBeenCalledOnce();
    const event: TurnCompleteEvent = handler.mock.calls[0][0];
    expect(event.reason).toBe('silence_timeout');
  });

  it('does NOT emit turn_complete before utteranceEndThresholdMs elapses', async () => {
    const handler = vi.fn();
    detector.on('turn_complete', handler);

    const now = 2_000_000;
    vi.setSystemTime(now);

    detector.pushVadEvent(makeVad('speech_start', now));
    detector.pushVadEvent(makeVad('speech_end', now + 100));

    // Advance to just before the threshold
    await advance(800);

    expect(handler).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // speech_start cancels pending timer
  // -------------------------------------------------------------------------

  it('cancels pending turn_complete when speech_start arrives before threshold', async () => {
    const handler = vi.fn();
    detector.on('turn_complete', handler);

    const now = 3_000_000;
    vi.setSystemTime(now);

    detector.pushVadEvent(makeVad('speech_start', now));
    detector.pushVadEvent(makeVad('speech_end', now + 200));

    // Advance partway through silence window…
    await advance(600);

    // …then speech resumes, which should cancel any pending completion
    detector.pushVadEvent(makeVad('speech_start', now + 800));

    // Advance well past threshold; still no event expected
    await advance(2000);

    expect(handler).not.toHaveBeenCalled();
  });

  it('re-emits "speech_start" on itself when a speech_start VAD event is received', () => {
    const handler = vi.fn();
    detector.on('speech_start', handler);

    detector.pushVadEvent(makeVad('speech_start', Date.now()));

    expect(handler).toHaveBeenCalledOnce();
  });

  // -------------------------------------------------------------------------
  // reset()
  // -------------------------------------------------------------------------

  it('reset() prevents a pending turn_complete from firing', async () => {
    const handler = vi.fn();
    detector.on('turn_complete', handler);

    const now = 4_000_000;
    vi.setSystemTime(now);

    detector.pushVadEvent(makeVad('speech_start', now));
    detector.pushVadEvent(makeVad('speech_end', now + 100));

    // Reset before threshold elapses
    await advance(400);
    detector.reset();

    // Advance well past threshold after reset
    await advance(2000);

    expect(handler).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // pushTranscript is a no-op
  // -------------------------------------------------------------------------

  it('pushTranscript() is a no-op and does not throw', () => {
    const handler = vi.fn();
    detector.on('turn_complete', handler);

    const transcriptEvent: TranscriptEvent = {
      text: 'hello world',
      confidence: 0.95,
      words: [],
      isFinal: true,
    };

    expect(() => detector.pushTranscript(transcriptEvent)).not.toThrow();
    expect(handler).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Configurable thresholds
  // -------------------------------------------------------------------------

  it('respects a custom utteranceEndThresholdMs', async () => {
    // Build a fresh detector with a much shorter threshold
    const fastDetector = new AcousticEndpointDetector({
      significantPauseThresholdMs: 100,
      utteranceEndThresholdMs: 300,
    });
    const handler = vi.fn();
    fastDetector.on('turn_complete', handler);

    const now = 5_000_000;
    vi.setSystemTime(now);

    fastDetector.pushVadEvent(makeVad('speech_start', now));
    fastDetector.pushVadEvent(makeVad('speech_end', now + 50));

    // Should NOT fire before 300 ms (total 200ms elapsed since speech_end at 50ms)
    await advance(200);
    expect(handler).not.toHaveBeenCalled();

    // Advance well past threshold + polling interval to ensure timer fires
    await advance(500);
    expect(handler).toHaveBeenCalledOnce();

    fastDetector.reset();
  });

  it('includes a non-negative durationMs in the TurnCompleteEvent', async () => {
    const handler = vi.fn<[TurnCompleteEvent], void>();
    detector.on('turn_complete', handler);

    const now = 6_000_000;
    vi.setSystemTime(now);

    detector.pushVadEvent(makeVad('speech_start', now));
    detector.pushVadEvent(makeVad('speech_end', now + 400));

    await advance(1500);

    expect(handler).toHaveBeenCalledOnce();
    const event = handler.mock.calls[0][0];
    // durationMs = speechEndTimeMs - speechStartTimeMs = 400
    expect(event.durationMs).toBeGreaterThanOrEqual(0);
    expect(event.durationMs).toBe(400);
  });
});
