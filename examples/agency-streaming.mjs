#!/usr/bin/env node
// Example: agency().stream() raw live output vs finalized approved output
//
// Usage:
//   export OPENAI_API_KEY="sk-..."
//   node examples/agency-streaming.mjs

import { agency } from '../dist/index.js';

const provider = process.env.AGENTOS_PROVIDER || 'openai';

async function main() {
  const team = agency({
    provider,
    strategy: 'sequential',
    agents: {
      researcher: {
        instructions:
          'You are a careful researcher. Gather the most important facts and risks.',
      },
      writer: {
        instructions:
          'You are a concise writer. Turn the research into four crisp bullet points.',
      },
    },
    hitl: {
      approvals: { beforeReturn: true },
      handler: async () => ({
        approved: true,
        modifications: {
          output:
            'Approved for delivery:\n' +
            '- Rollout risk 1\n' +
            '- Rollout risk 2\n' +
            '- Rollout risk 3\n' +
            '- Rollout risk 4',
        },
      }),
    },
  });

  const stream = team.stream('Summarize the main HTTP/3 rollout risks.');

  console.log('=== raw textStream ===\n');
  for await (const chunk of stream.textStream) {
    process.stdout.write(chunk);
  }
  process.stdout.write('\n');

  console.log('\n=== fullStream final-output ===\n');
  for await (const event of stream.fullStream) {
    if (event.type === 'final-output') {
      console.log(event.text);
      console.log(`agentCalls=${event.agentCalls.length}`);
    }
  }

  console.log('\n=== finalTextStream ===\n');
  for await (const approved of stream.finalTextStream) {
    console.log(approved);
  }

  console.log('\n=== finalized scalars ===\n');
  console.log(await stream.text);
  console.log(await stream.usage);

  await team.close();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
