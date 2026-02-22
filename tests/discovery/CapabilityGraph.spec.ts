/**
 * @file CapabilityGraph.spec.ts
 * @description Unit tests for the CapabilityGraph class.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { CapabilityGraph } from '../../src/discovery/CapabilityGraph.js';
import type { CapabilityDescriptor, PresetCoOccurrence } from '../../src/discovery/types.js';

// ---------------------------------------------------------------------------
// TEST DESCRIPTORS
// ---------------------------------------------------------------------------

function makeDescriptor(overrides: Partial<CapabilityDescriptor>): CapabilityDescriptor {
  return {
    id: 'tool:placeholder',
    kind: 'tool',
    name: 'placeholder',
    displayName: 'Placeholder',
    description: 'Placeholder capability',
    category: 'general',
    tags: [],
    requiredSecrets: [],
    requiredTools: [],
    available: true,
    sourceRef: { type: 'tool', toolName: 'placeholder' },
    ...overrides,
  };
}

const webSearch = makeDescriptor({
  id: 'tool:web-search',
  name: 'web-search',
  displayName: 'Web Search',
  description: 'Search the web for information',
  category: 'information',
  tags: ['search', 'web', 'research'],
});

const newsSearch = makeDescriptor({
  id: 'tool:news-search',
  name: 'news-search',
  displayName: 'News Search',
  description: 'Search for news articles',
  category: 'information',
  tags: ['search', 'web', 'news'],
});

const summarize = makeDescriptor({
  id: 'skill:summarize',
  kind: 'skill',
  name: 'summarize',
  displayName: 'Summarize',
  description: 'Summarize text content',
  category: 'productivity',
  tags: ['text', 'summarization'],
  requiredTools: ['web-search'],
  sourceRef: { type: 'skill', skillName: 'summarize' },
});

const telegram = makeDescriptor({
  id: 'channel:telegram',
  kind: 'channel',
  name: 'telegram',
  displayName: 'Telegram',
  description: 'Telegram messaging',
  category: 'communication',
  tags: ['messaging', 'chat'],
  sourceRef: { type: 'channel', platform: 'telegram' },
});

const discord = makeDescriptor({
  id: 'channel:discord',
  kind: 'channel',
  name: 'discord',
  displayName: 'Discord',
  description: 'Discord messaging',
  category: 'communication',
  tags: ['messaging', 'chat'],
  sourceRef: { type: 'channel', platform: 'discord' },
});

// ---------------------------------------------------------------------------
// TESTS
// ---------------------------------------------------------------------------

describe('CapabilityGraph', () => {
  let graph: CapabilityGraph;

  beforeEach(() => {
    graph = new CapabilityGraph();
  });

  // =========================================================================
  // buildGraph — node creation
  // =========================================================================

  describe('buildGraph', () => {
    it('adds all capabilities as nodes', () => {
      graph.buildGraph([webSearch, newsSearch, summarize]);
      expect(graph.nodeCount()).toBe(3);
    });

    it('adds DEPENDS_ON edges for skills with requiredTools', () => {
      graph.buildGraph([webSearch, summarize]);

      // summarize depends on web-search
      const related = graph.getRelated('skill:summarize');
      const dependsOn = related.find((r) => r.id === 'tool:web-search');
      expect(dependsOn).toBeDefined();
      expect(dependsOn!.relationType).toBe('DEPENDS_ON');
      expect(dependsOn!.weight).toBe(1.0);
    });

    it('adds COMPOSED_WITH edges from preset co-occurrences', () => {
      const presets: PresetCoOccurrence[] = [
        {
          presetName: 'researcher',
          capabilityIds: ['tool:web-search', 'skill:summarize'],
        },
      ];

      graph.buildGraph([webSearch, summarize], presets);

      const related = graph.getRelated('tool:web-search');
      // Should have both DEPENDS_ON (from summarize.requiredTools) and/or COMPOSED_WITH
      const composedEdge = related.find(
        (r) => r.id === 'skill:summarize',
      );
      expect(composedEdge).toBeDefined();
      // The DEPENDS_ON edge has weight 1.0 which is > COMPOSED_WITH 0.5,
      // so the edge type will be DEPENDS_ON (safeAddEdge keeps the higher weight)
      expect(composedEdge!.weight).toBe(1.0);
    });

    it('adds COMPOSED_WITH edges from presets for unrelated capabilities', () => {
      // Use capabilities with no shared tags so COMPOSED_WITH wins
      const toolA = makeDescriptor({
        id: 'tool:image-gen',
        name: 'image-gen',
        displayName: 'Image Gen',
        category: 'creative',
        tags: ['images'],
      });
      const toolB = makeDescriptor({
        id: 'tool:code-review',
        name: 'code-review',
        displayName: 'Code Review',
        category: 'developer',
        tags: ['code'],
      });

      const presets: PresetCoOccurrence[] = [
        {
          presetName: 'mixed-preset',
          capabilityIds: ['tool:image-gen', 'tool:code-review'],
        },
      ];

      graph.buildGraph([toolA, toolB], presets);

      const related = graph.getRelated('tool:image-gen');
      const composed = related.find((r) => r.id === 'tool:code-review');
      expect(composed).toBeDefined();
      expect(composed!.relationType).toBe('COMPOSED_WITH');
      expect(composed!.weight).toBe(0.5);
    });

    it('adds TAGGED_WITH edges for capabilities sharing >= 2 tags', () => {
      // webSearch and newsSearch share 'search' and 'web' tags (2 overlap)
      graph.buildGraph([webSearch, newsSearch]);

      const related = graph.getRelated('tool:web-search');
      const taggedWith = related.find(
        (r) => r.id === 'tool:news-search' && r.relationType === 'TAGGED_WITH',
      );
      // They share 2 tags, so TAGGED_WITH weight = 2 * 0.3 = 0.6
      // But they also share category+kind → SAME_CATEGORY weight = 0.1
      // TAGGED_WITH 0.6 > SAME_CATEGORY 0.1, so the edge should be TAGGED_WITH
      expect(taggedWith).toBeDefined();
      expect(taggedWith!.weight).toBe(0.6);
    });

    it('does not add TAGGED_WITH for < 2 shared tags', () => {
      const toolA = makeDescriptor({
        id: 'tool:a',
        name: 'a',
        category: 'cat-a',
        tags: ['only-one-shared'],
      });
      const toolB = makeDescriptor({
        id: 'tool:b',
        name: 'b',
        category: 'cat-b',
        tags: ['only-one-shared'],
      });

      graph.buildGraph([toolA, toolB]);

      const related = graph.getRelated('tool:a');
      const taggedWith = related.find((r) => r.relationType === 'TAGGED_WITH');
      expect(taggedWith).toBeUndefined();
    });

    it('adds SAME_CATEGORY edges for same-kind capabilities in same category', () => {
      // webSearch and newsSearch are both tool:information
      graph.buildGraph([webSearch, newsSearch]);

      const related = graph.getRelated('tool:web-search');
      const neighbor = related.find((r) => r.id === 'tool:news-search');
      expect(neighbor).toBeDefined();
      // Due to tag overlap, the edge type may be TAGGED_WITH (higher weight wins)
    });

    it('skips category edges for groups > 8', () => {
      // Create 10 tools in the same category
      const manyTools = Array.from({ length: 10 }, (_, i) =>
        makeDescriptor({
          id: `tool:tool-${i}`,
          name: `tool-${i}`,
          category: 'crowded',
          tags: [],
        }),
      );

      graph.buildGraph(manyTools);

      // With no tags and >8 in same kind+category, there should be no SAME_CATEGORY edges
      expect(graph.edgeCount()).toBe(0);
    });

    it('adds SAME_CATEGORY edges for groups of exactly 8', () => {
      const tools = Array.from({ length: 8 }, (_, i) =>
        makeDescriptor({
          id: `tool:tool-${i}`,
          name: `tool-${i}`,
          category: 'ok-group',
          tags: [],
        }),
      );

      graph.buildGraph(tools);

      // C(8,2) = 28 edges
      expect(graph.edgeCount()).toBe(28);
    });
  });

  // =========================================================================
  // getRelated
  // =========================================================================

  describe('getRelated', () => {
    it('returns empty for unknown node', () => {
      graph.buildGraph([webSearch]);
      const related = graph.getRelated('tool:nonexistent');
      expect(related).toEqual([]);
    });

    it('returns neighbors sorted by weight descending', () => {
      graph.buildGraph([webSearch, newsSearch, summarize]);

      const related = graph.getRelated('tool:web-search');
      // Verify sorted by weight descending
      for (let i = 0; i < related.length - 1; i++) {
        expect(related[i].weight).toBeGreaterThanOrEqual(related[i + 1].weight);
      }
    });
  });

  // =========================================================================
  // getSubgraph
  // =========================================================================

  describe('getSubgraph', () => {
    it('returns only edges within the node set', () => {
      graph.buildGraph([webSearch, newsSearch, summarize]);

      // Subgraph of webSearch and newsSearch only
      const sub = graph.getSubgraph(['tool:web-search', 'tool:news-search']);

      expect(sub.nodes).toHaveLength(2);
      expect(sub.nodes).toContain('tool:web-search');
      expect(sub.nodes).toContain('tool:news-search');

      // All edges should be between the two nodes in the subgraph
      for (const edge of sub.edges) {
        expect(sub.nodes).toContain(edge.sourceId);
        expect(sub.nodes).toContain(edge.targetId);
      }

      // No edge to summarize should be included
      const hasSummarize = sub.edges.some(
        (e) => e.sourceId === 'skill:summarize' || e.targetId === 'skill:summarize',
      );
      expect(hasSummarize).toBe(false);
    });

    it('filters out unknown node IDs', () => {
      graph.buildGraph([webSearch]);
      const sub = graph.getSubgraph(['tool:web-search', 'tool:nonexistent']);
      expect(sub.nodes).toHaveLength(1);
      expect(sub.nodes).toContain('tool:web-search');
    });
  });

  // =========================================================================
  // rerank
  // =========================================================================

  describe('rerank', () => {
    it('boosts co-present capabilities', () => {
      graph.buildGraph([webSearch, newsSearch, summarize]);

      const results = [
        { id: 'tool:web-search', score: 0.8 },
        { id: 'tool:news-search', score: 0.6 },
      ];

      const reranked = graph.rerank(results, 0.15);

      // Both should be boosted because they share edges
      const wsResult = reranked.find((r) => r.id === 'tool:web-search');
      const nsResult = reranked.find((r) => r.id === 'tool:news-search');
      expect(wsResult).toBeDefined();
      expect(nsResult).toBeDefined();
      // At least one should be boosted
      expect(reranked.some((r) => r.boosted)).toBe(true);
    });

    it('pulls in DEPENDS_ON neighbors not in original results', () => {
      graph.buildGraph([webSearch, summarize]);

      // Only summarize is in results, but it DEPENDS_ON web-search
      const results = [{ id: 'skill:summarize', score: 0.9 }];

      const reranked = graph.rerank(results, 0.15);

      // web-search should be pulled in as a boosted result
      const wsResult = reranked.find((r) => r.id === 'tool:web-search');
      expect(wsResult).toBeDefined();
      expect(wsResult!.boosted).toBe(true);
    });

    it('returns results sorted by score descending', () => {
      graph.buildGraph([webSearch, newsSearch, summarize]);

      const results = [
        { id: 'tool:web-search', score: 0.5 },
        { id: 'tool:news-search', score: 0.8 },
      ];

      const reranked = graph.rerank(results, 0.15);

      for (let i = 0; i < reranked.length - 1; i++) {
        expect(reranked[i].score).toBeGreaterThanOrEqual(reranked[i + 1].score);
      }
    });
  });

  // =========================================================================
  // clear
  // =========================================================================

  describe('clear', () => {
    it('resets to 0 nodes and edges', () => {
      graph.buildGraph([webSearch, newsSearch, summarize]);
      expect(graph.nodeCount()).toBeGreaterThan(0);

      graph.clear();

      expect(graph.nodeCount()).toBe(0);
      expect(graph.edgeCount()).toBe(0);
    });
  });
});
