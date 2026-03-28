import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentOS, type AgentOSConfig } from '../../src/api/AgentOS';
import { processRequestWithExternalTools } from '../../src/api/processRequestWithExternalTools';
import { processRequestWithRegisteredTools } from '../../src/api/processRequestWithRegisteredTools';
import type { AgentOSInput } from '../../src/api/types/AgentOSInput';
import { AGENTOS_PENDING_EXTERNAL_TOOL_REQUEST_METADATA_KEY } from '../../src/api/types/AgentOSExternalToolRequest';
import {
  AgentOSResponseChunkType,
  type AgentOSFinalResponseChunk,
  type AgentOSMetadataUpdateChunk,
  type AgentOSResponse,
  type AgentOSToolCallRequestChunk,
  type AgentOSToolResultEmissionChunk,
} from '../../src/api/types/AgentOSResponse';
import { GMI } from '../../src/cognitive_substrate/GMI';
import {
  GMIOutputChunkType,
  type GMIOutput,
  type GMITurnInput,
} from '../../src/cognitive_substrate/IGMI';
import { InMemoryWorkingMemory } from '../../src/cognitive_substrate/memory/InMemoryWorkingMemory';
import type { ToolExecutionContext } from '../../src/core/tools/ITool';
import type { ChatMessage, ModelCompletionResponse } from '../../src/core/llm/providers/IProvider';
import { GMIManager } from '../../src/cognitive_substrate/GMIManager';
import { ConversationContext } from '../../src/core/conversation/ConversationContext';
import { PromptEngine } from '../../src/core/llm/PromptEngine';
import { Memory } from '../../src/memory/io/facade/Memory';

function createConfig(overrides: Partial<AgentOSConfig> = {}): AgentOSConfig {
  return {
    gmiManagerConfig: {
      personaLoaderConfig: {
        personaSource: './personas',
        loaderType: 'file_system',
        options: {},
      },
    },
    orchestratorConfig: {},
    promptEngineConfig: {},
    toolOrchestratorConfig: {},
    toolPermissionManagerConfig: {},
    conversationManagerConfig: {
      persistenceEnabled: false,
    },
    streamingManagerConfig: {},
    modelProviderManagerConfig: {
      providers: [],
    },
    defaultPersonaId: 'test-persona',
    prisma: {} as any,
    utilityAIService: {
      summarizeConversationHistory: async () => ({
        summaryMessages: [],
        originalTokenCount: 0,
        finalTokenCount: 0,
        messagesSummarized: 0,
      }),
      summarizeRAGContext: async () => ({
        summary: '',
        originalTokenCount: 0,
        finalTokenCount: 0,
        preservedSources: [],
      }),
    } as any,
    ...overrides,
  };
}

async function collectResponses(agentos: AgentOS, input: AgentOSInput): Promise<AgentOSResponse[]> {
  return collectStream(agentos.processRequest(input));
}

async function collectStream(stream: AsyncIterable<AgentOSResponse>): Promise<AgentOSResponse[]> {
  const responses: AgentOSResponse[] = [];
  for await (const chunk of stream) {
    responses.push(chunk);
  }
  return responses;
}

