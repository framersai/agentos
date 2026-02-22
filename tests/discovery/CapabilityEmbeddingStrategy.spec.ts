/**
 * @file CapabilityEmbeddingStrategy.spec.ts
 * @description Unit tests for the CapabilityEmbeddingStrategy class.
 */

import { describe, it, expect } from 'vitest';
import { CapabilityEmbeddingStrategy } from '../../src/discovery/CapabilityEmbeddingStrategy.js';
import type { CapabilityDescriptor } from '../../src/discovery/types.js';

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------

function makeDescriptor(overrides: Partial<CapabilityDescriptor> = {}): CapabilityDescriptor {
  return {
    id: 'tool:web-search',
    kind: 'tool',
    name: 'web-search',
    displayName: 'Web Search',
    description: 'Search the web for information',
    category: 'information',
    tags: ['search', 'web', 'research'],
    requiredSecrets: ['SERPER_API_KEY'],
    requiredTools: [],
    available: true,
    sourceRef: { type: 'tool', toolName: 'web-search' },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// TESTS
// ---------------------------------------------------------------------------

describe('CapabilityEmbeddingStrategy', () => {
  const strategy = new CapabilityEmbeddingStrategy();

  // =========================================================================
  // buildEmbeddingText
  // =========================================================================

  describe('buildEmbeddingText', () => {
    it('includes displayName when different from name', () => {
      const cap = makeDescriptor({ name: 'web-search', displayName: 'Web Search' });
      const text = strategy.buildEmbeddingText(cap);
      expect(text).toContain('Web Search (web-search)');
    });

    it('uses name alone when displayName equals name', () => {
      const cap = makeDescriptor({ name: 'web-search', displayName: 'web-search' });
      const text = strategy.buildEmbeddingText(cap);
      expect(text).toContain('web-search');
      expect(text).not.toContain('web-search (web-search)');
    });

    it('includes category and tags', () => {
      const cap = makeDescriptor();
      const text = strategy.buildEmbeddingText(cap);
      expect(text).toContain('Category: information');
      expect(text).toContain('Use cases: search, web, research');
    });

    it('extracts parameter names from fullSchema', () => {
      const cap = makeDescriptor({
        kind: 'tool',
        fullSchema: {
          type: 'object',
          properties: {
            query: { type: 'string' },
            maxResults: { type: 'number' },
            language: { type: 'string' },
          },
        },
      });
      const text = strategy.buildEmbeddingText(cap);
      expect(text).toContain('Parameters: query, maxResults, language');
    });

    it('includes requiredTools', () => {
      const cap = makeDescriptor({
        requiredTools: ['git', 'gh'],
      });
      const text = strategy.buildEmbeddingText(cap);
      expect(text).toContain('Requires: git, gh');
    });

    it('omits empty sections gracefully', () => {
      const cap = makeDescriptor({
        tags: [],
        requiredTools: [],
        fullSchema: undefined,
      });
      const text = strategy.buildEmbeddingText(cap);
      expect(text).not.toContain('Use cases:');
      expect(text).not.toContain('Parameters:');
      expect(text).not.toContain('Requires:');
    });
  });

  // =========================================================================
  // buildCompactSummary
  // =========================================================================

  describe('buildCompactSummary', () => {
    it('truncates long descriptions at 120 chars', () => {
      const longDesc = 'A'.repeat(200);
      const cap = makeDescriptor({ description: longDesc });
      const summary = strategy.buildCompactSummary(cap);
      // Truncated form: first 117 chars + '...'
      expect(summary).toContain('A'.repeat(117) + '...');
      expect(summary).not.toContain('A'.repeat(118));
    });

    it('keeps short descriptions intact', () => {
      const cap = makeDescriptor({ description: 'Short description' });
      const summary = strategy.buildCompactSummary(cap);
      expect(summary).toContain('Short description');
    });

    it('shows unavailability warning when available is false', () => {
      const cap = makeDescriptor({ available: false });
      const summary = strategy.buildCompactSummary(cap);
      expect(summary).toContain('[not available');
    });

    it('does not show unavailability warning when available is true', () => {
      const cap = makeDescriptor({ available: true });
      const summary = strategy.buildCompactSummary(cap);
      expect(summary).not.toContain('[not available');
    });

    it('shows top 3 params only for tools with schema', () => {
      const cap = makeDescriptor({
        kind: 'tool',
        fullSchema: {
          type: 'object',
          properties: {
            query: { type: 'string' },
            maxResults: { type: 'number' },
            language: { type: 'string' },
            region: { type: 'string' },
            outputMode: { type: 'string' },
          },
        },
      });
      const summary = strategy.buildCompactSummary(cap);
      expect(summary).toContain('Params: query, maxResults, language');
      // The 4th and 5th params should not appear in the summary
      expect(summary).not.toContain('region');
      expect(summary).not.toContain('outputMode');
    });

    it('includes name and kind', () => {
      const cap = makeDescriptor({ name: 'web-search', kind: 'tool' });
      const summary = strategy.buildCompactSummary(cap);
      expect(summary).toContain('web-search (tool)');
    });

    it('includes requiredTools in summary', () => {
      const cap = makeDescriptor({ requiredTools: ['git'] });
      const summary = strategy.buildCompactSummary(cap);
      expect(summary).toContain('Requires: git');
    });
  });

  // =========================================================================
  // buildFullDetailText
  // =========================================================================

  describe('buildFullDetailText', () => {
    it('includes full schema and skill content', () => {
      const cap = makeDescriptor({
        kind: 'tool',
        fullSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query' },
          },
          required: ['query'],
        },
        fullContent: '# Web Search Skill\nUse this to search the web.',
      });
      const text = strategy.buildFullDetailText(cap);
      expect(text).toContain('## Input Schema');
      expect(text).toContain('query (string, required): Search query');
      expect(text).toContain('## Skill Instructions');
      expect(text).toContain('# Web Search Skill');
    });

    it('includes heading with displayName', () => {
      const cap = makeDescriptor({ displayName: 'Web Search' });
      const text = strategy.buildFullDetailText(cap);
      expect(text).toContain('# Web Search');
    });

    it('includes kind and category', () => {
      const cap = makeDescriptor({ kind: 'tool', category: 'information' });
      const text = strategy.buildFullDetailText(cap);
      expect(text).toContain('Kind: tool | Category: information');
    });

    it('includes required secrets', () => {
      const cap = makeDescriptor({ requiredSecrets: ['SERPER_API_KEY'] });
      const text = strategy.buildFullDetailText(cap);
      expect(text).toContain('Required secrets: SERPER_API_KEY');
    });

    it('includes tags', () => {
      const cap = makeDescriptor({ tags: ['search', 'web'] });
      const text = strategy.buildFullDetailText(cap);
      expect(text).toContain('Tags: search, web');
    });

    it('handles cap with no optional fields', () => {
      const cap = makeDescriptor({
        kind: 'skill',
        tags: [],
        requiredSecrets: [],
        requiredTools: [],
        fullSchema: undefined,
        fullContent: undefined,
      });
      const text = strategy.buildFullDetailText(cap);
      // Should still have the heading and description
      expect(text).toContain('# Web Search');
      expect(text).toContain('Search the web for information');
      // Should not have optional sections
      expect(text).not.toContain('## Input Schema');
      expect(text).not.toContain('## Skill Instructions');
      expect(text).not.toContain('Required secrets:');
      expect(text).not.toContain('Tags:');
    });
  });
});
