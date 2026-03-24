/**
 * @module voice-pipeline/__tests__/HardCutBargeinHandler.spec.ts
 *
 * Unit tests for {@link HardCutBargeinHandler}.
 *
 * Covers:
 * - mode property
 * - ignore threshold (speech too short)
 * - cancel threshold (speech meets or exceeds minSpeechMs)
 * - exact boundary value
 * - configurable minSpeechMs option
 */

import { describe, it, expect } from 'vitest';
import { HardCutBargeinHandler } from '../HardCutBargeinHandler.js';
import type { BargeinContext } from '../types.js';

/** Minimal valid context factory — fields not under test use sensible stubs. */
function makeContext(speechDurationMs: number): BargeinContext {
  return {
    speechDurationMs,
    interruptedText: 'Hello, how can I help you today?',
    playedDurationMs: 500,
  };
}

describe('HardCutBargeinHandler', () => {
  describe('mode property', () => {
    it('reports mode as "hard-cut"', () => {
      const handler = new HardCutBargeinHandler();
      expect(handler.mode).toBe('hard-cut');
    });
  });

  describe('default minSpeechMs (300 ms)', () => {
    const handler = new HardCutBargeinHandler();

    it('ignores speech shorter than 300 ms', () => {
      const action = handler.handleBargein(makeContext(0));
      expect(action.type).toBe('ignore');
    });

    it('ignores speech of 1 ms', () => {
      expect(handler.handleBargein(makeContext(1)).type).toBe('ignore');
    });

    it('ignores speech of 299 ms (one below boundary)', () => {
      expect(handler.handleBargein(makeContext(299)).type).toBe('ignore');
    });

    it('cancels at exactly 300 ms (boundary)', () => {
      const action = handler.handleBargein(makeContext(300));
      expect(action.type).toBe('cancel');
    });

    it('cancels at 301 ms (one above boundary)', () => {
      expect(handler.handleBargein(makeContext(301)).type).toBe('cancel');
    });

    it('cancels at a large duration (3000 ms)', () => {
      expect(handler.handleBargein(makeContext(3000)).type).toBe('cancel');
    });

    it('injects the "[interrupted]" marker on cancel', () => {
      const action = handler.handleBargein(makeContext(300));
      expect(action).toMatchObject({ type: 'cancel', injectMarker: '[interrupted]' });
    });
  });

  describe('configurable minSpeechMs', () => {
    it('honours a custom minSpeechMs of 500 ms — ignores at 499 ms', () => {
      const handler = new HardCutBargeinHandler({ minSpeechMs: 500 });
      expect(handler.handleBargein(makeContext(499)).type).toBe('ignore');
    });

    it('honours a custom minSpeechMs of 500 ms — cancels at 500 ms', () => {
      const handler = new HardCutBargeinHandler({ minSpeechMs: 500 });
      expect(handler.handleBargein(makeContext(500)).type).toBe('cancel');
    });

    it('honours a custom minSpeechMs of 0 — cancels at 0 ms', () => {
      const handler = new HardCutBargeinHandler({ minSpeechMs: 0 });
      expect(handler.handleBargein(makeContext(0)).type).toBe('cancel');
    });

    it('uses default when minSpeechMs is omitted from options object', () => {
      const handler = new HardCutBargeinHandler({});
      // Default is 300 ms
      expect(handler.handleBargein(makeContext(299)).type).toBe('ignore');
      expect(handler.handleBargein(makeContext(300)).type).toBe('cancel');
    });
  });

  describe('return value shape', () => {
    it('ignore result has only type field', () => {
      const action = new HardCutBargeinHandler().handleBargein(makeContext(0));
      expect(action).toEqual({ type: 'ignore' });
    });

    it('cancel result always includes injectMarker', () => {
      const action = new HardCutBargeinHandler().handleBargein(makeContext(1000));
      expect(action).toHaveProperty('injectMarker');
    });
  });
});
