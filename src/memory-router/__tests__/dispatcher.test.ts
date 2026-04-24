/**
 * @file dispatcher.test.ts
 * @description Contract tests for {@link IMemoryDispatcher} and the
 * built-in {@link FunctionMemoryDispatcher} reference implementation.
 *
 * The dispatcher is the second half of the router pipeline: given a
 * backend identifier + a query, it returns recall results. Splitting
 * dispatch from decision keeps the router decision-only usable in
 * dry-runs and benchmarks, while letting production callers compose
 * decide + dispatch via {@link MemoryRouter.decideAndDispatch}.
 *
 * Because backend execution depends on how the caller's memory state is
 * wired (canonical-hybrid just needs a query; OM backends need ingest-
 * time setup), the shipping dispatcher is a routing-table-of-functions
 * pattern: caller provides `{ [backend]: (query) => Promise<result> }`
 * at construction, and the dispatcher picks the right function per call.
 *
 * Tests cover:
 *   - Routes the query to the correct per-backend function.
 *   - Throws a typed error for unsupported backends.
 *   - Propagates errors from the underlying function.
 *   - Accepts extra-arguments passed through to the function (via the
 *     generic payload field).
 *
 * @module memory-router/__tests__/dispatcher.test
 */

import { describe, it, expect, vi } from 'vitest';
import {
  FunctionMemoryDispatcher,
  UnsupportedMemoryBackendError,
} from '../dispatcher.js';
import type { MemoryBackendId } from '../routing-tables.js';

interface StubTrace {
  id: string;
  score: number;
}

describe('FunctionMemoryDispatcher: routes to the correct per-backend function', () => {
  it('calls the canonical-hybrid function for canonical-hybrid dispatch', async () => {
    const canonicalFn = vi.fn(async () => [{ id: 'c1', score: 0.9 }]);
    const dispatcher = new FunctionMemoryDispatcher<StubTrace>({
      'canonical-hybrid': canonicalFn,
    });
    const result = await dispatcher.dispatch({
      backend: 'canonical-hybrid',
      query: 'test',
    });
    expect(canonicalFn).toHaveBeenCalledTimes(1);
    expect(result.traces).toEqual([{ id: 'c1', score: 0.9 }]);
    expect(result.backend).toBe('canonical-hybrid');
  });

  it('calls the OM-v11 function for observational-memory-v11 dispatch', async () => {
    const v11Fn = vi.fn(async () => [{ id: 'v11', score: 0.95 }]);
    const dispatcher = new FunctionMemoryDispatcher<StubTrace>({
      'canonical-hybrid': vi.fn(async () => []),
      'observational-memory-v11': v11Fn,
    });
    const result = await dispatcher.dispatch({
      backend: 'observational-memory-v11',
      query: 'q',
    });
    expect(v11Fn).toHaveBeenCalledTimes(1);
    expect(result.traces).toEqual([{ id: 'v11', score: 0.95 }]);
  });
});

describe('FunctionMemoryDispatcher: error handling', () => {
  it('throws UnsupportedMemoryBackendError when no function is registered for the backend', async () => {
    const dispatcher = new FunctionMemoryDispatcher<StubTrace>({
      'canonical-hybrid': vi.fn(async () => []),
      // no observational-memory-v10 / v11 registered
    });
    await expect(
      dispatcher.dispatch({
        backend: 'observational-memory-v11',
        query: 'q',
      }),
    ).rejects.toThrow(UnsupportedMemoryBackendError);
  });

  it('propagates underlying function errors', async () => {
    const failingFn = vi.fn(async () => {
      throw new Error('upstream-retrieval-failed');
    });
    const dispatcher = new FunctionMemoryDispatcher<StubTrace>({
      'canonical-hybrid': failingFn,
    });
    await expect(
      dispatcher.dispatch({ backend: 'canonical-hybrid', query: 'q' }),
    ).rejects.toThrow('upstream-retrieval-failed');
  });
});

describe('FunctionMemoryDispatcher: payload passthrough', () => {
  it('forwards the optional payload to the per-backend function', async () => {
    const fn = vi.fn(async (_q: string, payload: { topK: number }) => [
      { id: 'p', score: payload.topK },
    ]);
    const dispatcher = new FunctionMemoryDispatcher<StubTrace, { topK: number }>({
      'canonical-hybrid': fn,
    });
    const result = await dispatcher.dispatch({
      backend: 'canonical-hybrid',
      query: 'q',
      payload: { topK: 42 },
    });
    expect(fn).toHaveBeenCalledWith('q', { topK: 42 });
    expect(result.traces).toEqual([{ id: 'p', score: 42 }]);
  });
});

describe('MemoryRouter.decideAndDispatch: composes decide + dispatch', () => {
  it('classifies, routes, and dispatches in one call', async () => {
    const { MemoryRouter } = await import('../MemoryRouter.js');
    const stubClassifier = {
      classify: vi.fn(async () => ({
        category: 'multi-session' as const,
        tokensIn: 40,
        tokensOut: 4,
        model: 'stub',
      })),
    };
    const v11Fn = vi.fn(async () => [{ id: 'om', score: 0.9 }]);
    const dispatcher = new FunctionMemoryDispatcher<StubTrace>({
      'canonical-hybrid': vi.fn(async () => []),
      'observational-memory-v11': v11Fn,
    });

    const router = new MemoryRouter({
      classifier: stubClassifier,
      preset: 'minimize-cost', // routes MS -> v11
      dispatcher,
    });

    const result = await router.decideAndDispatch('How many books did I buy?');

    expect(v11Fn).toHaveBeenCalledTimes(1);
    expect(result.decision.routing.chosenBackend).toBe('observational-memory-v11');
    expect(result.traces).toEqual([{ id: 'om', score: 0.9 }]);
    expect(result.backend).toBe('observational-memory-v11');
  });

  it('throws when a dispatcher is required but not supplied', async () => {
    const { MemoryRouter } = await import('../MemoryRouter.js');
    const stubClassifier = {
      classify: vi.fn(async () => ({
        category: 'multi-session' as const,
        tokensIn: 40,
        tokensOut: 4,
        model: 'stub',
      })),
    };
    const router = new MemoryRouter({
      classifier: stubClassifier,
      preset: 'minimize-cost',
      // no dispatcher
    });
    await expect(router.decideAndDispatch('q')).rejects.toThrow();
  });
});
