/**
 * @file CapabilityContextAssembler.spec.ts
 * @description Unit tests for the CapabilityContextAssembler class.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { CapabilityContextAssembler } from '../../src/discovery/CapabilityContextAssembler.js';
import { CapabilityEmbeddingStrategy } from '../../src/discovery/CapabilityEmbeddingStrategy.js';
import type {
  CapabilityDescriptor,
  CapabilitySearchResult,
  CapabilityDiscoveryConfig,
  CapabilityDiscoveryResult,
} from '../../src/discovery/types.js';
import { DEFAULT_DISCOVERY_CONFIG } from '../../src/discovery/types.js';

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------

function makeDescriptor(overrides: Partial<CapabilityDescriptor> = {}): CapabilityDescriptor {
  return {
    id: 'tool:test',
    kind: 'tool',
    name: 'test',
    displayName: 'Test',
    description: 'A test capability',
    category: 'general',
    tags: [],
    requiredSecrets: [],
    requiredTools: [],
    available: true,
    sourceRef: { type: 'tool', toolName: 'test' },
    ...overrides,
  };
}

function makeSearchResult(
  overrides: Partial<CapabilityDescriptor> = {},
  score = 0.8,
): CapabilitySearchResult {
  return {
    descriptor: makeDescriptor(overrides),
    score,
  };
}

// ---------------------------------------------------------------------------
// TESTS
// ---------------------------------------------------------------------------

describe('CapabilityContextAssembler', () => {
  let assembler: CapabilityContextAssembler;
  let strategy: CapabilityEmbeddingStrategy;

  beforeEach(() => {
    strategy = new CapabilityEmbeddingStrategy();
    assembler = new CapabilityContextAssembler(strategy);
  });

  // =========================================================================
  // buildTier0
  // =========================================================================

  describe('buildTier0', () => {
    it('groups capabilities by category', () => {
      const caps: CapabilityDescriptor[] = [
        makeDescriptor({ id: 'tool:a', name: 'a', category: 'information' }),
        makeDescriptor({ id: 'tool:b', name: 'b', category: 'information' }),
        makeDescriptor({ id: 'tool:c', name: 'c', category: 'communication' }),
      ];

      const text = assembler.buildTier0(caps, 1);

      expect(text).toContain('Available capability categories:');
      expect(text).toContain('Information');
      expect(text).toContain('Communication');
      // information has 2, communication has 1
      expect(text).toContain('(2)');
      expect(text).toContain('(1)');
    });

    it('caches result for same version', () => {
      const caps: CapabilityDescriptor[] = [
        makeDescriptor({ id: 'tool:a', name: 'a', category: 'info' }),
      ];

      const text1 = assembler.buildTier0(caps, 1);
      const text2 = assembler.buildTier0(caps, 1);

      expect(text1).toBe(text2);
    });

    it('regenerates on version change', () => {
      const capsV1: CapabilityDescriptor[] = [
        makeDescriptor({ id: 'tool:a', name: 'a', category: 'info' }),
      ];
      const capsV2: CapabilityDescriptor[] = [
        makeDescriptor({ id: 'tool:a', name: 'a', category: 'info' }),
        makeDescriptor({ id: 'tool:b', name: 'b', category: 'dev' }),
      ];

      const text1 = assembler.buildTier0(capsV1, 1);
      const text2 = assembler.buildTier0(capsV2, 2);

      expect(text1).not.toBe(text2);
      expect(text2).toContain('Dev');
    });

    it('shows first 4 names then +N more for large categories', () => {
      const caps: CapabilityDescriptor[] = Array.from({ length: 6 }, (_, i) =>
        makeDescriptor({ id: `tool:t${i}`, name: `tool-${i}`, category: 'big' }),
      );

      const text = assembler.buildTier0(caps, 1);
      expect(text).toContain('(+2 more)');
      expect(text).toContain('(6)');
    });
  });

  // =========================================================================
  // assemble
  // =========================================================================

  describe('assemble', () => {
    const tier0Text = 'Available capability categories:\n- General (1)';

    it('respects tier1TokenBudget', () => {
      // Create many results that would exceed a small budget
      const results: CapabilitySearchResult[] = Array.from({ length: 20 }, (_, i) =>
        makeSearchResult(
          {
            id: `tool:t${i}`,
            name: `tool-${i}`,
            description: 'A'.repeat(100), // ~25 tokens each line
          },
          0.9 - i * 0.01,
        ),
      );

      const config: CapabilityDiscoveryConfig = {
        ...DEFAULT_DISCOVERY_CONFIG,
        tier1TokenBudget: 50, // Very small budget
        tier1TopK: 20,
        tier1MinRelevance: 0,
      };

      const result = assembler.assemble(tier0Text, results, config);

      // Should be limited by token budget, not by count
      expect(result.tier1.length).toBeLessThan(20);
      expect(result.tokenEstimate.tier1Tokens).toBeLessThanOrEqual(50);
    });

    it('respects tier2TokenBudget', () => {
      const results: CapabilitySearchResult[] = Array.from({ length: 5 }, (_, i) =>
        makeSearchResult(
          {
            id: `tool:t${i}`,
            name: `tool-${i}`,
            description: 'A very long description. '.repeat(30),
            fullSchema: {
              type: 'object',
              properties: {
                a: { type: 'string', description: 'Param a' },
                b: { type: 'string', description: 'Param b' },
              },
            },
            fullContent: 'Detailed instructions. '.repeat(50),
          },
          0.9,
        ),
      );

      const config: CapabilityDiscoveryConfig = {
        ...DEFAULT_DISCOVERY_CONFIG,
        tier1TokenBudget: 5000,
        tier2TokenBudget: 100, // Very small budget for tier2
        tier1TopK: 5,
        tier2TopK: 5,
        tier1MinRelevance: 0,
      };

      const result = assembler.assemble(tier0Text, results, config);

      expect(result.tier2.length).toBeLessThan(5);
      expect(result.tokenEstimate.tier2Tokens).toBeLessThanOrEqual(100);
    });

    it('filters by tier1MinRelevance', () => {
      const results: CapabilitySearchResult[] = [
        makeSearchResult({ id: 'tool:high', name: 'high' }, 0.9),
        makeSearchResult({ id: 'tool:medium', name: 'medium' }, 0.5),
        makeSearchResult({ id: 'tool:low', name: 'low' }, 0.1),
      ];

      const config: CapabilityDiscoveryConfig = {
        ...DEFAULT_DISCOVERY_CONFIG,
        tier1MinRelevance: 0.4,
        tier1TopK: 10,
      };

      const result = assembler.assemble(tier0Text, results, config);

      // Only high and medium should pass the 0.4 threshold
      expect(result.tier1.length).toBe(2);
      expect(result.tier1[0].capability.name).toBe('high');
      expect(result.tier1[1].capability.name).toBe('medium');
    });

    it('limits tier1 to tier1TopK', () => {
      const results: CapabilitySearchResult[] = Array.from({ length: 10 }, (_, i) =>
        makeSearchResult({ id: `tool:t${i}`, name: `t${i}` }, 0.9),
      );

      const config: CapabilityDiscoveryConfig = {
        ...DEFAULT_DISCOVERY_CONFIG,
        tier1TopK: 3,
        tier1MinRelevance: 0,
        tier1TokenBudget: 10000, // high enough to not be the limiting factor
      };

      const result = assembler.assemble(tier0Text, results, config);

      expect(result.tier1.length).toBeLessThanOrEqual(3);
    });

    it('takes top tier2TopK from tier1 for full expansion', () => {
      const results: CapabilitySearchResult[] = [
        makeSearchResult({ id: 'tool:first', name: 'first', description: 'First tool' }, 0.95),
        makeSearchResult({ id: 'tool:second', name: 'second', description: 'Second tool' }, 0.90),
        makeSearchResult({ id: 'tool:third', name: 'third', description: 'Third tool' }, 0.85),
      ];

      const config: CapabilityDiscoveryConfig = {
        ...DEFAULT_DISCOVERY_CONFIG,
        tier1TopK: 3,
        tier2TopK: 2,
        tier1MinRelevance: 0,
        tier1TokenBudget: 10000,
        tier2TokenBudget: 10000,
      };

      const result = assembler.assemble(tier0Text, results, config);

      // tier2 should have at most 2 (tier2TopK)
      expect(result.tier2.length).toBeLessThanOrEqual(2);
      if (result.tier2.length === 2) {
        expect(result.tier2[0].capability.name).toBe('first');
        expect(result.tier2[1].capability.name).toBe('second');
      }
    });

    it('returns correct token estimates', () => {
      const results: CapabilitySearchResult[] = [
        makeSearchResult({ id: 'tool:a', name: 'a' }, 0.9),
      ];

      const result = assembler.assemble(tier0Text, results);

      expect(result.tokenEstimate.tier0Tokens).toBeGreaterThan(0);
      expect(result.tokenEstimate.totalTokens).toBe(
        result.tokenEstimate.tier0Tokens +
        result.tokenEstimate.tier1Tokens +
        result.tokenEstimate.tier2Tokens,
      );
    });

    it('includes diagnostics', () => {
      const results: CapabilitySearchResult[] = [
        makeSearchResult({ id: 'tool:a', name: 'a' }, 0.9),
      ];

      const timings = { embeddingTimeMs: 42, graphTraversalTimeMs: 7 };
      const result = assembler.assemble(tier0Text, results, DEFAULT_DISCOVERY_CONFIG, timings);

      expect(result.diagnostics.embeddingTimeMs).toBe(42);
      expect(result.diagnostics.graphTraversalTimeMs).toBe(7);
      expect(result.diagnostics.candidatesScanned).toBe(1);
      expect(result.diagnostics.queryTimeMs).toBeGreaterThanOrEqual(0);
    });
  });

  // =========================================================================
  // renderForPrompt
  // =========================================================================

  describe('renderForPrompt', () => {
    it('includes all 3 tiers', () => {
      const result: CapabilityDiscoveryResult = {
        tier0: 'Tier 0 text',
        tier1: [
          {
            capability: makeDescriptor({ id: 'tool:a', name: 'a' }),
            relevanceScore: 0.9,
            summaryText: '1. a (tool): A test capability',
          },
        ],
        tier2: [
          {
            capability: makeDescriptor({ id: 'tool:a', name: 'a' }),
            fullText: '# Test\nFull detail here',
          },
        ],
        tokenEstimate: { tier0Tokens: 10, tier1Tokens: 20, tier2Tokens: 30, totalTokens: 60 },
        diagnostics: {
          queryTimeMs: 1,
          embeddingTimeMs: 1,
          graphTraversalTimeMs: 1,
          candidatesScanned: 1,
          capabilitiesRetrieved: 1,
        },
      };

      const rendered = assembler.renderForPrompt(result);

      expect(rendered).toContain('Tier 0 text');
      expect(rendered).toContain('Relevant capabilities:');
      expect(rendered).toContain('1. a (tool): A test capability');
      expect(rendered).toContain('--- Detailed Capability Reference ---');
      expect(rendered).toContain('# Test\nFull detail here');
    });

    it('handles empty tier1/tier2', () => {
      const result: CapabilityDiscoveryResult = {
        tier0: 'Tier 0 only',
        tier1: [],
        tier2: [],
        tokenEstimate: { tier0Tokens: 10, tier1Tokens: 0, tier2Tokens: 0, totalTokens: 10 },
        diagnostics: {
          queryTimeMs: 0,
          embeddingTimeMs: 0,
          graphTraversalTimeMs: 0,
          candidatesScanned: 0,
          capabilitiesRetrieved: 0,
        },
      };

      const rendered = assembler.renderForPrompt(result);

      expect(rendered).toContain('Tier 0 only');
      expect(rendered).not.toContain('Relevant capabilities:');
      expect(rendered).not.toContain('--- Detailed Capability Reference ---');
    });
  });

  // =========================================================================
  // invalidateCache
  // =========================================================================

  describe('invalidateCache', () => {
    it('forces regeneration of tier0', () => {
      const caps: CapabilityDescriptor[] = [
        makeDescriptor({ id: 'tool:a', name: 'a', category: 'info' }),
      ];

      const text1 = assembler.buildTier0(caps, 1);

      // Invalidate and rebuild with same version — should still regenerate
      assembler.invalidateCache();

      const capsUpdated: CapabilityDescriptor[] = [
        makeDescriptor({ id: 'tool:a', name: 'a', category: 'info' }),
        makeDescriptor({ id: 'tool:b', name: 'b', category: 'dev' }),
      ];

      // Same version 1 but cache was invalidated, so passing version 1
      // would normally return cached, but invalidateCache resets cachedTier0Version to 0
      // so version 1 !== 0, and it regenerates
      const text2 = assembler.buildTier0(capsUpdated, 1);

      expect(text2).not.toBe(text1);
      expect(text2).toContain('Dev');
    });
  });
});
