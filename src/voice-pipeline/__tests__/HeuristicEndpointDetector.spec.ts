/**
 * Unit tests for HeuristicEndpointDetector.
 *
 * All tests use real timers except the `silence_timeout` case, which uses a
 * 100 ms detector instance and a short `setTimeout` await — fast enough for CI
 * while remaining deterministic.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HeuristicEndpointDetector } from '../HeuristicEndpointDetector.js';
import type { TranscriptEvent, VadEvent } from '../types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal final TranscriptEvent. */
function transcript(text: string, isFinal = true): TranscriptEvent {
  return { text, confidence: 0.9, words: [], isFinal };
}

/** Build a speech_end VadEvent at the current time. */
function speechEnd(): VadEvent {
  return { type: 'speech_end', timestamp: Date.now(), source: 'vad' };
}

/** Build a speech_start VadEvent at the current time. */
function speechStart(): VadEvent {
  return { type: 'speech_start', timestamp: Date.now(), source: 'vad' };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('HeuristicEndpointDetector', () => {
  let detector: HeuristicEndpointDetector;

  beforeEach(() => {
    detector = new HeuristicEndpointDetector();
  });

  afterEach(() => {
    // Ensure any pending timers are cancelled and state is clean.
    detector.reset();
  });

  // -------------------------------------------------------------------------
  // Basic identity
  // -------------------------------------------------------------------------

  it('has mode "heuristic"', () => {
    expect(detector.mode).toBe('heuristic');
  });

  // -------------------------------------------------------------------------
  // Punctuation-triggered completion
  // -------------------------------------------------------------------------

  it('emits turn_complete with reason "punctuation" on period + speech_end', () => {
    const handler = vi.fn();
    detector.on('turn_complete', handler);

    detector.pushTranscript({ text: 'Hello there.', confidence: 0.95, words: [], isFinal: true });
    detector.pushVadEvent({ type: 'speech_end', timestamp: Date.now(), source: 'vad' });

    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0][0].reason).toBe('punctuation');
    expect(handler.mock.calls[0][0].transcript).toBe('Hello there.');
  });

  it('emits turn_complete with reason "punctuation" on question mark', () => {
    const handler = vi.fn();
    detector.on('turn_complete', handler);

    detector.pushTranscript(transcript('Are you there?'));
    detector.pushVadEvent(speechEnd());

    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0][0].reason).toBe('punctuation');
  });

  it('emits turn_complete with reason "punctuation" on exclamation mark', () => {
    const handler = vi.fn();
    detector.on('turn_complete', handler);

    detector.pushTranscript(transcript('Watch out!'));
    detector.pushVadEvent(speechEnd());

    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0][0].reason).toBe('punctuation');
  });

  it('includes the correct transcript text in the turn_complete event', () => {
    const handler = vi.fn();
    detector.on('turn_complete', handler);

    detector.pushTranscript(transcript('Testing one two three.'));
    detector.pushVadEvent(speechEnd());

    expect(handler.mock.calls[0][0].transcript).toBe('Testing one two three.');
  });

  it('includes confidence in the turn_complete event', () => {
    const handler = vi.fn();
    detector.on('turn_complete', handler);

    detector.pushTranscript({ text: 'Hello.', confidence: 0.77, words: [], isFinal: true });
    detector.pushVadEvent(speechEnd());

    expect(handler.mock.calls[0][0].confidence).toBe(0.77);
  });

  // -------------------------------------------------------------------------
  // Backchannel detection
  // -------------------------------------------------------------------------

  it('detects "uh huh" and emits backchannel_detected', () => {
    const bcHandler = vi.fn();
    const tcHandler = vi.fn();
    detector.on('backchannel_detected', bcHandler);
    detector.on('turn_complete', tcHandler);

    detector.pushTranscript({ text: 'uh huh', confidence: 0.8, words: [], isFinal: true });
    detector.pushVadEvent(speechEnd());

    expect(bcHandler).toHaveBeenCalledOnce();
    expect(bcHandler.mock.calls[0][0].text).toBe('uh huh');
    // turn_complete must NOT fire because backchannel suppresses accumulation.
    expect(tcHandler).not.toHaveBeenCalled();
  });

  it('detects "yeah" as a backchannel phrase', () => {
    const handler = vi.fn();
    detector.on('backchannel_detected', handler);

    detector.pushTranscript(transcript('yeah'));
    expect(handler).toHaveBeenCalledOnce();
  });

  it('detects "okay" as a backchannel phrase', () => {
    const handler = vi.fn();
    detector.on('backchannel_detected', handler);
    detector.pushTranscript(transcript('okay'));
    expect(handler).toHaveBeenCalledOnce();
  });

  it('detects "ok" as a backchannel phrase', () => {
    const handler = vi.fn();
    detector.on('backchannel_detected', handler);
    detector.pushTranscript(transcript('ok'));
    expect(handler).toHaveBeenCalledOnce();
  });

  it('detects "mm hmm" as a backchannel phrase', () => {
    const handler = vi.fn();
    detector.on('backchannel_detected', handler);
    detector.pushTranscript(transcript('mm hmm'));
    expect(handler).toHaveBeenCalledOnce();
  });

  it('detects "mm-hmm" as a backchannel phrase', () => {
    const handler = vi.fn();
    detector.on('backchannel_detected', handler);
    detector.pushTranscript(transcript('mm-hmm'));
    expect(handler).toHaveBeenCalledOnce();
  });

  it('detects "gotcha" as a backchannel phrase', () => {
    const handler = vi.fn();
    detector.on('backchannel_detected', handler);
    detector.pushTranscript(transcript('gotcha'));
    expect(handler).toHaveBeenCalledOnce();
  });

  it('is case-insensitive for backchannel matching', () => {
    const handler = vi.fn();
    detector.on('backchannel_detected', handler);
    detector.pushTranscript(transcript('  Uh Huh  '));
    expect(handler).toHaveBeenCalledOnce();
  });

  // -------------------------------------------------------------------------
  // Silence timeout fallback
  // -------------------------------------------------------------------------

  it('falls back to silence timeout when no terminal punctuation', async () => {
    detector = new HeuristicEndpointDetector({ silenceTimeoutMs: 100 });
    const handler = vi.fn();
    detector.on('turn_complete', handler);

    detector.pushTranscript({ text: 'well I think', confidence: 0.85, words: [], isFinal: true });
    detector.pushVadEvent({ type: 'speech_end', timestamp: Date.now(), source: 'vad' });

    // Must not fire synchronously.
    expect(handler).not.toHaveBeenCalled();

    await new Promise<void>((r) => setTimeout(r, 150));

    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0][0].reason).toBe('silence_timeout');
  });

  it('silence timeout carries the correct transcript', async () => {
    detector = new HeuristicEndpointDetector({ silenceTimeoutMs: 100 });
    const handler = vi.fn();
    detector.on('turn_complete', handler);

    detector.pushTranscript(transcript('no punctuation here'));
    detector.pushVadEvent(speechEnd());

    await new Promise<void>((r) => setTimeout(r, 150));

    expect(handler.mock.calls[0][0].transcript).toBe('no punctuation here');
  });

  // -------------------------------------------------------------------------
  // Does not emit without accumulated text
  // -------------------------------------------------------------------------

  it('does not emit turn_complete if no text was accumulated before speech_end', () => {
    const handler = vi.fn();
    detector.on('turn_complete', handler);

    // Push speech_end with no prior transcript.
    detector.pushVadEvent(speechEnd());

    expect(handler).not.toHaveBeenCalled();
  });

  it('does not emit turn_complete for interim (non-final) transcripts', () => {
    const handler = vi.fn();
    detector.on('turn_complete', handler);

    detector.pushTranscript({ text: 'hello.', confidence: 0.9, words: [], isFinal: false });
    detector.pushVadEvent(speechEnd());

    expect(handler).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // speech_start cancels pending silence timer
  // -------------------------------------------------------------------------

  it('speech_start cancels a pending silence timer so turn_complete does not fire', async () => {
    detector = new HeuristicEndpointDetector({ silenceTimeoutMs: 100 });
    const handler = vi.fn();
    detector.on('turn_complete', handler);

    detector.pushTranscript(transcript('mid sentence without punctuation'));
    detector.pushVadEvent({ type: 'speech_end', timestamp: Date.now(), source: 'vad' });

    // User resumes speaking before timeout elapses.
    detector.pushVadEvent({ type: 'speech_start', timestamp: Date.now(), source: 'vad' });

    await new Promise<void>((r) => setTimeout(r, 150));

    // Timer was cancelled — turn_complete should not have fired.
    expect(handler).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // reset()
  // -------------------------------------------------------------------------

  it('reset clears accumulated text so speech_end no longer triggers turn_complete', () => {
    const handler = vi.fn();
    detector.on('turn_complete', handler);

    detector.pushTranscript(transcript('some text.'));
    detector.reset();

    // After reset the accumulated text is gone — speech_end should not fire.
    detector.pushVadEvent(speechEnd());
    expect(handler).not.toHaveBeenCalled();
  });

  it('reset cancels a pending silence timer', async () => {
    detector = new HeuristicEndpointDetector({ silenceTimeoutMs: 100 });
    const handler = vi.fn();
    detector.on('turn_complete', handler);

    detector.pushTranscript(transcript('hello there'));
    detector.pushVadEvent(speechEnd());

    // Timer is now ticking — reset it before it fires.
    detector.reset();

    await new Promise<void>((r) => setTimeout(r, 150));
    expect(handler).not.toHaveBeenCalled();
  });
});
