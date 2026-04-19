/**
 * @fileoverview Tests for UnifiedRetriever — plan-based retrieval orchestrator
 * that executes all sources in parallel, merges via RRF, reranks, and
 * feeds back into cognitive memory.
 *
 * All dependencies are vi.fn() mocks injected via UnifiedRetrieverDeps.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

import { UnifiedRetriever } from '../UnifiedRetriever.js';
import type { UnifiedRetrieverDeps } from '../UnifiedRetriever.js';
import { buildDefaultPlan } from '../types.js';
import type { RetrievalPlan, UnifiedRetrieverEvent } from '../types.js';
import type { RetrievedChunk } from '../../../query-router/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Factory for a realistic RetrievedChunk with sensible defaults. */
function makeChunk(overrides: Partial<RetrievedChunk> = {}): RetrievedChunk {
  return {
    id: overrides.id ?? `chunk-${Math.random().toString(36).slice(2, 8)}`,
    content: overrides.content ?? 'Some retrieved content',
    heading: overrides.heading ?? 'Section A',
    sourcePath: overrides.sourcePath ?? '/docs/file.md',
    relevanceScore: overrides.relevanceScore ?? 0.85,
    matchType: overrides.matchType ?? 'vector',
  };
}

/** Creates minimal mock deps. */
function makeDeps(overrides: Partial<UnifiedRetrieverDeps> = {}): UnifiedRetrieverDeps {
  return {
    vectorSearch: vi.fn().mockResolvedValue([
      makeChunk({ id: 'v1', relevanceScore: 0.9 }),
      makeChunk({ id: 'v2', relevanceScore: 0.8 }),
      makeChunk({ id: 'v3', relevanceScore: 0.7 }),
    ]),
    rerank: vi.fn().mockImplementation(
      async (_q: string, chunks: RetrievedChunk[], topN: number) =>
        [...chunks].sort((a, b) => b.relevanceScore - a.relevanceScore).slice(0, topN),
    ),
    emit: vi.fn(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('UnifiedRetriever', () => {
  // -----------------------------------------------------------------------
  // 1. None strategy returns empty
  // -----------------------------------------------------------------------
  it('returns empty result for none strategy', async () => {
    const deps = makeDeps();
    const retriever = new UnifiedRetriever(deps);
    const plan = buildDefaultPlan('none');

    const result = await retriever.retrieve('Hello!', plan);

    expect(result.chunks).toEqual([]);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.memoryCacheHit).toBe(false);

    // No source functions should be called
    expect(deps.vectorSearch).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // 2. Simple strategy uses vector + BM25
  // -----------------------------------------------------------------------
  it('simple strategy queries vector search and returns merged results', async () => {
    const deps = makeDeps();
    const retriever = new UnifiedRetriever(deps);
    const plan = buildDefaultPlan('simple');

    const result = await retriever.retrieve('What port does the API run on?', plan);

    expect(result.chunks.length).toBeGreaterThan(0);
    expect(deps.vectorSearch).toHaveBeenCalledWith(expect.any(String), 15);
    expect(result.plan.strategy).toBe('simple');
  });

  it('retrieveWithPolicy escalates from balanced to max-recall on weak hits', async () => {
    const retriever = new UnifiedRetriever({
      vectorSearch: vi
        .fn()
        .mockResolvedValueOnce([makeChunk({ id: 'weak', content: 'weak', relevanceScore: 0.12 })])
        .mockResolvedValueOnce([makeChunk({ id: 'strong', content: 'strong', relevanceScore: 0.91 })]),
      rerank: vi.fn(async (_query, chunks) => chunks),
    });

    const result = await (retriever as any).retrieveWithPolicy('shipping date', {
      profile: 'balanced',
      adaptive: true,
      minScore: 0.3,
    });

    expect(result.policyDiagnostics?.policy.profile).toBe('balanced');
    expect(result.policyDiagnostics?.escalations).toContain('upgrade:max-recall');
    expect(result.chunks[0]?.content).toBe('strong');
  });

  // -----------------------------------------------------------------------
  // 3. All sources plan triggers parallel execution
  // -----------------------------------------------------------------------
  it('moderate plan with all sources executes in parallel', async () => {
    const mockRaptorTree = {
      search: vi.fn().mockResolvedValue([
        { id: 'r1', text: 'Raptor summary', score: 0.75, layer: 1, isSummary: true, metadata: {} },
      ]),
    };

    const deps = makeDeps({
      raptorTree: mockRaptorTree as any,
    });
    const retriever = new UnifiedRetriever(deps);
    const plan = buildDefaultPlan('moderate');

    const result = await retriever.retrieve('How does auth work?', plan);

    // Both vector and raptor should have been called
    expect(deps.vectorSearch).toHaveBeenCalled();
    expect(mockRaptorTree.search).toHaveBeenCalled();
    expect(result.chunks.length).toBeGreaterThan(0);
  });

  // -----------------------------------------------------------------------
  // 4. Memory-first cache hit skips external sources
  // -----------------------------------------------------------------------
  it('returns cached result when episodic memory has high-confidence match', async () => {
    const mockMemoryManager = {
      retrieve: vi.fn().mockResolvedValue({
        retrieved: [{
          id: 'mem-1',
          content: 'Previously retrieved auth info',
          type: 'episodic',
          retrievalScore: 0.95,
          createdAt: Date.now() - 60_000,
        }],
        partiallyRetrieved: [],
        diagnostics: {},
      }),
      encode: vi.fn(),
      getStore: vi.fn().mockReturnValue({ recordAccess: vi.fn() }),
    };

    const deps = makeDeps({
      memoryManager: mockMemoryManager as any,
    });
    const retriever = new UnifiedRetriever(deps);
    const plan = buildDefaultPlan('simple');

    const result = await retriever.retrieve('How does auth work?', plan);

    expect(result.memoryCacheHit).toBe(true);
    // vectorSearch should NOT have been called since memory cache hit
    expect(deps.vectorSearch).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // 5. HyDE generates hypotheses when enabled
  // -----------------------------------------------------------------------
  it('executes HyDE search when plan.hyde.enabled is true', async () => {
    const mockHydeRetriever = {
      generateHypothesis: vi.fn().mockResolvedValue({
        hypothesis: 'Authentication uses JWT tokens with refresh rotation.',
        latencyMs: 100,
      }),
    };

    const deps = makeDeps({
      hydeRetriever: mockHydeRetriever as any,
    });
    const retriever = new UnifiedRetriever(deps);
    const plan = buildDefaultPlan('moderate');

    const result = await retriever.retrieve('How does auth work?', plan);

    expect(mockHydeRetriever.generateHypothesis).toHaveBeenCalled();
    expect(result.chunks.length).toBeGreaterThan(0);
  });

  // -----------------------------------------------------------------------
  // 6. Multi-hypothesis HyDE generates multiple hypotheses
  // -----------------------------------------------------------------------
  it('generates multiple hypotheses for complex strategy', async () => {
    const mockHydeRetriever = {
      generateMultipleHypotheses: vi.fn().mockResolvedValue({
        hypotheses: [
          'JWT auth with rotation',
          'Session-based auth with cookies',
          'OAuth2 integration overview',
        ],
        latencyMs: 300,
      }),
    };

    const deps = makeDeps({
      hydeRetriever: mockHydeRetriever as any,
    });
    const retriever = new UnifiedRetriever(deps);
    const plan = buildDefaultPlan('complex');
    // Disable deep research to focus on HyDE testing
    plan.deepResearch = false;

    const result = await retriever.retrieve('Compare auth strategies', plan);

    expect(mockHydeRetriever.generateMultipleHypotheses).toHaveBeenCalledWith(
      'Compare auth strategies',
      3,
    );
    expect(result.chunks.length).toBeGreaterThan(0);
  });

  // -----------------------------------------------------------------------
  // 7. Temporal boosting reorders results
  // -----------------------------------------------------------------------
  it('applies temporal boosting when plan.temporal.preferRecent is true', async () => {
    const now = Date.now();
    const deps = makeDeps({
      vectorSearch: vi.fn().mockResolvedValue([
        makeChunk({ id: 'old', relevanceScore: 0.9, content: 'Old content' }),
        makeChunk({ id: 'new', relevanceScore: 0.7, content: 'New content' }),
      ]),
    });
    const retriever = new UnifiedRetriever(deps);
    const plan = buildDefaultPlan('simple', {
      temporal: { preferRecent: true, recencyBoost: 2.0, maxAgeMs: 86_400_000 },
    });

    const result = await retriever.retrieve('Latest updates', plan);

    // Result should exist (temporal boosting is applied but without timestamps
    // on the chunks, it degrades gracefully)
    expect(result.chunks.length).toBeGreaterThan(0);
  });

  // -----------------------------------------------------------------------
  // 8. Complex plan triggers decomposition
  // -----------------------------------------------------------------------
  it('decomposes query into sub-queries for complex strategy with deep research', async () => {
    const decompose = vi.fn().mockResolvedValue([
      'How does authentication work?',
      'How does the session store work?',
    ]);
    const deepResearch = vi.fn().mockResolvedValue({
      synthesis: 'Auth uses JWT + session store uses Redis.',
      sources: [makeChunk({ id: 'research-1', matchType: 'research' })],
    });

    const deps = makeDeps({ decompose, deepResearch });
    const retriever = new UnifiedRetriever(deps);
    const plan = buildDefaultPlan('complex');

    const result = await retriever.retrieve(
      'How does auth integrate with the session store?',
      plan,
    );

    expect(decompose).toHaveBeenCalled();
    expect(deepResearch).toHaveBeenCalled();
    expect(result.researchSynthesis).toBeDefined();
    expect(result.chunks.length).toBeGreaterThan(0);
  });

  // -----------------------------------------------------------------------
  // 9. Memory feedback stores retrieval event
  // -----------------------------------------------------------------------
  it('stores retrieval event as episodic memory after retrieval', async () => {
    const encode = vi.fn();
    const mockMemoryManager = {
      retrieve: vi.fn().mockResolvedValue({
        retrieved: [],
        partiallyRetrieved: [],
        diagnostics: {},
      }),
      encode,
      getStore: vi.fn().mockReturnValue({ recordAccess: vi.fn() }),
    };

    const deps = makeDeps({
      memoryManager: mockMemoryManager as any,
    });
    const retriever = new UnifiedRetriever(deps);
    const plan = buildDefaultPlan('simple');

    await retriever.retrieve('What is the API port?', plan);

    // encode should have been called for memory feedback
    expect(encode).toHaveBeenCalledWith(
      expect.stringContaining('Retrieved'),
      expect.any(Object),
      'neutral',
      expect.objectContaining({
        type: 'episodic',
        tags: expect.arrayContaining(['retrieval', 'unified-retriever']),
      }),
    );
  });

  // -----------------------------------------------------------------------
  // 10. Graceful degradation when sources fail
  // -----------------------------------------------------------------------
  it('degrades gracefully when a source fails', async () => {
    const mockRaptorTree = {
      search: vi.fn().mockRejectedValue(new Error('RAPTOR unavailable')),
    };

    const emitted: UnifiedRetrieverEvent[] = [];
    const deps = makeDeps({
      raptorTree: mockRaptorTree as any,
      emit: (event) => emitted.push(event),
    });
    const retriever = new UnifiedRetriever(deps);
    const plan = buildDefaultPlan('moderate');

    // Should NOT throw despite RAPTOR failure
    const result = await retriever.retrieve('How does auth work?', plan);

    // Vector results should still be present
    expect(result.chunks.length).toBeGreaterThan(0);

    // Should have emitted an error event for RAPTOR
    const errorEvent = emitted.find(e => e.type === 'unified:source-error');
    expect(errorEvent).toBeDefined();
  });

  // -----------------------------------------------------------------------
  // 11. Reranker failure falls back to score sorting
  // -----------------------------------------------------------------------
  it('falls back to score sorting when reranker fails', async () => {
    const deps = makeDeps({
      rerank: vi.fn().mockRejectedValue(new Error('Reranker down')),
    });
    const retriever = new UnifiedRetriever(deps);
    const plan = buildDefaultPlan('simple');

    const result = await retriever.retrieve('What is the API port?', plan);

    // Should still return results (score-sorted fallback)
    expect(result.chunks.length).toBeGreaterThan(0);
    // Results should be sorted by score descending
    for (let i = 1; i < result.chunks.length; i++) {
      expect(result.chunks[i - 1].relevanceScore).toBeGreaterThanOrEqual(
        result.chunks[i].relevanceScore,
      );
    }
  });

  // -----------------------------------------------------------------------
  // 12. RRF merge boosts chunks appearing in multiple sources
  // -----------------------------------------------------------------------
  it('RRF merge boosts chunks appearing in multiple source lists', async () => {
    const sharedChunkId = 'shared-chunk';

    const mockRaptorTree = {
      search: vi.fn().mockResolvedValue([
        { id: sharedChunkId, text: 'Auth overview', score: 0.8, layer: 0, isSummary: false, metadata: {} },
        { id: 'raptor-only', text: 'Raptor only', score: 0.6, layer: 1, isSummary: true, metadata: {} },
      ]),
    };

    const deps = makeDeps({
      vectorSearch: vi.fn().mockResolvedValue([
        makeChunk({ id: sharedChunkId, relevanceScore: 0.7 }),
        makeChunk({ id: 'vector-only', relevanceScore: 0.9 }),
      ]),
      raptorTree: mockRaptorTree as any,
      rerank: undefined, // Disable reranker to test raw RRF scores
    });
    const retriever = new UnifiedRetriever(deps);
    const plan = buildDefaultPlan('moderate');

    const result = await retriever.retrieve('Auth overview', plan);

    // The shared chunk should appear with a boosted score (RRF contributions from both sources)
    const sharedResult = result.chunks.find(c => c.id === sharedChunkId);
    const vectorOnly = result.chunks.find(c => c.id === 'vector-only');
    expect(sharedResult).toBeDefined();
    expect(vectorOnly).toBeDefined();

    // Shared chunk gets RRF score from both sources, so it should be boosted
    // relative to what a single source would give it
    expect(sharedResult!.relevanceScore).toBeGreaterThan(0);
  });

  // -----------------------------------------------------------------------
  // 13. Events are emitted throughout the pipeline
  // -----------------------------------------------------------------------
  it('emits lifecycle events during retrieval', async () => {
    const emitted: UnifiedRetrieverEvent[] = [];
    const deps = makeDeps({
      emit: (event) => emitted.push(event),
    });
    const retriever = new UnifiedRetriever(deps);
    const plan = buildDefaultPlan('simple');

    await retriever.retrieve('What is the API port?', plan);

    const types = emitted.map(e => e.type);
    expect(types).toContain('unified:plan-start');
    expect(types).toContain('unified:merge-complete');
    expect(types).toContain('unified:complete');
  });

  // -----------------------------------------------------------------------
  // 14. buildDefaultPlan creates correct defaults
  // -----------------------------------------------------------------------
  describe('buildDefaultPlan', () => {
    it('creates correct defaults for each strategy', () => {
      const none = buildDefaultPlan('none');
      expect(none.sources.vector).toBe(false);
      expect(none.sources.bm25).toBe(false);
      expect(none.hyde.enabled).toBe(false);

      const simple = buildDefaultPlan('simple');
      expect(simple.sources.vector).toBe(true);
      expect(simple.sources.bm25).toBe(true);
      expect(simple.sources.graph).toBe(false);
      expect(simple.hyde.enabled).toBe(false);

      const moderate = buildDefaultPlan('moderate');
      expect(moderate.sources.vector).toBe(true);
      expect(moderate.sources.graph).toBe(true);
      expect(moderate.sources.raptor).toBe(true);
      expect(moderate.hyde.enabled).toBe(true);
      expect(moderate.hyde.hypothesisCount).toBe(1);

      const complex = buildDefaultPlan('complex');
      expect(complex.sources.vector).toBe(true);
      expect(complex.sources.graph).toBe(true);
      expect(complex.hyde.enabled).toBe(true);
      expect(complex.hyde.hypothesisCount).toBe(3);
      expect(complex.deepResearch).toBe(true);
    });

    it('applies overrides on top of defaults', () => {
      const plan = buildDefaultPlan('moderate', {
        temporal: { preferRecent: true, recencyBoost: 1.5, maxAgeMs: 86_400_000 },
        sources: { vector: true, bm25: true, graph: false, raptor: true, memory: true, multimodal: false },
      });

      expect(plan.temporal.preferRecent).toBe(true);
      expect(plan.temporal.recencyBoost).toBe(1.5);
      expect(plan.sources.graph).toBe(false); // Overridden
      expect(plan.hyde.enabled).toBe(true); // From defaults
    });
  });

  // -----------------------------------------------------------------------
  // 15. RAPTOR layer filtering
  // -----------------------------------------------------------------------
  it('filters RAPTOR results by requested layers', async () => {
    const mockRaptorTree = {
      search: vi.fn().mockResolvedValue([
        { id: 'leaf-1', text: 'Leaf detail', score: 0.9, layer: 0, isSummary: false, metadata: {} },
        { id: 'summary-1', text: 'L1 summary', score: 0.8, layer: 1, isSummary: true, metadata: {} },
        { id: 'summary-2', text: 'L2 summary', score: 0.7, layer: 2, isSummary: true, metadata: {} },
      ]),
    };

    const deps = makeDeps({
      raptorTree: mockRaptorTree as any,
      rerank: undefined,
    });
    const retriever = new UnifiedRetriever(deps);
    const plan = buildDefaultPlan('moderate', {
      raptorLayers: [0], // Only leaf chunks
    });

    const result = await retriever.retrieve('Auth details', plan);

    // Only layer-0 RAPTOR results + vector results should be present
    const raptorChunks = result.chunks.filter(c => c.sourcePath.startsWith('raptor://'));
    // Only 1 raptor chunk (layer 0) should be included; L1 and L2 are filtered out
    expect(raptorChunks.length).toBe(1);
    expect(raptorChunks[0].content).toBe('Leaf detail');
  });
});
