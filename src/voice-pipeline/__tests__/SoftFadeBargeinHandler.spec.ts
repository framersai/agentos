/**
 * @module voice-pipeline/__tests__/SoftFadeBargeinHandler.spec.ts
 *
 * Unit tests for {@link SoftFadeBargeinHandler}.
 *
 * Covers:
 * - mode property
 * - ignore tier (speech < ignoreMs)
 * - pause tier (ignoreMs <= speech < cancelMs)
 * - cancel tier (speech >= cancelMs)
 * - exact boundary values for both thresholds
 * - configurable ignoreMs, cancelMs, fadeMs options
 * - default fadeMs propagated in pause action
 */

import { describe, it, expect } from 'vitest';
import { SoftFadeBargeinHandler } from '../SoftFadeBargeinHandler.js';
import type { BargeinContext } from '../types.js';

/** Minimal valid context factory — fields not under test use sensible stubs. */
function makeContext(speechDurationMs: number): BargeinContext {
  return {
    speechDurationMs,
    interruptedText: 'Sure, let me explain that for you.',
    playedDurationMs: 800,
  };
}

describe('SoftFadeBargeinHandler', () => {
  describe('mode property', () => {
    it('reports mode as "soft-fade"', () => {
      const handler = new SoftFadeBargeinHandler();
      expect(handler.mode).toBe('soft-fade');
    });
  });

  describe('default thresholds (ignoreMs=100, cancelMs=2000, fadeMs=200)', () => {
    const handler = new SoftFadeBargeinHandler();

    // --- ignore tier ---
    it('ignores speech of 0 ms', () => {
      expect(handler.handleBargein(makeContext(0)).type).toBe('ignore');
    });

    it('ignores speech of 99 ms (one below ignoreMs boundary)', () => {
      expect(handler.handleBargein(makeContext(99)).type).toBe('ignore');
    });

    // --- pause tier ---
    it('pauses at exactly 100 ms (ignoreMs boundary)', () => {
      const action = handler.handleBargein(makeContext(100));
      expect(action.type).toBe('pause');
    });

    it('pauses at 101 ms (one above ignoreMs)', () => {
      expect(handler.handleBargein(makeContext(101)).type).toBe('pause');
    });

    it('pauses at 1999 ms (one below cancelMs)', () => {
      expect(handler.handleBargein(makeContext(1999)).type).toBe('pause');
    });

    it('pause action carries the default fadeMs of 200', () => {
      const action = handler.handleBargein(makeContext(500));
      expect(action).toMatchObject({ type: 'pause', fadeMs: 200 });
    });

    // --- cancel tier ---
    it('cancels at exactly 2000 ms (cancelMs boundary)', () => {
      const action = handler.handleBargein(makeContext(2000));
      expect(action.type).toBe('cancel');
    });

    it('cancels at 2001 ms (one above cancelMs)', () => {
      expect(handler.handleBargein(makeContext(2001)).type).toBe('cancel');
    });

    it('cancels at a very large duration (10000 ms)', () => {
      expect(handler.handleBargein(makeContext(10000)).type).toBe('cancel');
    });

    it('cancel action injects "[interrupted]" marker', () => {
      const action = handler.handleBargein(makeContext(2000));
      expect(action).toMatchObject({ type: 'cancel', injectMarker: '[interrupted]' });
    });
  });

  describe('configurable thresholds', () => {
    it('honours custom ignoreMs — ignores at (ignoreMs - 1)', () => {
      const handler = new SoftFadeBargeinHandler({ ignoreMs: 50 });
      expect(handler.handleBargein(makeContext(49)).type).toBe('ignore');
    });

    it('honours custom ignoreMs — pauses at ignoreMs', () => {
      const handler = new SoftFadeBargeinHandler({ ignoreMs: 50 });
      expect(handler.handleBargein(makeContext(50)).type).toBe('pause');
    });

    it('honours custom cancelMs — pauses at (cancelMs - 1)', () => {
      const handler = new SoftFadeBargeinHandler({ cancelMs: 1000 });
      expect(handler.handleBargein(makeContext(999)).type).toBe('pause');
    });

    it('honours custom cancelMs — cancels at cancelMs', () => {
      const handler = new SoftFadeBargeinHandler({ cancelMs: 1000 });
      expect(handler.handleBargein(makeContext(1000)).type).toBe('cancel');
    });

    it('propagates custom fadeMs in pause action', () => {
      const handler = new SoftFadeBargeinHandler({ fadeMs: 350 });
      const action = handler.handleBargein(makeContext(500));
      expect(action).toMatchObject({ type: 'pause', fadeMs: 350 });
    });

    it('uses defaults when empty options object is passed', () => {
      const handler = new SoftFadeBargeinHandler({});
      expect(handler.handleBargein(makeContext(99)).type).toBe('ignore');
      expect(handler.handleBargein(makeContext(100)).type).toBe('pause');
      expect(handler.handleBargein(makeContext(2000)).type).toBe('cancel');
    });

    it('all three tiers can be customised together', () => {
      const handler = new SoftFadeBargeinHandler({ ignoreMs: 200, cancelMs: 800, fadeMs: 100 });
      expect(handler.handleBargein(makeContext(199)).type).toBe('ignore');
      expect(handler.handleBargein(makeContext(200))).toMatchObject({ type: 'pause', fadeMs: 100 });
      expect(handler.handleBargein(makeContext(800))).toMatchObject({ type: 'cancel', injectMarker: '[interrupted]' });
    });
  });

  describe('return value shape', () => {
    it('ignore result has only type field', () => {
      const action = new SoftFadeBargeinHandler().handleBargein(makeContext(0));
      expect(action).toEqual({ type: 'ignore' });
    });

    it('pause result contains fadeMs', () => {
      const action = new SoftFadeBargeinHandler().handleBargein(makeContext(500));
      expect(action).toHaveProperty('fadeMs');
    });

    it('cancel result contains injectMarker', () => {
      const action = new SoftFadeBargeinHandler().handleBargein(makeContext(5000));
      expect(action).toHaveProperty('injectMarker');
    });
  });
});
