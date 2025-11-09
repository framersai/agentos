// File: packages/agentos/src/core/usage/tests/UsageLedger.test.ts
import { describe, it, expect } from 'vitest';
import UsageLedger from '../UsageLedger';
import { ModelCompletionResponse } from '../../llm/providers/IProvider';

function makeChunk(id: string, isFinal: boolean, usage?: any): ModelCompletionResponse {
  return {
    id: id + (isFinal ? '-final' : '-delta'),
    object: 'chat.completion.chunk',
    created: Date.now() / 1000,
    modelId: 'test-model',
    choices: [{ index: 0, message: { role: 'assistant', content: '' }, finishReason: isFinal ? 'stop' : null }],
    isFinal,
    usage,
  } as ModelCompletionResponse;
}

describe('UsageLedger', () => {
  it('aggregates final streaming usage only by default', () => {
    const ledger = new UsageLedger();
    const dim = { sessionId: 's1', personaId: 'p1', providerId: 'openai' };

    // Interim chunk with partial usage
    ledger.ingestCompletionChunk(dim, makeChunk('c1', false, { totalTokens: 10, promptTokens: 6, completionTokens: 4 }));
    // Final chunk
    ledger.ingestCompletionChunk(dim, makeChunk('c1', true, { totalTokens: 42, promptTokens: 20, completionTokens: 22, costUSD: 0.08 }));

    const summaries = ledger.getSummariesBySession('s1');
    expect(summaries.length).toBe(1);
    const bucket = summaries[0];
    expect(bucket.totalTokens).toBe(42); // interim ignored
    expect(bucket.costUSD).toBeCloseTo(0.08);
    expect(bucket.calls).toBe(1);
  });

  it('can include interim streaming usage when configured', () => {
    const ledger = new UsageLedger({ includeInterimStreamingUsage: true });
    const dim = { sessionId: 's2', personaId: 'p1', providerId: 'openai' };
    ledger.ingestCompletionChunk(dim, makeChunk('c2', false, { totalTokens: 5, promptTokens: 3, completionTokens: 2 }));
    ledger.ingestCompletionChunk(dim, makeChunk('c2', true, { totalTokens: 15, promptTokens: 7, completionTokens: 8 }));

    const agg = ledger.getSessionAggregate('s2');
    expect(agg?.totalTokens).toBe(20); // 5 + 15
    expect(agg?.promptTokens).toBe(10); // 3 + 7
    expect(agg?.completionTokens).toBe(10); // 2 + 8
  });

  it('derives cost from fallback pricing when costUSD absent', () => {
    const ledger = new UsageLedger({ pricingFallbacks: { 'test-model': { inputPer1M: 1, outputPer1M: 2 } } });
    const dim = { sessionId: 's3', providerId: 'openai' };
    ledger.ingestCompletionChunk(dim, makeChunk('c3', true, { totalTokens: 1000, promptTokens: 600, completionTokens: 400 }));
    const s = ledger.getSessionAggregate('s3');
    // cost = (600/1e6)*1 + (400/1e6)*2 = 0.0006 + 0.0008 = 0.0014
    expect(s?.costUSD).toBeCloseTo(0.0014, 6);
  });

  it('tracks multiple buckets and aggregates correctly', () => {
    const ledger = new UsageLedger();
    const dim1 = { sessionId: 's4', personaId: 'personaA', providerId: 'openai' };
    const dim2 = { sessionId: 's4', personaId: 'personaB', providerId: 'openai' };
    ledger.ingestCompletionChunk(dim1, makeChunk('c4a', true, { totalTokens: 10, promptTokens: 6, completionTokens: 4, costUSD: 0.02 }));
    ledger.ingestCompletionChunk(dim2, makeChunk('c4b', true, { totalTokens: 30, promptTokens: 20, completionTokens: 10, costUSD: 0.06 }));

    const agg = ledger.getSessionAggregate('s4');
    expect(agg?.totalTokens).toBe(40);
    expect(agg?.costUSD).toBeCloseTo(0.08);
    expect(agg?.calls).toBe(2);
  });
});
