#!/usr/bin/env node

import { AgentOS } from '../dist/index.js';
import { createTestAgentOSConfig } from '../dist/core/config/AgentOSConfig.js';

async function main() {
  const agent = new AgentOS();

  const config = await createTestAgentOSConfig({
    tools: {
      open_profile: {
        description: 'Load a saved profile record by ID.',
        inputSchema: {
          type: 'object',
          properties: {
            profileId: { type: 'string' },
          },
          required: ['profileId'],
        },
        execute: async ({ profileId }) => ({
          success: true,
          output: {
            profile: {
              id: profileId,
              preferredTheme: 'solarized',
            },
          },
        }),
      },
    },
  });

  await agent.initialize(config);

  const tool = await agent.getToolOrchestrator().getTool('open_profile');
  console.log(`registered=${Boolean(tool)}`);

  const result = await tool?.execute({ profileId: 'profile-1' }, {});
  console.log(JSON.stringify(result, null, 2));

  await agent.shutdown();
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
