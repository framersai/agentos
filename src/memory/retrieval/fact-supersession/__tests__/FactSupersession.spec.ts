import { describe, it, expect } from 'vitest';
import { FactSupersession } from '../FactSupersession.js';
import type { ScoredMemoryTrace } from '../../../core/types.js';

function mkTrace(id: string, content: string, createdAt: number): ScoredMemoryTrace {
  return {
    id,
    type: 'episodic',
    scope: 'user',
    scopeId: 'u1',
    content,
    entities: [],
    tags: [],
    provenance: { sourceType: 'user_statement', sourceTimestamp: createdAt, confidence: 1, verificationCount: 0 },
    emotionalContext: { valence: 0, arousal: 0, dominance: 0, intensity: 0, gmiMood: '' },
    encodingStrength: 0.5, stability: 0.5, retrievalCount: 0, lastAccessedAt: 0,
    accessCount: 0, reinforcementInterval: 0, associatedTraceIds: [],
    createdAt, updatedAt: createdAt, isActive: true,
    retrievalScore: 0.8,
    scoreBreakdown: {
      strengthScore: 0, similarityScore: 0.8, recencyScore: 0,
      emotionalCongruenceScore: 0, graphActivationScore: 0, importanceScore: 0,
    },
  };
}

describe('FactSupersession', () => {
  it('drops superseded trace when LLM returns its id', async () => {
    const traces = [
      mkTrace('t1', 'I live in NYC', 1_000_000),
      mkTrace('t2', 'I moved to Berlin', 2_000_000),
    ];
    const fs = new FactSupersession({
      llmInvoker: async () => JSON.stringify({ dropIds: ['t1'] }),
    });
    const result = await fs.resolve({ traces, query: 'Where do I live?' });
    expect(result.traces.map((t) => t.id)).toEqual(['t2']);
    expect(result.droppedIds).toEqual(['t1']);
    expect(result.diagnostics.parseOk).toBe(true);
  });

  it('preserves order and scores when LLM returns empty dropIds', async () => {
    const traces = [
      mkTrace('t1', 'I like cats', 1_000_000),
      mkTrace('t2', 'I also like dogs', 2_000_000),
    ];
    const fs = new FactSupersession({
      llmInvoker: async () => JSON.stringify({ dropIds: [] }),
    });
    const result = await fs.resolve({ traces, query: 'What pets do I like?' });
    expect(result.traces.map((t) => t.id)).toEqual(['t1', 't2']);
    expect(result.traces[0].retrievalScore).toBe(0.8);
    expect(result.droppedIds).toEqual([]);
    expect(result.diagnostics.parseOk).toBe(true);
  });

  it('falls back to original on parse failure', async () => {
    const traces = [mkTrace('t1', 'hello', 1_000_000)];
    const fs = new FactSupersession({
      llmInvoker: async () => 'not valid json {{{',
    });
    const result = await fs.resolve({ traces, query: 'q' });
    expect(result.traces.map((t) => t.id)).toEqual(['t1']);
    expect(result.droppedIds).toEqual([]);
    expect(result.diagnostics.parseOk).toBe(false);
    expect(result.diagnostics.notes).toContain('fact-supersession:parse-failed');
  });

  it('safety clamp rejects drop-all output', async () => {
    const traces = [
      mkTrace('t1', 'a', 1_000_000),
      mkTrace('t2', 'b', 2_000_000),
    ];
    const fs = new FactSupersession({
      llmInvoker: async () => JSON.stringify({ dropIds: ['t1', 't2'] }),
    });
    const result = await fs.resolve({ traces, query: 'q' });
    expect(result.traces.map((t) => t.id)).toEqual(['t1', 't2']);
    expect(result.droppedIds).toEqual([]);
    expect(result.diagnostics.notes).toContain('fact-supersession:drop-all-rejected');
  });
});
