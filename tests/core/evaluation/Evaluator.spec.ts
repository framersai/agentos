/**
 * @file Evaluator.spec.ts
 * @description Unit tests for the Evaluator class.
 * @module AgentOS/Evaluation/Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Evaluator } from '../../../src/core/evaluation/Evaluator';
import type { EvalTestCase } from '../../../src/core/evaluation/IEvaluator';

describe('Evaluator', () => {
  let evaluator: Evaluator;

  beforeEach(() => {
    evaluator = new Evaluator();
  });

  describe('Built-in Scorers', () => {
    it('exact_match: should return 1 for identical strings', async () => {
      const score = await evaluator.score('exact_match', 'hello', 'hello');
      expect(score).toBe(1);
    });

    it('exact_match: should return 0 for different strings', async () => {
      const score = await evaluator.score('exact_match', 'hello', 'world');
      expect(score).toBe(0);
    });

    it('exact_match: should be case-insensitive', async () => {
      const score = await evaluator.score('exact_match', 'Hello', 'hello');
      expect(score).toBe(1);
    });

    it('contains: should return 1 if expected is found', async () => {
      const score = await evaluator.score('contains', 'Hello World!', 'World');
      expect(score).toBe(1);
    });

    it('contains: should return 0 if expected is not found', async () => {
      const score = await evaluator.score('contains', 'Hello World!', 'Goodbye');
      expect(score).toBe(0);
    });

    it('levenshtein: should return 1 for identical strings', async () => {
      const score = await evaluator.score('levenshtein', 'hello', 'hello');
      expect(score).toBe(1);
    });

    it('levenshtein: should return high score for similar strings', async () => {
      const score = await evaluator.score('levenshtein', 'hello', 'hallo');
      expect(score).toBeGreaterThan(0.7);
    });

    it('levenshtein: should return low score for dissimilar strings', async () => {
      const score = await evaluator.score('levenshtein', 'hello', 'world');
      expect(score).toBeLessThan(0.5);
    });

    it('semantic_similarity: should return high score for similar content', async () => {
      const score = await evaluator.score(
        'semantic_similarity',
        'The quick brown fox jumps over the lazy dog',
        'The quick brown fox leaps over the lazy dog',
      );
      expect(score).toBeGreaterThan(0.5);
    });

    it('bleu: should return 1 for identical strings', async () => {
      const score = await evaluator.score('bleu', 'hello world', 'hello world');
      expect(score).toBeCloseTo(1, 1);
    });

    it('rouge: should return 1 for identical strings', async () => {
      const score = await evaluator.score('rouge', 'hello world', 'hello world');
      expect(score).toBe(1);
    });

    it('rouge: should return high score for similar strings', async () => {
      const score = await evaluator.score('rouge', 'the cat sat on mat', 'the cat sat on the mat');
      expect(score).toBeGreaterThan(0.7);
    });
  });

  describe('registerScorer', () => {
    it('should register and use a custom scorer', async () => {
      evaluator.registerScorer('custom', (actual, expected) => {
        return actual.length === expected?.length ? 1 : 0;
      });

      const score = await evaluator.score('custom', 'hello', 'world');
      expect(score).toBe(1);

      const score2 = await evaluator.score('custom', 'hi', 'world');
      expect(score2).toBe(0);
    });
  });

  describe('evaluateTestCase', () => {
    it('should evaluate a test case with default criteria', async () => {
      const testCase: EvalTestCase = {
        id: 'tc-1',
        name: 'Simple Test',
        input: 'What is 2+2?',
        expectedOutput: 'The answer is 4.',
      };

      const result = await evaluator.evaluateTestCase(testCase, 'The answer is 4.');

      expect(result.testCaseId).toBe('tc-1');
      expect(result.testCaseName).toBe('Simple Test');
      expect(result.passed).toBe(true);
      expect(result.score).toBe(1);
      expect(result.actualOutput).toBe('The answer is 4.');
    });

    it('should evaluate with custom criteria', async () => {
      const testCase: EvalTestCase = {
        id: 'tc-2',
        name: 'Multi-Criteria Test',
        input: 'Summarize AI',
        expectedOutput: 'computer science',
        criteria: [
          { name: 'contains_topic', description: 'Contains expected term', weight: 1, scorer: 'contains' },
          { name: 'similarity', description: 'Similarity', weight: 2, scorer: 'levenshtein' },
        ],
      };

      const result = await evaluator.evaluateTestCase(
        testCase,
        'AI is a branch of computer science focused on creating intelligent machines.',
      );

      expect(result.metrics).toHaveLength(2);
      expect(result.metrics[0].name).toBe('contains_topic');
      expect(result.metrics[0].value).toBe(1); // Contains "computer science"
    });

    it('should fail a test case below threshold', async () => {
      const testCase: EvalTestCase = {
        id: 'tc-3',
        name: 'Failing Test',
        input: 'Hello',
        expectedOutput: 'Goodbye',
      };

      const result = await evaluator.evaluateTestCase(testCase, 'Hello there');

      expect(result.passed).toBe(false);
      expect(result.score).toBeLessThan(0.7);
    });
  });

  describe('runEvaluation', () => {
    it('should run evaluation on multiple test cases', async () => {
      const testCases: EvalTestCase[] = [
        { id: 'tc-1', name: 'Test 1', input: 'input1', expectedOutput: 'output1' },
        { id: 'tc-2', name: 'Test 2', input: 'input2', expectedOutput: 'output2' },
      ];

      const agentFn = vi.fn(async (input: string) => input.replace('input', 'output'));

      const run = await evaluator.runEvaluation('Test Run', testCases, agentFn);

      expect(run.name).toBe('Test Run');
      expect(run.status).toBe('completed');
      expect(run.results).toHaveLength(2);
      expect(run.results[0].passed).toBe(true);
      expect(run.results[1].passed).toBe(true);
      expect(run.aggregateMetrics.passedTests).toBe(2);
      expect(run.aggregateMetrics.passRate).toBe(1);
    });

    it('should handle agent function errors gracefully', async () => {
      const testCases: EvalTestCase[] = [
        { id: 'tc-1', name: 'Error Test', input: 'input1', expectedOutput: 'output1' },
      ];

      const agentFn = vi.fn(async () => {
        throw new Error('Agent error');
      });

      const run = await evaluator.runEvaluation('Error Run', testCases, agentFn, {
        retries: 0,
        continueOnError: true,
      });

      expect(run.results[0].passed).toBe(false);
      expect(run.results[0].error).toBe('Agent error');
    });

    it('should retry on failure', async () => {
      const testCases: EvalTestCase[] = [
        { id: 'tc-1', name: 'Retry Test', input: 'input', expectedOutput: 'output' },
      ];

      let callCount = 0;
      const agentFn = vi.fn(async () => {
        callCount++;
        if (callCount === 1) {
          throw new Error('First attempt failed');
        }
        return 'output';
      });

      const run = await evaluator.runEvaluation('Retry Run', testCases, agentFn, {
        retries: 2,
      });

      expect(callCount).toBe(2);
      expect(run.results[0].passed).toBe(true);
    });
  });

  describe('getRun and listRuns', () => {
    it('should store and retrieve runs', async () => {
      const testCases: EvalTestCase[] = [
        { id: 'tc-1', name: 'Test', input: 'in', expectedOutput: 'out' },
      ];

      const run = await evaluator.runEvaluation('Stored Run', testCases, async () => 'out');

      const retrieved = await evaluator.getRun(run.runId);
      expect(retrieved).toEqual(run);
    });

    it('should list runs in reverse chronological order', async () => {
      const testCases: EvalTestCase[] = [
        { id: 'tc-1', name: 'Test', input: 'in', expectedOutput: 'out' },
      ];

      await evaluator.runEvaluation('Run 1', testCases, async () => 'out');
      // Small delay to ensure different timestamps
      await new Promise(resolve => setTimeout(resolve, 10));
      await evaluator.runEvaluation('Run 2', testCases, async () => 'out');

      const runs = await evaluator.listRuns();
      expect(runs[0].name).toBe('Run 2');
      expect(runs[1].name).toBe('Run 1');
    });
  });

  describe('compareRuns', () => {
    it('should compare two runs', async () => {
      const testCases: EvalTestCase[] = [
        { id: 'tc-1', name: 'Test', input: 'hello', expectedOutput: 'hello world' },
      ];

      const run1 = await evaluator.runEvaluation('Run 1', testCases, async () => 'hello');
      const run2 = await evaluator.runEvaluation('Run 2', testCases, async () => 'hello world');

      const comparison = await evaluator.compareRuns(run1.runId, run2.runId);

      expect(comparison.run1Id).toBe(run1.runId);
      expect(comparison.run2Id).toBe(run2.runId);
      expect(comparison.metrics).toHaveLength(4);

      const passRateMetric = comparison.metrics.find(m => m.name === 'passRate');
      expect(passRateMetric).toBeDefined();
      expect(passRateMetric?.run2Value).toBeGreaterThan(passRateMetric!.run1Value);
    });

    it('should throw if run not found', async () => {
      await expect(evaluator.compareRuns('invalid-1', 'invalid-2')).rejects.toThrow('Run not found');
    });
  });

  describe('generateReport', () => {
    it('should generate JSON report', async () => {
      const testCases: EvalTestCase[] = [
        { id: 'tc-1', name: 'Test', input: 'in', expectedOutput: 'out' },
      ];

      const run = await evaluator.runEvaluation('Report Run', testCases, async () => 'out');
      const report = await evaluator.generateReport(run.runId, 'json');

      const parsed = JSON.parse(report);
      expect(parsed.runId).toBe(run.runId);
      expect(parsed.name).toBe('Report Run');
    });

    it('should generate Markdown report', async () => {
      const testCases: EvalTestCase[] = [
        { id: 'tc-1', name: 'Test', input: 'in', expectedOutput: 'out' },
      ];

      const run = await evaluator.runEvaluation('MD Run', testCases, async () => 'out');
      const report = await evaluator.generateReport(run.runId, 'markdown');

      expect(report).toContain('# Evaluation Report');
      expect(report).toContain('MD Run');
      expect(report).toContain('Total Tests');
    });

    it('should generate HTML report', async () => {
      const testCases: EvalTestCase[] = [
        { id: 'tc-1', name: 'Test', input: 'in', expectedOutput: 'out' },
      ];

      const run = await evaluator.runEvaluation('HTML Run', testCases, async () => 'out');
      const report = await evaluator.generateReport(run.runId, 'html');

      expect(report).toContain('<!DOCTYPE html>');
      expect(report).toContain('HTML Run');
      expect(report).toContain('<table>');
    });
  });
});

