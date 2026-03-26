// packages/agentos/tests/api/tool-adapter.spec.ts
import { describe, it, expect } from 'vitest';
import { adaptTools, adaptToolsToMap, mergeAdaptableTools } from '../../src/api/toolAdapter.js';

describe('adaptTools', () => {
  it('adapts JSON Schema tool', () => {
    const tools = adaptTools({
      search: {
        description: 'Search the web',
        parameters: {
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query'],
        },
        execute: async ({ query }: any) => ({ results: [query] }),
      },
    });
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('search');
    expect(tools[0].description).toBe('Search the web');
    expect(tools[0].inputSchema.type).toBe('object');
  });

  it('passes through ITool instances', () => {
    const tool = {
      id: 'test-v1',
      name: 'test',
      displayName: 'Test',
      description: 'A test',
      inputSchema: { type: 'object', properties: {} },
      hasSideEffects: false,
      execute: async () => ({ success: true, output: 'ok' }),
    };
    const tools = adaptTools({ test: tool as any });
    expect(tools).toHaveLength(1);
    expect(tools[0].id).toBe('test-v1');
  });

  it('returns empty array for undefined', () => {
    expect(adaptTools(undefined)).toEqual([]);
  });

  it('adapts external tool registries provided as Map entries', async () => {
    const tools = adaptTools(
      new Map([
        [
          'open_profile',
          {
            description: 'Load a saved profile record by ID.',
            inputSchema: {
              type: 'object',
              properties: { profileId: { type: 'string' } },
              required: ['profileId'],
            },
            execute: async (_args: any) => ({
              success: true,
              output: { profile: { id: 'profile-1' } },
            }),
          },
        ],
      ])
    );

    expect(tools).toHaveLength(1);
    expect(tools[0]?.name).toBe('open_profile');
    expect(tools[0]?.inputSchema.required).toEqual(['profileId']);
    await expect(tools[0]?.execute({ profileId: 'profile-1' }, {} as any)).resolves.toMatchObject({
      success: true,
      output: { profile: { id: 'profile-1' } },
    });
  });

  it('adapts ToolDefinitionForLLM arrays as prompt-only tools', async () => {
    const tools = adaptTools([
      {
        name: 'open_profile',
        description: 'Load a saved profile record by ID.',
        inputSchema: {
          type: 'object',
          properties: { profileId: { type: 'string' } },
          required: ['profileId'],
        },
      },
    ]);

    expect(tools).toHaveLength(1);
    await expect(tools[0]?.execute({ profileId: 'profile-1' }, {} as any)).resolves.toMatchObject({
      success: false,
      error: 'No executor configured for prompt-only tool "open_profile".',
    });
  });

  it('converts adaptable tool inputs into a named tool map', () => {
    const tools = adaptToolsToMap([
      {
        name: 'open_profile',
        description: 'Load a saved profile record by ID.',
        inputSchema: {
          type: 'object',
          properties: { profileId: { type: 'string' } },
          required: ['profileId'],
        },
      },
    ]);

    expect(Object.keys(tools)).toEqual(['open_profile']);
    expect(tools.open_profile).toMatchObject({
      name: 'open_profile',
      description: 'Load a saved profile record by ID.',
    });
  });

  it('merges adaptable tool inputs with later inputs winning by name', () => {
    const merged = mergeAdaptableTools(
      new Map([
        [
          'search',
          {
            description: 'Shared search tool.',
            inputSchema: { type: 'object', properties: {} },
            execute: async () => ({ success: true, output: 'shared' }),
          },
        ],
      ]),
      {
        search: {
          description: 'Agent-specific search tool.',
          parameters: { type: 'object', properties: {} },
          execute: async () => ({ success: true, output: 'agent' }),
        },
      }
    );

    expect(Object.keys(merged ?? {})).toEqual(['search']);
    expect(merged?.search).toMatchObject({
      name: 'search',
      description: 'Agent-specific search tool.',
    });
  });
});
