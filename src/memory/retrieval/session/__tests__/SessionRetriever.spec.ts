import { describe, it, expect } from 'vitest';
import { SessionRetriever } from '../SessionRetriever.js';
import { SessionSummaryStore } from '../SessionSummaryStore.js';
import type {
  ScoredMemoryTrace,
  CognitiveRetrievalOptions,
  PADState,
  MemoryScope,
} from '../../../core/types.js';

class FakeSummaryStore {
  constructor(private sessions: Array<{ sessionId: string; similarity: number }> = []) {}
  async querySessions(_q: string, opts: { topK: number }) {
    return this.sessions
      .slice()
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, opts.topK)
      .map((s) => ({ sessionId: s.sessionId, similarityScore: s.similarity }));
  }
  async indexSession() { /* no-op */ }
}

function mkTrace(id: string, sessionId: string, score: number): ScoredMemoryTrace {
  return {
    id,
    type: 'episodic',
    scope: 'user',
    scopeId: 'u1',
    content: `content-${id}`,
    entities: [],
    tags: [`bench-session:${sessionId}`],
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
      strengthScore: 0, similarityScore: score, recencyScore: 0,
      emotionalCongruenceScore: 0, graphActivationScore: 0, importanceScore: 0,
    },
  };
}

class FakeMemoryStore {
  constructor(private traces: ScoredMemoryTrace[] = []) {}
  async query(_q: string, _mood: PADState, opts: CognitiveRetrievalOptions) {
    const scored = this.traces.slice(0, opts.topK ?? 10);
    return { scored, partial: [], timings: { vectorSearchMs: 1, scoringMs: 1 } };
  }
}

class FakeReranker {
  public called = false;
  async rerank(input: { documents: Array<{ id: string; content: string; originalScore?: number }> }) {
    this.called = true;
    return {
      results: input.documents.slice().reverse().map((d, i) => ({
        id: d.id,
        relevanceScore: 1 - i * 0.1,
        originalScore: d.originalScore,
      })),
      model: 'fake-rerank',
      usage: { searchUnits: 1 },
    };
  }
}

const neutralMood: PADState = { valence: 0, arousal: 0, dominance: 0 };
const scope = { scope: 'user' as MemoryScope, scopeId: 'u1' };

