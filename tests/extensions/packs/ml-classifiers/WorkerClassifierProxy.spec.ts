/**
 * @fileoverview Unit tests for {@link WorkerClassifierProxy}.
 *
 * These tests verify the proxy's routing logic and IContentClassifier
 * contract without relying on real Web Workers or model weights.
 *
 * Test coverage:
 *  1. Falls back to main-thread when `typeof Worker === 'undefined'`
 *  2. Delegates `classify()` to the wrapped classifier in fallback mode
 *  3. Exposes the same identity properties (`id`, `displayName`, `description`, `modelId`)
 *     as the wrapped classifier
 *  4. `isLoaded` reflects the wrapped classifier's state
 *  5. `useWebWorker: false` forces main-thread execution
 *  6. Worker creation failure sets `workerFailed` and falls back gracefully
 *  7. `dispose()` is forwarded to the wrapped classifier
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ClassificationResult } from '../../../../src/core/ai_utilities/IUtilityAI';
import type { IContentClassifier } from '../../../../src/extensions/packs/ml-classifiers/IContentClassifier';
import { WorkerClassifierProxy } from '../../../../src/extensions/packs/ml-classifiers/classifiers/WorkerClassifierProxy';
import type { BrowserConfig } from '../../../../src/extensions/packs/ml-classifiers/types';

// ---------------------------------------------------------------------------
// Test fixtures & helpers
// ---------------------------------------------------------------------------

/**
 * A well-defined classification result used throughout the suite so tests
 * are not coupled to magic literal values.
 */
const MOCK_RESULT: ClassificationResult = {
  bestClass: 'toxic',
  confidence: 0.92,
  allScores: [
    { classLabel: 'toxic', score: 0.92 },
    { classLabel: 'benign', score: 0.08 },
  ],
};

/**
 * Build a minimal mock IContentClassifier with all required fields.
 *
 * @param overrides - Optional partial overrides for specific fields.
 * @returns A mock classifier with controllable `classify()` and `dispose()`.
 */
