import { describe, it, expect } from 'vitest';
import { ToolExecutor } from '../../../src/core/tools/ToolExecutor';
import { ITool, ToolExecutionResult } from '../../../src/core/tools/ITool';
import { ToolCallRequest, UserContext } from '../../../src/cognitive_substrate/IGMI';

const userContext: UserContext = { userId: 'u-1' };

const makeTool = (overrides?: Partial<ITool>): ITool => ({
  id: 'echo-tool',
  name: 'echo',
  displayName: 'Echo',
  description: 'Echoes text',
  inputSchema: {
    type: 'object',
    properties: { text: { type: 'string' } },
    required: ['text'],
  },
  execute: async (args: any): Promise<ToolExecutionResult> => ({
    success: true,
    output: { text: args.text },
  }),
  ...overrides,
});

const makeRequest = (name: string, args: Record<string, any> = { text: 'hi' }): ToolCallRequest => ({
  id: 'call-1',
  name,
  arguments: args,
});

describe('ToolExecutor', () => {
  it('registers and executes a tool successfully', async () => {
    const executor = new ToolExecutor();
    const tool = makeTool();
    await executor.registerTool(tool);

    const result = await executor.executeTool({
      toolCallRequest: makeRequest('echo', { text: 'hello' }),
      gmiId: 'gmi-1',
      personaId: 'persona-1',
      personaCapabilities: [],
      userContext,
    });

    expect(result.success).toBe(true);
    expect(result.output).toEqual({ text: 'hello' });
  });

  it('fails when tool not found', async () => {
    const executor = new ToolExecutor();
    const result = await executor.executeTool({
      toolCallRequest: makeRequest('missing'),
      gmiId: 'gmi-1',
      personaId: 'persona-1',
      personaCapabilities: [],
      userContext,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('rejects missing required capabilities', async () => {
    const executor = new ToolExecutor();
    const guardedTool = makeTool({ requiredCapabilities: ['can-run'] });
    await executor.registerTool(guardedTool);

    const result = await executor.executeTool({
      toolCallRequest: makeRequest('echo', { text: 'hi' }),
      gmiId: 'gmi-1',
      personaId: 'persona-1',
      personaCapabilities: ['other-cap'],
      userContext,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('lacks capabilities');
  });

  it('returns error when arguments fail JSON parsing', async () => {
    const executor = new ToolExecutor();
    await executor.registerTool(makeTool());

    const result = await executor.executeTool({
      toolCallRequest: { ...makeRequest('echo'), arguments: 'not-json' },
      gmiId: 'gmi-1',
      personaId: 'persona-1',
      personaCapabilities: [],
      userContext,
    });

    expect(result.success).toBe(false);
    expect(String(result.error)).toContain('Failed to parse arguments');
  });

  it('returns validation errors when required args missing', async () => {
    const executor = new ToolExecutor();
    await executor.registerTool(makeTool());

    const result = await executor.executeTool({
      toolCallRequest: makeRequest('echo', {}),
      gmiId: 'gmi-1',
      personaId: 'persona-1',
      personaCapabilities: [],
      userContext,
    });

    expect(result.success).toBe(false);
    expect(String(result.error)).toContain('Invalid arguments');
  });
});

