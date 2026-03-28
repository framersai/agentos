import { describe, expect, it } from 'vitest';

import type { CompiledExecutionGraph, GraphNode } from '../ir/types.js';
import { END, START } from '../ir/types.js';
import { createMissionExpansionHandler } from '../planning/MissionExpansionHandler.js';
import { DEFAULT_THRESHOLDS } from '../planning/types.js';

function makeNode(id: string, overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    id,
    type: 'gmi',
    executorConfig: { type: 'gmi', instructions: `Do ${id}` },
    executionMode: 'single_turn',
    effectClass: 'read',
    checkpoint: 'after',
    ...overrides,
  };
}

function makeGraph(nodes: GraphNode[]): CompiledExecutionGraph {
  const edges = nodes.flatMap((node, index) => {
    if (index === 0) {
      return [
        { id: `start-${node.id}`, source: START, target: node.id, type: 'static' as const },
      ];
    }

    return [
      {
        id: `${nodes[index - 1]!.id}-${node.id}`,
        source: nodes[index - 1]!.id,
        target: node.id,
        type: 'static' as const,
      },
    ];
  });

  if (nodes.length > 0) {
    edges.push({
      id: `${nodes[nodes.length - 1]!.id}-end`,
      source: nodes[nodes.length - 1]!.id,
      target: END,
      type: 'static',
    });
  }

  return {
    id: 'graph',
    name: 'graph',
    nodes,
    edges,
    stateSchema: { input: {}, scratch: {}, artifacts: {} },
    reducers: {},
    checkpointPolicy: 'every_node',
    memoryConsistency: 'live',
  };
}

