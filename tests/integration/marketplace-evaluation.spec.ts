/**
 * @file marketplace-evaluation.spec.ts
 * @description Integration tests for Marketplace and Evaluation systems.
 * Tests the full lifecycle of publishing, installing, and evaluating agents.
 *
 * @module AgentOS/Integration/Tests
 * @version 1.0.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Marketplace } from '../../src/core/marketplace/Marketplace';
import { Evaluator } from '../../src/core/evaluation/Evaluator';
import type {
  PublisherInfo,
  PricingInfo,
} from '../../src/core/marketplace/IMarketplace';
import type { EvalTestCase, EvalConfig } from '../../src/core/evaluation/IEvaluator';

describe('Marketplace + Evaluation Integration', () => {
  let marketplace: Marketplace;
  let evaluator: Evaluator;

  const testPublisher: PublisherInfo = {
    id: 'pub-integration-test',
    name: 'Integration Test Publisher',
    type: 'organization',
    verified: true,
  };

  const testPricing: PricingInfo = { model: 'free' };

  beforeEach(async () => {
    marketplace = new Marketplace({ userId: 'integration-test-user' });
    evaluator = new Evaluator();
    await marketplace.initialize();
  });

  describe('Agent Publishing Workflow', () => {
    it('should publish an agent and make it discoverable', async () => {
      // Publish a new agent
      const agent = await marketplace.publish({
        type: 'agent',
        name: 'Integration Test Agent',
        description: 'An agent for integration testing',
        version: '1.0.0',
        publisher: testPublisher,
        visibility: 'public',
        status: 'published',
        categories: ['testing', 'integration'],
        tags: ['test', 'automated'],
        license: 'MIT',
        pricing: testPricing,
        agentosVersion: '^2.0.0',
        defaultConfig: {
          maxTokens: 1000,
          temperature: 0.7,
        },
      });

      expect(agent.id).toBeDefined();
      expect(agent.status).toBe('published');

      // Search and find the agent
      const searchResult = await marketplace.search({ query: 'Integration Test' });
      expect(searchResult.items.some(i => i.id === agent.id)).toBe(true);

      // Get agent directly
      const retrieved = await marketplace.getItem(agent.id);
      expect(retrieved?.name).toBe('Integration Test Agent');
    });

    it('should handle the full installation lifecycle', async () => {
      // Publish
      const agent = await marketplace.publish({
        type: 'agent',
        name: 'Lifecycle Test Agent',
        description: 'Testing full lifecycle',
        version: '1.0.0',
        publisher: testPublisher,
        visibility: 'public',
        status: 'published',
        categories: ['testing'],
        tags: ['lifecycle'],
        license: 'MIT',
        pricing: testPricing,
        agentosVersion: '^2.0.0',
      });

      // Install
      const installResult = await marketplace.install(agent.id);
      expect(installResult.success).toBe(true);
      expect(installResult.installation?.status).toBe('installed');

      // Verify installation shows up
      const installed = await marketplace.getInstalled();
      expect(installed.some(i => i.itemId === agent.id)).toBe(true);

      // Update version
      await marketplace.publishVersion(agent.id, '1.1.0', {
        changelog: 'Bug fixes and improvements',
      });

      // Check for updates
      const updates = await marketplace.checkUpdates();
      expect(updates.some(u => u.installation.itemId === agent.id)).toBe(true);

      // Update installation
      const updateResult = await marketplace.update(installResult.installation!.installationId, {
        version: '1.1.0',
      });
      expect(updateResult.success).toBe(true);
      expect(updateResult.installation?.version).toBe('1.1.0');

      // Uninstall
      const uninstallResult = await marketplace.uninstall(installResult.installation!.installationId);
      expect(uninstallResult.success).toBe(true);

      // Verify uninstallation
      const installedAfter = await marketplace.getInstalled();
      expect(installedAfter.some(i => i.itemId === agent.id)).toBe(false);
    });
  });

  describe('Agent Evaluation Workflow', () => {
    it('should evaluate an agent with multiple test cases', async () => {
      // Mock agent function
      const mockAgent = vi.fn(async (input: string) => {
        if (input.includes('capital')) return 'Paris';
        if (input.includes('fibonacci')) return '1, 1, 2, 3, 5, 8';
        return 'I do not know';
      });

      const testCases: EvalTestCase[] = [
        {
          id: 'tc-1',
          name: 'Capital question',
          input: 'What is the capital of France?',
          expectedOutput: 'Paris',
          criteria: [{ name: 'exact', description: 'Exact match', weight: 1, scorer: 'exact_match' }],
        },
        {
          id: 'tc-2',
          name: 'Fibonacci question',
          input: 'List the first 6 fibonacci numbers',
          expectedOutput: '1, 1, 2, 3, 5, 8',
          criteria: [{ name: 'contains', description: 'Contains answer', weight: 1, scorer: 'contains' }],
        },
      ];

      // Run evaluation
      const run = await evaluator.runEvaluation('Integration Test Evaluation', testCases, mockAgent);

      expect(run.runId).toBeDefined();
      expect(run.status).toBe('completed');
      expect(run.aggregateMetrics.totalTests).toBe(2);
      expect(run.aggregateMetrics.passedTests).toBeGreaterThanOrEqual(1);
      expect(mockAgent).toHaveBeenCalledTimes(2);
    });

    it('should handle evaluation failures gracefully', async () => {
      // Agent that always throws
      const failingAgent = vi.fn(async () => {
        throw new Error('Agent malfunction');
      });

      const testCases: EvalTestCase[] = [
        {
          id: 'tc-fail',
          name: 'Failing test',
          input: 'Test input',
          expectedOutput: 'Expected output',
          criteria: [{ name: 'match', description: 'Match', weight: 1, scorer: 'exact_match' }],
        },
      ];

      // Should not throw, but mark tests as failed
      const run = await evaluator.runEvaluation('Failing Agent Test', testCases, failingAgent);

      expect(run.status).toBe('completed');
      expect(run.aggregateMetrics.failedTests).toBe(1);
      expect(run.aggregateMetrics.passedTests).toBe(0);
    });

    it('should support custom scorers', async () => {
      // Register a custom scorer
      evaluator.registerScorer('word_count_match', (actual: string, expected: string | undefined) => {
        if (!expected) return 0;
        const actualWords = actual.split(/\s+/).length;
        const expectedWords = expected.split(/\s+/).length;
        return actualWords === expectedWords ? 1 : 0;
      });

      const mockAgent = vi.fn(async () => 'one two three');

      const testCases: EvalTestCase[] = [
        {
          id: 'tc-custom',
          name: 'Word count test',
          input: 'Count to three',
          expectedOutput: 'a b c', // Same word count
          criteria: [{ name: 'words', description: 'Word count', weight: 1, scorer: 'word_count_match' }],
        },
      ];

      const run = await evaluator.runEvaluation('Custom Scorer Test', testCases, mockAgent);

      expect(run.results[0].score).toBe(1);
      expect(run.results[0].passed).toBe(true);
    });
  });

  describe('Marketplace + Evaluation Combined Workflow', () => {
    it('should publish, install, and evaluate an agent end-to-end', async () => {
      // Step 1: Publish agent to marketplace
      const agent = await marketplace.publish({
        type: 'agent',
        name: 'E2E Test Agent',
        description: 'End-to-end testing agent',
        version: '1.0.0',
        publisher: testPublisher,
        visibility: 'public',
        status: 'published',
        categories: ['testing'],
        tags: ['e2e', 'automated'],
        license: 'MIT',
        pricing: testPricing,
        agentosVersion: '^2.0.0',
        metadata: {
          evaluationSuite: 'basic-qa',
        },
      });

      expect(agent.id).toBeDefined();

      // Step 2: Install agent
      const installResult = await marketplace.install(agent.id);
      expect(installResult.success).toBe(true);

      // Step 3: Create mock agent function
      const agentFunction = vi.fn(async (input: string) => {
        if (input.toLowerCase().includes('hello')) return 'Hello! How can I help you?';
        return 'I can help with your questions.';
      });

      // Step 4: Run evaluation
      const testCases: EvalTestCase[] = [
        {
          id: 'greeting-test',
          name: 'Greeting test',
          input: 'Hello there!',
          expectedOutput: 'Hello',
          criteria: [{ name: 'contains', description: 'Contains greeting', weight: 1, scorer: 'contains' }],
        },
      ];

      const run = await evaluator.runEvaluation(`Evaluation for ${agent.name}`, testCases, agentFunction);

      expect(run.status).toBe('completed');
      expect(run.aggregateMetrics.passedTests).toBeGreaterThanOrEqual(1);

      // Step 5: Submit review based on evaluation
      const review = await marketplace.submitReview(agent.id, {
        rating: run.aggregateMetrics.avgScore >= 0.8 ? 5 : run.aggregateMetrics.avgScore >= 0.6 ? 4 : 3,
        title: 'Automated Evaluation Results',
        body: `Pass rate: ${(run.aggregateMetrics.passRate * 100).toFixed(1)}%`,
      });

      expect(review.id).toBeDefined();

      // Step 6: Verify agent rating updated
      const updatedAgent = await marketplace.getItem(agent.id);
      expect(updatedAgent?.ratings.count).toBeGreaterThan(0);
    });

    it('should track marketplace analytics after evaluation', async () => {
      // Publish
      const agent = await marketplace.publish({
        type: 'agent',
        name: 'Analytics Test Agent',
        description: 'Testing analytics tracking',
        version: '1.0.0',
        publisher: testPublisher,
        visibility: 'public',
        status: 'published',
        categories: ['analytics'],
        tags: [],
        license: 'MIT',
        pricing: testPricing,
        agentosVersion: '^2.0.0',
      });

      // Record views
      await marketplace.recordView(agent.id);
      await marketplace.recordView(agent.id);

      // Install
      await marketplace.install(agent.id);

      // Get analytics
      const analytics = await marketplace.getItemAnalytics(agent.id);

      expect(analytics.views[0].count).toBe(2);
      expect(analytics.downloads[0].count).toBe(1);
      expect(analytics.activeInstalls).toBe(1);
    });
  });

  describe('Concurrent Operations', () => {
    it('should handle multiple concurrent installs', async () => {
      // Publish multiple agents
      const agents = await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          marketplace.publish({
            type: 'agent',
            name: `Concurrent Agent ${i + 1}`,
            description: `Agent ${i + 1} for concurrent testing`,
            version: '1.0.0',
            publisher: testPublisher,
            visibility: 'public',
            status: 'published',
            categories: ['concurrent'],
            tags: [],
            license: 'MIT',
            pricing: testPricing,
            agentosVersion: '^2.0.0',
          })
        )
      );

      // Install all concurrently
      const installResults = await Promise.all(
        agents.map(agent => marketplace.install(agent.id))
      );

      // All should succeed
      expect(installResults.every(r => r.success)).toBe(true);

      // Verify all installed
      const installed = await marketplace.getInstalled();
      expect(installed.length).toBeGreaterThanOrEqual(5);
    });

    it('should handle concurrent evaluations', async () => {
      const mockAgent = vi.fn(async (input: string) => `Response to: ${input}`);

      const evaluations = Array.from({ length: 3 }, (_, i) => ({
        name: `Concurrent Eval ${i + 1}`,
        testCases: [
          {
            id: `tc-${i}`,
            name: `Test ${i}`,
            input: `Test input ${i}`,
            expectedOutput: `Response to: Test input ${i}`,
            criteria: [{ name: 'match', description: 'Match', weight: 1, scorer: 'exact_match' }],
          },
        ] as EvalTestCase[],
      }));

      // Run all evaluations concurrently
      const runs = await Promise.all(
        evaluations.map(e => evaluator.runEvaluation(e.name, e.testCases, mockAgent))
      );

      // All should complete
      expect(runs.every(r => r.status === 'completed')).toBe(true);
      expect(runs.every(r => r.aggregateMetrics.passedTests >= 1)).toBe(true);
    });
  });

  describe('Report Generation', () => {
    it('should generate markdown report for evaluation run', async () => {
      const mockAgent = vi.fn(async () => 'Test response');

      const testCases: EvalTestCase[] = [
        {
          id: 'report-test',
          name: 'Report generation test',
          input: 'Test input',
          expectedOutput: 'Test response',
          criteria: [{ name: 'match', description: 'Match', weight: 1, scorer: 'exact_match' }],
        },
      ];

      const run = await evaluator.runEvaluation('Report Test', testCases, mockAgent);
      const report = await evaluator.generateReport(run.runId, 'markdown');

      expect(report).toContain('# Evaluation Report');
      expect(report).toContain('Report Test');
      expect(report).toContain('Pass');
    });

    it('should generate HTML report for evaluation run', async () => {
      const mockAgent = vi.fn(async () => 'Test response');

      const testCases: EvalTestCase[] = [
        {
          id: 'html-test',
          name: 'HTML report test',
          input: 'Test',
          expectedOutput: 'Test response',
          criteria: [{ name: 'match', description: 'Match', weight: 1, scorer: 'exact_match' }],
        },
      ];

      const run = await evaluator.runEvaluation('HTML Report Test', testCases, mockAgent);
      const report = await evaluator.generateReport(run.runId, 'html');

      expect(report).toContain('<!DOCTYPE html>');
      expect(report).toContain('<title>');
      expect(report).toContain('HTML Report Test');
    });
  });
});
