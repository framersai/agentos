/**
 * @file read-router.test.ts
 * @description Contract tests for ReadRouter — the read-stage LLM-as-judge
 * orchestrator that picks a reader strategy per query+evidence pair.
 *
 * @module read-router/__tests__/read-router.test
 */

import { describe, it, expect, vi } from 'vitest';
import {
  selectReadStrategy,
  ReadRouter,
  LLMReadIntentClassifier,
  FunctionReadDispatcher,
  PRECISE_FACT_TABLE,
  SYNTHESIS_TABLE,
  TEMPORAL_TABLE,
  PRESET_READ_TABLES,
  DEFAULT_READ_COSTS,
  READ_INTENTS,
  ReadRouterUnknownIntentError,
  UnsupportedReadStrategyError,
  type ReadIntent,
  type ReadStrategyId,
  type IReadIntentClassifierLLM,
} from '../index.js';

const ALL_PRESETS = [
  ['precise-fact', PRECISE_FACT_TABLE],
  ['synthesis', SYNTHESIS_TABLE],
  ['temporal', TEMPORAL_TABLE],
] as const;

describe('read-router preset routing tables', () => {
  it.each(ALL_PRESETS)('preset %s carries its name', (name, table) => {
    expect(table.preset).toBe(name);
  });

  it.each(ALL_PRESETS)('preset %s covers every ReadIntent', (_n, table) => {
    for (const intent of READ_INTENTS) {
      expect(table.defaultMapping[intent as ReadIntent]).toBeDefined();
    }
  });

  it.each(ALL_PRESETS)('preset %s maps to known strategies', (_n, table) => {
    const valid: ReadStrategyId[] = [
      'single-call',
      'two-call-extract-answer',
      'commit-vs-abstain',
      'verbatim-citation',
      'scratchpad-then-answer',
    ];
    for (const intent of READ_INTENTS) {
      expect(valid).toContain(table.defaultMapping[intent as ReadIntent]);
    }
  });

  it.each(ALL_PRESETS)('preset %s tables are frozen', (_n, table) => {
    expect(Object.isFrozen(table)).toBe(true);
    expect(Object.isFrozen(table.defaultMapping)).toBe(true);
  });

  it('PRESET_READ_TABLES exposes every preset', () => {
    expect(PRESET_READ_TABLES['precise-fact']).toBe(PRECISE_FACT_TABLE);
    expect(PRESET_READ_TABLES['synthesis']).toBe(SYNTHESIS_TABLE);
    expect(PRESET_READ_TABLES['temporal']).toBe(TEMPORAL_TABLE);
  });
});

describe('selectReadStrategy: pure function', () => {
  it('returns the strategy mapped by the table', () => {
    const decision = selectReadStrategy({
      predictedIntent: 'precise-fact',
      groundTruthIntent: null,
      config: {
        table: PRECISE_FACT_TABLE,
        budgetPerReadUsd: null,
        budgetMode: 'cheapest-fallback',
        strategyCosts: DEFAULT_READ_COSTS,
      },
    });
    expect(decision.chosenStrategy).toBe(
      PRECISE_FACT_TABLE.defaultMapping['precise-fact'],
    );
    expect(decision.budgetExceeded).toBe(false);
  });

  it('throws ReadRouterUnknownIntentError on unknown intent', () => {
    expect(() =>
      selectReadStrategy({
        // @ts-expect-error testing runtime guard
        predictedIntent: 'made-up',
        groundTruthIntent: null,
        config: {
          table: PRECISE_FACT_TABLE,
          budgetPerReadUsd: null,
          budgetMode: 'cheapest-fallback',
          strategyCosts: DEFAULT_READ_COSTS,
        },
      }),
    ).toThrow(ReadRouterUnknownIntentError);
  });
});

function mockLLM(text: string): IReadIntentClassifierLLM {
  return {
    invoke: vi.fn(async () => ({
      text,
      tokensIn: 30,
      tokensOut: 4,
      model: 'mini',
    })),
  };
}

describe('LLMReadIntentClassifier: parsing', () => {
  it.each(READ_INTENTS)('parses %s correctly', async (intent) => {
    const c = new LLMReadIntentClassifier({ llm: mockLLM(intent) });
    const r = await c.classify('Q?', []);
    expect(r.intent).toBe(intent);
  });

  it('falls back to multi-source-synthesis on unparseable output', async () => {
    const c = new LLMReadIntentClassifier({ llm: mockLLM('garbage') });
    const r = await c.classify('Q?', []);
    expect(r.intent).toBe('multi-source-synthesis');
  });
});

function stubClassifier(intent: ReadIntent) {
  return {
    classify: vi.fn(async () => ({
      intent,
      tokensIn: 20,
      tokensOut: 2,
      model: 'stub',
    })),
  };
}

describe('ReadRouter: end-to-end compose', () => {
  it('classifies + routes', async () => {
    const router = new ReadRouter({
      classifier: stubClassifier('precise-fact'),
      preset: 'precise-fact',
    });
    const decision = await router.decide('What is X?', ['evidence A']);
    expect(decision.classifier.intent).toBe('precise-fact');
    expect(decision.routing.chosenStrategy).toBe(
      PRECISE_FACT_TABLE.defaultMapping['precise-fact'],
    );
  });

  it('honors manualIntent override skipping the classifier', async () => {
    const classifier = stubClassifier('precise-fact');
    const router = new ReadRouter({ classifier, preset: 'precise-fact' });
    const decision = await router.decide('Q?', [], {
      manualIntent: 'time-interval',
    });
    expect(classifier.classify).not.toHaveBeenCalled();
    expect(decision.classifier.intent).toBe('time-interval');
  });
});

describe('FunctionReadDispatcher: routes by strategy', () => {
  it('calls the correct executor', async () => {
    const single = vi.fn(async () => ({ answer: 'single' }));
    const twoCall = vi.fn(async () => ({ answer: 'two-call' }));
    const dispatcher = new FunctionReadDispatcher<{ answer: string }>({
      'single-call': single,
      'two-call-extract-answer': twoCall,
    });
    const result = await dispatcher.dispatch({
      strategy: 'two-call-extract-answer',
      query: 'Q?',
      evidence: [],
    });
    expect(twoCall).toHaveBeenCalled();
    expect(single).not.toHaveBeenCalled();
    expect(result.outcome.answer).toBe('two-call');
  });

  it('throws when strategy is not registered', async () => {
    const dispatcher = new FunctionReadDispatcher<{ answer: string }>({
      'single-call': vi.fn(async () => ({ answer: '' })),
    });
    await expect(
      dispatcher.dispatch({
        strategy: 'commit-vs-abstain',
        query: 'Q',
        evidence: [],
      }),
    ).rejects.toThrow(UnsupportedReadStrategyError);
  });
});

describe('ReadRouter.decideAndDispatch: composes', () => {
  it('classifies + routes + executes', async () => {
    const router = new ReadRouter({
      classifier: stubClassifier('precise-fact'),
      preset: 'precise-fact',
      dispatcher: new FunctionReadDispatcher<{ answer: string }>({
        'single-call': async () => ({ answer: 'X' }),
        'two-call-extract-answer': async () => ({ answer: 'X-two' }),
        'commit-vs-abstain': async () => ({ answer: 'X-commit' }),
        'verbatim-citation': async () => ({ answer: 'X-verbatim' }),
        'scratchpad-then-answer': async () => ({ answer: 'X-scratch' }),
      }),
    });
    const result = await router.decideAndDispatch<{ answer: string }>(
      'Q?',
      ['e1', 'e2'],
    );
    expect(result.outcome.answer.startsWith('X')).toBe(true);
  });
});