describe('MissionExpansionHandler', () => {
  it('reconnects surrounding static edges when removing an agent', async () => {
    const handler = createMissionExpansionHandler({
      autonomy: 'autonomous',
      thresholds: DEFAULT_THRESHOLDS,
      llmCaller: async () => '{"shouldExpand":false,"patch":null}',
      costCap: 10,
      maxAgents: 10,
    });

    const result = await handler.handle({
      graph: makeGraph([makeNode('worker'), makeNode('verifier'), makeNode('deliver')]),
      runId: 'run-remove',
      nodeId: 'worker',
      state: {
        input: {},
        scratch: {},
        artifacts: {},
        diagnostics: {},
        visitedNodes: ['worker'],
        iteration: 1,
      } as any,
      request: {
        trigger: 'supervisor_manage',
        reason: 'Verifier is redundant',
        request: {
          action: 'remove_agent',
          spec: { nodeId: 'verifier' },
          reason: 'Verifier is redundant',
        },
      },
      completedNodes: ['worker'],
      skippedNodes: [],
      nodeResults: {},
    });

    expect(result?.graph?.nodes.map((node) => node.id)).toEqual(['worker', 'deliver']);
    expect(result?.graph?.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: 'worker', target: 'deliver', type: 'static' }),
      ]),
    );
  });

  it('reassigns a node role while preserving its wiring', async () => {
    const handler = createMissionExpansionHandler({
      autonomy: 'autonomous',
      thresholds: DEFAULT_THRESHOLDS,
      llmCaller: async () => '{"shouldExpand":false,"patch":null}',
      costCap: 10,
      maxAgents: 10,
    });

    const result = await handler.handle({
      graph: makeGraph([makeNode('worker'), makeNode('deliver')]),
      runId: 'run-reassign',
      nodeId: 'worker',
      state: {
        input: {},
        scratch: {},
        artifacts: {},
        diagnostics: {},
        visitedNodes: ['worker'],
        iteration: 1,
      } as any,
      request: {
        trigger: 'supervisor_manage',
        reason: 'Worker should switch to critique mode',
        request: {
          action: 'reassign_role',
          spec: {
            nodeId: 'deliver',
            instructions: 'Critique the draft before delivery',
          },
          reason: 'Worker should switch to critique mode',
        },
      },
      completedNodes: ['worker'],
      skippedNodes: [],
      nodeResults: {},
    });

    const deliverNode = result?.graph?.nodes.find((node) => node.id === 'deliver');
    expect(deliverNode?.executorConfig).toMatchObject({
      type: 'gmi',
      instructions: 'Critique the draft before delivery',
    });
    expect(result?.graph?.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: START, target: 'worker', type: 'static' }),
        expect.objectContaining({ source: 'worker', target: 'deliver', type: 'static' }),
        expect.objectContaining({ source: 'deliver', target: END, type: 'static' }),
      ]),
    );
  });

  it('inserts a tool node inline for add_tool actions', async () => {
    const handler = createMissionExpansionHandler({
      autonomy: 'autonomous',
      thresholds: DEFAULT_THRESHOLDS,
      llmCaller: async () => '{"shouldExpand":false,"patch":null}',
      costCap: 10,
      maxAgents: 10,
    });

    const result = await handler.handle({
      graph: makeGraph([makeNode('worker'), makeNode('deliver')]),
      runId: 'run-add-tool',
      nodeId: 'worker',
      state: {
        input: {},
        scratch: {},
        artifacts: {},
        diagnostics: {},
        visitedNodes: ['worker'],
        iteration: 1,
      } as any,
      request: {
        trigger: 'supervisor_manage',
        reason: 'Need a web search step',
        request: {
          action: 'add_tool',
          spec: {
            toolName: 'web_search',
            nodeId: 'web_search_tool',
            args: { q: 'latest release' },
          },
          reason: 'Need a web search step',
        },
      },
      completedNodes: ['worker'],
      skippedNodes: [],
      nodeResults: {},
    });

    const toolNode = result?.graph?.nodes.find((node) => node.id === 'web_search_tool');
    expect(toolNode).toMatchObject({
      type: 'tool',
      executorConfig: {
        type: 'tool',
        toolName: 'web_search',
        args: { q: 'latest release' },
      },
    });
    expect(result?.graph?.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: 'worker', target: 'web_search_tool', type: 'static' }),
        expect.objectContaining({ source: 'web_search_tool', target: 'deliver', type: 'static' }),
      ]),
    );
  });

  it('adds a parallel branch for fork_branch actions', async () => {
    const handler = createMissionExpansionHandler({
      autonomy: 'autonomous',
      thresholds: DEFAULT_THRESHOLDS,
      llmCaller: async () => '{"shouldExpand":false,"patch":null}',
      costCap: 10,
      maxAgents: 10,
    });

    const result = await handler.handle({
      graph: makeGraph([makeNode('worker'), makeNode('deliver')]),
      runId: 'run-fork',
      nodeId: 'worker',
      state: {
        input: {},
        scratch: {},
        artifacts: {},
        diagnostics: {},
        visitedNodes: ['worker'],
        iteration: 1,
      } as any,
      request: {
        trigger: 'supervisor_manage',
        reason: 'Run a parallel fact-check branch',
        request: {
          action: 'fork_branch',
          spec: {
            nodeId: 'fact_checker',
            instructions: 'Fact-check the draft in parallel',
          },
          reason: 'Run a parallel fact-check branch',
        },
      },
      completedNodes: ['worker'],
      skippedNodes: [],
      nodeResults: {},
    });

    expect(result?.graph?.nodes.map((node) => node.id)).toEqual(
      expect.arrayContaining(['worker', 'deliver', 'fact_checker']),
    );
    expect(result?.graph?.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: 'worker', target: 'deliver', type: 'static' }),
        expect.objectContaining({ source: 'worker', target: 'fact_checker', type: 'static' }),
        expect.objectContaining({ source: 'fact_checker', target: 'deliver', type: 'static' }),
      ]),
    );
  });

  it('blocks tool-node expansions when the tool forge cap is exceeded', async () => {
    const handler = createMissionExpansionHandler({
      autonomy: 'guardrailed',
      thresholds: {
        ...DEFAULT_THRESHOLDS,
        maxToolForges: 0,
      },
      llmCaller: async () => '{"shouldExpand":false,"patch":null}',
      costCap: 10,
      maxAgents: 10,
    });

    const result = await handler.handle({
      graph: makeGraph([makeNode('worker')]),
      runId: 'run-1',
      nodeId: 'worker',
      state: {
        input: {},
        scratch: {},
        artifacts: {},
        diagnostics: {},
        visitedNodes: ['worker'],
        iteration: 1,
      } as any,
      request: {
        trigger: 'agent_request',
        reason: 'Need a tool verifier',
        request: {},
        patch: {
          addNodes: [
            {
              id: 'verify_tool',
              type: 'tool',
              executorConfig: {
                type: 'tool',
                toolName: 'verify_result',
              },
              executionMode: 'single_turn',
              effectClass: 'read',
              checkpoint: 'after',
            },
          ],
          addEdges: [
            {
              id: 'worker-verify',
              source: 'worker',
              target: 'verify_tool',
              type: 'static',
            },
          ],
          removeNodes: [],
          rewireEdges: [
            { from: 'worker', to: END, newTarget: 'verify_tool' },
          ],
          reason: 'Need a tool verifier',
          estimatedCostDelta: 0.2,
          estimatedLatencyDelta: 200,
        },
      },
      completedNodes: ['worker'],
      skippedNodes: [],
      nodeResults: {},
    });

    expect(result?.graph).toBeUndefined();
    expect(result?.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'mission:threshold_reached',
          threshold: 'maxToolForges',
        }),
        expect.objectContaining({
          type: 'mission:approval_required',
          action: 'apply_graph_patch',
        }),
      ]),
    );
  });

  it('blocks expansions that increase graph depth beyond the configured cap', async () => {
    const handler = createMissionExpansionHandler({
      autonomy: 'guardrailed',
      thresholds: {
        ...DEFAULT_THRESHOLDS,
        maxDepth: 1,
      },
      llmCaller: async () => '{"shouldExpand":false,"patch":null}',
      costCap: 10,
      maxAgents: 10,
    });

    const result = await handler.handle({
      graph: makeGraph([makeNode('worker')]),
      runId: 'run-2',
      nodeId: 'worker',
      state: {
        input: {},
        scratch: {},
        artifacts: {},
        diagnostics: {},
        visitedNodes: ['worker'],
        iteration: 1,
      } as any,
      request: {
        trigger: 'agent_request',
        reason: 'Need a deeper verifier',
        request: {},
        patch: {
          addNodes: [makeNode('verifier')],
          addEdges: [
            {
              id: 'verifier-end',
              source: 'verifier',
              target: END,
              type: 'static',
            },
          ],
          removeNodes: [],
          rewireEdges: [
            { from: 'worker', to: END, newTarget: 'verifier' },
          ],
          reason: 'Need a deeper verifier',
          estimatedCostDelta: 0.2,
          estimatedLatencyDelta: 200,
        },
      },
      completedNodes: ['worker'],
      skippedNodes: [],
      nodeResults: {},
    });

    expect(result?.graph).toBeUndefined();
    expect(result?.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'mission:threshold_reached',
          threshold: 'maxDepth',
        }),
      ]),
    );
  });

  it('tracks tool forge usage across applied expansions', async () => {
    const handler = createMissionExpansionHandler({
      autonomy: 'guardrailed',
      thresholds: {
        ...DEFAULT_THRESHOLDS,
        maxToolForges: 1,
      },
      llmCaller: async () => '{"shouldExpand":false,"patch":null}',
      costCap: 10,
      maxAgents: 10,
    });

    const baseGraph = makeGraph([makeNode('worker')]);

    const first = await handler.handle({
      graph: baseGraph,
      runId: 'run-3',
      nodeId: 'worker',
      state: {
        input: {},
        scratch: {},
        artifacts: {},
        diagnostics: {},
        visitedNodes: ['worker'],
        iteration: 1,
      } as any,
      request: {
        trigger: 'agent_request',
        reason: 'Need a first tool',
        request: {},
        patch: {
          addNodes: [
            {
              id: 'tool_one',
              type: 'tool',
              executorConfig: {
                type: 'tool',
                toolName: 'tool_one',
              },
              executionMode: 'single_turn',
              effectClass: 'read',
              checkpoint: 'after',
            },
          ],
          addEdges: [],
          removeNodes: [],
          rewireEdges: [
            { from: 'worker', to: END, newTarget: 'tool_one' },
          ],
          reason: 'Need a first tool',
          estimatedCostDelta: 0.2,
          estimatedLatencyDelta: 200,
        },
      },
      completedNodes: ['worker'],
      skippedNodes: [],
      nodeResults: {},
    });

    expect(first?.graph).toBeDefined();
    expect(first?.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'mission:expansion_approved',
          by: 'auto',
        }),
      ]),
    );

    const second = await handler.handle({
      graph: first?.graph ?? baseGraph,
      runId: 'run-3',
      nodeId: 'tool_one',
      state: {
        input: {},
        scratch: {},
        artifacts: {},
        diagnostics: {},
        visitedNodes: ['worker', 'tool_one'],
        iteration: 2,
      } as any,
      request: {
        trigger: 'agent_request',
        reason: 'Need a second tool',
        request: {},
        patch: {
          addNodes: [
            {
              id: 'tool_two',
              type: 'tool',
              executorConfig: {
                type: 'tool',
                toolName: 'tool_two',
              },
              executionMode: 'single_turn',
              effectClass: 'read',
              checkpoint: 'after',
            },
          ],
          addEdges: [],
          removeNodes: [],
          rewireEdges: [
            { from: 'tool_one', to: END, newTarget: 'tool_two' },
          ],
          reason: 'Need a second tool',
          estimatedCostDelta: 0.2,
          estimatedLatencyDelta: 200,
        },
      },
      completedNodes: ['worker', 'tool_one'],
      skippedNodes: [],
      nodeResults: {},
    });

    expect(second?.graph).toBeUndefined();
    expect(second?.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'mission:threshold_reached',
          threshold: 'maxToolForges',
        }),
      ]),
    );
  });
});
