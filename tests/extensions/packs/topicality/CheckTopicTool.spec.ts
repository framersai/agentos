/**
 * @fileoverview Unit tests for `CheckTopicTool`.
 *
 * Tests verify:
 *  - Has correct ITool properties (id, name, displayName, category, etc.)
 *  - inputSchema has text as a required string property
 *  - execute returns topic match data for on-topic text
 *  - execute returns off-topic result
 *  - execute returns forbidden match when text matches forbidden topic
 *  - execute returns error for empty text
 *  - execute handles embedding errors gracefully
 */

import { describe, it, expect, vi } from 'vitest';
import { CheckTopicTool } from '../../../../src/extensions/packs/topicality/tools/CheckTopicTool';
import { TopicEmbeddingIndex } from '../../../../src/extensions/packs/topicality/TopicEmbeddingIndex';
import type { TopicDescriptor } from '../../../../src/extensions/packs/topicality/types';
import type { ToolExecutionContext } from '../../../../src/core/tools/ITool';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

/**
 * Mock embedding function that maps known text patterns to controlled vectors.
 *
 * - Billing-related text → [1, 0, 0] (aligns with allowed topic)
 * - Violence-related text → [0, 1, 0] (aligns with forbidden topic)
 * - Off-topic text → [0, 0, 1] (orthogonal)
 */
function createMockEmbeddingFn(): (texts: string[]) => Promise<number[][]> {
  return vi.fn(async (texts: string[]): Promise<number[][]> => {
    return texts.map((text) => {
      const lower = text.toLowerCase();

      if (lower.includes('billing') || lower.includes('invoice') || lower.includes('charge')) {
        return [1, 0, 0];
      }
      if (lower.includes('violence') || lower.includes('harm') || lower.includes('hurt')) {
        return [0, 1, 0];
      }
      // On-topic user message.
      if (lower.includes('on-topic')) {
        return [0.95, 0.1, 0];
      }
      // Forbidden user message.
      if (lower.includes('forbidden-match')) {
        return [0.1, 0.95, 0];
      }
      // Off-topic.
      if (lower.includes('off-topic') || lower.includes('weather')) {
        return [0, 0, 1];
      }

      return [0.33, 0.33, 0.33];
    });
  });
}

/** A simple allowed topic. */
const BILLING_TOPIC: TopicDescriptor = {
  id: 'billing',
  name: 'Billing & Payments',
  description: 'Questions about invoices and charges.',
  examples: ['Why was I charged twice?'],
};

/** A simple forbidden topic. */
const VIOLENCE_TOPIC: TopicDescriptor = {
  id: 'violence',
  name: 'Violence & Harm',
  description: 'Content about violence and harm.',
  examples: ['How do I hurt someone?'],
};