async function collectStreamWithTimeout(
  stream: AsyncIterable<AgentOSResponse>,
  timeoutMs = 1000
): Promise<AgentOSResponse[]> {
  return Promise.race([
    collectStream(stream),
    new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Timed out after ${timeoutMs}ms while collecting AgentOS stream.`));
      }, timeoutMs);
    }),
  ]);
}

describe('AgentOS.processRequest standalone memory integration', () => {
  const tempDirs: string[] = [];
  const openMemories: Memory[] = [];
  const openAgents: AgentOS[] = [];
  const openGmis: GMI[] = [];

  beforeEach(() => {
    vi.spyOn(AgentOS.prototype as any, 'initializeWorkflowRuntime').mockResolvedValue(undefined);
    vi.spyOn(AgentOS.prototype as any, 'startWorkflowRuntime').mockResolvedValue(undefined);
    vi.spyOn(AgentOS.prototype as any, 'initializeTurnPlanner').mockResolvedValue(undefined);
    vi.spyOn(AgentOS.prototype as any, 'initializeRagSubsystem').mockResolvedValue(undefined);
    vi.spyOn(PromptEngine.prototype, 'initialize').mockResolvedValue(undefined);
    vi.spyOn(PromptEngine.prototype, 'clearCache').mockResolvedValue(undefined);
    vi.spyOn(GMIManager.prototype, 'initialize').mockResolvedValue(undefined);
    vi.spyOn(GMIManager.prototype, 'shutdown').mockResolvedValue(undefined);
  });

  afterEach(async () => {
    for (const gmi of openGmis.splice(0)) {
      try {
        await gmi.shutdown();
      } catch {
        // best effort cleanup
      }
    }

    for (const agent of openAgents.splice(0)) {
      try {
        await agent.shutdown();
      } catch {
        // best effort cleanup
      }
    }

    for (const memory of openMemories.splice(0)) {
      try {
        await memory.close();
      } catch {
        // already closed
      }
    }

    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }

    vi.restoreAllMocks();
  });

  async function createTempMemory(): Promise<Memory> {
    const dir = mkdtempSync(join(tmpdir(), 'agentos-process-memory-'));
    tempDirs.push(dir);

    const memory = await Memory.create({
      path: join(dir, 'brain.sqlite'),
      selfImprove: true,
    });
    openMemories.push(memory);
    return memory;
  }

  it('injects standalone long-term memory into a live processRequest turn', async () => {
    const memory = await createTempMemory();
    await memory.remember('User preference: command palettes and keyboard-driven workflows.', {
      type: 'semantic',
      scope: 'user',
      scopeId: 'user-1',
      tags: ['preferences'],
    });

    const conversationContext = new ConversationContext('conv-live');
    let capturedGmiInput: GMITurnInput | undefined;

    const fakeGmi = {
      getCurrentPrimaryPersonaId: () => 'test-persona',
      getGMIId: () => 'gmi-live-memory',
      processTurnStream: async function* (
        input: GMITurnInput
      ): AsyncGenerator<never, GMIOutput, undefined> {
        capturedGmiInput = input;
        return {
          isFinal: true,
          responseText: `Memory seen:\n${String(input.metadata?.longTermMemoryContext ?? 'none')}`,
        };
      },
    };

    vi.spyOn(GMIManager.prototype, 'getOrCreateGMIForSession').mockResolvedValue({
      gmi: fakeGmi,
      conversationContext,
    } as any);

    const agentos = new AgentOS();
    openAgents.push(agentos);

    await agentos.initialize(
      createConfig({
        standaloneMemory: {
          memory,
          longTermRetriever: true,
        },
      })
    );

    const responses = await collectResponses(agentos, {
      userId: 'user-1',
      sessionId: 'session-1',
      conversationId: 'conv-live',
      textInput: 'What are my command palette workflow preferences?',
      selectedPersonaId: 'test-persona',
      memoryControl: {
        longTermMemory: {
          scopes: {
            user: true,
          },
        },
      },
    });

    const metadataChunk = responses.find(
      (chunk): chunk is AgentOSMetadataUpdateChunk =>
        chunk.type === AgentOSResponseChunkType.METADATA_UPDATE &&
        Boolean((chunk as AgentOSMetadataUpdateChunk).updates?.longTermMemoryRetrieval)
    );
    const finalChunk = responses.find(
      (chunk): chunk is AgentOSFinalResponseChunk =>
        chunk.type === AgentOSResponseChunkType.FINAL_RESPONSE
    );

    expect(capturedGmiInput?.metadata?.longTermMemoryContext).toContain('User Memory');
    expect(capturedGmiInput?.metadata?.longTermMemoryContext).toContain(
      'command palettes and keyboard-driven workflows'
    );
    expect(metadataChunk?.updates.longTermMemoryRetrieval).toMatchObject({
      shouldReview: true,
      didRetrieve: true,
    });
    expect(finalChunk?.finalResponseText).toContain('User Memory');
    expect(finalChunk?.finalResponseText).toContain(
      'command palettes and keyboard-driven workflows'
    );
  });

  it('continues a live turn through handleToolResult with the registered memory_search tool', async () => {
    const memory = await createTempMemory();
    await memory.remember('User preference: keyboard shortcuts over nested menus.', {
      type: 'semantic',
      scope: 'user',
      scopeId: 'user-1',
      tags: ['preferences'],
    });

    const conversationContext = new ConversationContext('conv-tool');
    const toolCall = {
      id: 'tool-call-memory-search-1',
      name: 'memory_search',
      arguments: {
        query: 'keyboard shortcuts',
        scope: 'user',
        limit: 3,
      },
    };

    const fakePersona = {
      id: 'test-persona',
      name: 'Test Persona',
      version: '1.0.0',
      baseSystemPrompt: 'You are a memory-aware assistant.',
    };

    const fakeGmi = {
      getCurrentPrimaryPersonaId: () => 'test-persona',
      getGMIId: () => 'gmi-memory-tool',
      getPersona: () => fakePersona,
      processTurnStream: async function* (): AsyncGenerator<any, GMIOutput, undefined> {
        yield {
          type: GMIOutputChunkType.TOOL_CALL_REQUEST,
          content: [toolCall],
          interactionId: 'interaction-memory-tool',
          timestamp: new Date(),
          metadata: {
            executionMode: 'external',
            requiresExternalToolResult: true,
          },
        };

        return {
          isFinal: false,
          responseText: 'I need to search memory before I can answer.',
          toolCalls: [toolCall],
        };
      },
      handleToolResult: vi.fn(
        async (_toolCallId: string, _toolName: string, resultPayload: any): Promise<GMIOutput> => {
          const firstResult =
            resultPayload.type === 'success' ? resultPayload.result?.results?.[0]?.content : null;

          return {
            isFinal: true,
            responseText: firstResult
              ? `Found memory: ${firstResult}`
              : 'No matching memory found.',
          };
        }
      ),
    };

    vi.spyOn(GMIManager.prototype, 'getOrCreateGMIForSession').mockResolvedValue({
      gmi: fakeGmi,
      conversationContext,
    } as any);

    const agentos = new AgentOS();
    openAgents.push(agentos);

    await agentos.initialize(
      createConfig({
        standaloneMemory: {
          memory,
          tools: true,
        },
      })
    );

    const initialChunks = await collectResponses(agentos, {
      userId: 'user-1',
      sessionId: 'session-tool',
      conversationId: 'conv-tool',
      textInput: 'Search memory for my menu preferences.',
      selectedPersonaId: 'test-persona',
    });

    const toolRequestChunk = initialChunks.find(
      (chunk): chunk is AgentOSToolCallRequestChunk =>
        chunk.type === AgentOSResponseChunkType.TOOL_CALL_REQUEST
    );

    expect(toolRequestChunk).toBeDefined();
    expect(toolRequestChunk?.toolCalls).toHaveLength(1);
    expect(toolRequestChunk?.toolCalls[0]?.name).toBe('memory_search');
    expect(toolRequestChunk?.executionMode).toBe('external');
    expect(toolRequestChunk?.requiresExternalToolResult).toBe(true);
    expect(
      initialChunks.some((chunk) => chunk.type === AgentOSResponseChunkType.FINAL_RESPONSE)
    ).toBe(false);

    const tool = await agentos.getToolOrchestrator().getTool('memory_search');
    expect(tool).toBeDefined();

    const toolExecution = await tool!.execute(toolCall.arguments, {
      gmiId: 'gmi-memory-tool',
      personaId: 'test-persona',
      userContext: { userId: 'user-1' } as any,
    } satisfies ToolExecutionContext);

    expect(toolExecution.success).toBe(true);

    const continuationChunks: AgentOSResponse[] = [];
    for await (const chunk of agentos.handleToolResult(
      toolRequestChunk!.streamId,
      toolCall.id,
      toolCall.name,
      toolExecution.output,
      true
    )) {
      continuationChunks.push(chunk);
    }

    const toolResultChunk = continuationChunks.find(
      (chunk): chunk is AgentOSToolResultEmissionChunk =>
        chunk.type === AgentOSResponseChunkType.TOOL_RESULT_EMISSION
    );
    const finalChunk = continuationChunks.find(
      (chunk): chunk is AgentOSFinalResponseChunk =>
        chunk.type === AgentOSResponseChunkType.FINAL_RESPONSE
    );

    expect(toolResultChunk).toBeDefined();
    expect(toolResultChunk?.toolName).toBe('memory_search');
    expect(finalChunk?.finalResponseText).toContain(
      'User preference: keyboard shortcuts over nested menus.'
    );
    expect(fakeGmi.handleToolResult).toHaveBeenCalledTimes(1);
  });

  it('stops handleToolResult at the next actionable external tool request', async () => {
    const conversationContext = new ConversationContext('conv-tool-pause');
    const firstToolCall = {
      id: 'tool-call-1',
      name: 'memory_search',
      arguments: {
        query: 'keyboard shortcuts',
      },
    };
    const secondToolCall = {
      id: 'tool-call-2',
      name: 'memory_add',
      arguments: {
        content: 'Remember this preference.',
      },
    };

    const fakePersona = {
      id: 'test-persona',
      name: 'Test Persona',
      version: '1.0.0',
      baseSystemPrompt: 'You are a memory-aware assistant.',
    };

    const fakeGmi = {
      getCurrentPrimaryPersonaId: () => 'test-persona',
      getGMIId: () => 'gmi-memory-pause',
      getPersona: () => fakePersona,
      processTurnStream: async function* (): AsyncGenerator<any, GMIOutput, undefined> {
        yield {
          type: GMIOutputChunkType.TOOL_CALL_REQUEST,
          content: [firstToolCall],
          interactionId: 'interaction-memory-pause',
          timestamp: new Date(),
          metadata: {
            executionMode: 'external',
            requiresExternalToolResult: true,
          },
        };

        return {
          isFinal: false,
          responseText: 'I need a tool before I can answer.',
          toolCalls: [firstToolCall],
        };
      },
      handleToolResult: vi.fn(
        async (): Promise<GMIOutput> => ({
          isFinal: false,
          responseText: 'I need another tool before I can answer.',
          toolCalls: [secondToolCall],
        })
      ),
    };

    vi.spyOn(GMIManager.prototype, 'getOrCreateGMIForSession').mockResolvedValue({
      gmi: fakeGmi,
      conversationContext,
    } as any);

    const agentos = new AgentOS();
    openAgents.push(agentos);

    await agentos.initialize(createConfig());

    const initialChunks = await collectResponses(agentos, {
      userId: 'user-1',
      sessionId: 'session-tool-pause',
      conversationId: 'conv-tool-pause',
      textInput: 'Search memory for my preferences.',
      selectedPersonaId: 'test-persona',
    });

    const firstRequestChunk = initialChunks.find(
      (chunk): chunk is AgentOSToolCallRequestChunk =>
        chunk.type === AgentOSResponseChunkType.TOOL_CALL_REQUEST
    );

    expect(firstRequestChunk?.toolCalls[0]?.name).toBe('memory_search');

    const continuationChunks = await collectStreamWithTimeout(
      agentos.handleToolResult(
        firstRequestChunk!.streamId,
        firstToolCall.id,
        firstToolCall.name,
        { results: [] },
        true
      )
    );

    const nextToolRequestChunk = continuationChunks.find(
      (chunk): chunk is AgentOSToolCallRequestChunk =>
        chunk.type === AgentOSResponseChunkType.TOOL_CALL_REQUEST
    );

    expect(
      continuationChunks.some(
        (chunk) => chunk.type === AgentOSResponseChunkType.TOOL_RESULT_EMISSION
      )
    ).toBe(true);
    expect(nextToolRequestChunk?.toolCalls[0]?.name).toBe('memory_add');
    expect(nextToolRequestChunk?.executionMode).toBe('external');
    expect(nextToolRequestChunk?.requiresExternalToolResult).toBe(true);
    expect(
      continuationChunks.some((chunk) => chunk.type === AgentOSResponseChunkType.FINAL_RESPONSE)
    ).toBe(false);
  });

  it('recovers a persisted external memory tool pause after restarting AgentOS', async () => {
    const memory = await createTempMemory();
    await memory.remember('User preference: keyboard shortcuts over nested menus.', {
      type: 'semantic',
      scope: 'user',
      scopeId: 'user-1',
      tags: ['preferences'],
    });

    const sharedConversationContext = new ConversationContext('conv-tool-restart');
    sharedConversationContext.setMetadata('userId', 'user-1');

    const toolCall = {
      id: 'tool-call-memory-search-restart',
      name: 'memory_search',
      arguments: {
        query: 'keyboard shortcuts',
        scope: 'user',
        limit: 3,
      },
    };

    const fakePersona = {
      id: 'test-persona',
      name: 'Test Persona',
      version: '1.0.0',
      baseSystemPrompt: 'You are a memory-aware assistant.',
    };

    const firstGmi = {
      getCurrentPrimaryPersonaId: () => 'test-persona',
      getGMIId: () => 'gmi-memory-tool-restart-initial',
      getPersona: () => fakePersona,
      processTurnStream: async function* (): AsyncGenerator<any, GMIOutput, undefined> {
        yield {
          type: GMIOutputChunkType.TOOL_CALL_REQUEST,
          content: [toolCall],
          interactionId: 'interaction-memory-tool-restart-initial',
          timestamp: new Date(),
          metadata: {
            executionMode: 'external',
            requiresExternalToolResult: true,
          },
        };

        return {
          isFinal: false,
          responseText: 'I need to search memory before I can answer.',
          toolCalls: [toolCall],
        };
      },
    };

    const resumedGmi = {
      getCurrentPrimaryPersonaId: () => 'test-persona',
      getGMIId: () => 'gmi-memory-tool-restart-resumed',
      getPersona: () => fakePersona,
      hydrateConversationHistory: vi.fn(),
      handleToolResult: vi.fn(
        async (_toolCallId: string, _toolName: string, resultPayload: any): Promise<GMIOutput> => {
          const firstResult =
            resultPayload.type === 'success' ? resultPayload.result?.results?.[0]?.content : null;

          return {
            isFinal: true,
            responseText: firstResult
              ? `Recovered memory: ${firstResult}`
              : 'No matching memory found after restart.',
          };
        }
      ),
    };

    vi.spyOn(GMIManager.prototype, 'getOrCreateGMIForSession')
      .mockResolvedValueOnce({
        gmi: firstGmi,
        conversationContext: sharedConversationContext,
      } as any)
      .mockResolvedValueOnce({
        gmi: resumedGmi,
        conversationContext: sharedConversationContext,
      } as any);

    const firstAgent = new AgentOS();
    openAgents.push(firstAgent);

    await firstAgent.initialize(
      createConfig({
        standaloneMemory: {
          memory,
          tools: true,
        },
      })
    );

    const initialChunks = await collectResponses(firstAgent, {
      userId: 'user-1',
      sessionId: 'session-tool-restart',
      conversationId: 'conv-tool-restart',
      textInput: 'Search memory for my menu preferences.',
      selectedPersonaId: 'test-persona',
    });

    const toolRequestChunk = initialChunks.find(
      (chunk): chunk is AgentOSToolCallRequestChunk =>
        chunk.type === AgentOSResponseChunkType.TOOL_CALL_REQUEST
    );

    expect(toolRequestChunk).toBeDefined();
    expect(toolRequestChunk?.executionMode).toBe('external');
    expect(toolRequestChunk?.requiresExternalToolResult).toBe(true);
    expect(
      sharedConversationContext.getMetadata(AGENTOS_PENDING_EXTERNAL_TOOL_REQUEST_METADATA_KEY)
    ).toMatchObject({
      conversationId: 'conv-tool-restart',
      userId: 'user-1',
      toolCalls: [expect.objectContaining({ id: toolCall.id, name: 'memory_search' })],
    });

    await firstAgent.shutdown();
    const firstAgentIndex = openAgents.indexOf(firstAgent);
    if (firstAgentIndex >= 0) {
      openAgents.splice(firstAgentIndex, 1);
    }

    const secondAgent = new AgentOS();
    openAgents.push(secondAgent);

    await secondAgent.initialize(
      createConfig({
        standaloneMemory: {
          memory,
          tools: true,
        },
      })
    );

    vi.spyOn(secondAgent.getConversationManager(), 'getConversation').mockImplementation(
      async (conversationId: string) =>
        conversationId === 'conv-tool-restart' ? (sharedConversationContext as any) : null
    );

    const pendingRequest = await secondAgent.getPendingExternalToolRequest(
      'conv-tool-restart',
      'user-1'
    );
    expect(pendingRequest).toMatchObject({
      conversationId: 'conv-tool-restart',
      userId: 'user-1',
      toolCalls: [expect.objectContaining({ id: toolCall.id, name: 'memory_search' })],
    });

    const tool = await secondAgent.getToolOrchestrator().getTool('memory_search');
    expect(tool).toBeDefined();

    const toolExecution = await tool!.execute(toolCall.arguments, {
      gmiId: 'gmi-memory-tool-restart-resumed',
      personaId: 'test-persona',
      userContext: { userId: 'user-1' } as any,
    } satisfies ToolExecutionContext);
    expect(toolExecution.success).toBe(true);

    const resumedChunks = await collectStream(
      secondAgent.resumeExternalToolRequest(pendingRequest!, [
        {
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          toolOutput: toolExecution.output,
          isSuccess: toolExecution.success,
          errorMessage: toolExecution.error,
        },
      ])
    );

    const toolResultChunk = resumedChunks.find(
      (chunk): chunk is AgentOSToolResultEmissionChunk =>
        chunk.type === AgentOSResponseChunkType.TOOL_RESULT_EMISSION
    );
    const finalChunk = resumedChunks.find(
      (chunk): chunk is AgentOSFinalResponseChunk =>
        chunk.type === AgentOSResponseChunkType.FINAL_RESPONSE
    );

    expect(toolResultChunk?.toolName).toBe('memory_search');
    expect(finalChunk?.finalResponseText).toContain(
      'User preference: keyboard shortcuts over nested menus.'
    );
    expect(resumedGmi.handleToolResult).toHaveBeenCalledTimes(1);
    expect(resumedGmi.hydrateConversationHistory).toHaveBeenCalledTimes(1);

    const hydratedHistory = resumedGmi.hydrateConversationHistory.mock.calls[0]?.[0] as
      | Array<{ tool_calls?: Array<{ id: string }> }>
      | undefined;
    expect(
      hydratedHistory?.some(
        (message) => Array.isArray(message.tool_calls) && message.tool_calls[0]?.id === toolCall.id
      )
    ).toBe(true);

    expect(
      await secondAgent.getPendingExternalToolRequest('conv-tool-restart', 'user-1')
    ).toBeNull();
  });

  it('processRequestWithRegisteredTools auto-resumes a registered memory_search tool', async () => {
    const memory = await createTempMemory();
    await memory.remember('User preference: keyboard shortcuts over nested menus.', {
      type: 'semantic',
      scope: 'user',
      scopeId: 'user-1',
      tags: ['preferences'],
    });

    const conversationContext = new ConversationContext('conv-tool-helper');
    const toolCall = {
      id: 'tool-call-memory-search-helper',
      name: 'memory_search',
      arguments: {
        query: 'keyboard shortcuts',
        scope: 'user',
        limit: 3,
      },
    };

    const fakePersona = {
      id: 'test-persona',
      name: 'Test Persona',
      version: '1.0.0',
      baseSystemPrompt: 'You are a memory-aware assistant.',
    };

    const fakeGmi = {
      getCurrentPrimaryPersonaId: () => 'test-persona',
      getGMIId: () => 'gmi-memory-tool-helper',
      getPersona: () => fakePersona,
      processTurnStream: async function* (): AsyncGenerator<any, GMIOutput, undefined> {
        yield {
          type: GMIOutputChunkType.TOOL_CALL_REQUEST,
          content: [toolCall],
          interactionId: 'interaction-memory-tool-helper',
          timestamp: new Date(),
          metadata: {
            executionMode: 'external',
            requiresExternalToolResult: true,
          },
        };

        return {
          isFinal: false,
          responseText: 'I need to search memory before I can answer.',
          toolCalls: [toolCall],
        };
      },
      handleToolResult: vi.fn(
        async (_toolCallId: string, _toolName: string, resultPayload: any): Promise<GMIOutput> => {
          const firstResult =
            resultPayload.type === 'success' ? resultPayload.result?.results?.[0]?.content : null;

          return {
            isFinal: true,
            responseText: firstResult
              ? `Found memory: ${firstResult}`
              : 'No matching memory found.',
          };
        }
      ),
    };

    vi.spyOn(GMIManager.prototype, 'getOrCreateGMIForSession').mockResolvedValue({
      gmi: fakeGmi,
      conversationContext,
    } as any);

    const agentos = new AgentOS();
    openAgents.push(agentos);

    await agentos.initialize(
      createConfig({
        standaloneMemory: {
          memory,
          tools: true,
        },
      })
    );

    const responses = await collectStream(
      processRequestWithRegisteredTools(agentos, {
        userId: 'user-1',
        sessionId: 'session-tool-helper',
        conversationId: 'conv-tool-helper',
        textInput: 'Search memory for my menu preferences.',
        selectedPersonaId: 'test-persona',
      })
    );

    const finalChunk = responses.find(
      (chunk): chunk is AgentOSFinalResponseChunk =>
        chunk.type === AgentOSResponseChunkType.FINAL_RESPONSE
    );

    expect(finalChunk?.finalResponseText).toContain(
      'User preference: keyboard shortcuts over nested menus.'
    );
    expect(fakeGmi.handleToolResult).toHaveBeenCalledTimes(1);
  });

  it('processRequestWithRegisteredTools mixes registered memory tools with externalTools registry entries', async () => {
    const memory = await createTempMemory();
    await memory.remember('User preference: keyboard shortcuts over nested menus.', {
      type: 'semantic',
      scope: 'user',
      scopeId: 'user-1',
      tags: ['preferences'],
    });

    const conversationContext = new ConversationContext('conv-tool-helper-mixed');
    const toolCalls = [
      {
        id: 'tool-call-memory-search-helper-mixed',
        name: 'memory_search',
        arguments: {
          query: 'keyboard shortcuts',
          scope: 'user',
          limit: 3,
        },
      },
      {
        id: 'tool-call-open-profile-helper-mixed',
        name: 'open_profile',
        arguments: {
          profileId: 'profile-1',
        },
      },
    ];

    const fakePersona = {
      id: 'test-persona',
      name: 'Test Persona',
      version: '1.0.0',
      baseSystemPrompt: 'You are a memory-aware assistant.',
    };

    const fakeGmi = {
      getCurrentPrimaryPersonaId: () => 'test-persona',
      getGMIId: () => 'gmi-memory-tool-helper-mixed',
      getPersona: () => fakePersona,
      processTurnStream: async function* (): AsyncGenerator<any, GMIOutput, undefined> {
        yield {
          type: GMIOutputChunkType.TOOL_CALL_REQUEST,
          content: toolCalls,
          interactionId: 'interaction-memory-tool-helper-mixed',
          timestamp: new Date(),
          metadata: {
            executionMode: 'external',
            requiresExternalToolResult: true,
          },
        };

        return {
          isFinal: false,
          responseText: 'I need memory and profile data before I can answer.',
          toolCalls,
        };
      },
      handleToolResult: vi.fn(),
      handleToolResults: vi.fn(
        async (toolResults: any[]): Promise<GMIOutput> => ({
          isFinal: true,
          responseText: [
            `Found memory: ${toolResults[0]?.output?.results?.[0]?.content ?? 'none'}`,
            `Profile theme: ${toolResults[1]?.output?.profile?.preferredTheme ?? 'unknown'}`,
          ].join('\n'),
        })
      ),
    };

    vi.spyOn(GMIManager.prototype, 'getOrCreateGMIForSession').mockResolvedValue({
      gmi: fakeGmi,
      conversationContext,
    } as any);

    const agentos = new AgentOS();
    openAgents.push(agentos);

    await agentos.initialize(
      createConfig({
        standaloneMemory: {
          memory,
          tools: true,
        },
      })
    );

    const openProfileTool = vi.fn(async (args: Record<string, any>) => ({
      success: true,
      output: {
        profile: {
          id: args.profileId,
          preferredTheme: 'solarized',
        },
      },
    }));

    const responses = await collectStream(
      processRequestWithRegisteredTools(
        agentos,
        {
          userId: 'user-1',
          sessionId: 'session-tool-helper-mixed',
          conversationId: 'conv-tool-helper-mixed',
          textInput: 'Search memory and load my profile.',
          selectedPersonaId: 'test-persona',
        },
        {
          externalTools: {
            open_profile: openProfileTool,
          },
        }
      )
    );

    const finalChunk = responses.find(
      (chunk): chunk is AgentOSFinalResponseChunk =>
        chunk.type === AgentOSResponseChunkType.FINAL_RESPONSE
    );

    expect(finalChunk?.finalResponseText).toContain(
      'User preference: keyboard shortcuts over nested menus.'
    );
    expect(finalChunk?.finalResponseText).toContain('Profile theme: solarized');
    expect(openProfileTool).toHaveBeenCalledTimes(1);
    expect(fakeGmi.handleToolResult).not.toHaveBeenCalled();
    expect(fakeGmi.handleToolResults).toHaveBeenCalledTimes(1);
  });

  it('processRequestWithRegisteredTools uses streamed conversation context for thread-scoped tools', async () => {
    const memory = await createTempMemory();
    const conversationContext = new ConversationContext('conv-tool-helper-thread-derived');
    const toolCall = {
      id: 'tool-call-memory-add-thread-helper',
      name: 'memory_add',
      arguments: {
        content: 'Remember this thread-specific onboarding preference.',
        scope: 'thread',
        type: 'semantic',
        tags: ['onboarding'],
      },
    };

    const fakePersona = {
      id: 'test-persona',
      name: 'Test Persona',
      version: '1.0.0',
      baseSystemPrompt: 'You are a memory-aware assistant.',
    };

    const fakeGmi = {
      getCurrentPrimaryPersonaId: () => 'test-persona',
      getGMIId: () => 'gmi-memory-tool-helper-thread',
      getPersona: () => fakePersona,
      processTurnStream: async function* (): AsyncGenerator<any, GMIOutput, undefined> {
        yield {
          type: GMIOutputChunkType.TOOL_CALL_REQUEST,
          content: [toolCall],
          interactionId: 'interaction-memory-tool-helper-thread',
          timestamp: new Date(),
          metadata: {
            executionMode: 'external',
            requiresExternalToolResult: true,
          },
        };

        return {
          isFinal: false,
          responseText: 'I need to save a thread-specific memory before I can answer.',
          toolCalls: [toolCall],
        };
      },
      handleToolResult: vi.fn(
        async (_toolCallId: string, _toolName: string, resultPayload: any): Promise<GMIOutput> => ({
          isFinal: true,
          responseText: `Saved trace: ${resultPayload.type === 'success' ? resultPayload.result?.traceId : 'none'}`,
        })
      ),
    };

    vi.spyOn(GMIManager.prototype, 'getOrCreateGMIForSession').mockResolvedValue({
      gmi: fakeGmi,
      conversationContext,
    } as any);

    const agentos = new AgentOS();
    openAgents.push(agentos);

    await agentos.initialize(
      createConfig({
        standaloneMemory: {
          memory,
          tools: true,
        },
      })
    );

    const responses = await collectStream(
      processRequestWithRegisteredTools(agentos, {
        userId: 'user-1',
        sessionId: 'session-tool-helper-thread',
        textInput: 'Remember this onboarding preference for this thread.',
        selectedPersonaId: 'test-persona',
      })
    );

    const finalChunk = responses.find(
      (chunk): chunk is AgentOSFinalResponseChunk =>
        chunk.type === AgentOSResponseChunkType.FINAL_RESPONSE
    );

    expect(finalChunk?.finalResponseText).toContain('Saved trace: mt_');

    const threadHits = await memory.recall('onboarding preference', {
      scope: 'thread',
      scopeId: 'conv-tool-helper-thread-derived',
      limit: 5,
    });
    expect(
      threadHits.some((hit) =>
        hit.trace.content.includes('Remember this thread-specific onboarding preference.')
      )
    ).toBe(true);
    expect(fakeGmi.handleToolResult).toHaveBeenCalledTimes(1);
  });

  it('continues a live turn through handleToolResults with registered memory_search and memory_add tools', async () => {
    const memory = await createTempMemory();
    await memory.remember('User preference: keyboard shortcuts over nested menus.', {
      type: 'semantic',
      scope: 'user',
      scopeId: 'user-1',
      tags: ['preferences'],
    });

    const conversationContext = new ConversationContext('conv-tool-batch');
    const toolCalls = [
      {
        id: 'tool-call-memory-search-batch',
        name: 'memory_search',
        arguments: {
          query: 'keyboard shortcuts',
          scope: 'user',
          limit: 3,
        },
      },
      {
        id: 'tool-call-memory-add-batch',
        name: 'memory_add',
        arguments: {
          content: 'Remember this preference for future UI suggestions.',
          type: 'semantic',
          scope: 'user',
          tags: ['preferences'],
        },
      },
    ];

    const fakePersona = {
      id: 'test-persona',
      name: 'Test Persona',
      version: '1.0.0',
      baseSystemPrompt: 'You are a memory-aware assistant.',
    };

    const fakeGmi = {
      getCurrentPrimaryPersonaId: () => 'test-persona',
      getGMIId: () => 'gmi-memory-tool-batch',
      getPersona: () => fakePersona,
      processTurnStream: async function* (): AsyncGenerator<any, GMIOutput, undefined> {
        yield {
          type: GMIOutputChunkType.TOOL_CALL_REQUEST,
          content: toolCalls,
          interactionId: 'interaction-memory-tool-batch',
          timestamp: new Date(),
          metadata: {
            executionMode: 'external',
            requiresExternalToolResult: true,
          },
        };

        return {
          isFinal: false,
          responseText: 'I need to search and update memory before I can answer.',
          toolCalls,
        };
      },
      handleToolResult: vi.fn(),
      handleToolResults: vi.fn(
        async (toolResults: any[]): Promise<GMIOutput> => ({
          isFinal: true,
          responseText: [
            `Found memory: ${toolResults[0]?.output?.results?.[0]?.content ?? 'none'}`,
            `Saved trace: ${toolResults[1]?.output?.traceId ?? 'none'}`,
          ].join('\n'),
        })
      ),
    };

    vi.spyOn(GMIManager.prototype, 'getOrCreateGMIForSession').mockResolvedValue({
      gmi: fakeGmi,
      conversationContext,
    } as any);

    const agentos = new AgentOS();
    openAgents.push(agentos);

    await agentos.initialize(
      createConfig({
        standaloneMemory: {
          memory,
          tools: true,
        },
      })
    );

    const initialChunks = await collectResponses(agentos, {
      userId: 'user-1',
      sessionId: 'session-tool-batch',
      conversationId: 'conv-tool-batch',
      textInput: 'Search memory and save my preference.',
      selectedPersonaId: 'test-persona',
    });

    const toolRequestChunk = initialChunks.find(
      (chunk): chunk is AgentOSToolCallRequestChunk =>
        chunk.type === AgentOSResponseChunkType.TOOL_CALL_REQUEST
    );

    expect(toolRequestChunk).toBeDefined();
    expect(toolRequestChunk?.toolCalls).toHaveLength(2);
    expect(toolRequestChunk?.executionMode).toBe('external');
    expect(toolRequestChunk?.requiresExternalToolResult).toBe(true);

    const toolResults: Array<{
      toolCallId: string;
      toolName: string;
      toolOutput: unknown;
      isSuccess: boolean;
      errorMessage?: string;
    }> = [];
    for (const toolCall of toolCalls) {
      const tool = await agentos.getToolOrchestrator().getTool(toolCall.name);
      expect(tool).toBeDefined();

      const execution = await tool!.execute(toolCall.arguments, {
        gmiId: 'gmi-memory-tool-batch',
        personaId: 'test-persona',
        userContext: { userId: 'user-1' } as any,
      } satisfies ToolExecutionContext);

      toolResults.push({
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        toolOutput: execution.output,
        isSuccess: execution.success,
        errorMessage: execution.error,
      });
    }

    const continuationChunks = await collectStreamWithTimeout(
      agentos.handleToolResults!(toolRequestChunk!.streamId, toolResults)
    );

    const toolResultChunks = continuationChunks.filter(
      (chunk): chunk is AgentOSToolResultEmissionChunk =>
        chunk.type === AgentOSResponseChunkType.TOOL_RESULT_EMISSION
    );
    const finalChunk = continuationChunks.find(
      (chunk): chunk is AgentOSFinalResponseChunk =>
        chunk.type === AgentOSResponseChunkType.FINAL_RESPONSE
    );
    const addToolResultChunk = toolResultChunks.find((chunk) => chunk.toolName === 'memory_add');

    expect(toolResultChunks).toHaveLength(2);
    expect(toolResultChunks.map((chunk) => chunk.toolName)).toEqual([
      'memory_search',
      'memory_add',
    ]);
    expect(finalChunk?.finalResponseText).toContain(
      'User preference: keyboard shortcuts over nested menus.'
    );
    expect(finalChunk?.finalResponseText).toContain('Saved trace: mt_');
    expect((addToolResultChunk?.toolResult as any)?.traceId).toMatch(/^mt_/);
    const savedMemoryHits = await memory.recall('future UI suggestions', {
      scope: 'user',
      scopeId: 'user-1',
      limit: 5,
    });
    expect(
      savedMemoryHits.some((hit) =>
        hit.trace.content.includes('Remember this preference for future UI suggestions.')
      )
    ).toBe(true);
    expect(fakeGmi.handleToolResult).not.toHaveBeenCalled();
    expect(fakeGmi.handleToolResults).toHaveBeenCalledTimes(1);
  });

  it('processRequestWithExternalTools batches registered memory tools through handleToolResults', async () => {
    const memory = await createTempMemory();
    await memory.remember('User preference: keyboard shortcuts over nested menus.', {
      type: 'semantic',
      scope: 'user',
      scopeId: 'user-1',
      tags: ['preferences'],
    });

    const conversationContext = new ConversationContext('conv-tool-helper-batch');
    const toolCalls = [
      {
        id: 'tool-call-memory-search-helper-batch',
        name: 'memory_search',
        arguments: {
          query: 'keyboard shortcuts',
          scope: 'user',
          limit: 3,
        },
      },
      {
        id: 'tool-call-memory-add-helper-batch',
        name: 'memory_add',
        arguments: {
          content: 'Remember this preference for future onboarding.',
          type: 'semantic',
          scope: 'user',
          tags: ['preferences'],
        },
      },
    ];

    const fakePersona = {
      id: 'test-persona',
      name: 'Test Persona',
      version: '1.0.0',
      baseSystemPrompt: 'You are a memory-aware assistant.',
    };

    const fakeGmi = {
      getCurrentPrimaryPersonaId: () => 'test-persona',
      getGMIId: () => 'gmi-memory-tool-helper-batch',
      getPersona: () => fakePersona,
      processTurnStream: async function* (): AsyncGenerator<any, GMIOutput, undefined> {
        yield {
          type: GMIOutputChunkType.TOOL_CALL_REQUEST,
          content: toolCalls,
          interactionId: 'interaction-memory-tool-helper-batch',
          timestamp: new Date(),
          metadata: {
            executionMode: 'external',
            requiresExternalToolResult: true,
          },
        };

        return {
          isFinal: false,
          responseText: 'I need to search and store memory before I can answer.',
          toolCalls,
        };
      },
      handleToolResult: vi.fn(),
      handleToolResults: vi.fn(
        async (toolResults: any[]): Promise<GMIOutput> => ({
          isFinal: true,
          responseText: [
            `Found memory: ${toolResults[0]?.output?.results?.[0]?.content ?? 'none'}`,
            `Saved trace: ${toolResults[1]?.output?.traceId ?? 'none'}`,
          ].join('\n'),
        })
      ),
    };

    vi.spyOn(GMIManager.prototype, 'getOrCreateGMIForSession').mockResolvedValue({
      gmi: fakeGmi,
      conversationContext,
    } as any);

    const agentos = new AgentOS();
    openAgents.push(agentos);

    await agentos.initialize(
      createConfig({
        standaloneMemory: {
          memory,
          tools: true,
        },
      })
    );

    const executeToolCall = vi.fn(async ({ toolCall }) => {
      const tool = await agentos.getToolOrchestrator().getTool(toolCall.name);
      expect(tool).toBeDefined();

      const execution = await tool!.execute(toolCall.arguments, {
        gmiId: 'gmi-memory-tool-helper-batch',
        personaId: 'test-persona',
        userContext: { userId: 'user-1' } as any,
      } satisfies ToolExecutionContext);

      return {
        toolOutput: execution.output,
        isSuccess: execution.success,
        errorMessage: execution.error,
      };
    });

    const responses = await collectStream(
      processRequestWithExternalTools(
        agentos,
        {
          userId: 'user-1',
          sessionId: 'session-tool-helper-batch',
          conversationId: 'conv-tool-helper-batch',
          textInput: 'Search memory and remember this onboarding preference.',
          selectedPersonaId: 'test-persona',
        },
        executeToolCall
      )
    );

    const toolResultChunks = responses.filter(
      (chunk): chunk is AgentOSToolResultEmissionChunk =>
        chunk.type === AgentOSResponseChunkType.TOOL_RESULT_EMISSION
    );
    const finalChunk = responses.find(
      (chunk): chunk is AgentOSFinalResponseChunk =>
        chunk.type === AgentOSResponseChunkType.FINAL_RESPONSE
    );
    const addToolResultChunk = toolResultChunks.find((chunk) => chunk.toolName === 'memory_add');

    expect(executeToolCall).toHaveBeenCalledTimes(2);
    expect(toolResultChunks).toHaveLength(2);
    expect(toolResultChunks.map((chunk) => chunk.toolName)).toEqual([
      'memory_search',
      'memory_add',
    ]);
    expect(finalChunk?.finalResponseText).toContain(
      'User preference: keyboard shortcuts over nested menus.'
    );
    expect(finalChunk?.finalResponseText).toContain('Saved trace: mt_');
    expect((addToolResultChunk?.toolResult as any)?.traceId).toMatch(/^mt_/);
    expect(fakeGmi.handleToolResult).not.toHaveBeenCalled();
    expect(fakeGmi.handleToolResults).toHaveBeenCalledTimes(1);
  });

  it('executes memory_search through the real GMI and tool orchestrator during processRequest', async () => {
    const memory = await createTempMemory();
    await memory.remember('User preference: keyboard shortcuts over nested menus.', {
      type: 'semantic',
      scope: 'user',
      scopeId: 'user-1',
      tags: ['preferences'],
    });

    const conversationContext = new ConversationContext('conv-real-gmi');
    const promptCalls: ChatMessage[][] = [];
    let providerCallCount = 0;

    const provider = {
      providerId: 'mock-provider',
      isInitialized: true,
      generateCompletionStream: vi.fn(async function* (
        _modelId: string,
        messages: ChatMessage[]
      ): AsyncGenerator<ModelCompletionResponse, void, undefined> {
        promptCalls.push(messages);
        providerCallCount += 1;

        if (providerCallCount === 1) {
          yield {
            id: 'cmp-tool-request',
            object: 'chat.completion.chunk',
            created: Date.now(),
            modelId: 'mock-model',
            choices: [
              {
                index: 0,
                message: {
                  role: 'assistant',
                  content: null,
                  tool_calls: [
                    {
                      id: 'tool-call-real-memory-search-1',
                      type: 'function',
                      function: {
                        name: 'memory_search',
                        arguments: JSON.stringify({
                          query: 'keyboard shortcuts',
                          scope: 'user',
                          limit: 3,
                        }),
                      },
                    },
                  ],
                },
                finishReason: 'tool_calls',
              },
            ],
            usage: { promptTokens: 12, completionTokens: 4, totalTokens: 16 },
            isFinal: true,
          };
          return;
        }

        yield {
          id: 'cmp-tool-final',
          object: 'chat.completion.chunk',
          created: Date.now(),
          modelId: 'mock-model',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: 'You prefer keyboard shortcuts over nested menus.',
              },
              finishReason: null,
            },
          ],
          responseTextDelta: 'You prefer keyboard shortcuts over nested menus.',
          isFinal: false,
        };

        yield {
          id: 'cmp-tool-final',
          object: 'chat.completion.chunk',
          created: Date.now(),
          modelId: 'mock-model',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: 'You prefer keyboard shortcuts over nested menus.',
              },
              finishReason: 'stop',
            },
          ],
          usage: { promptTokens: 18, completionTokens: 8, totalTokens: 26 },
          isFinal: true,
        };
      }),
    } as any;

    const promptEngine = {
      constructPrompt: vi.fn(async (components: any) => {
        const prompt: ChatMessage[] = (components.conversationHistory ?? []).map(
          (message: any) => ({
            role:
              message.role === 'assistant'
                ? 'assistant'
                : message.role === 'tool'
                  ? 'tool'
                  : message.role === 'system'
                    ? 'system'
                    : 'user',
            content:
              typeof message.content === 'string' || message.content === null
                ? message.content
                : JSON.stringify(message.content),
            name: message.name,
            tool_call_id: message.tool_call_id,
            tool_calls: Array.isArray(message.tool_calls)
              ? message.tool_calls.map((toolCall: any) => ({
                  id: toolCall.id,
                  type: 'function' as const,
                  function: {
                    name: toolCall.name,
                    arguments: JSON.stringify(toolCall.arguments ?? {}),
                  },
                }))
              : undefined,
          })
        );

        if (components.userInput) {
          prompt.push({ role: 'user', content: components.userInput });
        }

        return {
          prompt,
          formattedToolSchemas: [],
          estimatedTokenCount: 12,
          tokenCount: 12,
          issues: [],
        };
      }),
    } as any;

    const utilityAI = {
      summarize: vi.fn(),
      parseJsonSafe: vi.fn(),
    } as any;

    const realGmi = new GMI('gmi-real-memory-search');
    openGmis.push(realGmi);

    const agentos = new AgentOS();
    openAgents.push(agentos);

    await agentos.initialize(
      createConfig({
        standaloneMemory: {
          memory,
          tools: true,
        },
      })
    );

    await realGmi.initialize(
      {
        id: 'test-persona',
        name: 'Test Persona',
        version: '1.0.0',
        baseSystemPrompt: 'You are a memory-aware assistant.',
        defaultModelId: 'mock-model',
        defaultProviderId: 'mock-provider',
        defaultModelCompletionOptions: { temperature: 0.1 },
        allowedCapabilities: [],
        memoryConfig: { enabled: true, ragConfig: { enabled: false } },
        moodAdaptation: { enabled: false, defaultMood: 'neutral' },
        toolIds: [],
        allowedInputModalities: ['text'],
        allowedOutputModalities: ['text'],
        conversationContextConfig: { maxMessages: 10 },
        minSubscriptionTier: 'FREE',
        isPublic: true,
        activationKeywords: [],
        strengths: [],
        uiInteractionStyle: 'collaborative',
        initialMemoryImprints: [],
      } as any,
      {
        workingMemory: new InMemoryWorkingMemory(),
        promptEngine,
        llmProviderManager: {
          getModelInfo: vi.fn().mockResolvedValue({
            modelId: 'mock-model',
            providerId: 'mock-provider',
            contextWindowSize: 8192,
            capabilities: ['chat', 'tool_use'],
            supportsStreaming: true,
          }),
          getProvider: vi.fn().mockReturnValue(provider),
          getProviderForModel: vi.fn().mockReturnValue({ providerId: 'mock-provider' }),
        } as any,
        utilityAI,
        toolOrchestrator: agentos.getToolOrchestrator(),
        defaultLlmModelId: 'mock-model',
        defaultLlmProviderId: 'mock-provider',
      }
    );

    vi.spyOn(GMIManager.prototype, 'getOrCreateGMIForSession').mockResolvedValue({
      gmi: realGmi,
      conversationContext,
    } as any);

    const responses = await collectResponses(agentos, {
      userId: 'user-1',
      sessionId: 'session-real-gmi',
      conversationId: 'conv-real-gmi',
      textInput: 'Search memory for my navigation preferences.',
      selectedPersonaId: 'test-persona',
    });

    const toolRequestChunk = responses.find(
      (chunk): chunk is AgentOSToolCallRequestChunk =>
        chunk.type === AgentOSResponseChunkType.TOOL_CALL_REQUEST
    );
    const finalChunk = responses.find(
      (chunk): chunk is AgentOSFinalResponseChunk =>
        chunk.type === AgentOSResponseChunkType.FINAL_RESPONSE
    );

    expect(provider.generateCompletionStream).toHaveBeenCalledTimes(2);
    expect(toolRequestChunk?.toolCalls[0]?.name).toBe('memory_search');
    expect(toolRequestChunk?.executionMode).toBe('internal');
    expect(toolRequestChunk?.requiresExternalToolResult).toBe(false);
    expect(finalChunk?.finalResponseText).toContain(
      'You prefer keyboard shortcuts over nested menus.'
    );
    expect(promptCalls).toHaveLength(2);
    expect(
      promptCalls[1]?.some(
        (message) =>
          message.role === 'tool' &&
          String(message.content).includes('keyboard shortcuts over nested menus')
      )
    ).toBe(true);
  });

  it('exposes prompt-aware externalTools to the real GMI and executes them internally', async () => {
    const conversationContext = new ConversationContext('conv-real-external-tool');
    const promptCalls: ChatMessage[][] = [];
    const toolNamesPerCall: string[][] = [];
    let providerCallCount = 0;

    const provider = {
      providerId: 'mock-provider',
      isInitialized: true,
      generateCompletionStream: vi.fn(async function* (
        _modelId: string,
        messages: ChatMessage[],
        options: Record<string, any>
      ): AsyncGenerator<ModelCompletionResponse, void, undefined> {
        promptCalls.push(messages);
        toolNamesPerCall.push(
          Array.isArray(options.tools)
            ? options.tools
                .map((tool: any) => tool?.function?.name)
                .filter((toolName: unknown): toolName is string => typeof toolName === 'string')
            : []
        );
        providerCallCount += 1;

        if (providerCallCount === 1) {
          yield {
            id: 'cmp-external-tool-request',
            object: 'chat.completion.chunk',
            created: Date.now(),
            modelId: 'mock-model',
            choices: [
              {
                index: 0,
                message: {
                  role: 'assistant',
                  content: null,
                  tool_calls: [
                    {
                      id: 'tool-call-real-open-profile-1',
                      type: 'function',
                      function: {
                        name: 'open_profile',
                        arguments: JSON.stringify({
                          profileId: 'profile-1',
                        }),
                      },
                    },
                  ],
                },
                finishReason: 'tool_calls',
              },
            ],
            usage: { promptTokens: 12, completionTokens: 4, totalTokens: 16 },
            isFinal: true,
          };
          return;
        }

        yield {
          id: 'cmp-external-tool-final',
          object: 'chat.completion.chunk',
          created: Date.now(),
          modelId: 'mock-model',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: 'Loaded your solarized profile settings.',
              },
              finishReason: null,
            },
          ],
          responseTextDelta: 'Loaded your solarized profile settings.',
          isFinal: false,
        };

        yield {
          id: 'cmp-external-tool-final',
          object: 'chat.completion.chunk',
          created: Date.now(),
          modelId: 'mock-model',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: 'Loaded your solarized profile settings.',
              },
              finishReason: 'stop',
            },
          ],
          usage: { promptTokens: 18, completionTokens: 8, totalTokens: 26 },
          isFinal: true,
        };
      }),
    } as any;

    const promptEngine = {
      constructPrompt: vi.fn(async (components: any) => {
        const prompt: ChatMessage[] = (components.conversationHistory ?? []).map(
          (message: any) => ({
            role:
              message.role === 'assistant'
                ? 'assistant'
                : message.role === 'tool'
                  ? 'tool'
                  : message.role === 'system'
                    ? 'system'
                    : 'user',
            content:
              typeof message.content === 'string' || message.content === null
                ? message.content
                : JSON.stringify(message.content),
            name: message.name,
            tool_call_id: message.tool_call_id,
            tool_calls: Array.isArray(message.tool_calls)
              ? message.tool_calls.map((toolCall: any) => ({
                  id: toolCall.id,
                  type: 'function' as const,
                  function: {
                    name: toolCall.name,
                    arguments: JSON.stringify(toolCall.arguments ?? {}),
                  },
                }))
              : undefined,
          })
        );

        if (components.userInput) {
          prompt.push({ role: 'user', content: components.userInput });
        }

        return {
          prompt,
          formattedToolSchemas: [],
          estimatedTokenCount: 12,
          tokenCount: 12,
          issues: [],
        };
      }),
    } as any;

    const realGmi = new GMI('gmi-real-external-tool');
    openGmis.push(realGmi);

    const agentos = new AgentOS();
    openAgents.push(agentos);

    await agentos.initialize(createConfig());

    await realGmi.initialize(
      {
        id: 'test-persona',
        name: 'Test Persona',
        version: '1.0.0',
        baseSystemPrompt: 'You are a profile-aware assistant.',
        defaultModelId: 'mock-model',
        defaultProviderId: 'mock-provider',
        defaultModelCompletionOptions: { temperature: 0.1 },
        allowedCapabilities: [],
        memoryConfig: { enabled: false, ragConfig: { enabled: false } },
        moodAdaptation: { enabled: false, defaultMood: 'neutral' },
        toolIds: [],
        allowedInputModalities: ['text'],
        allowedOutputModalities: ['text'],
        conversationContextConfig: { maxMessages: 10 },
        minSubscriptionTier: 'FREE',
        isPublic: true,
        activationKeywords: [],
        strengths: [],
        uiInteractionStyle: 'collaborative',
        initialMemoryImprints: [],
      } as any,
      {
        workingMemory: new InMemoryWorkingMemory(),
        promptEngine,
        llmProviderManager: {
          getModelInfo: vi.fn().mockResolvedValue({
            modelId: 'mock-model',
            providerId: 'mock-provider',
            contextWindowSize: 8192,
            capabilities: ['chat', 'tool_use'],
            supportsStreaming: true,
          }),
          getProvider: vi.fn().mockReturnValue(provider),
          getProviderForModel: vi.fn().mockReturnValue({ providerId: 'mock-provider' }),
        } as any,
        utilityAI: {
          summarize: vi.fn(),
          parseJsonSafe: vi.fn(),
        } as any,
        toolOrchestrator: agentos.getToolOrchestrator(),
        defaultLlmModelId: 'mock-model',
        defaultLlmProviderId: 'mock-provider',
      }
    );

    vi.spyOn(GMIManager.prototype, 'getOrCreateGMIForSession').mockResolvedValue({
      gmi: realGmi,
      conversationContext,
    } as any);

    const externalToolExecute = vi.fn(async (args: Record<string, any>) => ({
      success: true,
      output: {
        profile: {
          id: args.profileId,
          preferredTheme: 'solarized',
        },
      },
    }));

    const responses = await collectStream(
      processRequestWithRegisteredTools(
        agentos,
        {
          userId: 'user-1',
          sessionId: 'session-real-external-tool',
          conversationId: 'conv-real-external-tool',
          textInput: 'Load my saved profile preferences.',
          selectedPersonaId: 'test-persona',
        },
        {
          externalTools: {
            open_profile: {
              description: 'Load a saved profile record by ID.',
              inputSchema: {
                type: 'object',
                properties: {
                  profileId: { type: 'string' },
                },
                required: ['profileId'],
              },
              execute: externalToolExecute,
            },
          },
        }
      )
    );

    const toolRequestChunk = responses.find(
      (chunk): chunk is AgentOSToolCallRequestChunk =>
        chunk.type === AgentOSResponseChunkType.TOOL_CALL_REQUEST
    );
    const finalChunk = responses.find(
      (chunk): chunk is AgentOSFinalResponseChunk =>
        chunk.type === AgentOSResponseChunkType.FINAL_RESPONSE
    );

    expect(provider.generateCompletionStream).toHaveBeenCalledTimes(2);
    expect(toolNamesPerCall[0]).toContain('open_profile');
    expect(toolRequestChunk?.toolCalls[0]?.name).toBe('open_profile');
    expect(toolRequestChunk?.executionMode).toBe('internal');
    expect(toolRequestChunk?.requiresExternalToolResult).toBe(false);
    expect(finalChunk?.finalResponseText).toContain('Loaded your solarized profile settings.');
    expect(externalToolExecute).toHaveBeenCalledTimes(1);
    expect(
      promptCalls[1]?.some(
        (message) =>
          message.role === 'tool' &&
          String(message.content).includes('"preferredTheme":"solarized"')
      )
    ).toBe(true);
    expect(await agentos.getToolOrchestrator().getTool('open_profile')).toBeUndefined();
  });

  it('executes AgentOSConfig.tools through the real GMI without helper wrappers', async () => {
    const conversationContext = new ConversationContext('conv-real-config-tool');
    const promptCalls: ChatMessage[][] = [];
    const toolNamesPerCall: string[][] = [];
    let providerCallCount = 0;

    const provider = {
      providerId: 'mock-provider',
      isInitialized: true,
      generateCompletionStream: vi.fn(async function* (
        _modelId: string,
        messages: ChatMessage[],
        options: Record<string, any>
      ): AsyncGenerator<ModelCompletionResponse, void, undefined> {
        promptCalls.push(messages);
        toolNamesPerCall.push(
          Array.isArray(options.tools)
            ? options.tools
                .map((tool: any) => tool?.function?.name)
                .filter((toolName: unknown): toolName is string => typeof toolName === 'string')
            : []
        );
        providerCallCount += 1;

        if (providerCallCount === 1) {
          yield {
            id: 'cmp-config-tool-request',
            object: 'chat.completion.chunk',
            created: Date.now(),
            modelId: 'mock-model',
            choices: [
              {
                index: 0,
                message: {
                  role: 'assistant',
                  content: null,
                  tool_calls: [
                    {
                      id: 'tool-call-real-config-open-profile-1',
                      type: 'function',
                      function: {
                        name: 'open_profile',
                        arguments: JSON.stringify({
                          profileId: 'profile-1',
                        }),
                      },
                    },
                  ],
                },
                finishReason: 'tool_calls',
              },
            ],
            usage: { promptTokens: 12, completionTokens: 4, totalTokens: 16 },
            isFinal: true,
          };
          return;
        }

        yield {
          id: 'cmp-config-tool-final',
          object: 'chat.completion.chunk',
          created: Date.now(),
          modelId: 'mock-model',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: 'Loaded your solarized profile settings.',
              },
              finishReason: null,
            },
          ],
          responseTextDelta: 'Loaded your solarized profile settings.',
          isFinal: false,
        };

        yield {
          id: 'cmp-config-tool-final',
          object: 'chat.completion.chunk',
          created: Date.now(),
          modelId: 'mock-model',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: 'Loaded your solarized profile settings.',
              },
              finishReason: 'stop',
            },
          ],
          usage: { promptTokens: 18, completionTokens: 8, totalTokens: 26 },
          isFinal: true,
        };
      }),
    } as any;

    const promptEngine = {
      constructPrompt: vi.fn(async (components: any) => {
        const prompt: ChatMessage[] = (components.conversationHistory ?? []).map(
          (message: any) => ({
            role:
              message.role === 'assistant'
                ? 'assistant'
                : message.role === 'tool'
                  ? 'tool'
                  : message.role === 'system'
                    ? 'system'
                    : 'user',
            content:
              typeof message.content === 'string' || message.content === null
                ? message.content
                : JSON.stringify(message.content),
            name: message.name,
            tool_call_id: message.tool_call_id,
            tool_calls: Array.isArray(message.tool_calls)
              ? message.tool_calls.map((toolCall: any) => ({
                  id: toolCall.id,
                  type: 'function' as const,
                  function: {
                    name: toolCall.name,
                    arguments: JSON.stringify(toolCall.arguments ?? {}),
                  },
                }))
              : undefined,
          })
        );

        if (components.userInput) {
          prompt.push({ role: 'user', content: components.userInput });
        }

        return {
          prompt,
          formattedToolSchemas: [],
          estimatedTokenCount: 12,
          tokenCount: 12,
          issues: [],
        };
      }),
    } as any;

    const realGmi = new GMI('gmi-real-config-tool');
    openGmis.push(realGmi);

    const execute = vi.fn(async (args: Record<string, any>) => ({
      success: true,
      output: {
        profile: {
          id: args.profileId,
          preferredTheme: 'solarized',
        },
      },
    }));

    const agentos = new AgentOS();
    openAgents.push(agentos);

    await agentos.initialize(
      createConfig({
        tools: new Map([
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
              execute,
            },
          ],
        ]),
      })
    );

    await realGmi.initialize(
      {
        id: 'test-persona',
        name: 'Test Persona',
        version: '1.0.0',
        baseSystemPrompt: 'You are a profile-aware assistant.',
        defaultModelId: 'mock-model',
        defaultProviderId: 'mock-provider',
        defaultModelCompletionOptions: { temperature: 0.1 },
        allowedCapabilities: [],
        memoryConfig: { enabled: false, ragConfig: { enabled: false } },
        moodAdaptation: { enabled: false, defaultMood: 'neutral' },
        toolIds: [],
        allowedInputModalities: ['text'],
        allowedOutputModalities: ['text'],
        conversationContextConfig: { maxMessages: 10 },
        minSubscriptionTier: 'FREE',
        isPublic: true,
        activationKeywords: [],
        strengths: [],
        uiInteractionStyle: 'collaborative',
        initialMemoryImprints: [],
      } as any,
      {
        workingMemory: new InMemoryWorkingMemory(),
        promptEngine,
        llmProviderManager: {
          getModelInfo: vi.fn().mockResolvedValue({
            modelId: 'mock-model',
            providerId: 'mock-provider',
            contextWindowSize: 8192,
            capabilities: ['chat', 'tool_use'],
            supportsStreaming: true,
          }),
          getProvider: vi.fn().mockReturnValue(provider),
          getProviderForModel: vi.fn().mockReturnValue({ providerId: 'mock-provider' }),
        } as any,
        utilityAI: {
          summarize: vi.fn(),
          parseJsonSafe: vi.fn(),
        } as any,
        toolOrchestrator: agentos.getToolOrchestrator(),
        defaultLlmModelId: 'mock-model',
        defaultLlmProviderId: 'mock-provider',
      }
    );

    vi.spyOn(GMIManager.prototype, 'getOrCreateGMIForSession').mockResolvedValue({
      gmi: realGmi,
      conversationContext,
    } as any);

    const responses = await collectResponses(agentos, {
      userId: 'user-1',
      sessionId: 'session-real-config-tool',
      conversationId: 'conv-real-config-tool',
      textInput: 'Load my saved profile preferences.',
      selectedPersonaId: 'test-persona',
    });

    const toolRequestChunk = responses.find(
      (chunk): chunk is AgentOSToolCallRequestChunk =>
        chunk.type === AgentOSResponseChunkType.TOOL_CALL_REQUEST
    );
    const finalChunk = responses.find(
      (chunk): chunk is AgentOSFinalResponseChunk =>
        chunk.type === AgentOSResponseChunkType.FINAL_RESPONSE
    );

    expect(provider.generateCompletionStream).toHaveBeenCalledTimes(2);
    expect(toolNamesPerCall[0]).toContain('open_profile');
    expect(toolRequestChunk?.toolCalls[0]?.name).toBe('open_profile');
    expect(toolRequestChunk?.executionMode).toBe('internal');
    expect(toolRequestChunk?.requiresExternalToolResult).toBe(false);
    expect(finalChunk?.finalResponseText).toContain('Loaded your solarized profile settings.');
    expect(execute).toHaveBeenCalledTimes(1);
    expect(
      promptCalls[1]?.some(
        (message) =>
          message.role === 'tool' &&
          String(message.content).includes('"preferredTheme":"solarized"')
      )
    ).toBe(true);
    expect(await agentos.getToolOrchestrator().getTool('open_profile')).toBeDefined();
  });

  it('executes thread-scoped memory_add through the real GMI and tool orchestrator during processRequest', async () => {
    const memory = await createTempMemory();
    const conversationContext = new ConversationContext('conv-real-gmi-thread');
    let providerCallCount = 0;

    const provider = {
      providerId: 'mock-provider',
      isInitialized: true,
      generateCompletionStream: vi.fn(async function* (
        _modelId: string,
        _messages: ChatMessage[]
      ): AsyncGenerator<ModelCompletionResponse, void, undefined> {
        providerCallCount += 1;

        if (providerCallCount === 1) {
          yield {
            id: 'cmp-thread-add-request',
            object: 'chat.completion.chunk',
            created: Date.now(),
            modelId: 'mock-model',
            choices: [
              {
                index: 0,
                message: {
                  role: 'assistant',
                  content: null,
                  tool_calls: [
                    {
                      id: 'tool-call-real-memory-add-thread-1',
                      type: 'function',
                      function: {
                        name: 'memory_add',
                        arguments: JSON.stringify({
                          content: 'Remember this thread-specific onboarding preference.',
                          scope: 'thread',
                          type: 'semantic',
                          tags: ['onboarding'],
                        }),
                      },
                    },
                  ],
                },
                finishReason: 'tool_calls',
              },
            ],
            usage: { promptTokens: 12, completionTokens: 4, totalTokens: 16 },
            isFinal: true,
          };
          return;
        }

        yield {
          id: 'cmp-thread-add-final',
          object: 'chat.completion.chunk',
          created: Date.now(),
          modelId: 'mock-model',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: 'Saved the onboarding preference for this conversation.',
              },
              finishReason: null,
            },
          ],
          responseTextDelta: 'Saved the onboarding preference for this conversation.',
          isFinal: false,
        };

        yield {
          id: 'cmp-thread-add-final',
          object: 'chat.completion.chunk',
          created: Date.now(),
          modelId: 'mock-model',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: 'Saved the onboarding preference for this conversation.',
              },
              finishReason: 'stop',
            },
          ],
          usage: { promptTokens: 18, completionTokens: 8, totalTokens: 26 },
          isFinal: true,
        };
      }),
    } as any;

    const promptEngine = {
      constructPrompt: vi.fn(async (components: any) => {
        const prompt: ChatMessage[] = (components.conversationHistory ?? []).map(
          (message: any) => ({
            role:
              message.role === 'assistant'
                ? 'assistant'
                : message.role === 'tool'
                  ? 'tool'
                  : message.role === 'system'
                    ? 'system'
                    : 'user',
            content:
              typeof message.content === 'string' || message.content === null
                ? message.content
                : JSON.stringify(message.content),
            name: message.name,
            tool_call_id: message.tool_call_id,
            tool_calls: Array.isArray(message.tool_calls)
              ? message.tool_calls.map((toolCall: any) => ({
                  id: toolCall.id,
                  type: 'function' as const,
                  function: {
                    name: toolCall.name,
                    arguments: JSON.stringify(toolCall.arguments ?? {}),
                  },
                }))
              : undefined,
          })
        );

        if (components.userInput) {
          prompt.push({ role: 'user', content: components.userInput });
        }

        return {
          prompt,
          formattedToolSchemas: [],
          estimatedTokenCount: 12,
          tokenCount: 12,
          issues: [],
        };
      }),
    } as any;

    const realGmi = new GMI('gmi-real-memory-add-thread');
    openGmis.push(realGmi);

    const agentos = new AgentOS();
    openAgents.push(agentos);

    await agentos.initialize(
      createConfig({
        standaloneMemory: {
          memory,
          tools: true,
        },
      })
    );

    await realGmi.initialize(
      {
        id: 'test-persona',
        name: 'Test Persona',
        version: '1.0.0',
        baseSystemPrompt: 'You are a memory-aware assistant.',
        defaultModelId: 'mock-model',
        defaultProviderId: 'mock-provider',
        defaultModelCompletionOptions: { temperature: 0.1 },
        allowedCapabilities: [],
        memoryConfig: { enabled: true, ragConfig: { enabled: false } },
        moodAdaptation: { enabled: false, defaultMood: 'neutral' },
        toolIds: [],
        allowedInputModalities: ['text'],
        allowedOutputModalities: ['text'],
        conversationContextConfig: { maxMessages: 10 },
        minSubscriptionTier: 'FREE',
        isPublic: true,
        activationKeywords: [],
        strengths: [],
        uiInteractionStyle: 'collaborative',
        initialMemoryImprints: [],
      } as any,
      {
        workingMemory: new InMemoryWorkingMemory(),
        promptEngine,
        llmProviderManager: {
          getModelInfo: vi.fn().mockResolvedValue({
            modelId: 'mock-model',
            providerId: 'mock-provider',
            contextWindowSize: 8192,
            capabilities: ['chat', 'tool_use'],
            supportsStreaming: true,
          }),
          getProvider: vi.fn().mockReturnValue(provider),
          getProviderForModel: vi.fn().mockReturnValue({ providerId: 'mock-provider' }),
        } as any,
        utilityAI: {
          summarize: vi.fn(),
          parseJsonSafe: vi.fn(),
        } as any,
        toolOrchestrator: agentos.getToolOrchestrator(),
        defaultLlmModelId: 'mock-model',
        defaultLlmProviderId: 'mock-provider',
      }
    );

    vi.spyOn(GMIManager.prototype, 'getOrCreateGMIForSession').mockResolvedValue({
      gmi: realGmi,
      conversationContext,
    } as any);

    const responses = await collectResponses(agentos, {
      userId: 'user-1',
      sessionId: 'session-real-gmi-thread',
      conversationId: 'conv-real-gmi-thread',
      textInput: 'Remember this onboarding preference for this conversation.',
      selectedPersonaId: 'test-persona',
    });

    const toolRequestChunk = responses.find(
      (chunk): chunk is AgentOSToolCallRequestChunk =>
        chunk.type === AgentOSResponseChunkType.TOOL_CALL_REQUEST
    );
    const finalChunk = responses.find(
      (chunk): chunk is AgentOSFinalResponseChunk =>
        chunk.type === AgentOSResponseChunkType.FINAL_RESPONSE
    );

    expect(provider.generateCompletionStream).toHaveBeenCalledTimes(2);
    expect(toolRequestChunk?.toolCalls[0]?.name).toBe('memory_add');
    expect(toolRequestChunk?.executionMode).toBe('internal');
    expect(toolRequestChunk?.requiresExternalToolResult).toBe(false);
    expect(finalChunk?.finalResponseText).toContain(
      'Saved the onboarding preference for this conversation.'
    );

    const threadHits = await memory.recall('onboarding preference', {
      scope: 'thread',
      scopeId: 'conv-real-gmi-thread',
      limit: 5,
    });
    expect(
      threadHits.some((hit) =>
        hit.trace.content.includes('Remember this thread-specific onboarding preference.')
      )
    ).toBe(true);
  });
});
