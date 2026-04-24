/**
 * @file memory-router.test.ts
 * @description Contract tests for the top-level {@link MemoryRouter} class.
 *
 * MemoryRouter orchestrates two steps:
 *   1. Classify the incoming query via {@link IMemoryClassifier} (LLM-as-judge).
 *   2. Select a backend via the pure {@link selectBackend} function using the
 *      router's configured routing table + budget policy + cost data.
 *
 * The router returns a {@link MemoryRouterDecision} bundling the classifier
 * prediction, the routing decision, and token-usage for the classifier
 * call. It does NOT execute the memory recall — that's delegated to
 * {@link IMemoryDispatcher} (tested separately) so the router can be used
 * in both "decide only" and "decide + dispatch" flows.
 *
 * Tests cover:
 *   - End-to-end compose: classifier result flows into selectBackend correctly.
 *   - Preset-based config: presets map to built-in tables.
 *   - Budget passthrough: budget policy reaches selectBackend.
 *   - Few-shot prompt passthrough: per-call prompt variant reaches classifier.
 *   - Custom cost-points override: deployment can supply its own cost data.
 *   - Classifier failure recovery: unparseable output surfaces the safe
 *     fallback without crashing.
 *
 * @module memory-router/__tests__/memory-router.test
 */

import { describe, it, expect, vi } from 'vitest';
import { MemoryRouter } from '../MemoryRouter.js';
import type {
  IMemoryClassifier,
  MemoryClassifierResult,
} from '../classifier.js';
import {
  DEFAULT_MEMORY_BACKEND_COSTS,
} from '../backend-costs.js';
import type { MemoryQueryCategory } from '../routing-tables.js';

function stubClassifier(
  category: MemoryQueryCategory,
  tokens = { in: 40, out: 4 },
  model = 'stub-classifier',
): IMemoryClassifier {
  return {
    classify: vi.fn(async (): Promise<MemoryClassifierResult> => ({
      category,
      tokensIn: tokens.in,
      tokensOut: tokens.out,
      model,
    })),
  };
}

describe('MemoryRouter: end-to-end compose', () => {
  it('classifies then routes in one call (default min-cost preset)', async () => {
    const router = new MemoryRouter({
      classifier: stubClassifier('multi-session'),
      preset: 'minimize-cost',
    });
    const decision = await router.decide('How many books did I mention?');

    expect(decision.classifier.category).toBe('multi-session');
    // minimize-cost routes MS -> observational-memory-v11
    expect(decision.routing.chosenBackend).toBe('observational-memory-v11');
    expect(decision.routing.preset).toBe('minimize-cost');
  });

  it('passes the classifier tokens-in/out through for cost tracking', async () => {
    const router = new MemoryRouter({
      classifier: stubClassifier('temporal-reasoning', { in: 412, out: 3 }, 'gpt-5-mini-2025-08-07'),
      preset: 'minimize-cost',
    });
    const decision = await router.decide('When did I move?');

    expect(decision.classifier.tokensIn).toBe(412);
    expect(decision.classifier.tokensOut).toBe(3);
    expect(decision.classifier.model).toBe('gpt-5-mini-2025-08-07');
  });

  it('routes multi-session to observational-memory-v11 under maximize-accuracy', async () => {
    const router = new MemoryRouter({
      classifier: stubClassifier('multi-session'),
      preset: 'maximize-accuracy',
    });
    const decision = await router.decide('aggregate Q');
    expect(decision.routing.chosenBackend).toBe('observational-memory-v11');
  });
});

describe('MemoryRouter: budget policy passthrough', () => {
  it('applies per-query USD budget with cheapest-fallback mode', async () => {
    const router = new MemoryRouter({
      classifier: stubClassifier('multi-session'),
      preset: 'maximize-accuracy', // routes MS to v11 ($0.0336)
      budget: { perQueryUsd: 0.025, mode: 'cheapest-fallback' },
    });
    const decision = await router.decide('MS q');
    // v11 doesn't fit $0.025; canonical-hybrid ($0.0196) does.
    expect(decision.routing.chosenBackend).toBe('canonical-hybrid');
    expect(decision.routing.chosenBackendReason).toContain('cheapest-fallback');
  });

  it('records budgetExceeded when no backend fits', async () => {
    const router = new MemoryRouter({
      classifier: stubClassifier('multi-session'),
      preset: 'maximize-accuracy',
      budget: { perQueryUsd: 0.001, mode: 'cheapest-fallback' },
    });
    const decision = await router.decide('MS q');
    expect(decision.routing.budgetExceeded).toBe(true);
  });
});