/** Minimal execution context for tool invocation. */
const EXEC_CONTEXT: ToolExecutionContext = {
  gmiId: 'gmi-1',
  personaId: 'persona-1',
  userContext: { userId: 'user-1' } as any,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CheckTopicTool', () => {
  // -----------------------------------------------------------------------
  // ITool metadata
  // -----------------------------------------------------------------------

  describe('ITool properties', () => {
    it('has correct id and name', () => {
      const tool = new CheckTopicTool(null, null, createMockEmbeddingFn(), 0.35, 0.65);

      expect(tool.id).toBe('check_topic');
      expect(tool.name).toBe('check_topic');
    });

    it('has correct displayName', () => {
      const tool = new CheckTopicTool(null, null, createMockEmbeddingFn(), 0.35, 0.65);

      expect(tool.displayName).toBe('Topic Checker');
    });

    it('has category "security" and version "1.0.0"', () => {
      const tool = new CheckTopicTool(null, null, createMockEmbeddingFn(), 0.35, 0.65);

      expect(tool.category).toBe('security');
      expect(tool.version).toBe('1.0.0');
    });

    it('has hasSideEffects=false', () => {
      const tool = new CheckTopicTool(null, null, createMockEmbeddingFn(), 0.35, 0.65);

      expect(tool.hasSideEffects).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // inputSchema
  // -----------------------------------------------------------------------

  describe('inputSchema', () => {
    it('has text as a required string property', () => {
      const tool = new CheckTopicTool(null, null, createMockEmbeddingFn(), 0.35, 0.65);

      expect(tool.inputSchema.type).toBe('object');
      expect(tool.inputSchema.properties.text).toBeDefined();
      expect(tool.inputSchema.properties.text.type).toBe('string');
      expect(tool.inputSchema.required).toContain('text');
    });
  });

  // -----------------------------------------------------------------------
  // execute
  // -----------------------------------------------------------------------

  describe('execute', () => {
    it('returns onTopic=true for text matching allowed topics', async () => {
      const embeddingFn = createMockEmbeddingFn();
      const allowedIndex = new TopicEmbeddingIndex(embeddingFn);
      await allowedIndex.build([BILLING_TOPIC]);

      const tool = new CheckTopicTool(allowedIndex, null, embeddingFn, 0.35, 0.65);

      const result = await tool.execute({ text: 'on-topic billing question' }, EXEC_CONTEXT);

      expect(result.success).toBe(true);
      expect(result.output).toBeDefined();
      expect(result.output!.onTopic).toBe(true);
      expect(result.output!.nearestTopic).not.toBeNull();
      expect(result.output!.nearestTopic!.topicId).toBe('billing');
    });

    it('returns onTopic=false for off-topic text', async () => {
      const embeddingFn = createMockEmbeddingFn();
      const allowedIndex = new TopicEmbeddingIndex(embeddingFn);
      await allowedIndex.build([BILLING_TOPIC]);

      const tool = new CheckTopicTool(allowedIndex, null, embeddingFn, 0.35, 0.65);

      const result = await tool.execute({ text: 'off-topic weather question' }, EXEC_CONTEXT);

      expect(result.success).toBe(true);
      expect(result.output!.onTopic).toBe(false);
    });

    it('returns forbiddenMatch when text matches forbidden topic', async () => {
      const embeddingFn = createMockEmbeddingFn();
      const forbiddenIndex = new TopicEmbeddingIndex(embeddingFn);
      await forbiddenIndex.build([VIOLENCE_TOPIC]);

      const tool = new CheckTopicTool(null, forbiddenIndex, embeddingFn, 0.35, 0.65);

      const result = await tool.execute({ text: 'forbidden-match message' }, EXEC_CONTEXT);

      expect(result.success).toBe(true);
      expect(result.output!.forbiddenMatch).not.toBeNull();
      expect(result.output!.forbiddenMatch!.topicId).toBe('violence');
    });

    it('returns onTopic=null when no allowed topics configured', async () => {
      const embeddingFn = createMockEmbeddingFn();
      const tool = new CheckTopicTool(null, null, embeddingFn, 0.35, 0.65);

      const result = await tool.execute({ text: 'any text' }, EXEC_CONTEXT);

      expect(result.success).toBe(true);
      expect(result.output!.onTopic).toBeNull();
      expect(result.output!.nearestTopic).toBeNull();
    });

    it('returns allScores sorted descending', async () => {
      const embeddingFn = createMockEmbeddingFn();
      const allowedIndex = new TopicEmbeddingIndex(embeddingFn);
      await allowedIndex.build([BILLING_TOPIC]);

      const forbiddenIndex = new TopicEmbeddingIndex(embeddingFn);
      await forbiddenIndex.build([VIOLENCE_TOPIC]);

      const tool = new CheckTopicTool(allowedIndex, forbiddenIndex, embeddingFn, 0.35, 0.65);

      const result = await tool.execute({ text: 'on-topic text' }, EXEC_CONTEXT);

      expect(result.success).toBe(true);
      const scores = result.output!.allScores;
      expect(scores.length).toBeGreaterThan(0);

      // Verify sorted descending.
      for (let i = 1; i < scores.length; i++) {
        expect(scores[i - 1].similarity).toBeGreaterThanOrEqual(scores[i].similarity);
      }
    });

    it('returns error for empty text', async () => {
      const tool = new CheckTopicTool(null, null, createMockEmbeddingFn(), 0.35, 0.65);

      const result = await tool.execute({ text: '' }, EXEC_CONTEXT);

      expect(result.success).toBe(false);
      expect(result.error).toContain('required');
    });

    it('returns error for whitespace-only text', async () => {
      const tool = new CheckTopicTool(null, null, createMockEmbeddingFn(), 0.35, 0.65);

      const result = await tool.execute({ text: '   ' }, EXEC_CONTEXT);

      expect(result.success).toBe(false);
      expect(result.error).toContain('required');
    });

    it('handles embedding errors gracefully', async () => {
      const brokenFn = vi.fn(async () => {
        throw new Error('Embedding crash');
      });

      const tool = new CheckTopicTool(null, null, brokenFn, 0.35, 0.65);

      const result = await tool.execute({ text: 'test text' }, EXEC_CONTEXT);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Embedding crash');
    });
  });

  // -----------------------------------------------------------------------
  // Index setters
  // -----------------------------------------------------------------------

  describe('index setters', () => {
    it('setAllowedIndex updates the allowed index', async () => {
      const embeddingFn = createMockEmbeddingFn();
      const tool = new CheckTopicTool(null, null, embeddingFn, 0.35, 0.65);

      // Initially no allowed index — onTopic should be null.
      let result = await tool.execute({ text: 'on-topic billing' }, EXEC_CONTEXT);
      expect(result.output!.onTopic).toBeNull();

      // Build and set an allowed index.
      const allowedIndex = new TopicEmbeddingIndex(embeddingFn);
      await allowedIndex.build([BILLING_TOPIC]);
      tool.setAllowedIndex(allowedIndex);

      // Now onTopic should be a boolean.
      result = await tool.execute({ text: 'on-topic billing' }, EXEC_CONTEXT);
      expect(result.output!.onTopic).toBe(true);
    });
  });
});
