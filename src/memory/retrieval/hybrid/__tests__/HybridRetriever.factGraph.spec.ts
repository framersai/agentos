/**
 * @file HybridRetriever.factGraph.spec.ts
 * @description Step-9 fact-graph integration tests — synthetic trace
 * prepending, classifier-driven query expansion, temporal-query expansion.
 */

import { describe, it, expect } from 'vitest';
import { HybridRetriever } from '../HybridRetriever.js';
import { FactStore } from '../../fact-graph/FactStore.js';
import type {
  ScoredMemoryTrace,
  CognitiveRetrievalOptions,
  MemoryScope,
} from '../../../core/types.js';
import type { PADState } from '../../../core/config.js';
import type { MemoryStore } from '../../store/MemoryStore.js';

function mkTrace(id: string, score: number, content = `content-${id}`): ScoredMemoryTrace {
  return {
    id,
    type: 'episodic',
    scope: 'user',
    scopeId: 'bench',
    content,
    entities: [],
    tags: [],
    provenance: { sourceType: 'user_statement', sourceTimestamp: 0, confidence: 1, verificationCount: 0 },
    emotionalContext: { valence: 0, arousal: 0, dominance: 0, intensity: 0, gmiMood: '' },
    encodingStrength: 0.5,
    stability: 0.5,
    retrievalCount: 0,
    lastAccessedAt: 0,
    accessCount: 0,
    reinforcementInterval: 0,
    associatedTraceIds: [],
    createdAt: 0,
    updatedAt: 0,
    isActive: true,
    retrievalScore: score,
    scoreBreakdown: {
      strengthScore: 0,
      similarityScore: score,
      recencyScore: 0,
      emotionalCongruenceScore: 0,
      graphActivationScore: 0,
      importanceScore: 0,
    },
  };
}

class FakeMemoryStore {
  constructor(private traces: ScoredMemoryTrace[] = []) {}
  async query(_q: string, _mood: PADState, opts: CognitiveRetrievalOptions) {
    return {
      scored: this.traces.slice(0, opts.topK ?? 10),
      partial: [],
      timings: { vectorSearchMs: 1, scoringMs: 1 },
    };
  }
}

const neutralMood: PADState = { valence: 0, arousal: 0, dominance: 0 };
const scope = { scope: 'user' as MemoryScope, scopeId: 'bench' };

describe('HybridRetriever + FactStore integration', () => {
  it('prepends a synthetic fact-graph trace when classifier matches', async () => {
    const factStore = new FactStore();
    factStore.upsert('user', 'bench', [
      {
        subject: 'user',
        predicate: 'livesIn',
        object: 'Berlin',
        timestamp: Date.parse('2026-03-15'),
        sourceTraceIds: ['t-live'],
        sourceSpan: 'I moved to Berlin in March',
      },
    ]);

    const memoryStore = new FakeMemoryStore([mkTrace('a', 0.9), mkTrace('b', 0.8)]);
    const r = new HybridRetriever({
      memoryStore: memoryStore as unknown as MemoryStore,
      factStore,
    });
    r.bm25.addDocument('a', 'alpha');
    r.bm25.addDocument('b', 'beta');

    // Query mentions "my" (first-person) + "livesIn" predicate (stem).
    // Default classifier extracts (subject: user, predicate: livesIn).
    const result = await r.retrieve(
      'where does my livesIn location say?',
      neutralMood,
      scope,
      { recallTopK: 5 },
    );

    const fg = result.retrieved.find((t) => t.id.startsWith('fact-graph:'));
    expect(fg).toBeDefined();
    expect(fg!.content).toContain('Berlin');
    expect(fg!.provenance.sourceType).toBe('fact_graph');
  });

  it('does not inject synthetic traces when classifier finds no match', async () => {
    const factStore = new FactStore();
    factStore.upsert('user', 'bench', [
      {
        subject: 'user',
        predicate: 'livesIn',
        object: 'Berlin',
        timestamp: Date.parse('2026-03-15'),
        sourceTraceIds: ['t-live'],
        sourceSpan: 'I moved to Berlin in March',
      },
    ]);

    const memoryStore = new FakeMemoryStore([mkTrace('a', 0.9)]);
    const r = new HybridRetriever({
      memoryStore: memoryStore as unknown as MemoryStore,
      factStore,
    });
    r.bm25.addDocument('a', 'alpha');

    // No first-person and no predicate stem → no fact-graph extraction.
    const result = await r.retrieve('the weather today', neutralMood, scope, { recallTopK: 5 });
    expect(result.retrieved.some((t) => t.id.startsWith('fact-graph:'))).toBe(false);
  });

  it('temporal queries expand to all facts for a subject', async () => {
    const factStore = new FactStore();
    factStore.upsert('user', 'bench', [
      {
        subject: 'user',
        predicate: 'livesIn',
        object: 'NYC',
        timestamp: Date.parse('2023-01-01'),
        sourceTraceIds: ['t1'],
        sourceSpan: 'moved to NYC',
      },
      {
        subject: 'user',
        predicate: 'livesIn',
        object: 'Berlin',
        timestamp: Date.parse('2026-03-15'),
        sourceTraceIds: ['t2'],
        sourceSpan: 'moved to Berlin',
      },
    ]);

    const memoryStore = new FakeMemoryStore([mkTrace('a', 0.5)]);
    const r = new HybridRetriever({
      memoryStore: memoryStore as unknown as MemoryStore,
      factStore,
    });
    r.bm25.addDocument('a', 'alpha');

    // "Where did I livesIn first" → temporal + first-person + predicate
    const result = await r.retrieve(
      'where did I livesIn first?',
      neutralMood,
      scope,
      { recallTopK: 10 },
    );

    const fgTraces = result.retrieved.filter((t) => t.id.startsWith('fact-graph:'));
    expect(fgTraces.length).toBe(2);
  });

  it('custom classifier overrides the default', async () => {
    const factStore = new FactStore();
    factStore.upsert('user', 'bench', [
      {
        subject: 'user',
        predicate: 'prefers',
        object: 'tea',
        timestamp: 1,
        sourceTraceIds: ['t'],
        sourceSpan: 'I prefer tea',
      },
    ]);

    const memoryStore = new FakeMemoryStore([mkTrace('a', 0.5)]);
    const r = new HybridRetriever({
      memoryStore: memoryStore as unknown as MemoryStore,
      factStore,
      // Custom classifier forces a match on any query.
      factGraphQueryClassifier: () => ({
        isTemporalQuestion: false,
        extractedSubjectPredicates: [{ subject: 'user', predicate: 'prefers' }],
      }),
    });
    r.bm25.addDocument('a', 'alpha');

    const result = await r.retrieve('totally unrelated', neutralMood, scope, { recallTopK: 5 });
    const fg = result.retrieved.find((t) => t.id.startsWith('fact-graph:'));
    expect(fg).toBeDefined();
    expect(fg!.content).toContain('tea');
  });
});
