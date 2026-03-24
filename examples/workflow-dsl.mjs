#!/usr/bin/env node

import { GraphRuntime, InMemoryCheckpointStore, workflow } from '../dist/index.js';
import { z } from 'zod';

function formatEvent(event) {
  switch (event.type) {
    case 'run_start':
      return `run_start ${event.runId}`;
    case 'node_start':
      return `node_start ${event.nodeId}`;
    case 'node_end':
      return `node_end ${event.nodeId}`;
    case 'edge_transition':
      return `edge_transition ${event.sourceId} -> ${event.targetId} (${event.edgeType})`;
    case 'checkpoint_saved':
      return `checkpoint_saved ${event.nodeId}`;
    case 'run_end':
      return 'run_end';
    default:
      return event.type;
  }
}

const onboarding = workflow('user-onboarding')
  .input(
    z.object({
      email: z.string().email(),
      name: z.string(),
      desiredPlan: z.enum(['free', 'pro']),
    }),
  )
  .returns(
    z.object({
      userId: z.string().optional(),
      plan: z.enum(['free', 'pro']).optional(),
      summary: z.string().optional(),
    }),
  )
  .step('validate-email', { tool: 'email_validator' })
  .branch(
    (state) => state.input.desiredPlan,
    {
      pro: { tool: 'activate_pro_plan' },
      free: { tool: 'create_free_account' },
    },
  )
  .parallel(
    [
      { tool: 'send_welcome_email' },
      { tool: 'notify_crm' },
    ],
    {
      strategy: 'all',
      merge: { 'scratch.completedTasks': 'concat' },
    },
  )
  .then('summarize', {
    gmi: { instructions: 'Summarize the onboarding result for the caller.' },
  })
  .compile();

const runtime = new GraphRuntime({
  checkpointStore: new InMemoryCheckpointStore(),
  nodeExecutor: {
    async execute(node, state) {
      const config = node.executorConfig;

      switch (config.type) {
        case 'tool': {
          switch (config.toolName) {
            case 'email_validator':
              return {
                success: true,
                output: { valid: true },
                scratchUpdate: { completedTasks: ['validated email'] },
              };
            case 'activate_pro_plan':
              return {
                success: true,
                output: { activated: true },
                artifactsUpdate: { userId: 'usr_pro_001', plan: 'pro' },
              };
            case 'create_free_account':
              return {
                success: true,
                output: { created: true },
                artifactsUpdate: { userId: 'usr_free_001', plan: 'free' },
              };
            case 'send_welcome_email':
              return {
                success: true,
                output: 'queued welcome email',
                scratchUpdate: { completedTasks: ['queued welcome email'] },
              };
            case 'notify_crm':
              return {
                success: true,
                output: 'updated CRM',
                scratchUpdate: { completedTasks: ['updated CRM'] },
              };
            default:
              return { success: true, output: `handled tool ${config.toolName}` };
          }
        }

        case 'router':
          return {
            success: true,
            output: config.condition.type === 'function'
              ? config.condition.fn(state)
              : state.input.desiredPlan,
          };

        case 'gmi':
          return {
            success: true,
            output: 'summary ready',
            artifactsUpdate: {
              ...state.artifacts,
              summary: [
                `Created a ${state.artifacts.plan} account for ${state.input.name}.`,
                `Completed tasks: ${(state.scratch.completedTasks ?? []).join(', ')}.`,
              ].join(' '),
            },
          };

        default:
          return { success: true, output: `noop:${node.id}` };
      }
    },
  },
});

async function main() {
  console.log('=== workflow() DSL ===');
  console.log('Compiled nodes:', onboarding.toIR().nodes.map((node) => node.id).join(' -> '));

  let finalOutput;
  for await (const event of runtime.stream(onboarding.toIR(), {
    email: 'johnn@example.com',
    name: 'John',
    desiredPlan: 'pro',
  })) {
    console.log(formatEvent(event));
    if (event.type === 'run_end') {
      finalOutput = event.finalOutput;
    }
  }

  console.log('\nFinal artifacts:');
  console.dir(finalOutput, { depth: null });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
