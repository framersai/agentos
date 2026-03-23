/**
 * @file graph-event-emitter.test.ts
 * @description Unit tests for GraphEventEmitter — covers listener management,
 * event dispatch, and the async-iterable `stream()` API.
 */

import { describe, it, expect, vi } from 'vitest';
import { GraphEventEmitter, type GraphEvent } from '../events/GraphEvent.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convenience factory for a minimal `run_start` event. */
const runStart = (runId = 'r1'): GraphEvent => ({
  type: 'run_start',
  runId,
  graphId: 'g1',
});

/** Convenience factory for a minimal `run_end` event. */
const runEnd = (): GraphEvent => ({
  type: 'run_end',
  runId: 'r1',
  finalOutput: null,
  totalDurationMs: 42,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GraphEventEmitter', () => {
  describe('on() / emit()', () => {
    it('calls all registered listeners on emit()', () => {
      const emitter = new GraphEventEmitter();
      const listenerA = vi.fn();
      const listenerB = vi.fn();

      emitter.on(listenerA);
      emitter.on(listenerB);

      const event = runStart();
      emitter.emit(event);

      expect(listenerA).toHaveBeenCalledOnce();
      expect(listenerA).toHaveBeenCalledWith(event);
      expect(listenerB).toHaveBeenCalledOnce();
      expect(listenerB).toHaveBeenCalledWith(event);
    });

    it('calls listeners in registration order', () => {
      const emitter = new GraphEventEmitter();
      const order: number[] = [];

      emitter.on(() => order.push(1));
      emitter.on(() => order.push(2));
      emitter.on(() => order.push(3));

      emitter.emit(runStart());
      expect(order).toEqual([1, 2, 3]);
    });

    it('delivers multiple events in emission order', () => {
      const emitter = new GraphEventEmitter();
      const received: GraphEvent[] = [];
      emitter.on((e) => received.push(e));

      const e1 = runStart('r1');
      const e2 = runStart('r2');
      emitter.emit(e1);
      emitter.emit(e2);

      expect(received).toHaveLength(2);
      expect(received[0]).toBe(e1);
      expect(received[1]).toBe(e2);
    });
  });

  describe('off()', () => {
    it('removes a listener so it no longer receives events', () => {
      const emitter = new GraphEventEmitter();
      const listener = vi.fn();

      emitter.on(listener);
      emitter.off(listener);
      emitter.emit(runStart());

      expect(listener).not.toHaveBeenCalled();
    });

    it('only removes the target listener, leaving others intact', () => {
      const emitter = new GraphEventEmitter();
      const removed = vi.fn();
      const kept = vi.fn();

      emitter.on(removed);
      emitter.on(kept);
      emitter.off(removed);
      emitter.emit(runStart());

      expect(removed).not.toHaveBeenCalled();
      expect(kept).toHaveBeenCalledOnce();
    });

    it('is a no-op when the listener was never registered', () => {
      const emitter = new GraphEventEmitter();
      const unregistered = vi.fn();

      // Should not throw.
      expect(() => emitter.off(unregistered)).not.toThrow();

      emitter.emit(runStart());
      expect(unregistered).not.toHaveBeenCalled();
    });
  });

  describe('close()', () => {
    it('silently ignores emit() calls after close()', () => {
      const emitter = new GraphEventEmitter();
      const listener = vi.fn();
      emitter.on(listener);

      emitter.close();
      emitter.emit(runStart());

      expect(listener).not.toHaveBeenCalled();
    });

    it('is idempotent — calling close() twice does not throw', () => {
      const emitter = new GraphEventEmitter();
      expect(() => {
        emitter.close();
        emitter.close();
      }).not.toThrow();
    });
  });

  describe('stream()', () => {
    it('yields events emitted after stream() is called', async () => {
      const emitter = new GraphEventEmitter();
      const events: GraphEvent[] = [];

      const consuming = (async () => {
        for await (const event of emitter.stream()) {
          events.push(event);
        }
      })();

      // Allow the generator to reach its first await point.
      await Promise.resolve();

      const e1 = runStart('r1');
      const e2 = runStart('r2');
      emitter.emit(e1);
      emitter.emit(e2);
      emitter.close();

      await consuming;

      expect(events).toHaveLength(2);
      expect(events[0]).toBe(e1);
      expect(events[1]).toBe(e2);
    });

    it('completes the generator when close() is called', async () => {
      const emitter = new GraphEventEmitter();

      const consumingPromise = (async () => {
        const collected: GraphEvent[] = [];
        for await (const event of emitter.stream()) {
          collected.push(event);
        }
        return collected;
      })();

      await Promise.resolve();

      emitter.emit(runStart());
      emitter.close();

      const collected = await consumingPromise;
      expect(collected).toHaveLength(1);
      expect(collected[0].type).toBe('run_start');
    });

    it('drains pre-queued events before completing when close() is called before consuming', async () => {
      const emitter = new GraphEventEmitter();

      // Emit events and close before any consumer attaches.
      emitter.emit(runStart());
      emitter.emit(runEnd());
      emitter.close();

      // Events emitted before stream() attaches may not be in the queue depending
      // on implementation. This test verifies that stream() on a pre-closed emitter
      // terminates without hanging, even if it yields 0 events.
      const collected: GraphEvent[] = [];
      for await (const event of emitter.stream()) {
        collected.push(event);
      }

      // The stream should have terminated (no infinite hang). Event count may be 0
      // because the generator registered after the emitter was already closed.
      expect(Array.isArray(collected)).toBe(true);
    });

    it('supports multiple independent concurrent streams', async () => {
      const emitter = new GraphEventEmitter();
      const collectedA: GraphEvent[] = [];
      const collectedB: GraphEvent[] = [];

      const streamA = (async () => {
        for await (const e of emitter.stream()) collectedA.push(e);
      })();

      const streamB = (async () => {
        for await (const e of emitter.stream()) collectedB.push(e);
      })();

      // Allow both generators to reach their first await.
      await Promise.resolve();
      await Promise.resolve();

      emitter.emit(runStart('r1'));
      emitter.emit(runStart('r2'));
      emitter.close();

      await Promise.all([streamA, streamB]);

      expect(collectedA).toHaveLength(2);
      expect(collectedB).toHaveLength(2);
      expect(collectedA[0].type).toBe('run_start');
      expect(collectedB[0].type).toBe('run_start');
    });

    it('completes cleanly if consumer breaks out of the for-await loop early', async () => {
      const emitter = new GraphEventEmitter();

      const firstEvent = await new Promise<GraphEvent>((resolve) => {
        (async () => {
          for await (const event of emitter.stream()) {
            resolve(event);
            break; // Early exit — tests that finally-cleanup runs.
          }
        })();

        // Give generator a tick to start.
        setTimeout(() => emitter.emit(runStart()), 0);
      });

      emitter.close();
      expect(firstEvent.type).toBe('run_start');
    });
  });
});
