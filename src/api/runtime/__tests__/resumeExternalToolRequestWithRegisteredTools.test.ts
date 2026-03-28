import { describe, expect, it, vi } from 'vitest';

import { AgentOSServiceError } from '../../errors';
import {
  buildPendingExternalToolExecutionContext,
  executePendingExternalToolCall,
  executePendingExternalToolCalls,
  resumeExternalToolRequestWithRegisteredTools,
} from '../resumeExternalToolRequestWithRegisteredTools';
import type { AgentOSPendingExternalToolRequest } from '../../types/AgentOSExternalToolRequest';
import { AgentOSResponseChunkType, type AgentOSResponse } from '../../types/AgentOSResponse';
import type { ITool, ToolExecutionContext } from '../../../core/tools/ITool';

const pendingRequest: AgentOSPendingExternalToolRequest = {
  streamId: 'stream-pending',
  sessionId: 'session-pending',
  conversationId: 'conv-pending',
  userId: 'user-1',
  personaId: 'persona-1',
  gmiInstanceId: 'gmi-1',
  toolCalls: [
    {
      id: 'tool-1',
      name: 'memory_search',
      arguments: { query: 'prefs', scope: 'organization' },
    },
    {
      id: 'tool-2',
      name: 'memory_add',
      arguments: { content: 'Remember this', scope: 'organization' },
    },
  ],
  requestedAt: new Date().toISOString(),
};

