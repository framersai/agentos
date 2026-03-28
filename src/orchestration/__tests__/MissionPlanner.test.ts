import { describe, it, expect, vi } from 'vitest';
import { MissionPlanner } from '../planning/MissionPlanner.js';
import type { PlannerConfig } from '../planning/types.js';
import { DEFAULT_THRESHOLDS } from '../planning/types.js';

function createMockLlmCaller(responses: string[]) {
  let callIndex = 0;
  return vi.fn(async (_system: string, _user: string) => {
    const response = responses[callIndex] ?? '{}';
    callIndex++;
    return response;
  });
}

const basePlannerConfig = (llmCaller: PlannerConfig['llmCaller']): PlannerConfig => ({
  branchCount: 3,
  autonomy: 'guardrailed',
  providerStrategy: { strategy: 'balanced' },
  thresholds: { ...DEFAULT_THRESHOLDS },
  costCap: 10.0,
  maxAgents: 10,
  maxToolForges: 5,
  maxExpansions: 8,
  maxDepth: 3,
  reevalInterval: 3,
  llmCaller,
});

const makeBranchResponse = (strategy: string, summary: string) =>
  JSON.stringify({
    strategy,
    summary,
    nodes: [
      {
        id: 'researcher',
        type: 'gmi',
        role: 'Researcher',
        executorConfig: { type: 'gmi', instructions: 'Research the topic' },
        complexity: 0.7,
        estimatedTokens: 2000,
      },
    ],
    edges: [
      { source: '__START__', target: 'researcher', type: 'static' },
      { source: 'researcher', target: '__END__', type: 'static' },
    ],
    estimatedCost: 1.0,
    estimatedLatencyMs: 60000,
  });

const makeEvalResponse = (selectedBranchId: string, branches: Array<{ branchId: string; overall: number }>) =>
  JSON.stringify({
    evaluations: branches.map((b) => ({
      branchId: b.branchId,
      scores: {
        feasibility: 0.9,
        costEfficiency: 0.7,
        latency: 0.5,
        robustness: 0.6,
        overall: b.overall,
      },
      reasoning: `Score for ${b.branchId}`,
    })),
    recommendation: { selectedBranchId, reason: 'Best overall score' },
  });

const makeRefineResponse = (cost = 1.0, latency = 60000) =>
  JSON.stringify({
    refinements: [],
    toolGaps: [],
    finalEstimatedCost: cost,
    finalEstimatedLatencyMs: latency,
  });

