#!/usr/bin/env node

import {
  AgentGraph,
  END,
  GraphRuntime,
  InMemoryCheckpointStore,
  START,
  gmiNode,
  humanNode,
  toolNode,
} from '../dist/index.js';
import { z } from 'zod';

function formatEvent(event) {
  switch (event.type) {
    case 'run_start':
      return `run_start ${event.runId}`;
    case 'node_start':
      return `node_start ${event.nodeId}`;
    case 'node_end':
      return `node_end ${event.nodeId}`;
    case 'interrupt':
      return `interrupt ${event.nodeId}`;
    case 'checkpoint_saved':
      return `checkpoint_saved ${event.nodeId}`;
    case 'edge_transition':
      return `edge_transition ${event.sourceId} -> ${event.targetId}`;
    case 'run_end':
      return 'run_end';
    default:
      return event.type;
  }
}

const graph = new AgentGraph(
  {
    input: z.object({ topic: z.string() }),
    scratch: z.object({ draft: z.string().optional() }),
    artifacts: z.object({
      status: z.string().optional(),
      summary: z.string().optional(),
    }),
  },
  {
    checkpointPolicy: 'every_node',
  },
)
  .addNode(
    'draft-summary',
    gmiNode(
      {
        instructions: 'Draft a concise summary for the requested topic.',
        executionMode: 'single_turn',
      },
      { checkpoint: 'after' },
    ),
  )
  .addNode('human-review', humanNode({ prompt: 'Approve this draft before publishing?' }))
  .addNode(
    'publish',
    toolNode('publish_report', undefined, {
      effectClass: 'write',
      checkpoint: 'after',
    }),
  )
  .addEdge(START, 'draft-summary')
  .addEdge('draft-summary', 'human-review')
  .addEdge('human-review', 'publish')
  .addEdge('publish', END)
  .compile();

const checkpointStore = new InMemoryCheckpointStore();
const runtime = new GraphRuntime({
  checkpointStore,
  nodeExecutor: {
    async execute(node, state) {
      const config = node.executorConfig;

      switch (config.type) {
        case 'gmi':
          return {
            success: true,
            output: 'drafted summary',
            scratchUpdate: {
              draft: `Summary draft for "${state.input.topic}" with explicit checkpoints.`,
            },
          };

        case 'human':
          return {
            success: false,
            output: { approved: true, reviewer: 'demo-human' },
            interrupt: true,
          };

        case 'tool':
          return {
            success: true,
            output: { published: true },
            artifactsUpdate: {
              status: 'published',
              summary: state.scratch.draft,
            },
          };

        default:
          return { success: true, output: `noop:${node.id}` };
      }
    },
  },
});

async function main() {
  console.log('=== AgentGraph ===');
  console.log('Compiled nodes:', graph.toIR().nodes.map((node) => node.id).join(' -> '));

  let runId;
  for await (const event of runtime.stream(graph.toIR(), { topic: 'checkpoint debugging' })) {
    console.log(formatEvent(event));
    if (event.type === 'run_start') {
      runId = event.runId;
    }
  }

  if (!runId) {
    throw new Error('Expected a run id from GraphRuntime.stream().');
  }

  console.log('\nResuming after the human-review checkpoint...');
  const result = await runtime.resume(graph.toIR(), runId);

  console.log('\nFinal artifacts:');
  console.dir(result, { depth: null });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
