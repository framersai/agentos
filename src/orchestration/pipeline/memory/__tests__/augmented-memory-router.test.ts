/**
 * @file augmented-memory-router.test.ts
 * @description Contract tests for the augmented {@link MemoryRouter}
 * methods added in Phase 2 of the RetrievalConfigRouter
 * productionization plan
 * (`packages/agentos-bench/docs/specs/2026-04-26-retrieval-config-router-productionization-plan.md`).
 *
 * Phase 2 adds two new entry points to the existing {@link MemoryRouter}
 * primitive:
 *
 *   - {@link MemoryRouter.decideAugmented}: classify + resolve a
 *     composite {@link MemoryDispatchKey} (backend × retrieval-config)
 *     from the configured {@link AugmentedRoutingTable}.
 *   - {@link MemoryRouter.decideAndDispatchAugmented}: decide + dispatch
 *     in one call, threading the chosen retrieval config through to the
 *     backend executor's {@link MemoryBackendExecutorContext} arg.
 *
 * Existing legacy entry points (`decide`, `decideAndDispatch`) remain
 * unchanged, and consumers who don't pass an `augmentedTable` see no
 * behavioral diff.
 *
 * Tests cover:
 *   - decideAugmented resolves the calibrated dispatch key for each
 *     classifier category from MINIMIZE_COST_AUGMENTED_TABLE,
 *   - missing augmentedTable raises a typed error,
 *   - few-shot prompt routing passes through to the classifier,
 *   - decideAndDispatchAugmented forwards the retrievalConfig to the
 *     dispatcher via MemoryDispatchArgs.retrievalConfig,
 *   - FunctionMemoryDispatcher exposes retrievalConfig to the executor
 *     as the third-arg context,
 *   - missing dispatcher raises the existing
 *     MemoryRouterDispatcherMissingError on the augmented path,
 *   - existing decide/decideAndDispatch behavior unchanged.
 *
 * @module memory-router/__tests__/augmented-memory-router.test
 */

import { describe, it, expect, vi } from 'vitest';
import {
  MemoryRouter,
  MemoryRouterAugmentedTableMissingError,
  MemoryRouterDispatcherMissingError,
} from '../MemoryRouter.js';
import {
  MINIMIZE_COST_AUGMENTED_TABLE,
  type MemoryQueryCategory,
} from '../routing-tables.js';
import type {
  IMemoryClassifier,
  MemoryClassifierResult,
} from '../classifier.js';
import {
  FunctionMemoryDispatcher,
  type IMemoryDispatcher,
  type MemoryBackendExecutorContext,
  type MemoryDispatchArgs,
  type MemoryDispatchResult,
} from '../dispatcher.js';

function stubClassifier(
  category: MemoryQueryCategory,
  fewShotSentinel?: { onUseFewShot?: () => void },
): IMemoryClassifier {
  return {
    classify: vi.fn(
      async (
        _query: string,
        opts?: { useFewShotPrompt?: boolean },
      ): Promise<MemoryClassifierResult> => {
        if (opts?.useFewShotPrompt) fewShotSentinel?.onUseFewShot?.();
        return {
          category,
          tokensIn: 32,
          tokensOut: 4,
          model: 'stub-classifier',
        };
      },
    ),
  };
}