describe('SessionRetriever', () => {
  it('happy path: two-stage retrieval returns chunks from the top-K selected sessions', async () => {
    const summaryStore = new FakeSummaryStore([
      { sessionId: 's-a', similarity: 0.9 },
      { sessionId: 's-b', similarity: 0.8 },
      { sessionId: 's-c', similarity: 0.2 },
    ]);
    const memoryStore = new FakeMemoryStore([
      mkTrace('t1', 's-a', 0.91),
      mkTrace('t2', 's-a', 0.88),
      mkTrace('t3', 's-b', 0.82),
      mkTrace('t4', 's-b', 0.77),
      mkTrace('t5', 's-c', 0.50),
      mkTrace('t6', 's-c', 0.40),
    ]);
    const r = new SessionRetriever({
      summaryStore: summaryStore as unknown as SessionSummaryStore,
      memoryStore: memoryStore as unknown as import('../../store/MemoryStore.js').MemoryStore,
      embeddingManager: undefined as never,
    });
    const result = await r.retrieve('q', neutralMood, scope, {
      topSessions: 2, chunksPerSession: 2, recallTopK: 10,
    });
    const returnedSessions = new Set(
      result.retrieved.map((t) => t.tags.find((tag) => tag.startsWith('bench-session:'))!.slice('bench-session:'.length)),
    );
    expect(returnedSessions.has('s-a')).toBe(true);
    expect(returnedSessions.has('s-b')).toBe(true);
    expect(returnedSessions.has('s-c')).toBe(false);
    expect(result.retrieved.length).toBeLessThanOrEqual(4);
  });

  it('fallback stage1-empty: falls through to memoryStore.query when no sessions indexed', async () => {
    const summaryStore = new FakeSummaryStore([]);
    const memoryStore = new FakeMemoryStore([mkTrace('t1', 's-a', 0.9)]);
    const r = new SessionRetriever({
      summaryStore: summaryStore as unknown as SessionSummaryStore,
      memoryStore: memoryStore as unknown as import('../../store/MemoryStore.js').MemoryStore,
      embeddingManager: undefined as never,
    });
    const result = await r.retrieve('q', neutralMood, scope, { recallTopK: 10 });
    expect(result.retrieved.length).toBe(1);
    expect(result.diagnostics).toBeDefined();
  });

  it('fallback stage2-empty: returns raw Stage-2 pool when post-filter wipes everything', async () => {
    const summaryStore = new FakeSummaryStore([{ sessionId: 's-x', similarity: 0.9 }]);
    const memoryStore = new FakeMemoryStore([
      mkTrace('t1', 's-other', 0.8),
      mkTrace('t2', 's-other', 0.7),
    ]);
    const r = new SessionRetriever({
      summaryStore: summaryStore as unknown as SessionSummaryStore,
      memoryStore: memoryStore as unknown as import('../../store/MemoryStore.js').MemoryStore,
      embeddingManager: undefined as never,
    });
    const result = await r.retrieve('q', neutralMood, scope, {
      topSessions: 1, chunksPerSession: 3, recallTopK: 10,
    });
    expect(result.retrieved.length).toBe(2);
  });

  it('rerank applied when rerankerService present', async () => {
    const summaryStore = new FakeSummaryStore([{ sessionId: 's-a', similarity: 0.9 }]);
    const memoryStore = new FakeMemoryStore([
      mkTrace('t1', 's-a', 0.9),
      mkTrace('t2', 's-a', 0.8),
      mkTrace('t3', 's-a', 0.7),
    ]);
    const reranker = new FakeReranker();
    const r = new SessionRetriever({
      summaryStore: summaryStore as unknown as SessionSummaryStore,
      memoryStore: memoryStore as unknown as import('../../store/MemoryStore.js').MemoryStore,
      embeddingManager: undefined as never,
      rerankerService: reranker as unknown as import('../../../../rag/reranking/RerankerService.js').RerankerService,
    });
    await r.retrieve('q', neutralMood, scope, {
      topSessions: 1, chunksPerSession: 3, recallTopK: 10,
    });
    expect(reranker.called).toBe(true);
  });

  it('rerank skipped when no rerankerService configured', async () => {
    const summaryStore = new FakeSummaryStore([{ sessionId: 's-a', similarity: 0.9 }]);
    const memoryStore = new FakeMemoryStore([mkTrace('t1', 's-a', 0.9)]);
    const r = new SessionRetriever({
      summaryStore: summaryStore as unknown as SessionSummaryStore,
      memoryStore: memoryStore as unknown as import('../../store/MemoryStore.js').MemoryStore,
      embeddingManager: undefined as never,
    });
    const result = await r.retrieve('q', neutralMood, scope, { recallTopK: 10 });
    expect(result.retrieved.length).toBeGreaterThan(0);
  });

  it('truncates to recallTopK after merge', async () => {
    const summaryStore = new FakeSummaryStore([
      { sessionId: 's-a', similarity: 0.9 },
      { sessionId: 's-b', similarity: 0.8 },
    ]);
    const memoryStore = new FakeMemoryStore([
      mkTrace('a1', 's-a', 0.9), mkTrace('a2', 's-a', 0.88), mkTrace('a3', 's-a', 0.86),
      mkTrace('b1', 's-b', 0.85), mkTrace('b2', 's-b', 0.83), mkTrace('b3', 's-b', 0.81),
    ]);
    const r = new SessionRetriever({
      summaryStore: summaryStore as unknown as SessionSummaryStore,
      memoryStore: memoryStore as unknown as import('../../store/MemoryStore.js').MemoryStore,
      embeddingManager: undefined as never,
    });
    const result = await r.retrieve('q', neutralMood, scope, {
      topSessions: 2, chunksPerSession: 3, recallTopK: 4,
    });
    expect(result.retrieved.length).toBe(4);
  });
});
