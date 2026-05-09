/**
 * @file ingest-router.test.ts
 * @description Contract tests for the {@link IngestRouter} primitive — the
 * input-stage LLM-as-judge orchestrator that picks an ingest strategy
 * (raw-chunks / summarized / observations / fact-graph / hybrid / skip)
 * for each piece of content entering memory.
 *
 * IngestRouter is the input-stage sibling of MemoryRouter (recall-stage).
 * It decides HOW the content is stored so that downstream retrieval has
 * the right substrate to recall from.
 *
 * Tests cover:
 *   - Strategy selection per content profile (small turn / long article /
 *     code / mixed / structured data).
 *   - Pure {@link selectIngestStrategy}: deterministic routing-table lookup.
 *   - LLMIngestClassifier: provider-agnostic adapter pattern, robust parsing.
 *   - IngestRouter top-level: classify + select + (optional) dispatch.
 *   - Budget-aware dispatch (some strategies are LLM-heavy at ingest time).
 *
 * @module ingest-router/__tests__/ingest-router.test
 */

import { describe, it, expect, vi } from 'vitest';
import {
  selectIngestStrategy,
  IngestRouter,
  LLMIngestClassifier,
  FunctionIngestDispatcher,
  RAW_CHUNKS_TABLE,
  SUMMARIZED_TABLE,
  OBSERVATIONAL_TABLE,
  HYBRID_TABLE,
  PRESET_INGEST_TABLES,
  DEFAULT_INGEST_COSTS,
  INGEST_CONTENT_KINDS,
  IngestRouterUnknownKindError,
  UnsupportedIngestStrategyError,
  type IngestContentKind,
  type IngestStrategyId,
  type IIngestClassifierLLM,
} from '../index.js';

// ============================================================================
// Routing-table contract
// ============================================================================

const ALL_PRESETS = [
  ['raw-chunks', RAW_CHUNKS_TABLE],
  ['summarized', SUMMARIZED_TABLE],
  ['observational', OBSERVATIONAL_TABLE],
  ['hybrid', HYBRID_TABLE],
] as const;

describe('ingest-router: preset routing tables are well-formed', () => {
  it.each(ALL_PRESETS)(
    'preset %s carries its own preset name in the table object',
    (name, table) => {
      expect(table.preset).toBe(name);
    },
  );

  it.each(ALL_PRESETS)(
    'preset %s covers every IngestContentKind in defaultMapping',
    (_name, table) => {
      for (const kind of INGEST_CONTENT_KINDS) {
        expect(table.defaultMapping[kind as IngestContentKind]).toBeDefined();
      }
    },
  );

  it.each(ALL_PRESETS)(
    'preset %s maps every kind to a known IngestStrategyId',
    (_name, table) => {
      const valid: IngestStrategyId[] = [
        'raw-chunks',
        'summarized',
        'observational',
        'fact-graph',
        'hybrid',
        'skip',
      ];
      for (const kind of INGEST_CONTENT_KINDS) {
        const strategy = table.defaultMapping[kind as IngestContentKind];
        expect(valid).toContain(strategy);
      }
    },
  );

  it.each(ALL_PRESETS)('preset %s tables are deeply frozen', (_name, table) => {
    expect(Object.isFrozen(table)).toBe(true);
    expect(Object.isFrozen(table.defaultMapping)).toBe(true);
  });

  it('PRESET_INGEST_TABLES registry exposes every preset', () => {
    expect(PRESET_INGEST_TABLES['raw-chunks']).toBe(RAW_CHUNKS_TABLE);
    expect(PRESET_INGEST_TABLES['summarized']).toBe(SUMMARIZED_TABLE);
    expect(PRESET_INGEST_TABLES['observational']).toBe(OBSERVATIONAL_TABLE);
    expect(PRESET_INGEST_TABLES['hybrid']).toBe(HYBRID_TABLE);
  });
});

// ============================================================================
// selectIngestStrategy: pure function
// ============================================================================