describe('MemoryRouter.decideAugmented: resolves composite dispatch key', () => {
  it('routes multi-session to (OM-v11, hyde-topk50-mult5) per the calibrated MINIMIZE_COST_AUGMENTED_TABLE', async () => {
    const router = new MemoryRouter({
      classifier: stubClassifier('multi-session'),
      augmentedTable: MINIMIZE_COST_AUGMENTED_TABLE,
    });
    const decision = await router.decideAugmented('How many books did I mention?');

    expect(decision.classifier.category).toBe('multi-session');
    expect(decision.dispatch.backend).toBe('observational-memory-v11');
    expect(decision.dispatch.retrievalConfig).toBe('hyde-topk50-mult5');
  });

  it('routes temporal-reasoning to (canonical-hybrid, hyde) — wider rerank pool actively hurts TR on M', async () => {
    const router = new MemoryRouter({
      classifier: stubClassifier('temporal-reasoning'),
      augmentedTable: MINIMIZE_COST_AUGMENTED_TABLE,
    });
    const decision = await router.decideAugmented('In what order did I visit the cities?');

    expect(decision.dispatch.backend).toBe('canonical-hybrid');
    expect(decision.dispatch.retrievalConfig).toBe('hyde');
  });

  it('routes knowledge-update to (canonical-hybrid, topk50) — top-K alone is sufficient and cheaper than full combined', async () => {
    const router = new MemoryRouter({
      classifier: stubClassifier('knowledge-update'),
      augmentedTable: MINIMIZE_COST_AUGMENTED_TABLE,
    });
    const decision = await router.decideAugmented("What's my current job title?");

    expect(decision.dispatch.backend).toBe('canonical-hybrid');
    expect(decision.dispatch.retrievalConfig).toBe('topk50');
  });

  it('routes single-session-preference to (OM-v11, hyde) — backend axis from S, retrieval axis from M', async () => {
    const router = new MemoryRouter({
      classifier: stubClassifier('single-session-preference'),
      augmentedTable: MINIMIZE_COST_AUGMENTED_TABLE,
    });
    const decision = await router.decideAugmented('Do I prefer tea or coffee?');

    expect(decision.dispatch.backend).toBe('observational-memory-v11');
    expect(decision.dispatch.retrievalConfig).toBe('hyde');
  });

  it('throws MemoryRouterAugmentedTableMissingError when no augmented table was configured', async () => {
    const router = new MemoryRouter({
      classifier: stubClassifier('multi-session'),
      preset: 'minimize-cost',
      // augmentedTable intentionally omitted
    });

    await expect(router.decideAugmented('hello')).rejects.toThrow(
      MemoryRouterAugmentedTableMissingError,
    );
  });

  it('passes the few-shot prompt option through to the classifier on the augmented path', async () => {
    const sentinel = { onUseFewShot: vi.fn() };
    const router = new MemoryRouter({
      classifier: stubClassifier('multi-session', sentinel),
      augmentedTable: MINIMIZE_COST_AUGMENTED_TABLE,
      useFewShotPrompt: true,
    });
    await router.decideAugmented('Pick a card');

    expect(sentinel.onUseFewShot).toHaveBeenCalledTimes(1);
  });
});

describe('MemoryRouter.decideAndDispatchAugmented: end-to-end', () => {
  it('forwards the chosen retrievalConfig to the dispatcher as MemoryDispatchArgs.retrievalConfig', async () => {
    const dispatchSpy = vi.fn(
      async (
        args: MemoryDispatchArgs<unknown>,
      ): Promise<MemoryDispatchResult<unknown>> => ({
        traces: [{ id: 'mock-trace', backend: args.backend, rc: args.retrievalConfig }],
        backend: args.backend,
      }),
    );
    const dispatcher: IMemoryDispatcher<unknown, unknown> = { dispatch: dispatchSpy };

    const router = new MemoryRouter({
      classifier: stubClassifier('multi-session'),
      augmentedTable: MINIMIZE_COST_AUGMENTED_TABLE,
      dispatcher,
    });

    const result = await router.decideAndDispatchAugmented('cross-session question');

    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    expect(dispatchSpy.mock.calls[0]?.[0].backend).toBe('observational-memory-v11');
    expect(dispatchSpy.mock.calls[0]?.[0].retrievalConfig).toBe('hyde-topk50-mult5');
    expect(result.dispatch.backend).toBe('observational-memory-v11');
    expect(result.dispatch.retrievalConfig).toBe('hyde-topk50-mult5');
  });

  it('throws MemoryRouterDispatcherMissingError when no dispatcher was configured', async () => {
    const router = new MemoryRouter({
      classifier: stubClassifier('multi-session'),
      augmentedTable: MINIMIZE_COST_AUGMENTED_TABLE,
      // dispatcher intentionally omitted
    });

    await expect(router.decideAndDispatchAugmented('hello')).rejects.toThrow(
      MemoryRouterDispatcherMissingError,
    );
  });

  it('throws MemoryRouterAugmentedTableMissingError before reaching the dispatcher when no augmented table was configured', async () => {
    const dispatcher: IMemoryDispatcher<unknown, unknown> = {
      dispatch: vi.fn(
        async (): Promise<MemoryDispatchResult<unknown>> => ({
          traces: [],
          backend: 'canonical-hybrid',
        }),
      ),
    };
    const router = new MemoryRouter({
      classifier: stubClassifier('multi-session'),
      dispatcher,
      // augmentedTable intentionally omitted
    });

    await expect(router.decideAndDispatchAugmented('hello')).rejects.toThrow(
      MemoryRouterAugmentedTableMissingError,
    );
    expect(dispatcher.dispatch).not.toHaveBeenCalled();
  });
});

