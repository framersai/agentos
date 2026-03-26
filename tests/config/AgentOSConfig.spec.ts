import { afterEach, describe, expect, it } from 'vitest';

import { createAgentOSConfig, createTestAgentOSConfig } from '../../src/config/AgentOSConfig';

describe('AgentOSConfig factory helpers', () => {
  const originalEnv = { ...process.env };
  const createdPrismaClients: Array<{ $disconnect?: () => Promise<unknown> }> = [];

  afterEach(async () => {
    process.env = { ...originalEnv };

    for (const prisma of createdPrismaClients.splice(0)) {
      try {
        await prisma.$disconnect?.();
      } catch {
        // best effort cleanup for config factory tests
      }
    }
  });

  it('passes runtime tools and externalTools through createAgentOSConfig()', async () => {
    process.env.DATABASE_URL = 'file:./test.db';

    const tools = new Map([
      [
        'open_profile',
        {
          description: 'Load a saved profile record by ID.',
          inputSchema: {
            type: 'object',
            properties: {
              profileId: { type: 'string' },
            },
            required: ['profileId'],
          },
          execute: async () => ({
            success: true,
            output: { profile: { id: 'profile-1' } },
          }),
        },
      ],
    ]);

    const externalTools = {
      refresh_cache: async () => ({
        success: true,
        output: { refreshed: true },
      }),
    };

    const config = await createAgentOSConfig({
      tools,
      externalTools,
    });
    createdPrismaClients.push(config.prisma as any);

    expect(config.tools).toBe(tools);
    expect(config.externalTools).toBe(externalTools);
  });

  it('forwards runtime tools through createTestAgentOSConfig()', async () => {
    const tools = [
      {
        name: 'open_profile',
        description: 'Load a saved profile record by ID.',
        inputSchema: {
          type: 'object',
          properties: {
            profileId: { type: 'string' },
          },
          required: ['profileId'],
        },
      },
    ];

    const config = await createTestAgentOSConfig({ tools });
    createdPrismaClients.push(config.prisma as any);

    expect(config.tools).toBe(tools);
    expect(process.env.DATABASE_URL).toBe('file:./test.db');
  });
});
