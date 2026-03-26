import { describe, expect, it, vi } from 'vitest';

import { AgentOSServiceError } from '../errors';
import {
  buildRegisteredExternalToolExecutionContext,
  processRequestWithRegisteredTools,
} from '../processRequestWithRegisteredTools';
import {
  AgentOSResponseChunkType,
  type AgentOSActionableToolCallRequestChunk,
  type AgentOSResponse,
} from '../types/AgentOSResponse';
import type { ToolExecutionContext, ITool } from '../../core/tools/ITool';

function createChunk(chunk: Record<string, unknown>): AgentOSResponse {
  return {
    ...chunk,
    timestamp: new Date().toISOString(),
  } as AgentOSResponse;
}

async function collectStream(stream: AsyncIterable<AgentOSResponse>): Promise<AgentOSResponse[]> {
  const chunks: AgentOSResponse[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return chunks;
}

function createDeferred(): {
  promise: Promise<void>;
  resolve: () => void;
} {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('processRequestWithRegisteredTools', () => {
  it('builds tool execution context from streamed chunk metadata', () => {
    const requestChunk: AgentOSActionableToolCallRequestChunk = {
      type: AgentOSResponseChunkType.TOOL_CALL_REQUEST,
      streamId: 'stream-1',
      gmiInstanceId: 'gmi-1',
      personaId: 'persona-1',
      isFinal: false,
      timestamp: new Date().toISOString(),
      toolCalls: [{ id: 'tool-1', name: 'memory_add', arguments: { scope: 'thread' } }],
      executionMode: 'external',
      requiresExternalToolResult: true,
      metadata: {
        sessionId: 'session-derived',
        conversationId: 'conv-derived',
        organizationId: 'org-derived',
      },
    };

    const context = buildRegisteredExternalToolExecutionContext(
      {
        userId: 'user-1',
        sessionId: 'session-input',
        textInput: 'Remember this.',
      },
      {
        requestChunk,
        toolCall: requestChunk.toolCalls[0]!,
      }
    );

    expect(context).toEqual({
      gmiId: 'gmi-1',
      personaId: 'persona-1',
      correlationId: 'tool-1',
      userContext: {
        userId: 'user-1',
        organizationId: 'org-derived',
      },
      sessionData: {
        sessionId: 'session-derived',
        conversationId: 'conv-derived',
        organizationId: 'org-derived',
      },
    } satisfies ToolExecutionContext);
  });

  it('executes registered tools and resumes the stream automatically', async () => {
    let observedContext: ToolExecutionContext | undefined;

    const tool = {
      id: 'memory-add-v1',
      name: 'memory_add',
      displayName: 'Memory Add',
      description: 'Add memory.',
      inputSchema: { type: 'object' },
      execute: vi.fn(async (_args, context) => {
        observedContext = context;
        return {
          success: true,
          output: { traceId: 'mt_123' },
        };
      }),
    } satisfies ITool;

    const agentos = {
      processRequest: async function* () {
        yield createChunk({
          type: AgentOSResponseChunkType.TOOL_CALL_REQUEST,
          streamId: 'stream-1',
          gmiInstanceId: 'gmi-1',
          personaId: 'persona-1',
          isFinal: false,
          toolCalls: [
            {
              id: 'tool-1',
              name: 'memory_add',
              arguments: { content: 'Remember this', scope: 'thread' },
            },
          ],
          executionMode: 'external',
          requiresExternalToolResult: true,
          metadata: {
            sessionId: 'session-live',
            conversationId: 'conv-live',
          },
        });
      },
      handleToolResult: vi.fn(async function* () {
        yield createChunk({
          type: AgentOSResponseChunkType.FINAL_RESPONSE,
          streamId: 'stream-1',
          gmiInstanceId: 'gmi-1',
          personaId: 'persona-1',
          isFinal: true,
          finalResponseText: 'Done.',
        });
      }),
      getToolOrchestrator: () => ({
        getTool: vi.fn(async () => tool),
      }),
    };

    const chunks = await collectStream(
      processRequestWithRegisteredTools(
        agentos as any,
        {
          userId: 'user-1',
          sessionId: 'session-live',
          textInput: 'Remember this.',
        },
        {
          organizationId: 'org-live',
        }
      )
    );

    expect(tool.execute).toHaveBeenCalledTimes(1);
    expect(observedContext?.sessionData).toEqual({
      sessionId: 'session-live',
      conversationId: 'conv-live',
      organizationId: 'org-live',
    });
    expect(agentos.handleToolResult).toHaveBeenCalledTimes(1);
    expect(chunks.map((chunk) => chunk.type)).toEqual([
      AgentOSResponseChunkType.TOOL_CALL_REQUEST,
      AgentOSResponseChunkType.FINAL_RESPONSE,
    ]);
  });

  it('temporarily registers prompt-aware externalTools for planning and cleans them up', async () => {
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
      processRequest: async function* () {
        expect(registeredTools).toContain('open_profile');
        yield createChunk({
          type: AgentOSResponseChunkType.FINAL_RESPONSE,
          streamId: 'stream-1',
          gmiInstanceId: 'gmi-1',
          personaId: 'persona-1',
          isFinal: true,
          finalResponseText: 'Done.',
        });
      },
      handleToolResult: vi.fn(),
      getToolOrchestrator: () => ({
        getTool,
        registerTool,
        unregisterTool,
      }),
    };

    const chunks = await collectStream(
      processRequestWithRegisteredTools(
        agentos as any,
        {
          userId: 'user-1',
          sessionId: 'session-live',
          textInput: 'Load my profile.',
        },
        {
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
        }
      )
    );

    expect(registerTool).toHaveBeenCalledTimes(1);
    expect(registerTool.mock.calls[0]?.[0]).toMatchObject({
      name: 'open_profile',
      description: 'Load a user profile by ID.',
    });
    expect(unregisterTool).toHaveBeenCalledWith('open_profile');
    expect(registeredTools).toEqual([]);
    expect(chunks.map((chunk) => chunk.type)).toEqual([AgentOSResponseChunkType.FINAL_RESPONSE]);
  });

  it('reference-counts prompt-aware externalTools across overlapping helper streams', async () => {
    const registeredTools: string[] = [];
    const releaseTurns = createDeferred();
    const firstTurnStarted = createDeferred();
    let processRequestCallCount = 0;

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
      processRequest: async function* () {
        processRequestCallCount += 1;
        if (processRequestCallCount === 1) {
          firstTurnStarted.resolve();
        }
        await releaseTurns.promise;
        yield createChunk({
          type: AgentOSResponseChunkType.FINAL_RESPONSE,
          streamId: 'stream-1',
          gmiInstanceId: 'gmi-1',
          personaId: 'persona-1',
          isFinal: true,
          finalResponseText: 'Done.',
        });
      },
      handleToolResult: vi.fn(),
      getToolOrchestrator: () => ({
        getTool,
        registerTool,
        unregisterTool,
      }),
    };

    const options = {
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
    };

    const firstStream = collectStream(
      processRequestWithRegisteredTools(
        agentos as any,
        {
          userId: 'user-1',
          sessionId: 'session-live-1',
          textInput: 'Load my profile.',
        },
        options
      )
    );
    await firstTurnStarted.promise;

    const secondStream = collectStream(
      processRequestWithRegisteredTools(
        agentos as any,
        {
          userId: 'user-2',
          sessionId: 'session-live-2',
          textInput: 'Load my profile too.',
        },
        options
      )
    );

    expect(registerTool).toHaveBeenCalledTimes(1);
    expect(registeredTools).toEqual(['open_profile']);

    releaseTurns.resolve();
    await Promise.all([firstStream, secondStream]);

    expect(unregisterTool).toHaveBeenCalledTimes(1);
    expect(unregisterTool).toHaveBeenCalledWith('open_profile');
    expect(registeredTools).toEqual([]);
  });

  it('executes host-managed external tools from externalTools with live-turn context', async () => {
    let observedContext: ToolExecutionContext | undefined;

    const agentos = {
      processRequest: async function* () {
        yield createChunk({
          type: AgentOSResponseChunkType.TOOL_CALL_REQUEST,
          streamId: 'stream-1',
          gmiInstanceId: 'gmi-1',
          personaId: 'persona-1',
          isFinal: false,
          toolCalls: [
            {
              id: 'tool-2',
              name: 'open_profile',
              arguments: { profileId: 'profile-1' },
            },
          ],
          executionMode: 'external',
          requiresExternalToolResult: true,
          metadata: {
            sessionId: 'session-live',
            conversationId: 'conv-live',
            organizationId: 'org-live',
          },
        });
      },
      handleToolResult: vi.fn(async function* () {
        yield createChunk({
          type: AgentOSResponseChunkType.FINAL_RESPONSE,
          streamId: 'stream-1',
          gmiInstanceId: 'gmi-1',
          personaId: 'persona-1',
          isFinal: true,
          finalResponseText: 'Done.',
        });
      }),
      getToolOrchestrator: () => ({
        getTool: vi.fn(async () => undefined),
      }),
    };

    const chunks = await collectStream(
      processRequestWithRegisteredTools(
        agentos as any,
        {
          userId: 'user-1',
          sessionId: 'session-input',
          textInput: 'Load my profile.',
        },
        {
          externalTools: {
            open_profile: async (_args, context) => {
              observedContext = context;
              return {
                success: true,
                output: { profile: { preferredTheme: 'solarized' } },
              };
            },
          },
        }
      )
    );

    expect(observedContext).toEqual({
      gmiId: 'gmi-1',
      personaId: 'persona-1',
      correlationId: 'tool-2',
      userContext: {
        userId: 'user-1',
        organizationId: 'org-live',
      },
      sessionData: {
        sessionId: 'session-live',
        conversationId: 'conv-live',
        organizationId: 'org-live',
      },
    } satisfies ToolExecutionContext);
    expect(agentos.handleToolResult).toHaveBeenCalledWith(
      'stream-1',
      'tool-2',
      'open_profile',
      { profile: { preferredTheme: 'solarized' } },
      true,
      undefined
    );
    expect(chunks.map((chunk) => chunk.type)).toEqual([
      AgentOSResponseChunkType.TOOL_CALL_REQUEST,
      AgentOSResponseChunkType.FINAL_RESPONSE,
    ]);
  });

  it('defaults to agentos.getExternalToolRegistry() when per-call externalTools are omitted', async () => {
    let observedContext: ToolExecutionContext | undefined;
    const registeredTools = new Map<string, ITool>();

    const getTool = vi.fn(async (toolName: string) => registeredTools.get(toolName));
    const registerTool = vi.fn(async (tool: ITool) => {
      registeredTools.set(tool.name, tool);
    });
    const unregisterTool = vi.fn(async (toolName: string) => {
      registeredTools.delete(toolName);
      return true;
    });

    const agentos = {
      processRequest: async function* () {
        expect(registeredTools.has('open_profile')).toBe(true);
        yield createChunk({
          type: AgentOSResponseChunkType.TOOL_CALL_REQUEST,
          streamId: 'stream-1',
          gmiInstanceId: 'gmi-1',
          personaId: 'persona-1',
          isFinal: false,
          toolCalls: [
            {
              id: 'tool-3',
              name: 'open_profile',
              arguments: { profileId: 'profile-1' },
            },
          ],
          executionMode: 'external',
          requiresExternalToolResult: true,
          metadata: {
            sessionId: 'session-live',
            conversationId: 'conv-live',
          },
        });
      },
      handleToolResult: vi.fn(async function* () {
        yield createChunk({
          type: AgentOSResponseChunkType.FINAL_RESPONSE,
          streamId: 'stream-1',
          gmiInstanceId: 'gmi-1',
          personaId: 'persona-1',
          isFinal: true,
          finalResponseText: 'Done.',
        });
      }),
      getExternalToolRegistry: () => ({
        open_profile: {
          description: 'Load a user profile by ID.',
          inputSchema: {
            type: 'object',
            properties: {
              profileId: { type: 'string' },
            },
            required: ['profileId'],
          },
          execute: vi.fn(async (_args, context) => {
            observedContext = context;
            return {
              success: true,
              output: { profile: { preferredTheme: 'solarized' } },
            };
          }),
        },
      }),
      getToolOrchestrator: () => ({
        getTool,
        registerTool,
        unregisterTool,
      }),
    };

    const chunks = await collectStream(
      processRequestWithRegisteredTools(agentos as any, {
        userId: 'user-1',
        sessionId: 'session-input',
        textInput: 'Load my profile.',
      })
    );

    expect(registerTool).toHaveBeenCalledTimes(1);
    expect(observedContext?.sessionData).toEqual({
      sessionId: 'session-live',
      conversationId: 'conv-live',
    });
    expect(unregisterTool).toHaveBeenCalledWith('open_profile');
    expect(chunks.map((chunk) => chunk.type)).toEqual([
      AgentOSResponseChunkType.TOOL_CALL_REQUEST,
      AgentOSResponseChunkType.FINAL_RESPONSE,
    ]);
  });

  it('prefers per-call externalTools over the configured registry for the same tool name', async () => {
    let executedSource: 'configured' | 'override' | undefined;

    const agentos = {
      processRequest: async function* () {
        yield createChunk({
          type: AgentOSResponseChunkType.TOOL_CALL_REQUEST,
          streamId: 'stream-1',
          gmiInstanceId: 'gmi-1',
          personaId: 'persona-1',
          isFinal: false,
          toolCalls: [
            {
              id: 'tool-4',
              name: 'open_profile',
              arguments: { profileId: 'profile-1' },
            },
          ],
          executionMode: 'external',
          requiresExternalToolResult: true,
        });
      },
      handleToolResult: vi.fn(async function* () {
        yield createChunk({
          type: AgentOSResponseChunkType.FINAL_RESPONSE,
          streamId: 'stream-1',
          gmiInstanceId: 'gmi-1',
          personaId: 'persona-1',
          isFinal: true,
          finalResponseText: 'Done.',
        });
      }),
      getExternalToolRegistry: () => ({
        open_profile: async () => {
          executedSource = 'configured';
          return {
            success: true,
            output: { source: 'configured' },
          };
        },
      }),
      getToolOrchestrator: () => ({
        getTool: vi.fn(async () => undefined),
      }),
    };

    await collectStream(
      processRequestWithRegisteredTools(
        agentos as any,
        {
          userId: 'user-1',
          sessionId: 'session-input',
          textInput: 'Load my profile.',
        },
        {
          externalTools: {
            open_profile: async () => {
              executedSource = 'override';
              return {
                success: true,
                output: { source: 'override' },
              };
            },
          },
        }
      )
    );

    expect(executedSource).toBe('override');
    expect(agentos.handleToolResult).toHaveBeenCalledWith(
      'stream-1',
      'tool-4',
      'open_profile',
      { source: 'override' },
      true,
      undefined
    );
  });

  it('falls back to a host handler for unregistered external tools in the same pause', async () => {
    const registeredTool = {
      id: 'memory-search-v1',
      name: 'memory_search',
      displayName: 'Memory Search',
      description: 'Search memory.',
      inputSchema: { type: 'object' },
      execute: vi.fn(async () => ({
        success: true,
        output: { results: [{ content: 'User prefers shortcuts.' }] },
      })),
    } satisfies ITool;

    const fallbackExternalToolHandler = vi.fn(async ({ toolCall }) => ({
      toolOutput: { profile: { preferredTheme: 'solarized' }, handledBy: toolCall.name },
      isSuccess: true,
    }));

    const getTool = vi.fn(async (toolName: string) =>
      toolName === 'memory_search' ? registeredTool : undefined
    );

    const agentos = {
      processRequest: async function* () {
        yield createChunk({
          type: AgentOSResponseChunkType.TOOL_CALL_REQUEST,
          streamId: 'stream-1',
          gmiInstanceId: 'gmi-1',
          personaId: 'persona-1',
          isFinal: false,
          toolCalls: [
            {
              id: 'tool-1',
              name: 'memory_search',
              arguments: { query: 'prefs' },
            },
            {
              id: 'tool-2',
              name: 'open_profile',
              arguments: { profileId: 'profile-1' },
            },
          ],
          executionMode: 'external',
          requiresExternalToolResult: true,
        });
      },
      handleToolResult: vi.fn(),
      handleToolResults: vi.fn(async function* (_streamId: string, toolResults: any[]) {
        yield createChunk({
          type: AgentOSResponseChunkType.FINAL_RESPONSE,
          streamId: 'stream-1',
          gmiInstanceId: 'gmi-1',
          personaId: 'persona-1',
          isFinal: true,
          finalResponseText: `Handled ${toolResults.length} tools.`,
        });
      }),
      getToolOrchestrator: () => ({
        getTool,
      }),
    };

    const chunks = await collectStream(
      processRequestWithRegisteredTools(
        agentos as any,
        {
          userId: 'user-1',
          sessionId: 'session-live',
          textInput: 'Search memory and load the profile.',
        },
        {
          fallbackExternalToolHandler,
        }
      )
    );

    expect(getTool).toHaveBeenCalledTimes(2);
    expect(registeredTool.execute).toHaveBeenCalledTimes(1);
    expect(fallbackExternalToolHandler).toHaveBeenCalledTimes(1);
    expect(fallbackExternalToolHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        streamId: 'stream-1',
        toolCall: expect.objectContaining({
          id: 'tool-2',
          name: 'open_profile',
        }),
      })
    );
    expect(agentos.handleToolResult).not.toHaveBeenCalled();
    expect(agentos.handleToolResults).toHaveBeenCalledWith('stream-1', [
      {
        toolCallId: 'tool-1',
        toolName: 'memory_search',
        toolOutput: { results: [{ content: 'User prefers shortcuts.' }] },
        isSuccess: true,
        errorMessage: undefined,
      },
      {
        toolCallId: 'tool-2',
        toolName: 'open_profile',
        toolOutput: {
          profile: { preferredTheme: 'solarized' },
          handledBy: 'open_profile',
        },
        isSuccess: true,
        errorMessage: undefined,
      },
    ]);
    expect(chunks.map((chunk) => chunk.type)).toEqual([
      AgentOSResponseChunkType.TOOL_CALL_REQUEST,
      AgentOSResponseChunkType.FINAL_RESPONSE,
    ]);
  });

  it('throws when a registered external tool is missing', async () => {
    const agentos = {
      processRequest: async function* () {
        yield createChunk({
          type: AgentOSResponseChunkType.TOOL_CALL_REQUEST,
          streamId: 'stream-1',
          gmiInstanceId: 'gmi-1',
          personaId: 'persona-1',
          isFinal: false,
          toolCalls: [{ id: 'tool-1', name: 'memory_add', arguments: {} }],
          executionMode: 'external',
          requiresExternalToolResult: true,
        });
      },
      handleToolResult: vi.fn(),
      getToolOrchestrator: () => ({
        getTool: vi.fn(async () => undefined),
      }),
    };

    await expect(
      collectStream(
        processRequestWithRegisteredTools(agentos as any, {
          userId: 'user-1',
          sessionId: 'session-live',
          textInput: 'Remember this.',
        })
      )
    ).rejects.toBeInstanceOf(AgentOSServiceError);
  });
});