describe('FunctionMemoryDispatcher: forwards retrievalConfig to executor as MemoryBackendExecutorContext', () => {
  it('passes retrievalConfig as the third executor arg when supplied', async () => {
    const captured: Array<{
      query: string;
      payload: { topK: number };
      ctx: MemoryBackendExecutorContext | undefined;
    }> = [];
    const dispatcher = new FunctionMemoryDispatcher<string, { topK: number }>({
      'canonical-hybrid': async (query, payload, context) => {
        captured.push({ query, payload, ctx: context });
        return ['trace-a', 'trace-b'];
      },
    });

    await dispatcher.dispatch({
      backend: 'canonical-hybrid',
      query: 'hello',
      payload: { topK: 20 },
      retrievalConfig: 'hyde-topk50-mult5',
    });

    expect(captured).toHaveLength(1);
    expect(captured[0]?.ctx?.retrievalConfig).toBe('hyde-topk50-mult5');
  });

  it('omits the context arg entirely on legacy dispatch calls (no retrievalConfig field)', async () => {
    let observedCtx: MemoryBackendExecutorContext | undefined = { retrievalConfig: 'canonical' };
    const dispatcher = new FunctionMemoryDispatcher<string, undefined>({
      'canonical-hybrid': async (_q, _p, context) => {
        observedCtx = context;
        return ['ok'];
      },
    });

    await dispatcher.dispatch({ backend: 'canonical-hybrid', query: 'q' });

    expect(observedCtx).toBeUndefined();
  });

  it('preserves backwards compat: an executor that ignores the context arg still works', async () => {
    const dispatcher = new FunctionMemoryDispatcher<string, { topK: number }>({
      // Two-argument legacy executor — assignable because the third arg is optional.
      'canonical-hybrid': async (query, payload) => [`${query}:${payload.topK}`],
    });

    const result = await dispatcher.dispatch({
      backend: 'canonical-hybrid',
      query: 'hello',
      payload: { topK: 7 },
      retrievalConfig: 'topk50',
    });

    expect(result.traces).toEqual(['hello:7']);
    expect(result.backend).toBe('canonical-hybrid');
  });
});

describe('legacy MemoryRouter methods: unchanged when augmented table is absent', () => {
  it('decide() still routes via the legacy single-axis path with no augmentedTable', async () => {
    const router = new MemoryRouter({
      classifier: stubClassifier('multi-session'),
      preset: 'minimize-cost',
    });
    const decision = await router.decide('cross-session question');
    expect(decision.routing.chosenBackend).toBe('observational-memory-v11');
    expect(decision.routing.preset).toBe('minimize-cost');
  });

  it('decideAndDispatch() still passes a legacy MemoryDispatchArgs (no retrievalConfig field)', async () => {
    const dispatchSpy = vi.fn(
      async (
        args: MemoryDispatchArgs<unknown>,
      ): Promise<MemoryDispatchResult<unknown>> => ({
        traces: [],
        backend: args.backend,
      }),
    );
    const router = new MemoryRouter({
      classifier: stubClassifier('multi-session'),
      preset: 'minimize-cost',
      dispatcher: { dispatch: dispatchSpy },
    });
    await router.decideAndDispatch('hello');

    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    expect(dispatchSpy.mock.calls[0]?.[0].backend).toBe('observational-memory-v11');
    expect(dispatchSpy.mock.calls[0]?.[0].retrievalConfig).toBeUndefined();
  });
});
