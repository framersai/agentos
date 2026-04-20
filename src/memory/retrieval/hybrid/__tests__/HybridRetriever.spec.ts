import { describe, it, expect } from 'vitest';
import { HybridRetriever } from '../HybridRetriever.js';
import type {
  ScoredMemoryTrace,
  CognitiveRetrievalOptions,
  MemoryScope,
} from '../../../core/types.js';
import type { PADState } from '../../../core/config.js';
import type { MemoryStore } from '../../store/MemoryStore.js';
import type { RerankerService } from '../../../../rag/reranking/RerankerService.js';

function mkTrace(id: string, score: number, content = `content-${id}`): ScoredMemoryTrace {
  return {
    id,
    type: 'episodic',
    scope: 'user',
    scopeId: 'u1',
    content,
    entities: [],
    tags: [],
    provenance: { sourceType: 'user_statement', sourceTimestamp: 0, confidence: 1, verificationCount: 0 },
    emotionalContext: { valence: 0, arousal: 0, dominance: 0, intensity: 0, gmiMood: '' },
    encodingStrength: 0.5, stability: 0.5, retrievalCount: 0, lastAccessedAt: 0,
    accessCount: 0, reinforcementInterval: 0, associatedTraceIds: [],
    createdAt: 0, updatedAt: 0, isActive: true,
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
    return {
      scored: this.traces.slice(0, opts.topK ?? 10),
      partial: [],
      timings: { vectorSearchMs: 1, scoringMs: 1 },
    };
  }
}