describe('selectIngestStrategy: pure routing-table lookup', () => {
  it('returns the strategy mapped by the table for the predicted kind', () => {
    const decision = selectIngestStrategy({
      predictedKind: 'long-article',
      groundTruthKind: null,
      config: {
        table: SUMMARIZED_TABLE,
        budgetPerIngestUsd: null,
        budgetMode: 'cheapest-fallback',
        strategyCosts: DEFAULT_INGEST_COSTS,
      },
    });
    expect(decision.chosenStrategy).toBe(
      SUMMARIZED_TABLE.defaultMapping['long-article'],
    );
    expect(decision.predictedKind).toBe('long-article');
    expect(decision.budgetExceeded).toBe(false);
  });

  it('records ground-truth when supplied (telemetry only)', () => {
    const decision = selectIngestStrategy({
      predictedKind: 'short-conversation',
      groundTruthKind: 'long-article',
      config: {
        table: RAW_CHUNKS_TABLE,
        budgetPerIngestUsd: null,
        budgetMode: 'cheapest-fallback',
        strategyCosts: DEFAULT_INGEST_COSTS,
      },
    });
    expect(decision.groundTruthKind).toBe('long-article');
  });

  it('throws IngestRouterUnknownKindError on a kind not in the table', () => {
    expect(() =>
      selectIngestStrategy({
        // @ts-expect-error testing runtime guard
        predictedKind: 'made-up-kind',
        groundTruthKind: null,
        config: {
          table: RAW_CHUNKS_TABLE,
          budgetPerIngestUsd: null,
          budgetMode: 'cheapest-fallback',
          strategyCosts: DEFAULT_INGEST_COSTS,
        },
      }),
    ).toThrow(IngestRouterUnknownKindError);
  });

  it('downgrades to the cheapest strategy that fits when over budget (cheapest-fallback mode)', () => {
    // OBSERVATIONAL routes long-article -> 'observational' which is the most
    // expensive ingest strategy. Tight budget should force fallback.
    const decision = selectIngestStrategy({
      predictedKind: 'long-article',
      groundTruthKind: null,
      config: {
        table: OBSERVATIONAL_TABLE,
        budgetPerIngestUsd: 0.0005, // tight
        budgetMode: 'cheapest-fallback',
        strategyCosts: DEFAULT_INGEST_COSTS,
      },
    });
    // Either fits at the cheapest, or globally cheapest if none fit.
    expect(['raw-chunks', 'skip']).toContain(decision.chosenStrategy);
    expect(decision.chosenStrategyReason).toBeTruthy();
  });
});

// ============================================================================
// LLMIngestClassifier: provider-agnostic, robust output parsing
// ============================================================================

function mockLLM(text: string, tokensIn = 30, tokensOut = 4): IIngestClassifierLLM {
  return {
    invoke: vi.fn(async () => ({
      text,
      tokensIn,
      tokensOut,
      model: 'test-mini',
    })),
  };
}

describe('LLMIngestClassifier: parsing + fallback', () => {
  it.each(INGEST_CONTENT_KINDS)('parses %s correctly', async (kind) => {
    const llm = mockLLM(kind);
    const c = new LLMIngestClassifier({ llm });
    const result = await c.classify('any content');
    expect(result.kind).toBe(kind);
  });

  it('strips trailing punctuation', async () => {
    const llm = mockLLM('long-article.');
    const c = new LLMIngestClassifier({ llm });
    const result = await c.classify('content');
    expect(result.kind).toBe('long-article');
  });

  it('strips Category: label prefix', async () => {
    const llm = mockLLM('Kind: code');
    const c = new LLMIngestClassifier({ llm });
    const result = await c.classify('content');
    expect(result.kind).toBe('code');
  });

  it('falls back to short-conversation on unparseable output', async () => {
    const llm = mockLLM('something-random');
    const c = new LLMIngestClassifier({ llm });
    const result = await c.classify('content');
    expect(result.kind).toBe('short-conversation');
  });

  it('propagates token usage', async () => {
    const llm = mockLLM('code', 200, 6);
    const c = new LLMIngestClassifier({ llm });
    const result = await c.classify('content');
    expect(result.tokensIn).toBe(200);
    expect(result.tokensOut).toBe(6);
  });
});

// ============================================================================
// IngestRouter: end-to-end compose
// ============================================================================