describe('MissionPlanner', () => {
  describe('Phase 1: Divergent Exploration', () => {
    it('generates N candidate branches', async () => {
      const branch = makeBranchResponse('linear', 'Sequential pipeline');
      const llmCaller = createMockLlmCaller([
        branch,
        branch,
        branch,
        makeEvalResponse('branch_0', [
          { branchId: 'branch_0', overall: 0.75 },
          { branchId: 'branch_1', overall: 0.6 },
          { branchId: 'branch_2', overall: 0.5 },
        ]),
        makeRefineResponse(),
      ]);

      const planner = new MissionPlanner(basePlannerConfig(llmCaller));
      const result = await planner.plan('Research AI papers', { tools: [], providers: ['openai'] });

      expect(result.allBranches).toHaveLength(3);
      expect(result.selectedBranch).toBeDefined();
      expect(result.compiledGraph).toBeDefined();
      expect(result.compiledGraph.nodes.length).toBeGreaterThan(0);
    });

    it('survives partial branch failures', async () => {
      const branch = makeBranchResponse('linear', 'Sequential');
      const llmCaller = createMockLlmCaller([
        branch,
        'INVALID JSON !!!', // branch 1 fails
        branch,
        makeEvalResponse('branch_0', [
          { branchId: 'branch_0', overall: 0.75 },
          { branchId: 'branch_2', overall: 0.5 },
        ]),
        makeRefineResponse(),
      ]);

      const planner = new MissionPlanner(basePlannerConfig(llmCaller));
      const result = await planner.plan('Test goal', { tools: [], providers: ['openai'] });

      // Should have 2 branches (one failed)
      expect(result.allBranches.length).toBeLessThanOrEqual(3);
      expect(result.allBranches.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Phase 2: Evaluation', () => {
    it('scores branches and selects the best one', async () => {
      const llmCaller = createMockLlmCaller([
        makeBranchResponse('linear', 'Linear approach'),
        makeBranchResponse('parallel', 'Parallel approach'),
        makeBranchResponse('hierarchical', 'Hierarchical approach'),
        makeEvalResponse('branch_1', [
          { branchId: 'branch_0', overall: 0.63 },
          { branchId: 'branch_1', overall: 0.74 },
          { branchId: 'branch_2', overall: 0.55 },
        ]),
        makeRefineResponse(2.0, 30000),
      ]);

      const planner = new MissionPlanner(basePlannerConfig(llmCaller));
      const result = await planner.plan('Test goal', { tools: [], providers: ['openai'] });

      expect(result.selectedBranch.branchId).toBe('branch_1');
      expect(result.selectedBranch.scores.overall).toBe(0.74);
    });
  });

  describe('Phase 3: Refinement', () => {
    it('applies refinements from the reflexion pass', async () => {
      const refineWithAddition = JSON.stringify({
        refinements: [
          {
            type: 'add_node',
            description: 'Added fact checker',
            nodeId: 'fact_checker',
            patch: {
              id: 'fact_checker',
              type: 'gmi',
              executorConfig: { type: 'gmi', instructions: 'Verify claims' },
              executionMode: 'single_turn',
              effectClass: 'read',
              checkpoint: 'after',
            },
          },
        ],
        toolGaps: [],
        finalEstimatedCost: 1.5,
        finalEstimatedLatencyMs: 90000,
      });

      const llmCaller = createMockLlmCaller([
        makeBranchResponse('linear', 'Linear'),
        makeBranchResponse('linear', 'Linear'),
        makeBranchResponse('linear', 'Linear'),
        makeEvalResponse('branch_0', [{ branchId: 'branch_0', overall: 0.7 }]),
        refineWithAddition,
      ]);

      const planner = new MissionPlanner(basePlannerConfig(llmCaller));
      const result = await planner.plan('Test', { tools: [], providers: ['openai'] });

      expect(result.refinements).toContain('Added fact checker');
      expect(result.compiledGraph.nodes.find((n) => n.id === 'fact_checker')).toBeDefined();
    });
  });

  describe('Provider assignment', () => {
    it('attaches node-level provider assignments to compiled gmi nodes', async () => {
      const llmCaller = createMockLlmCaller([
        makeBranchResponse('linear', 'Linear approach'),
        makeBranchResponse('parallel', 'Parallel approach'),
        makeBranchResponse('hierarchical', 'Hierarchical approach'),
        makeEvalResponse('branch_0', [{ branchId: 'branch_0', overall: 0.8 }]),
        makeRefineResponse(),
      ]);

      const planner = new MissionPlanner(basePlannerConfig(llmCaller));
      const result = await planner.plan('Research agent runtimes', {
        tools: [],
        providers: ['openai', 'anthropic'],
      });

      expect(result.selectedBranch.providerAssignments).toHaveLength(1);
      const assignment = result.selectedBranch.providerAssignments[0]!;
      const node = result.compiledGraph.nodes.find((item) => item.id === assignment.nodeId);

      expect(node?.llm).toEqual({
        providerId: assignment.provider,
        model: assignment.model,
        reason: assignment.reason,
      });
      expect(node?.complexity).toBe(assignment.complexity);
    });
  });

  describe('Event streaming', () => {
    it('emits planning events in order', async () => {
      const branch = makeBranchResponse('linear', 'Sequential');
      const llmCaller = createMockLlmCaller([
        branch,
        branch,
        branch,
        makeEvalResponse('branch_0', [{ branchId: 'branch_0', overall: 0.75 }]),
        makeRefineResponse(),
      ]);

      const events: Array<{ type: string }> = [];
      const planner = new MissionPlanner(basePlannerConfig(llmCaller));
      await planner.plan('Test', { tools: [], providers: ['openai'] }, (e) => events.push(e));

      const types = events.map((e) => e.type);
      expect(types[0]).toBe('mission:planning_start');
      expect(types).toContain('mission:branch_generated');
      expect(types).toContain('mission:branch_selected');
      expect(types).toContain('mission:graph_compiled');
    });
  });
});
