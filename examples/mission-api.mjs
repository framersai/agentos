#!/usr/bin/env node

import {
  GraphRuntime,
  InMemoryCheckpointStore,
  mission,
  toolNode,
} from '../dist/index.js';
import { z } from 'zod';

const deepResearch = mission('deep-research')
  .input(z.object({ topic: z.string() }))
  .goal('Research {{topic}} thoroughly and produce a cited summary')
  .returns(
    z.object({
      summary: z.string().optional(),
      confidence: z.number().optional(),
      verified: z.boolean().optional(),
    }),
  )
  .planner({
    strategy: 'plan_and_execute',
    maxSteps: 6,
    maxIterationsPerNode: 2,
    parallelTools: true,
  })
  .policy({
    guardrails: ['grounding-guard'],
  })
  .anchor(
    'fact-check',
    toolNode('grounding_verifier'),
    {
      required: true,
      phase: 'validate',
      after: 'process-info',
    },
  )
  .compile();

const runtime = new GraphRuntime({
  checkpointStore: new InMemoryCheckpointStore(),
  nodeExecutor: {
    async execute(node, state) {
      switch (node.id) {
        case 'gather-info':
          return {
            success: true,
            output: 'gathered research notes',
            scratchUpdate: {
              notes: [
                `Background research for ${state.input.topic}`,
                'Collected vendor docs and recent implementation notes',
              ],
            },
          };

        case 'process-info':
          return {
            success: true,
            output: 'drafted synthesis',
            scratchUpdate: {
              draft: `${state.input.topic} is best explained as a graph runtime layered over deterministic and planner-driven entrypoints.`,
              confidence: 0.88,
            },
          };

        case 'fact-check':
          return {
            success: true,
            output: { verified: true },
            scratchUpdate: { verified: true },
          };

        case 'deliver-result':
          return {
            success: true,
            output: 'delivered summary',
            artifactsUpdate: {
              summary: state.scratch.draft,
              confidence: state.scratch.confidence,
              verified: Boolean(state.scratch.verified),
            },
          };

        default:
          return {
            success: true,
            output: `handled:${node.id}`,
          };
      }
    },
  },
});

async function main() {
  console.log('=== mission() ===');

  const explanation = await deepResearch.explain({ topic: 'unified orchestration' });
  console.log('Generated steps:');
  console.table(
    explanation.steps.map((step) => ({
      id: step.id,
      type: step.type,
      executor: step.config.type,
    })),
  );

  const result = await runtime.invoke(deepResearch.toIR(), {
    topic: 'unified orchestration',
  });

  console.log('\nFinal artifacts:');
  console.dir(result, { depth: null });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