function stubClassifier(kind: IngestContentKind) {
  return {
    classify: vi.fn(async () => ({
      kind,
      tokensIn: 20,
      tokensOut: 3,
      model: 'stub',
    })),
  };
}

describe('IngestRouter: end-to-end compose (decide-only)', () => {
  it('classifies + routes in one call', async () => {
    const router = new IngestRouter({
      classifier: stubClassifier('long-article'),
      preset: 'summarized',
    });
    const decision = await router.decide('a long article…');
    expect(decision.classifier.kind).toBe('long-article');
    expect(decision.routing.chosenStrategy).toBe(
      SUMMARIZED_TABLE.defaultMapping['long-article'],
    );
  });

  it('honors per-call manualKind override (skips the classifier)', async () => {
    const classifier = stubClassifier('short-conversation');
    const router = new IngestRouter({
      classifier,
      preset: 'summarized',
    });
    const decision = await router.decide('content', {
      manualKind: 'code',
    });
    expect(classifier.classify).not.toHaveBeenCalled();
    expect(decision.classifier.kind).toBe('code');
    expect(decision.routing.chosenStrategy).toBe(
      SUMMARIZED_TABLE.defaultMapping['code'],
    );
  });

  it('records groundTruthKind when supplied (telemetry)', async () => {
    const router = new IngestRouter({
      classifier: stubClassifier('short-conversation'),
      preset: 'raw-chunks',
    });
    const decision = await router.decide('content', {
      groundTruthKind: 'code',
    });
    expect(decision.routing.groundTruthKind).toBe('code');
  });
});

// ============================================================================
// FunctionIngestDispatcher: routes execution by strategy
// ============================================================================

describe('FunctionIngestDispatcher: routes execution by strategy', () => {
  it('calls the correct executor for the chosen strategy', async () => {
    const rawFn = vi.fn(async () => ({ writtenTraces: 1 }));
    const summarizedFn = vi.fn(async () => ({ writtenTraces: 2 }));
    const dispatcher = new FunctionIngestDispatcher<{ writtenTraces: number }>({
      'raw-chunks': rawFn,
      summarized: summarizedFn,
    });
    const result = await dispatcher.dispatch({
      strategy: 'summarized',
      content: 'any',
    });
    expect(summarizedFn).toHaveBeenCalledTimes(1);
    expect(rawFn).not.toHaveBeenCalled();
    expect(result.outcome.writtenTraces).toBe(2);
    expect(result.strategy).toBe('summarized');
  });

  it('throws UnsupportedIngestStrategyError when no executor is registered', async () => {
    const dispatcher = new FunctionIngestDispatcher<{ writtenTraces: number }>({
      'raw-chunks': vi.fn(async () => ({ writtenTraces: 0 })),
    });
    await expect(
      dispatcher.dispatch({ strategy: 'fact-graph', content: 'x' }),
    ).rejects.toThrow(UnsupportedIngestStrategyError);
  });

  it('forwards optional payload to the executor', async () => {
    const fn = vi.fn(async (_c: string, p: { sessionId: string }) => ({
      writtenTraces: 1,
      sessionId: p.sessionId,
    }));
    const dispatcher = new FunctionIngestDispatcher<
      { writtenTraces: number; sessionId: string },
      { sessionId: string }
    >({ 'raw-chunks': fn });
    const result = await dispatcher.dispatch({
      strategy: 'raw-chunks',
      content: 'x',
      payload: { sessionId: 's-42' },
    });
    expect(fn).toHaveBeenCalledWith('x', { sessionId: 's-42' });
    expect(result.outcome.sessionId).toBe('s-42');
  });
});

describe('IngestRouter.decideAndDispatch: composes decide + dispatch', () => {
  it('classifies + routes + executes', async () => {
    const router = new IngestRouter({
      classifier: stubClassifier('long-article'),
      preset: 'summarized',
      dispatcher: new FunctionIngestDispatcher<{ writtenTraces: number }>({
        summarized: async () => ({ writtenTraces: 7 }),
      }),
    });
    const result = await router.decideAndDispatch('content');
    expect(result.outcome).toEqual({ writtenTraces: 7 });
    expect(result.decision.routing.chosenStrategy).toBe(
      SUMMARIZED_TABLE.defaultMapping['long-article'],
    );
  });
});
