/**
 * @module voice-pipeline/__tests__/SoftFadeBargeinHandler.spec
 *
 * Unit tests for {@link SoftFadeBargeinHandler}.
 *
 * ## What is tested
 *
 * - mode property returns 'soft-fade'
 * - Ignore tier: speech below ignoreMs returns { type: 'ignore' }
 * - Pause tier: speech in [ignoreMs, cancelMs) returns { type: 'pause', fadeMs }
 * - Cancel tier: speech at or above cancelMs returns { type: 'cancel' }
 * - Exact boundary values for both ignoreMs and cancelMs thresholds
 * - Default fadeMs (200 ms) is propagated in pause action
 * - Custom ignoreMs, cancelMs, and fadeMs are honoured
 * - All three tiers can be customised simultaneously
 * - Return value shapes match expected discriminated union variants
 */

import { describe, it, expect } from 'vitest';
import { SoftFadeBargeinHandler } from '../SoftFadeBargeinHandler.js';
import type { BargeinContext } from '../types.js';

/** Minimal valid context factory -- fields not under test use sensible stubs. */
function makeContext(speechDurationMs: number): BargeinContext {
  return {
    speechDurationMs,
    interruptedText: 'Sure, let me explain that for you.',
    playedDurationMs: 800,
  };
}

describe('SoftFadeBargeinHandler', () => {
  describe('mode property', () => {
    it('should report mode as "soft-fade"', () => {
      const handler = new SoftFadeBargeinHandler();
      expect(handler.mode).toBe('soft-fade');
    });
  });

  describe('default thresholds (ignoreMs=100, cancelMs=2000, fadeMs=200)', () => {
    const handler = new SoftFadeBargeinHandler();

    // --- Ignore tier (speechDurationMs < 100) ---

    it('should ignore speech of 0 ms (noise floor)', () => {
      expect(handler.handleBargein(makeContext(0)).type).toBe('ignore');
    });

    it('should ignore speech of 99 ms (one below ignoreMs boundary)', () => {
      expect(handler.handleBargein(makeContext(99)).type).toBe('ignore');
    });

    // --- Pause tier (100 <= speechDurationMs < 2000) ---

    /** The exact ignoreMs boundary should transition to the pause tier. */
    it('should pause at exactly 100 ms (ignoreMs boundary)', () => {
      const action = handler.handleBargein(makeContext(100));
      expect(action.type).toBe('pause');
    });

    it('should pause at 101 ms (one above ignoreMs)', () => {
      expect(handler.handleBargein(makeContext(101)).type).toBe('pause');
    });

    it('should pause at 1999 ms (one below cancelMs)', () => {
      expect(handler.handleBargein(makeContext(1999)).type).toBe('pause');
    });

    /** The pause action should carry the configured fadeMs duration. */
    it('should include default fadeMs of 200 in pause action', () => {
      const action = handler.handleBargein(makeContext(500));
      expect(action).toMatchObject({ type: 'pause', fadeMs: 200 });
    });

    // --- Cancel tier (speechDurationMs >= 2000) ---

    /** The exact cancelMs boundary should trigger a cancel, not a pause. */
    it('should cancel at exactly 2000 ms (cancelMs boundary)', () => {
      const action = handler.handleBargein(makeContext(2000));
      expect(action.type).toBe('cancel');
    });

    it('should cancel at 2001 ms (one above cancelMs)', () => {
      expect(handler.handleBargein(makeContext(2001)).type).toBe('cancel');
    });

    it('should cancel at a very large duration (10000 ms)', () => {
      expect(handler.handleBargein(makeContext(10000)).type).toBe('cancel');
    });

    /** The cancel action should inject the '[interrupted]' marker. */
    it('should inject "[interrupted]" marker when cancelling', () => {
      const action = handler.handleBargein(makeContext(2000));
      expect(action).toMatchObject({ type: 'cancel', injectMarker: '[interrupted]' });
    });
  });

  describe('configurable thresholds', () => {
    it('should honour custom ignoreMs -- ignore at (ignoreMs - 1)', () => {
      const handler = new SoftFadeBargeinHandler({ ignoreMs: 50 });
      expect(handler.handleBargein(makeContext(49)).type).toBe('ignore');
    });

    it('should honour custom ignoreMs -- pause at ignoreMs', () => {
      const handler = new SoftFadeBargeinHandler({ ignoreMs: 50 });
      expect(handler.handleBargein(makeContext(50)).type).toBe('pause');
    });

    it('should honour custom cancelMs -- pause at (cancelMs - 1)', () => {
      const handler = new SoftFadeBargeinHandler({ cancelMs: 1000 });
      expect(handler.handleBargein(makeContext(999)).type).toBe('pause');
    });

    it('should honour custom cancelMs -- cancel at cancelMs', () => {
      const handler = new SoftFadeBargeinHandler({ cancelMs: 1000 });
      expect(handler.handleBargein(makeContext(1000)).type).toBe('cancel');
    });

    /** Custom fadeMs should appear in the pause action. */
    it('should propagate custom fadeMs in pause action', () => {
      const handler = new SoftFadeBargeinHandler({ fadeMs: 350 });
      const action = handler.handleBargein(makeContext(500));
      expect(action).toMatchObject({ type: 'pause', fadeMs: 350 });
    });

    it('should use defaults when empty options object is passed', () => {
      const handler = new SoftFadeBargeinHandler({});
      expect(handler.handleBargein(makeContext(99)).type).toBe('ignore');
      expect(handler.handleBargein(makeContext(100)).type).toBe('pause');
      expect(handler.handleBargein(makeContext(2000)).type).toBe('cancel');
    });

    /** Verifies that all three thresholds can be customised independently. */
    it('should allow customising all three tiers simultaneously', () => {
      const handler = new SoftFadeBargeinHandler({ ignoreMs: 200, cancelMs: 800, fadeMs: 100 });
      expect(handler.handleBargein(makeContext(199)).type).toBe('ignore');
      expect(handler.handleBargein(makeContext(200))).toMatchObject({ type: 'pause', fadeMs: 100 });
      expect(handler.handleBargein(makeContext(800))).toMatchObject({ type: 'cancel', injectMarker: '[interrupted]' });
    });
  });

  describe('return value shape', () => {
    /** The ignore result should be a clean object with only the type field. */
    it('should return { type: "ignore" } with no extra properties for ignored barge-in', () => {
      const action = new SoftFadeBargeinHandler().handleBargein(makeContext(0));
      expect(action).toEqual({ type: 'ignore' });
    });

    it('should include fadeMs property in pause result', () => {
      const action = new SoftFadeBargeinHandler().handleBargein(makeContext(500));
      expect(action).toHaveProperty('fadeMs');
    });

    it('should include injectMarker property in cancel result', () => {
      const action = new SoftFadeBargeinHandler().handleBargein(makeContext(5000));
      expect(action).toHaveProperty('injectMarker');
    });
  });
});
