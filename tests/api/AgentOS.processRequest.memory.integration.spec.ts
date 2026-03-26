import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentOS, type AgentOSConfig } from '../../src/api/AgentOS';
import type { AgentOSInput } from '../../src/api/types/AgentOSInput';
import {
  AgentOSResponseChunkType,
  type AgentOSFinalResponseChunk,
  type AgentOSMetadataUpdateChunk,
  type AgentOSResponse,
  type AgentOSToolCallRequestChunk,
  type AgentOSToolResultEmissionChunk,
} from '../../src/api/types/AgentOSResponse';
import {
  GMIOutputChunkType,
  type GMIOutput,
  type GMITurnInput,
} from '../../src/cognitive_substrate/IGMI';
import type { ToolExecutionContext } from '../../src/core/tools/ITool';
import { GMIManager } from '../../src/cognitive_substrate/GMIManager';
import { ConversationContext } from '../../src/core/conversation/ConversationContext';
import { PromptEngine } from '../../src/core/llm/PromptEngine';
import { Memory } from '../../src/memory/facade/Memory';

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

async function collectResponses(
  agentos: AgentOS,
  input: AgentOSInput,
): Promise<AgentOSResponse[]> {
  const responses: AgentOSResponse[] = [];
  for await (const chunk of agentos.processRequest(input)) {
    responses.push(chunk);
  }
  return responses;
}

describe('AgentOS.processRequest standalone memory integration', () => {
  const tempDirs: string[] = [];
  const openMemories: Memory[] = [];
  const openAgents: AgentOS[] = [];

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

  function createTempMemory(): Memory {
    const dir = mkdtempSync(join(tmpdir(), 'agentos-process-memory-'));
    tempDirs.push(dir);

    const memory = new Memory({
      path: join(dir, 'brain.sqlite'),
      selfImprove: true,
    });
    openMemories.push(memory);
    return memory;
  }

  it('injects standalone long-term memory into a live processRequest turn', async () => {
    const memory = createTempMemory();
    await memory.remember(
      'User preference: command palettes and keyboard-driven workflows.',
      {
        type: 'semantic',
        scope: 'user',
        scopeId: 'user-1',
        tags: ['preferences'],
      },
    );

    const conversationContext = new ConversationContext('conv-live');
    let capturedGmiInput: GMITurnInput | undefined;

    const fakeGmi = {
      getCurrentPrimaryPersonaId: () => 'test-persona',
      getGMIId: () => 'gmi-live-memory',
      processTurnStream: async function* (
        input: GMITurnInput,
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
      }),
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
        Boolean((chunk as AgentOSMetadataUpdateChunk).updates?.longTermMemoryRetrieval),
    );
    const finalChunk = responses.find(
      (chunk): chunk is AgentOSFinalResponseChunk =>
        chunk.type === AgentOSResponseChunkType.FINAL_RESPONSE,
    );

    expect(capturedGmiInput?.metadata?.longTermMemoryContext).toContain('User Memory');
    expect(capturedGmiInput?.metadata?.longTermMemoryContext).toContain(
      'command palettes and keyboard-driven workflows',
    );
    expect(metadataChunk?.updates.longTermMemoryRetrieval).toMatchObject({
      shouldReview: true,
      didRetrieve: true,
    });
    expect(finalChunk?.finalResponseText).toContain('User Memory');
    expect(finalChunk?.finalResponseText).toContain(
      'command palettes and keyboard-driven workflows',
    );
  });

  it('continues a live turn through handleToolResult with the registered memory_search tool', async () => {
    const memory = createTempMemory();
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
            resultPayload.type === 'success'
              ? resultPayload.result?.results?.[0]?.content
              : null;

          return {
            isFinal: true,
            responseText: firstResult
              ? `Found memory: ${firstResult}`
              : 'No matching memory found.',
          };
        },
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
      }),
    );

    const requestStream = agentos.processRequest({
      userId: 'user-1',
      sessionId: 'session-tool',
      conversationId: 'conv-tool',
      textInput: 'Search memory for my menu preferences.',
      selectedPersonaId: 'test-persona',
    });

    const initialChunks: AgentOSResponse[] = [];
    let toolRequestChunk: AgentOSToolCallRequestChunk | undefined;

    while (true) {
      const { value, done } = await requestStream.next();
      if (done) {
        break;
      }

      initialChunks.push(value);
      if (value.type === AgentOSResponseChunkType.TOOL_CALL_REQUEST) {
        toolRequestChunk = value as AgentOSToolCallRequestChunk;
        break;
      }
    }

    expect(toolRequestChunk).toBeDefined();
    expect(toolRequestChunk?.toolCalls).toHaveLength(1);
    expect(toolRequestChunk?.toolCalls[0]?.name).toBe('memory_search');
    expect(
      initialChunks.some(
        (chunk) => chunk.type === AgentOSResponseChunkType.FINAL_RESPONSE,
      ),
    ).toBe(false);

    await requestStream.return(undefined);

    const tool = await agentos.getToolOrchestrator().getTool('memory_search');
    expect(tool).toBeDefined();

    const toolExecution = await tool!.execute(
      toolCall.arguments,
      {
        gmiId: 'gmi-memory-tool',
        personaId: 'test-persona',
        userContext: { userId: 'user-1' } as any,
      } satisfies ToolExecutionContext,
    );

    expect(toolExecution.success).toBe(true);

    const continuationChunks: AgentOSResponse[] = [];
    for await (const chunk of agentos.handleToolResult(
      toolRequestChunk!.streamId,
      toolCall.id,
      toolCall.name,
      toolExecution.output,
      true,
    )) {
      continuationChunks.push(chunk);
    }

    const toolResultChunk = continuationChunks.find(
      (chunk): chunk is AgentOSToolResultEmissionChunk =>
        chunk.type === AgentOSResponseChunkType.TOOL_RESULT_EMISSION,
    );
    const finalChunk = continuationChunks.find(
      (chunk): chunk is AgentOSFinalResponseChunk =>
        chunk.type === AgentOSResponseChunkType.FINAL_RESPONSE,
    );

    expect(toolResultChunk).toBeDefined();
    expect(toolResultChunk?.toolName).toBe('memory_search');
    expect(finalChunk?.finalResponseText).toContain(
      'User preference: keyboard shortcuts over nested menus.',
    );
    expect(fakeGmi.handleToolResult).toHaveBeenCalledTimes(1);
  });
});