async function collectStream(stream: AsyncIterable<AgentOSResponse>): Promise<AgentOSResponse[]> {
  const chunks: AgentOSResponse[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return chunks;
}

describe('resumeExternalToolRequestWithRegisteredTools', () => {
  it('builds the resume-time tool execution context from the pending request', () => {
    const context = buildPendingExternalToolExecutionContext(pendingRequest, {
      organizationId: 'org-alpha',
      userContext: {
        skillLevel: 'expert',
      },
    });

    expect(context).toEqual({
      gmiId: 'gmi-1',
      personaId: 'persona-1',
      correlationId: 'stream-pending',
      userContext: {
        userId: 'user-1',
        skillLevel: 'expert',
        organizationId: 'org-alpha',
      },
      sessionData: {
        sessionId: 'session-pending',
        conversationId: 'conv-pending',
        organizationId: 'org-alpha',
      },
    } satisfies ToolExecutionContext);
  });

  it('executes pending registered tools in order', async () => {
    const observedContexts: ToolExecutionContext[] = [];
    const tools = new Map<string, ITool>([
      [
        'memory_search',
        {
          id: 'memory-search-v1',
          name: 'memory_search',
          displayName: 'Memory Search',
          description: 'Search memory.',
          inputSchema: { type: 'object' },
          execute: vi.fn(async (_args, context) => {
            observedContexts.push(context);
            return {
              success: true,
              output: { results: [{ content: 'Org prefers shortcuts.' }] },
            };
          }),
        } satisfies ITool,
      ],
      [
        'memory_add',
        {
          id: 'memory-add-v1',
          name: 'memory_add',
          displayName: 'Memory Add',
          description: 'Add memory.',
          inputSchema: { type: 'object' },
          execute: vi.fn(async (_args, context) => {
            observedContexts.push(context);
            return {
              success: true,
              output: { traceId: 'mt_123' },
            };
          }),
        } satisfies ITool,
      ],
    ]);

    const agentos = {
      getToolOrchestrator: () => ({
        getTool: vi.fn(async (toolName: string) => tools.get(toolName)),
      }),
    };

    const results = await executePendingExternalToolCalls(agentos as any, pendingRequest, {
      organizationId: 'org-alpha',
      userContext: {
        skillLevel: 'expert',
      },
    });

    expect(results).toEqual([
      {
        toolCallId: 'tool-1',
        toolName: 'memory_search',
        toolOutput: { results: [{ content: 'Org prefers shortcuts.' }] },
        isSuccess: true,
        errorMessage: undefined,
      },
      {
        toolCallId: 'tool-2',
        toolName: 'memory_add',
        toolOutput: { traceId: 'mt_123' },
        isSuccess: true,
        errorMessage: undefined,
      },
    ]);
    expect(observedContexts).toHaveLength(2);
    expect(observedContexts[0]?.correlationId).toBe('tool-1');
    expect(observedContexts[1]?.correlationId).toBe('tool-2');
    expect(observedContexts[0]?.sessionData).toEqual({
      sessionId: 'session-pending',
      conversationId: 'conv-pending',
      organizationId: 'org-alpha',
    });
  });

  it('throws a service error when a pending registered tool is missing', async () => {
    const agentos = {
      getToolOrchestrator: () => ({
        getTool: vi.fn(async () => undefined),
      }),
    };

    await expect(
      executePendingExternalToolCall(agentos as any, pendingRequest, pendingRequest.toolCalls[0]!)
    ).rejects.toBeInstanceOf(AgentOSServiceError);
  });

  it('executes pending registered tools and resumes the stream', async () => {
    const tool = {
      id: 'memory-search-v1',
      name: 'memory_search',
      displayName: 'Memory Search',
      description: 'Search memory.',
      inputSchema: { type: 'object' },
      execute: vi.fn(async () => ({
        success: true,
        output: { results: [{ content: 'Org prefers shortcuts.' }] },
      })),
    } satisfies ITool;

    const agentos = {
      getToolOrchestrator: () => ({
        getTool: vi.fn(async () => tool),
      }),
      resumeExternalToolRequest: vi.fn(async function* (
        _pendingRequest: AgentOSPendingExternalToolRequest,
        toolResults: any[],
        options: Record<string, unknown>
      ) {
        yield {
          type: AgentOSResponseChunkType.FINAL_RESPONSE,
          streamId: 'stream-pending',
          gmiInstanceId: 'gmi-1',
          personaId: 'persona-1',
          isFinal: true,
          timestamp: new Date().toISOString(),
          finalResponseText: `Resumed with ${toolResults.length} tool result(s).`,
          metadata: options,
        } satisfies AgentOSResponse;
      }),
    };

    const chunks = await collectStream(
      resumeExternalToolRequestWithRegisteredTools(
        agentos as any,
        {
          ...pendingRequest,
          toolCalls: [pendingRequest.toolCalls[0]!],
        },
        {
          organizationId: 'org-alpha',
        }
      )
    );

    expect(agentos.resumeExternalToolRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conv-pending',
      }),
      [
        {
          toolCallId: 'tool-1',
          toolName: 'memory_search',
          toolOutput: { results: [{ content: 'Org prefers shortcuts.' }] },
          isSuccess: true,
          errorMessage: undefined,
        },
      ],
      {
        organizationId: 'org-alpha',
      }
    );
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.type).toBe(AgentOSResponseChunkType.FINAL_RESPONSE);
  });

  it('temporarily registers prompt-aware externalTools during resumed streaming and cleans them up', async () => {
    const registeredTools: string[] = [];

    const getTool = vi.fn(async (toolName: string) =>
      registeredTools.includes(toolName) ? ({ name: toolName } as any) : undefined
    );
    const registerTool = vi.fn(async (tool: ITool) => {
      registeredTools.push(tool.name);
    });
    const unregisterTool = vi.fn(async (toolName: string) => {
      const index = registeredTools.indexOf(toolName);
      if (index >= 0) {
        registeredTools.splice(index, 1);
      }
      return true;
    });

    const agentos = {
      getToolOrchestrator: () => ({
        getTool,
        registerTool,
        unregisterTool,
      }),
      resumeExternalToolRequest: vi.fn(async function* () {
        expect(registeredTools).toContain('open_profile');
        yield {
          type: AgentOSResponseChunkType.FINAL_RESPONSE,
          streamId: 'stream-pending',
          gmiInstanceId: 'gmi-1',
          personaId: 'persona-1',
          isFinal: true,
          timestamp: new Date().toISOString(),
          finalResponseText: 'Resumed.',
        } satisfies AgentOSResponse;
      }),
    };

    const customPendingRequest: AgentOSPendingExternalToolRequest = {
      ...pendingRequest,
      toolCalls: [
        {
          id: 'tool-3',
          name: 'open_profile',
          arguments: { profileId: 'profile-1' },
        },
      ],
    };

    const chunks = await collectStream(
      resumeExternalToolRequestWithRegisteredTools(agentos as any, customPendingRequest, {
        externalTools: {
          open_profile: {
            description: 'Load a user profile by ID.',
            inputSchema: {
              type: 'object',
              properties: {
                profileId: { type: 'string' },
              },
              required: ['profileId'],
            },
            execute: vi.fn(async () => ({
              success: true,
              output: { profile: { id: 'profile-1' } },
            })),
          },
        },
      })
    );

    expect(registerTool).toHaveBeenCalledTimes(1);
    expect(unregisterTool).toHaveBeenCalledWith('open_profile');
    expect(registeredTools).toEqual([]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.type).toBe(AgentOSResponseChunkType.FINAL_RESPONSE);
  });

  it('executes host-managed external tools from externalTools during resume', async () => {
    let observedContext: ToolExecutionContext | undefined;

    const agentos = {
      getToolOrchestrator: () => ({
        getTool: vi.fn(async () => undefined),
      }),
      resumeExternalToolRequest: vi.fn(async function* (
        _pendingRequest: AgentOSPendingExternalToolRequest,
        toolResults: any[],
        options: Record<string, unknown>
      ) {
        yield {
          type: AgentOSResponseChunkType.FINAL_RESPONSE,
          streamId: 'stream-pending',
          gmiInstanceId: 'gmi-1',
          personaId: 'persona-1',
          isFinal: true,
          timestamp: new Date().toISOString(),
          finalResponseText: `Resumed with ${toolResults.length} tool result(s).`,
          metadata: options,
        } satisfies AgentOSResponse;
      }),
    };

    const customPendingRequest: AgentOSPendingExternalToolRequest = {
      ...pendingRequest,
      toolCalls: [
        {
          id: 'tool-3',
          name: 'open_profile',
          arguments: { profileId: 'profile-1' },
        },
      ],
    };

    const chunks = await collectStream(
      resumeExternalToolRequestWithRegisteredTools(agentos as any, customPendingRequest, {
        organizationId: 'org-alpha',
        externalTools: {
          open_profile: async (_args, context) => {
            observedContext = context;
            return {
              success: true,
              output: { profile: { timezone: 'UTC' } },
            };
          },
        },
      })
    );

    expect(observedContext).toEqual({
      gmiId: 'gmi-1',
      personaId: 'persona-1',
      correlationId: 'tool-3',
      userContext: {
        userId: 'user-1',
        organizationId: 'org-alpha',
      },
      sessionData: {
        sessionId: 'session-pending',
        conversationId: 'conv-pending',
        organizationId: 'org-alpha',
      },
    } satisfies ToolExecutionContext);
    expect(agentos.resumeExternalToolRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conv-pending',
      }),
      [
        {
          toolCallId: 'tool-3',
          toolName: 'open_profile',
          toolOutput: { profile: { timezone: 'UTC' } },
          isSuccess: true,
          errorMessage: undefined,
        },
      ],
      {
        organizationId: 'org-alpha',
      }
    );
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.type).toBe(AgentOSResponseChunkType.FINAL_RESPONSE);
  });

  it('defaults to agentos.getExternalToolRegistry() when resume-time externalTools are omitted', async () => {
    let observedContext: ToolExecutionContext | undefined;

    const agentos = {
      getExternalToolRegistry: () => ({
        open_profile: async (_args: Record<string, any>, context: ToolExecutionContext) => {
          observedContext = context;
          return {
            success: true,
            output: { profile: { timezone: 'UTC' } },
          };
        },
      }),
      getToolOrchestrator: () => ({
        getTool: vi.fn(async () => undefined),
      }),
      resumeExternalToolRequest: vi.fn(async function* (
        _pendingRequest: AgentOSPendingExternalToolRequest,
        toolResults: any[],
        options: Record<string, unknown>
      ) {
        yield {
          type: AgentOSResponseChunkType.FINAL_RESPONSE,
          streamId: 'stream-pending',
          gmiInstanceId: 'gmi-1',
          personaId: 'persona-1',
          isFinal: true,
          timestamp: new Date().toISOString(),
          finalResponseText: `Resumed with ${toolResults.length} tool result(s).`,
          metadata: options,
        } satisfies AgentOSResponse;
      }),
    };

    const customPendingRequest: AgentOSPendingExternalToolRequest = {
      ...pendingRequest,
      toolCalls: [
        {
          id: 'tool-3',
          name: 'open_profile',
          arguments: { profileId: 'profile-1' },
        },
      ],
    };

    const chunks = await collectStream(
      resumeExternalToolRequestWithRegisteredTools(agentos as any, customPendingRequest, {
        organizationId: 'org-alpha',
      })
    );

    expect(observedContext?.sessionData).toEqual({
      sessionId: 'session-pending',
      conversationId: 'conv-pending',
      organizationId: 'org-alpha',
    });
    expect(agentos.resumeExternalToolRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conv-pending',
      }),
      [
        {
          toolCallId: 'tool-3',
          toolName: 'open_profile',
          toolOutput: { profile: { timezone: 'UTC' } },
          isSuccess: true,
          errorMessage: undefined,
        },
      ],
      {
        organizationId: 'org-alpha',
      }
    );
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.type).toBe(AgentOSResponseChunkType.FINAL_RESPONSE);
  });

  it('falls back to a host handler for pending unregistered tools in the same pause', async () => {
    const tools = new Map<string, ITool>([
      [
        'memory_search',
        {
          id: 'memory-search-v1',
          name: 'memory_search',
          displayName: 'Memory Search',
          description: 'Search memory.',
          inputSchema: { type: 'object' },
          execute: vi.fn(async () => ({
            success: true,
            output: { results: [{ content: 'Org prefers shortcuts.' }] },
          })),
        } satisfies ITool,
      ],
    ]);

    const fallbackExternalToolHandler = vi.fn(async ({ toolCall }) => ({
      toolOutput: { handledBy: toolCall.name, profile: { timezone: 'UTC' } },
      isSuccess: true,
    }));

    const agentos = {
      getToolOrchestrator: () => ({
        getTool: vi.fn(async (toolName: string) => tools.get(toolName)),
      }),
      resumeExternalToolRequest: vi.fn(async function* (
        _pendingRequest: AgentOSPendingExternalToolRequest,
        toolResults: any[]
      ) {
        yield {
          type: AgentOSResponseChunkType.FINAL_RESPONSE,
          streamId: 'stream-pending',
          gmiInstanceId: 'gmi-1',
          personaId: 'persona-1',
          isFinal: true,
          timestamp: new Date().toISOString(),
          finalResponseText: `Resumed with ${toolResults.length} tool result(s).`,
        } satisfies AgentOSResponse;
      }),
    };

    const mixedPendingRequest: AgentOSPendingExternalToolRequest = {
      ...pendingRequest,
      toolCalls: [
        pendingRequest.toolCalls[0]!,
        {
          id: 'tool-3',
          name: 'open_profile',
          arguments: { profileId: 'profile-1' },
        },
      ],
    };

    const chunks = await collectStream(
      resumeExternalToolRequestWithRegisteredTools(agentos as any, mixedPendingRequest, {
        organizationId: 'org-alpha',
        fallbackExternalToolHandler,
      })
    );

    expect(fallbackExternalToolHandler).toHaveBeenCalledTimes(1);
    expect(fallbackExternalToolHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        pendingRequest: expect.objectContaining({
          conversationId: 'conv-pending',
        }),
        toolCall: expect.objectContaining({
          id: 'tool-3',
          name: 'open_profile',
        }),
      })
    );
    expect(agentos.resumeExternalToolRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conv-pending',
      }),
      [
        {
          toolCallId: 'tool-1',
          toolName: 'memory_search',
          toolOutput: { results: [{ content: 'Org prefers shortcuts.' }] },
          isSuccess: true,
          errorMessage: undefined,
        },
        {
          toolCallId: 'tool-3',
          toolName: 'open_profile',
          toolOutput: {
            handledBy: 'open_profile',
            profile: { timezone: 'UTC' },
          },
          isSuccess: true,
          errorMessage: undefined,
        },
      ],
      {
        organizationId: 'org-alpha',
      }
    );
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.type).toBe(AgentOSResponseChunkType.FINAL_RESPONSE);
  });
});
