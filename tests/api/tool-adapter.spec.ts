// packages/agentos/tests/api/tool-adapter.spec.ts
import { describe, it, expect } from 'vitest';
import { adaptTools, type ToolDefinition } from '../../src/api/toolAdapter.js';

describe('adaptTools', () => {
  it('adapts JSON Schema tool', () => {
    const tools = adaptTools({
      search: {
        description: 'Search the web',
        parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
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
      id: 'test-v1', name: 'test', displayName: 'Test', description: 'A test',
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
});
