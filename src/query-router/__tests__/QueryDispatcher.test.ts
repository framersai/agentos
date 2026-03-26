/**
 * @fileoverview Tests for QueryDispatcher — routes classified queries to the
 * tier-appropriate retrieval pipeline with graceful fallbacks.
 *
 * All retrieval dependencies are vi.fn() mocks injected via QueryDispatcherDeps.
 */

import type {
  RetrievedChunk,
  QueryRouterEventUnion,
  QueryTier,
} from '../types.js';
import { QueryDispatcher } from '../QueryDispatcher.js';
import type { QueryDispatcherDeps } from '../QueryDispatcher.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Factory for a realistic RetrievedChunk with sensible defaults. */
function makeChunk(overrides: Partial<RetrievedChunk> = {}): RetrievedChunk {
  return {
    id: overrides.id ?? 'chunk-1',
    content: overrides.content ?? 'Some retrieved content',
    heading: overrides.heading ?? 'Section A',
    sourcePath: overrides.sourcePath ?? '/docs/file.md',
    relevanceScore: overrides.relevanceScore ?? 0.85,
    matchType: overrides.matchType ?? 'vector',
  };
}

/** Creates a standard mock deps object with all vi.fn() stubs. */
function makeDeps(overrides: Partial<QueryDispatcherDeps> = {}): QueryDispatcherDeps {
  return {
    vectorSearch: vi.fn().mockResolvedValue([
      makeChunk({ id: 'v1', relevanceScore: 0.9 }),
      makeChunk({ id: 'v2', relevanceScore: 0.8 }),
      makeChunk({ id: 'v3', relevanceScore: 0.7 }),
    ]),
    graphExpand: vi.fn().mockResolvedValue([
      makeChunk({ id: 'g1', relevanceScore: 0.75, matchType: 'graph' }),
    ]),
    rerank: vi.fn().mockImplementation(
      async (_q: string, chunks: RetrievedChunk[], topN: number) =>
        chunks.slice(0, topN),
    ),
    deepResearch: vi.fn().mockResolvedValue({
      synthesis: 'Deep research synthesis.',
      sources: [
        makeChunk({ id: 'r1', relevanceScore: 0.95, matchType: 'research' }),
      ],
    }),
    emit: vi.fn(),
    graphEnabled: true,
    deepResearchEnabled: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('QueryDispatcher', () => {
  // -----------------------------------------------------------------------
  // 1. T0 — trivial tier returns empty immediately
  // -----------------------------------------------------------------------
  it('returns empty result for tier 0', async () => {
    const deps = makeDeps();
    const dispatcher = new QueryDispatcher(deps);

    const result = await dispatcher.dispatch('What is TypeScript?', 0 as QueryTier);

    expect(result.chunks).toEqual([]);
    expect(result.durationMs).toBe(0);

    // No retrieval functions should be called
    expect(deps.vectorSearch).not.toHaveBeenCalled();
    expect(deps.graphExpand).not.toHaveBeenCalled();
    expect(deps.rerank).not.toHaveBeenCalled();
    expect(deps.deepResearch).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // 2. T1 — vector-only retrieval with topK=5
  // -----------------------------------------------------------------------
  it('does vector-only retrieval for tier 1 (topK=5)', async () => {
    const deps = makeDeps();
    const dispatcher = new QueryDispatcher(deps);

    const result = await dispatcher.dispatch('What port does the API run on?', 1 as QueryTier);

    // Vector search called with topK=5
    expect(deps.vectorSearch).toHaveBeenCalledWith('What port does the API run on?', 5);

    // No graph, no rerank, no deep research
    expect(deps.graphExpand).not.toHaveBeenCalled();
    expect(deps.rerank).not.toHaveBeenCalled();
    expect(deps.deepResearch).not.toHaveBeenCalled();

    // Should return the vector search results
    expect(result.chunks.length).toBe(3); // mock returns 3
    expect(result.durationMs).toBeGreaterThanOrEqual(0);

    // Should emit retrieve:start and retrieve:vector and retrieve:complete events
    const emittedTypes = (deps.emit as ReturnType<typeof vi.fn>).mock.calls.map(
      (call: [QueryRouterEventUnion]) => call[0].type,
    );
    expect(emittedTypes).toContain('retrieve:start');
    expect(emittedTypes).toContain('retrieve:vector');
    expect(emittedTypes).toContain('retrieve:complete');
  });

  // -----------------------------------------------------------------------
  // 3. T2 — hybrid: vector(15) + graph + rerank(5)
  // -----------------------------------------------------------------------
  it('does hybrid retrieval for tier 2 (vector topK=15 + graph + rerank to 5)', async () => {
    const deps = makeDeps();
    const dispatcher = new QueryDispatcher(deps);

    const result = await dispatcher.dispatch(
      'How does auth flow from frontend to backend?',
      2 as QueryTier,
    );

    // Vector search called with topK=15
    expect(deps.vectorSearch).toHaveBeenCalledWith(
      'How does auth flow from frontend to backend?',
      15,
    );

    // Graph expand called with vector results
    expect(deps.graphExpand).toHaveBeenCalled();

    // Rerank called with merged+deduped chunks, topN=5
    expect(deps.rerank).toHaveBeenCalledWith(
      'How does auth flow from frontend to backend?',
      expect.any(Array),
      5,
    );
    // The merged array should include both vector and graph chunks
    const rerankArgs = (deps.rerank as ReturnType<typeof vi.fn>).mock.calls[0];
    const mergedChunks = rerankArgs[1] as RetrievedChunk[];
    const chunkIds = mergedChunks.map((c) => c.id);
    expect(chunkIds).toContain('v1');
    expect(chunkIds).toContain('g1');

    // No deep research for T2
    expect(deps.deepResearch).not.toHaveBeenCalled();

    // Result should contain reranked chunks
    expect(result.chunks.length).toBeGreaterThan(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);

    // Events emitted
    const emittedTypes = (deps.emit as ReturnType<typeof vi.fn>).mock.calls.map(
      (call: [QueryRouterEventUnion]) => call[0].type,
    );
    expect(emittedTypes).toContain('retrieve:start');
    expect(emittedTypes).toContain('retrieve:vector');
    expect(emittedTypes).toContain('retrieve:graph');
    expect(emittedTypes).toContain('retrieve:rerank');
    expect(emittedTypes).toContain('retrieve:complete');
  });

  // -----------------------------------------------------------------------
  // 4. T3 — hybrid + deep research
  // -----------------------------------------------------------------------
  it('does hybrid + deep research for tier 3', async () => {
    const deps = makeDeps();
    const dispatcher = new QueryDispatcher(deps);

    const result = await dispatcher.dispatch(
      'Compare all caching strategies in this codebase.',
      3 as QueryTier,
      ['web', 'docs'],
    );

    // Vector + graph + rerank should all be called (same as T2)
    expect(deps.vectorSearch).toHaveBeenCalledWith(
      'Compare all caching strategies in this codebase.',
      15,
    );
    expect(deps.graphExpand).toHaveBeenCalled();
    expect(deps.rerank).toHaveBeenCalled();

    // Deep research called with query and suggestedSources
    expect(deps.deepResearch).toHaveBeenCalledWith(
      'Compare all caching strategies in this codebase.',
      ['web', 'docs'],
    );

    // Result should include research synthesis
    expect(result.researchSynthesis).toBe('Deep research synthesis.');

    // Research chunks should be merged into result
    const researchChunkIds = result.chunks
      .filter((c) => c.matchType === 'research')
      .map((c) => c.id);
    expect(researchChunkIds).toContain('r1');

    expect(result.durationMs).toBeGreaterThanOrEqual(0);

    // Events emitted — should include research events
    const emittedTypes = (deps.emit as ReturnType<typeof vi.fn>).mock.calls.map(
      (call: [QueryRouterEventUnion]) => call[0].type,
    );
    expect(emittedTypes).toContain('research:start');
    expect(emittedTypes).toContain('research:complete');
  });

  // -----------------------------------------------------------------------
  // 5. Fallback: graph fails → vector-only, emit fallback event
  // -----------------------------------------------------------------------
  it('falls back to vector-only when graph expand fails', async () => {
    const deps = makeDeps({
      graphExpand: vi.fn().mockRejectedValue(new Error('Graph service unavailable')),
    });
    const dispatcher = new QueryDispatcher(deps);

    const result = await dispatcher.dispatch(
      'How does auth flow?',
      2 as QueryTier,
    );

    // Vector search still called
    expect(deps.vectorSearch).toHaveBeenCalled();

    // Graph was attempted but failed
    expect(deps.graphExpand).toHaveBeenCalled();

    // Rerank still called with vector-only results (no graph chunks)
    expect(deps.rerank).toHaveBeenCalled();
    const rerankArgs = (deps.rerank as ReturnType<typeof vi.fn>).mock.calls[0];
    const mergedChunks = rerankArgs[1] as RetrievedChunk[];
    const graphChunks = mergedChunks.filter((c) => c.matchType === 'graph');
    expect(graphChunks).toEqual([]);

    // Should still produce a result
    expect(result.chunks.length).toBeGreaterThan(0);

    // Fallback event emitted
    const fallbackEvents = (deps.emit as ReturnType<typeof vi.fn>).mock.calls
      .map((call: [QueryRouterEventUnion]) => call[0])
      .filter((e: QueryRouterEventUnion) => e.type === 'retrieve:fallback');
    expect(fallbackEvents.length).toBeGreaterThanOrEqual(1);
    expect(fallbackEvents[0]).toMatchObject({
      type: 'retrieve:fallback',
      strategy: 'graph-skip',
      reason: expect.stringContaining('Graph'),
    });
  });

  // -----------------------------------------------------------------------
  // 6. Fallback: deep research fails → downgrades T3 to T2, emit fallback
  // -----------------------------------------------------------------------
  it('downgrades T3 to T2 when deep research fails', async () => {
    const deps = makeDeps({
      deepResearch: vi.fn().mockRejectedValue(new Error('Research API timeout')),
    });
    const dispatcher = new QueryDispatcher(deps);

    const result = await dispatcher.dispatch(
      'Compare all caching strategies.',
      3 as QueryTier,
    );

    // Vector + graph + rerank still called (T2 pipeline intact)
    expect(deps.vectorSearch).toHaveBeenCalled();
    expect(deps.graphExpand).toHaveBeenCalled();
    expect(deps.rerank).toHaveBeenCalled();

    // Deep research was attempted but failed
    expect(deps.deepResearch).toHaveBeenCalled();

    // No research synthesis in the result
    expect(result.researchSynthesis).toBeUndefined();

    // Should still return T2 results
    expect(result.chunks.length).toBeGreaterThan(0);

    // Fallback event emitted
    const fallbackEvents = (deps.emit as ReturnType<typeof vi.fn>).mock.calls
      .map((call: [QueryRouterEventUnion]) => call[0])
      .filter((e: QueryRouterEventUnion) => e.type === 'retrieve:fallback');
    expect(fallbackEvents.length).toBeGreaterThanOrEqual(1);
    const researchFallback = fallbackEvents.find(
      (e) => (e as { strategy: string }).strategy === 'research-skip',
    );
    expect(researchFallback).toBeDefined();
  });
});
