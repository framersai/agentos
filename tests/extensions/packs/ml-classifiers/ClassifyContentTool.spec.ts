/**
 * @fileoverview Unit tests for `ClassifyContentTool`.
 *
 * Tests verify:
 *  - Has correct ITool properties (id, name, displayName, etc.)
 *  - inputSchema has text (required) and classifiers (optional)
 *  - execute returns ChunkEvaluation with results for toxic text
 *  - Returns ALLOW for benign text
 *  - Returns error for empty text
 */

import { describe, it, expect, vi } from 'vitest';
import { ClassifyContentTool } from '../../../../src/extensions/packs/ml-classifiers/tools/ClassifyContentTool';
import { ClassifierOrchestrator } from '../../../../src/extensions/packs/ml-classifiers/ClassifierOrchestrator';
import type { IContentClassifier } from '../../../../src/extensions/packs/ml-classifiers/IContentClassifier';
import type { ClassificationResult } from '../../../../src/core/ai_utilities/IUtilityAI';
import { DEFAULT_THRESHOLDS } from '../../../../src/extensions/packs/ml-classifiers/types';
import { GuardrailAction } from '../../../../src/core/guardrails/IGuardrailService';
import type { ToolExecutionContext } from '../../../../src/core/tools/ITool';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

/**
 * Create a mock classifier returning a configurable result.
 */
function createMockClassifier(
  id: string,
  result: ClassificationResult,
): IContentClassifier {
  return {
    id,
    displayName: `Mock ${id}`,
    description: `Mock classifier: ${id}`,
    modelId: `mock/${id}`,
    isLoaded: true,
    classify: vi.fn(async () => result),
    dispose: vi.fn(async () => {}),
  };
}

/** Benign result — low confidence. */
const BENIGN: ClassificationResult = {
  bestClass: 'benign',
  confidence: 0.1,
  allScores: [{ classLabel: 'benign', score: 0.1 }],
};