class FakeReranker {
  public called = false;
  async rerank(input: { query: string; documents: Array<{ id: string; content: string; originalScore?: number }> }) {
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

describe('HybridRetriever', () => {
  it('happy path: RRF merges dense + sparse, returns results', async () => {
    const memoryStore = new FakeMemoryStore([
      mkTrace('t1', 0.9), mkTrace('t2', 0.8), mkTrace('t3', 0.7),
    ]);
    const r = new HybridRetriever({
      memoryStore: memoryStore as unknown as MemoryStore,
    });
    r.bm25.addDocument('t2', 'alpha beta gamma');
    r.bm25.addDocument('t4', 'alpha delta');
    const result = await r.retrieve('alpha', neutralMood, scope, { recallTopK: 10 });
    expect(result.retrieved.length).toBeGreaterThan(0);
    expect(result.retrieved.some((t) => t.id === 't2')).toBe(true);
  });

  it('sparse-only docs (not in dense pool) are skipped in MVP', async () => {
    const memoryStore = new FakeMemoryStore([mkTrace('t1', 0.9)]);
    const r = new HybridRetriever({
      memoryStore: memoryStore as unknown as MemoryStore,
    });
    r.bm25.addDocument('t99', 'alpha');
    const result = await r.retrieve('alpha', neutralMood, scope, { recallTopK: 10 });
    expect(result.retrieved.some((t) => t.id === 't99')).toBe(false);
  });

  it('empty BM25 index: degrades to dense-only with escalation diagnostic', async () => {
    const memoryStore = new FakeMemoryStore([mkTrace('t1', 0.9), mkTrace('t2', 0.8)]);
    const r = new HybridRetriever({
      memoryStore: memoryStore as unknown as MemoryStore,
    });
    const result = await r.retrieve('q', neutralMood, scope, { recallTopK: 10 });
    expect(result.retrieved.length).toBe(2);
    expect(result.diagnostics.escalations).toContain('hybrid-retriever:sparse-empty');
  });

  it('rerank applied when rerankerService present', async () => {
    const memoryStore = new FakeMemoryStore([mkTrace('t1', 0.9), mkTrace('t2', 0.8)]);
    const reranker = new FakeReranker();
    const r = new HybridRetriever({
      memoryStore: memoryStore as unknown as MemoryStore,
      rerankerService: reranker as unknown as RerankerService,
    });
    r.bm25.addDocument('t1', 'alpha');
    r.bm25.addDocument('t2', 'alpha beta');
    await r.retrieve('alpha', neutralMood, scope, { recallTopK: 10 });
    expect(reranker.called).toBe(true);
  });

  it('rerank skipped when no rerankerService', async () => {
    const memoryStore = new FakeMemoryStore([mkTrace('t1', 0.9)]);
    const r = new HybridRetriever({
      memoryStore: memoryStore as unknown as MemoryStore,
    });
    r.bm25.addDocument('t1', 'alpha');
    const result = await r.retrieve('alpha', neutralMood, scope, { recallTopK: 10 });
    expect(result.retrieved.length).toBeGreaterThan(0);
  });

  it('truncates to recallTopK after merge', async () => {
    const traces = Array.from({ length: 20 }, (_, i) => mkTrace(`t${i}`, 1 - i * 0.01));
    const memoryStore = new FakeMemoryStore(traces);
    const r = new HybridRetriever({
      memoryStore: memoryStore as unknown as MemoryStore,
    });
    for (const t of traces) r.bm25.addDocument(t.id, t.content);
    const result = await r.retrieve('content', neutralMood, scope, { recallTopK: 5 });
    expect(result.retrieved.length).toBe(5);
  });
});

class FakeHyde {
  public calls: string[] = [];
  constructor(private readonly hypothesis: string = 'HYPOTHETICAL ANSWER TEXT') {}
  async generateHypothesis(query: string): Promise<{ hypothesis: string; latencyMs: number }> {
    this.calls.push(query);
    return { hypothesis: this.hypothesis, latencyMs: 1 };
  }
}

class CapturingMemoryStore {
  public lastQuery: string | undefined;
  constructor(private traces: ScoredMemoryTrace[] = []) {}
  async query(q: string, _mood: PADState, opts: CognitiveRetrievalOptions) {
    this.lastQuery = q;
    return {
      scored: this.traces.slice(0, opts.topK ?? 10),
      partial: [],
      timings: { vectorSearchMs: 1, scoringMs: 1 },
    };
  }
}

class CapturingReranker {
  public lastQuery: string | undefined;
  async rerank(input: { query: string; documents: Array<{ id: string; content: string; originalScore?: number }> }) {
    this.lastQuery = input.query;
    return {
      results: input.documents.map((d, i) => ({
        id: d.id,
        relevanceScore: 1 - i * 0.1,
        originalScore: d.originalScore,
      })),
      model: 'fake-rerank',
      usage: { searchUnits: 1 },
    };
  }
}

describe('HybridRetriever + HyDE', () => {
  it('generates hypothesis and uses it for dense query when hydeRetriever is set', async () => {
    const memoryStore = new CapturingMemoryStore([mkTrace('t1', 0.9, 'relevant content')]);
    const hyde = new FakeHyde('User prefers hiking and cooking at home.');
    const r = new HybridRetriever({
      memoryStore: memoryStore as unknown as MemoryStore,
      hydeRetriever: hyde as unknown as import('../../../../rag/HydeRetriever.js').HydeRetriever,
    });
    r.bm25.addDocument('t1', 'hiking cooking');
    await r.retrieve('What does the user like?', neutralMood, scope, { recallTopK: 10 });
    expect(hyde.calls.length).toBe(1);
    expect(memoryStore.lastQuery).toBe('User prefers hiking and cooking at home.');
  });

  it('uses raw query (no hypothesis call) when hydeRetriever is undefined', async () => {
    const memoryStore = new CapturingMemoryStore([mkTrace('t1', 0.9)]);
    const r = new HybridRetriever({
      memoryStore: memoryStore as unknown as MemoryStore,
    });
    r.bm25.addDocument('t1', 'alpha');
    await r.retrieve('alpha', neutralMood, scope, { recallTopK: 10 });
    expect(memoryStore.lastQuery).toBe('alpha');
  });

  it('passes ORIGINAL query (not hypothesis) to reranker', async () => {
    const memoryStore = new CapturingMemoryStore([mkTrace('t1', 0.9), mkTrace('t2', 0.8)]);
    const hyde = new FakeHyde('hypothetical expanded answer');
    const reranker = new CapturingReranker();
    const r = new HybridRetriever({
      memoryStore: memoryStore as unknown as MemoryStore,
      hydeRetriever: hyde as unknown as import('../../../../rag/HydeRetriever.js').HydeRetriever,
      rerankerService: reranker as unknown as RerankerService,
    });
    // BM25 content includes tokens from the hypothesis so sparse
    // returns hits (otherwise the sparse-empty early-return skips
    // rerank and this test can't observe reranker.lastQuery).
    r.bm25.addDocument('t1', 'hypothetical expanded content');
    r.bm25.addDocument('t2', 'another expanded answer');
    await r.retrieve('what is the user up to?', neutralMood, scope, { recallTopK: 10 });
    expect(reranker.lastQuery).toBe('what is the user up to?');
  });
});