function makeWrapped(
  overrides: Partial<IContentClassifier> = {},
): IContentClassifier & { classify: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> } {
  return {
    id: 'agentos:ml-classifiers:toxicity-pipeline',
    displayName: 'Toxicity Pipeline',
    description: 'Detects toxic content.',
    modelId: 'unitary/toxic-bert',
    isLoaded: false,
    classify: vi.fn(async (_text: string): Promise<ClassificationResult> => MOCK_RESULT),
    dispose: vi.fn(async (): Promise<void> => {}),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WorkerClassifierProxy', () => {
  // -------------------------------------------------------------------------
  // 1. Identity properties delegated from wrapped classifier
  // -------------------------------------------------------------------------

  describe('IContentClassifier identity properties', () => {
    it('exposes the same id as the wrapped classifier', () => {
      const wrapped = makeWrapped();
      const proxy = new WorkerClassifierProxy(wrapped);

      expect(proxy.id).toBe(wrapped.id);
    });

    it('exposes the same displayName as the wrapped classifier', () => {
      const wrapped = makeWrapped({ displayName: 'My Custom Classifier' });
      const proxy = new WorkerClassifierProxy(wrapped);

      expect(proxy.displayName).toBe('My Custom Classifier');
    });

    it('exposes the same description as the wrapped classifier', () => {
      const wrapped = makeWrapped({ description: 'Detects bad stuff.' });
      const proxy = new WorkerClassifierProxy(wrapped);

      expect(proxy.description).toBe('Detects bad stuff.');
    });

    it('exposes the same modelId as the wrapped classifier', () => {
      const wrapped = makeWrapped({ modelId: 'Xenova/custom-model' });
      const proxy = new WorkerClassifierProxy(wrapped);

      expect(proxy.modelId).toBe('Xenova/custom-model');
    });
  });

  // -------------------------------------------------------------------------
  // 2. isLoaded reflects wrapped classifier state
  // -------------------------------------------------------------------------

  describe('isLoaded', () => {
    it('returns false when wrapped classifier isLoaded is false', () => {
      const wrapped = makeWrapped({ isLoaded: false });
      const proxy = new WorkerClassifierProxy(wrapped);

      expect(proxy.isLoaded).toBe(false);
    });

    it('returns true when wrapped classifier isLoaded is true', () => {
      const wrapped = makeWrapped({ isLoaded: true });
      const proxy = new WorkerClassifierProxy(wrapped);

      expect(proxy.isLoaded).toBe(true);
    });

    it('tracks changes to wrapped classifier isLoaded dynamically', () => {
      const wrapped = makeWrapped({ isLoaded: false });
      const proxy = new WorkerClassifierProxy(wrapped);

      expect(proxy.isLoaded).toBe(false);

      // Simulate the model loading.
      wrapped.isLoaded = true;

      expect(proxy.isLoaded).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // 3. Fallback when Worker is undefined (Node.js / server environment)
  // -------------------------------------------------------------------------

  describe('fallback when Worker is undefined', () => {
    let originalWorker: unknown;

    beforeEach(() => {
      // Save and remove the global Worker constructor to simulate Node.js.
      originalWorker = (globalThis as Record<string, unknown>)['Worker'];
      delete (globalThis as Record<string, unknown>)['Worker'];
    });

    afterEach(() => {
      // Restore the Worker constructor after each test.
      if (originalWorker !== undefined) {
        (globalThis as Record<string, unknown>)['Worker'] = originalWorker;
      }
    });

    it('calls wrapped.classify() directly when Worker is undefined', async () => {
      const wrapped = makeWrapped();
      const proxy = new WorkerClassifierProxy(wrapped);

      await proxy.classify('some text');

      // The wrapped classifier must have been called on the main thread.
      expect(wrapped.classify).toHaveBeenCalledOnce();
      expect(wrapped.classify).toHaveBeenCalledWith('some text');
    });

    it('returns the wrapped classifier result when Worker is undefined', async () => {
      const wrapped = makeWrapped();
      const proxy = new WorkerClassifierProxy(wrapped);

      const result = await proxy.classify('test input');

      expect(result).toEqual(MOCK_RESULT);
    });
  });

  // -------------------------------------------------------------------------
  // 4. useWebWorker: false forces main-thread delegation
  // -------------------------------------------------------------------------

  describe('useWebWorker: false option', () => {
    it('delegates directly to wrapped.classify() when useWebWorker is false', async () => {
      const wrapped = makeWrapped();
      const config: BrowserConfig = { useWebWorker: false };
      const proxy = new WorkerClassifierProxy(wrapped, config);

      await proxy.classify('hello world');

      expect(wrapped.classify).toHaveBeenCalledOnce();
      expect(wrapped.classify).toHaveBeenCalledWith('hello world');
    });

    it('returns the wrapped result when useWebWorker is false', async () => {
      const wrapped = makeWrapped();
      const proxy = new WorkerClassifierProxy(wrapped, { useWebWorker: false });

      const result = await proxy.classify('hello world');

      expect(result).toEqual(MOCK_RESULT);
    });

    it('does NOT use the Worker even when Worker is globally available', async () => {
      // Stub a Worker constructor to detect attempted usage.
      const workerSpy = vi.fn(() => {
        throw new Error('Worker should not have been created');
      });
      (globalThis as Record<string, unknown>)['Worker'] = workerSpy;

      const wrapped = makeWrapped();
      const proxy = new WorkerClassifierProxy(wrapped, { useWebWorker: false });

      // Should not throw — Worker constructor must not be called.
      await expect(proxy.classify('text')).resolves.toEqual(MOCK_RESULT);
      expect(workerSpy).not.toHaveBeenCalled();

      // Clean up the stub.
      delete (globalThis as Record<string, unknown>)['Worker'];
    });
  });

  // -------------------------------------------------------------------------
  // 5. Worker creation failure — sets workerFailed and falls back
  // -------------------------------------------------------------------------

  describe('Worker creation failure fallback', () => {
    let originalWorker: unknown;

    beforeEach(() => {
      originalWorker = (globalThis as Record<string, unknown>)['Worker'];
    });

    afterEach(() => {
      if (originalWorker !== undefined) {
        (globalThis as Record<string, unknown>)['Worker'] = originalWorker;
      } else {
        delete (globalThis as Record<string, unknown>)['Worker'];
      }
    });

    it('falls back to main-thread when Worker constructor throws', async () => {
      // Stub a Worker that always throws on construction (CSP violation, etc.).
      (globalThis as Record<string, unknown>)['Worker'] = vi.fn(() => {
        throw new Error('Blocked by CSP');
      });

      const wrapped = makeWrapped();
      const proxy = new WorkerClassifierProxy(wrapped);

      // The proxy should catch the Worker error and fall back gracefully.
      const result = await proxy.classify('text that hits CSP');

      expect(result).toEqual(MOCK_RESULT);
      expect(wrapped.classify).toHaveBeenCalledOnce();
    });

    it('uses main-thread for all subsequent calls after Worker creation failure', async () => {
      // First Worker call throws; subsequent calls should not attempt Worker creation.
      const workerCallCount = { value: 0 };
      (globalThis as Record<string, unknown>)['Worker'] = vi.fn(() => {
        workerCallCount.value++;
        throw new Error('Worker unavailable');
      });

      const wrapped = makeWrapped();
      const proxy = new WorkerClassifierProxy(wrapped);

      // First call — Worker creation fails, falls back.
      await proxy.classify('call 1');
      // Second call — should not attempt to create another Worker.
      await proxy.classify('call 2');
      // Third call — same expectation.
      await proxy.classify('call 3');

      // Worker constructor should only have been called once (on the first classify).
      expect(workerCallCount.value).toBe(1);

      // The wrapped classifier should have been called for all three.
      expect(wrapped.classify).toHaveBeenCalledTimes(3);
    });
  });

  // -------------------------------------------------------------------------
  // 6. dispose() delegation
  // -------------------------------------------------------------------------

  describe('dispose()', () => {
    it('calls wrapped.dispose() when dispose is available', async () => {
      const wrapped = makeWrapped();
      const proxy = new WorkerClassifierProxy(wrapped, { useWebWorker: false });

      await proxy.dispose();

      expect(wrapped.dispose).toHaveBeenCalledOnce();
    });

    it('does not throw when wrapped classifier has no dispose()', async () => {
      // Remove dispose from the wrapped classifier to test optional handling.
      const wrapped = makeWrapped();
      delete (wrapped as Partial<IContentClassifier>).dispose;

      const proxy = new WorkerClassifierProxy(wrapped, { useWebWorker: false });

      await expect(proxy.dispose()).resolves.toBeUndefined();
    });
  });
});