/** Toxic result — above default block threshold. */
const TOXIC: ClassificationResult = {
  bestClass: 'toxic',
  confidence: 0.95,
  allScores: [{ classLabel: 'toxic', score: 0.95 }],
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

describe('ClassifyContentTool', () => {
  // -----------------------------------------------------------------------
  // ITool metadata
  // -----------------------------------------------------------------------

  describe('ITool properties', () => {
    it('has correct id and name', () => {
      const orchestrator = new ClassifierOrchestrator([], DEFAULT_THRESHOLDS);
      const tool = new ClassifyContentTool(orchestrator);

      expect(tool.id).toBe('classify_content');
      expect(tool.name).toBe('classify_content');
    });

    it('has correct displayName and description', () => {
      const orchestrator = new ClassifierOrchestrator([], DEFAULT_THRESHOLDS);
      const tool = new ClassifyContentTool(orchestrator);

      expect(tool.displayName).toBe('Content Safety Classifier');
      expect(tool.description).toContain('toxicity');
      expect(tool.description).toContain('prompt injection');
      expect(tool.description).toContain('jailbreak');
    });

    it('has category=security and version=1.0.0', () => {
      const orchestrator = new ClassifierOrchestrator([], DEFAULT_THRESHOLDS);
      const tool = new ClassifyContentTool(orchestrator);

      expect(tool.category).toBe('security');
      expect(tool.version).toBe('1.0.0');
    });

    it('has hasSideEffects=false', () => {
      const orchestrator = new ClassifierOrchestrator([], DEFAULT_THRESHOLDS);
      const tool = new ClassifyContentTool(orchestrator);

      expect(tool.hasSideEffects).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // inputSchema
  // -----------------------------------------------------------------------

  describe('inputSchema', () => {
    it('has text as a required property', () => {
      const orchestrator = new ClassifierOrchestrator([], DEFAULT_THRESHOLDS);
      const tool = new ClassifyContentTool(orchestrator);

      expect(tool.inputSchema.type).toBe('object');
      expect(tool.inputSchema.properties.text).toBeDefined();
      expect(tool.inputSchema.properties.text.type).toBe('string');
      expect(tool.inputSchema.required).toContain('text');
    });

    it('has classifiers as an optional array property', () => {
      const orchestrator = new ClassifierOrchestrator([], DEFAULT_THRESHOLDS);
      const tool = new ClassifyContentTool(orchestrator);

      const classifiersProp = tool.inputSchema.properties.classifiers;
      expect(classifiersProp).toBeDefined();
      expect(classifiersProp.type).toBe('array');
      expect(classifiersProp.items.type).toBe('string');

      // Should NOT be in the required list.
      expect(tool.inputSchema.required).not.toContain('classifiers');
    });
  });

  // -----------------------------------------------------------------------
  // execute
  // -----------------------------------------------------------------------

  describe('execute', () => {
    it('returns ChunkEvaluation with results for toxic text', async () => {
      const classifier = createMockClassifier('tox', TOXIC);
      const orchestrator = new ClassifierOrchestrator([classifier], DEFAULT_THRESHOLDS);
      const tool = new ClassifyContentTool(orchestrator);

      const result = await tool.execute({ text: 'you are terrible' }, EXEC_CONTEXT);

      expect(result.success).toBe(true);
      expect(result.output).toBeDefined();
      expect(result.output!.recommendedAction).toBe(GuardrailAction.BLOCK);
      expect(result.output!.results).toHaveLength(1);
      expect(result.output!.results[0].classifierId).toBe('tox');
      expect(result.output!.triggeredBy).toBe('tox');
    });

    it('returns ALLOW for benign text', async () => {
      const classifier = createMockClassifier('safe', BENIGN);
      const orchestrator = new ClassifierOrchestrator([classifier], DEFAULT_THRESHOLDS);
      const tool = new ClassifyContentTool(orchestrator);

      const result = await tool.execute({ text: 'hello world' }, EXEC_CONTEXT);

      expect(result.success).toBe(true);
      expect(result.output).toBeDefined();
      expect(result.output!.recommendedAction).toBe(GuardrailAction.ALLOW);
      expect(result.output!.triggeredBy).toBeNull();
    });

    it('returns error for empty text', async () => {
      const orchestrator = new ClassifierOrchestrator([], DEFAULT_THRESHOLDS);
      const tool = new ClassifyContentTool(orchestrator);

      const result = await tool.execute({ text: '' }, EXEC_CONTEXT);

      expect(result.success).toBe(false);
      expect(result.error).toContain('required');
    });

    it('returns error for whitespace-only text', async () => {
      const orchestrator = new ClassifierOrchestrator([], DEFAULT_THRESHOLDS);
      const tool = new ClassifyContentTool(orchestrator);

      const result = await tool.execute({ text: '   ' }, EXEC_CONTEXT);

      expect(result.success).toBe(false);
      expect(result.error).toContain('required');
    });

    it('handles orchestrator errors gracefully', async () => {
      // Create a classifier that always throws.
      const brokenClassifier: IContentClassifier = {
        id: 'broken',
        displayName: 'Broken',
        description: 'Always fails',
        modelId: 'broken',
        isLoaded: true,
        classify: async () => { throw new Error('model crash'); },
      };

      // Even though the classifier throws, the orchestrator catches it via
      // allSettled, so the tool should still succeed with ALLOW.
      const orchestrator = new ClassifierOrchestrator([brokenClassifier], DEFAULT_THRESHOLDS);
      vi.spyOn(console, 'warn').mockImplementation(() => {});

      const tool = new ClassifyContentTool(orchestrator);
      const result = await tool.execute({ text: 'test' }, EXEC_CONTEXT);

      expect(result.success).toBe(true);
      expect(result.output!.recommendedAction).toBe(GuardrailAction.ALLOW);

      vi.restoreAllMocks();
    });

    it('includes totalLatencyMs in output', async () => {
      const classifier = createMockClassifier('safe', BENIGN);
      const orchestrator = new ClassifierOrchestrator([classifier], DEFAULT_THRESHOLDS);
      const tool = new ClassifyContentTool(orchestrator);

      const result = await tool.execute({ text: 'test' }, EXEC_CONTEXT);

      expect(result.success).toBe(true);
      expect(result.output!.totalLatencyMs).toBeGreaterThanOrEqual(0);
    });
  });
});