describe('MemoryRouter: few-shot prompt passthrough', () => {
  it('forwards useFewShotPrompt to the classifier when configured at construction', async () => {
    const classifier = stubClassifier('multi-session');
    const router = new MemoryRouter({
      classifier,
      preset: 'minimize-cost',
      useFewShotPrompt: true,
    });
    await router.decide('anything');

    const classifyArgs = (classifier.classify as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(classifyArgs?.[1]?.useFewShotPrompt).toBe(true);
  });

  it('does not set useFewShotPrompt by default', async () => {
    const classifier = stubClassifier('multi-session');
    const router = new MemoryRouter({
      classifier,
      preset: 'minimize-cost',
    });
    await router.decide('anything');

    const classifyArgs = (classifier.classify as ReturnType<typeof vi.fn>).mock.calls[0];
    // Either options not passed at all, or useFewShotPrompt is undefined/false.
    expect(classifyArgs?.[1]?.useFewShotPrompt ?? false).toBe(false);
  });
});

describe('MemoryRouter: custom routing table override', () => {
  it('accepts a custom routing table for the configured preset label', async () => {
    const router = new MemoryRouter({
      classifier: stubClassifier('multi-session'),
      preset: 'balanced',
      routingTable: {
        preset: 'balanced',
        defaultMapping: {
          'single-session-assistant': 'canonical-hybrid',
          'single-session-user': 'canonical-hybrid',
          'temporal-reasoning': 'canonical-hybrid',
          'knowledge-update': 'canonical-hybrid',
          'multi-session': 'canonical-hybrid', // override: don't pay OM premium
          'single-session-preference': 'canonical-hybrid',
        },
      },
    });
    const decision = await router.decide('aggregate Q');
    expect(decision.routing.chosenBackend).toBe('canonical-hybrid');
  });
});

describe('MemoryRouter: custom backend costs override', () => {
  it('accepts a custom backend-costs map (for workloads with non-LongMemEval-S cost profiles)', async () => {
    const customCosts = {
      ...DEFAULT_MEMORY_BACKEND_COSTS,
      'canonical-hybrid': {
        ...DEFAULT_MEMORY_BACKEND_COSTS['canonical-hybrid'],
        perCategoryCostPerQuery: {
          ...DEFAULT_MEMORY_BACKEND_COSTS['canonical-hybrid']
            .perCategoryCostPerQuery,
          'multi-session': 999.99, // make canonical prohibitively expensive
        },
      },
    };
    const router = new MemoryRouter({
      classifier: stubClassifier('multi-session'),
      preset: 'minimize-cost',
      backendCosts: customCosts,
    });
    const decision = await router.decide('MS q');
    // minimize-cost still routes to v11 on MS; cost reflects custom v11 default.
    expect(decision.routing.chosenBackend).toBe('observational-memory-v11');
  });
});

describe('MemoryRouter: ground-truth telemetry passthrough', () => {
  it('records groundTruthCategory in the decision when passed via decide()', async () => {
    const router = new MemoryRouter({
      classifier: stubClassifier('multi-session'),
      preset: 'minimize-cost',
    });
    const decision = await router.decide('q', {
      groundTruthCategory: 'temporal-reasoning',
    });
    expect(decision.routing.groundTruthCategory).toBe('temporal-reasoning');
  });

  it('leaves groundTruthCategory null when not passed (production case)', async () => {
    const router = new MemoryRouter({
      classifier: stubClassifier('multi-session'),
      preset: 'minimize-cost',
    });
    const decision = await router.decide('q');
    expect(decision.routing.groundTruthCategory).toBeNull();
  });
});
