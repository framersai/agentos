/**
 * @fileoverview Unit tests for token-budgeted memory prompt assembly.
 * Tests budget allocation, overflow redistribution, and personality formatting.
 */

import { describe, it, expect } from 'vitest';
import { assembleMemoryContext, type MemoryAssemblerInput } from '../../src/memory/prompt/MemoryPromptAssembler';
import type { ScoredMemoryTrace } from '../../src/memory/types';

function makeScoredTrace(overrides: Partial<ScoredMemoryTrace> = {}): ScoredMemoryTrace {
  return {
    id: `trace-${Math.random().toString(36).slice(2, 6)}`,
    type: 'semantic',
    scope: 'user',
    scopeId: 'agent-1',
    content: 'A sample memory trace content for testing purposes.',
    entities: [],
    tags: [],
    provenance: { sourceType: 'user_statement', sourceTimestamp: Date.now(), confidence: 0.8, verificationCount: 0 },
    emotionalContext: { valence: 0, arousal: 0.5, dominance: 0, intensity: 0, gmiMood: '' },
    encodingStrength: 0.7,
    stability: 3_600_000,
    retrievalCount: 1,
    lastAccessedAt: Date.now(),
    accessCount: 2,
    reinforcementInterval: 3_600_000,
    associatedTraceIds: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    isActive: true,
    retrievalScore: 0.8,
    scoreBreakdown: {
      strengthScore: 0.7, similarityScore: 0.85, recencyScore: 0.5,
      emotionalCongruenceScore: 0.3, graphActivationScore: 0, importanceScore: 0.6,
    },
    ...overrides,
  };
}

describe('MemoryPromptAssembler', () => {
  describe('assembleMemoryContext', () => {
    it('returns valid AssembledMemoryContext shape', () => {
      const input: MemoryAssemblerInput = {
        totalTokenBudget: 1000,
        traits: {},
        workingMemoryText: 'Some active context',
        retrievedTraces: [makeScoredTrace()],
      };

      const result = assembleMemoryContext(input);
      expect(result).toHaveProperty('contextText');
      expect(result).toHaveProperty('tokensUsed');
      expect(result).toHaveProperty('allocation');
      expect(result).toHaveProperty('includedMemoryIds');
    });

    it('respects total token budget', () => {
      const traces = Array.from({ length: 20 }, (_, i) =>
        makeScoredTrace({ id: `t-${i}`, content: 'A'.repeat(400) }),
      );

      const input: MemoryAssemblerInput = {
        totalTokenBudget: 200,
        traits: {},
        retrievedTraces: traces,
      };

      const result = assembleMemoryContext(input);
      expect(result.tokensUsed).toBeLessThanOrEqual(200);
    });

    it('includes working memory section when provided', () => {
      const input: MemoryAssemblerInput = {
        totalTokenBudget: 1000,
        traits: {},
        workingMemoryText: 'Active scratchpad state here.',
      };

      const result = assembleMemoryContext(input);
      expect(result.contextText).toContain('Active Context');
      expect(result.contextText).toContain('Active scratchpad state here.');
    });

    it('separates episodic and semantic traces into different sections', () => {
      const input: MemoryAssemblerInput = {
        totalTokenBudget: 2000,
        traits: {},
        retrievedTraces: [
          makeScoredTrace({ type: 'semantic', content: 'semantic fact' }),
          makeScoredTrace({ type: 'episodic', content: 'episodic event' }),
        ],
      };

      const result = assembleMemoryContext(input);
      expect(result.contextText).toContain('Relevant Memories');
      expect(result.contextText).toContain('Recent Experiences');
    });

    it('overflows unused Batch 2 budgets into semantic recall', () => {
      // When no prospective/graph/observation data, their budgets flow to semantic
      const input: MemoryAssemblerInput = {
        totalTokenBudget: 1000,
        traits: {},
        retrievedTraces: Array.from({ length: 10 }, () => makeScoredTrace()),
        prospectiveAlerts: [],
        graphContext: [],
        observationNotes: [],
      };

      const result = assembleMemoryContext(input);
      // Should include more semantic traces since overflow is available
      expect(result.includedMemoryIds.length).toBeGreaterThan(0);
    });

    it('includes prospective alerts when provided', () => {
      const input: MemoryAssemblerInput = {
        totalTokenBudget: 1000,
        traits: {},
        prospectiveAlerts: ['Remember to follow up on the report'],
      };

      const result = assembleMemoryContext(input);
      expect(result.contextText).toContain('Reminders');
      expect(result.contextText).toContain('Remember to follow up');
    });

    it('includes graph context when provided', () => {
      const input: MemoryAssemblerInput = {
        totalTokenBudget: 1000,
        traits: {},
        graphContext: ['Associated memory: user prefers dark mode'],
      };

      const result = assembleMemoryContext(input);
      expect(result.contextText).toContain('Related Context');
    });

    it('includes observation notes when provided', () => {
      const input: MemoryAssemblerInput = {
        totalTokenBudget: 1000,
        traits: {},
        observationNotes: ['User seems frustrated with the API'],
      };

      const result = assembleMemoryContext(input);
      expect(result.contextText).toContain('Observations');
    });

    it('returns empty context when budget is 0', () => {
      const result = assembleMemoryContext({
        totalTokenBudget: 0,
        traits: {},
        retrievedTraces: [makeScoredTrace()],
      });
      expect(result.tokensUsed).toBe(0);
    });

    it('tracks included memory IDs', () => {
      const input: MemoryAssemblerInput = {
        totalTokenBudget: 2000,
        traits: {},
        retrievedTraces: [
          makeScoredTrace({ id: 'included-1' }),
          makeScoredTrace({ id: 'included-2' }),
        ],
      };

      const result = assembleMemoryContext(input);
      expect(result.includedMemoryIds).toContain('included-1');
      expect(result.includedMemoryIds).toContain('included-2');
    });
  });
});
