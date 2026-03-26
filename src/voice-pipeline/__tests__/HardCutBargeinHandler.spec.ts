/**
 * @module voice-pipeline/__tests__/HardCutBargeinHandler.spec
 *
 * Unit tests for {@link HardCutBargeinHandler}.
 *
 * ## What is tested
 *
 * - mode property returns 'hard-cut'
 * - Speech below the default 300 ms threshold returns { type: 'ignore' }
 * - Speech at or above the threshold returns { type: 'cancel' }
 * - Exact boundary values (299 ms, 300 ms, 301 ms) are tested
 * - Custom minSpeechMs is honoured
 * - The cancel action always includes the '[interrupted]' marker
 * - The ignore action contains only the type field (no extra properties)
 */

import { describe, it, expect } from 'vitest';
import { HardCutBargeinHandler } from '../HardCutBargeinHandler.js';
import type { BargeinContext } from '../types.js';

/** Minimal valid context factory -- fields not under test use sensible stubs. */
function makeContext(speechDurationMs: number): BargeinContext {
  return {
    speechDurationMs,
    interruptedText: 'Hello, how can I help you today?',
    playedDurationMs: 500,
  };
}

describe('HardCutBargeinHandler', () => {
  describe('mode property', () => {
    it('should report mode as "hard-cut"', () => {
      const handler = new HardCutBargeinHandler();
      expect(handler.mode).toBe('hard-cut');
    });
  });

  describe('default minSpeechMs (300 ms)', () => {
    const handler = new HardCutBargeinHandler();

    it('should ignore speech of 0 ms (well below threshold)', () => {
      const action = handler.handleBargein(makeContext(0));
      expect(action.type).toBe('ignore');
    });

    it('should ignore speech of 1 ms', () => {
      expect(handler.handleBargein(makeContext(1)).type).toBe('ignore');
    });

    it('should ignore speech of 299 ms (one below boundary)', () => {
      expect(handler.handleBargein(makeContext(299)).type).toBe('ignore');
    });

    /** The exact boundary value should trigger cancel, not ignore. */
    it('should cancel at exactly 300 ms (boundary value)', () => {
      const action = handler.handleBargein(makeContext(300));
      expect(action.type).toBe('cancel');
    });

    it('should cancel at 301 ms (one above boundary)', () => {
      expect(handler.handleBargein(makeContext(301)).type).toBe('cancel');
    });

    it('should cancel at a large duration (3000 ms)', () => {
      expect(handler.handleBargein(makeContext(3000)).type).toBe('cancel');
    });

    /** The marker allows the agent to know its response was cut short. */
    it('should inject the "[interrupted]" marker when cancelling', () => {
      const action = handler.handleBargein(makeContext(300));
      expect(action).toMatchObject({ type: 'cancel', injectMarker: '[interrupted]' });
    });
  });

  describe('configurable minSpeechMs', () => {
    it('should ignore at 499 ms when minSpeechMs is set to 500', () => {
      const handler = new HardCutBargeinHandler({ minSpeechMs: 500 });
      expect(handler.handleBargein(makeContext(499)).type).toBe('ignore');
    });

    it('should cancel at 500 ms when minSpeechMs is set to 500', () => {
      const handler = new HardCutBargeinHandler({ minSpeechMs: 500 });
      expect(handler.handleBargein(makeContext(500)).type).toBe('cancel');
    });

    /** Setting minSpeechMs to 0 means ANY speech triggers a cancel. */
    it('should cancel at 0 ms when minSpeechMs is set to 0', () => {
      const handler = new HardCutBargeinHandler({ minSpeechMs: 0 });
      expect(handler.handleBargein(makeContext(0)).type).toBe('cancel');
    });

    it('should use default 300 ms when minSpeechMs is omitted from options', () => {
      const handler = new HardCutBargeinHandler({});
      // Default is 300 ms
      expect(handler.handleBargein(makeContext(299)).type).toBe('ignore');
      expect(handler.handleBargein(makeContext(300)).type).toBe('cancel');
    });
  });

  describe('return value shape', () => {
    /** The ignore action should be a plain object with only the type field. */
    it('should return { type: "ignore" } with no extra properties for ignored barge-in', () => {
      const action = new HardCutBargeinHandler().handleBargein(makeContext(0));
      expect(action).toEqual({ type: 'ignore' });
    });

    it('should always include injectMarker property in cancel result', () => {
      const action = new HardCutBargeinHandler().handleBargein(makeContext(1000));
      expect(action).toHaveProperty('injectMarker');
    });
  });
});
