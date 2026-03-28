import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDatabase } from '../../../sql-storage-adapter/src/core/database';
import type { StorageAdapter } from '../../../sql-storage-adapter/src/core/contracts';

import { AgentOS, type AgentOSConfig } from '../../src/api/AgentOS';
import {
  AgentOSResponseChunkType,
  type AgentOSResponse,
} from '../../src/api/types/AgentOSResponse';
import { resumeExternalToolRequestWithRegisteredTools } from '../../src/api/resumeExternalToolRequestWithRegisteredTools';
import type { ToolExecutionContext } from '../../src/core/tools/ITool';
import { GMIManager } from '../../src/cognitive_substrate/GMIManager';
import { GMIOutputChunkType, type GMIOutput } from '../../src/cognitive_substrate/IGMI';
import { PromptEngine } from '../../src/core/llm/PromptEngine';
import { Memory } from '../../src/memory/io/facade/Memory';

const cleanupPaths: string[] = [];
const openAgents: AgentOS[] = [];
const openMemories: Memory[] = [];
const openAdapters: StorageAdapter[] = [];

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'agentos-external-tool-resume-'));
  cleanupPaths.push(dir);
  return dir;
}

function trackMemory(memory: Memory): Memory {
  openMemories.push(memory);
  return memory;
}

function untrackMemory(memory: Memory): void {
  const index = openMemories.indexOf(memory);
  if (index >= 0) {
    openMemories.splice(index, 1);
  }
}

function trackAgent(agent: AgentOS): AgentOS {
  openAgents.push(agent);
  return agent;
}

function untrackAgent(agent: AgentOS): void {
  const index = openAgents.indexOf(agent);
  if (index >= 0) {
    openAgents.splice(index, 1);
  }
}

function trackAdapter(adapter: StorageAdapter): StorageAdapter {
  openAdapters.push(adapter);
  return adapter;
}

function untrackAdapter(adapter: StorageAdapter): void {
  const index = openAdapters.indexOf(adapter);
  if (index >= 0) {
    openAdapters.splice(index, 1);
  }
}

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
      persistenceEnabled: true,
    },
    streamingManagerConfig: {},
    modelProviderManagerConfig: {
      providers: [],
    },
    defaultPersonaId: 'test-persona',
    prisma: undefined as any,
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

async function collectStream(stream: AsyncIterable<AgentOSResponse>): Promise<AgentOSResponse[]> {
  const chunks: AgentOSResponse[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return chunks;
}

describe('External tool resume persistence e2e', () => {
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

    for (const adapter of openAdapters.splice(0)) {
      try {
        await adapter.close();
      } catch {
        // already closed
      }
    }

    for (const target of cleanupPaths.splice(0)) {
      await rm(target, { recursive: true, force: true });
    }

    vi.restoreAllMocks();
  });

  it('reloads a persisted external memory-tool pause from SQLite and resumes it after restart', async () => {
    const dir = await createTempDir();
    const conversationDbPath = path.join(dir, 'conversations.sqlite');
    const brainDbPath = path.join(dir, 'brain.sqlite');

    let memory = trackMemory(
      await Memory.create({
        path: brainDbPath,
        selfImprove: true,
      })
    );
    await memory.remember('User preference: keyboard shortcuts over nested menus.', {
      type: 'semantic',
      scope: 'user',
      scopeId: 'user-1',
      tags: ['preferences'],
    });

    const toolCall = {
      id: 'tool-call-memory-search-persisted',
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
      getGMIId: () => 'gmi-memory-tool-persisted-initial',
      getPersona: () => fakePersona,
      processTurnStream: async function* (): AsyncGenerator<any, GMIOutput, undefined> {
        yield {
          type: GMIOutputChunkType.TOOL_CALL_REQUEST,
          content: [toolCall],
          interactionId: 'interaction-memory-tool-persisted-initial',
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
      getGMIId: () => 'gmi-memory-tool-persisted-resumed',
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

    let activeAgent: AgentOS | null = null;
    let phase: 'initial' | 'resumed' = 'initial';

    vi.spyOn(GMIManager.prototype, 'getOrCreateGMIForSession').mockImplementation(
      async (userId: string, sessionId: string, personaId: string, conversationId?: string) => {
        const agent = activeAgent;
        if (!agent || !conversationId) {
          throw new Error('Test GMI bootstrap requires an active agent and conversation ID.');
        }

        const gmi = phase === 'initial' ? firstGmi : resumedGmi;
        const conversationContext = await agent
          .getConversationManager()
          .getOrCreateConversationContext(conversationId, userId, gmi.getGMIId(), personaId, {
            userId,
            activePersonaId: personaId,
          });

        return {
          gmi,
          conversationContext,
        } as any;
      }
    );

    const firstStorage = trackAdapter(
      await createDatabase({
        file: conversationDbPath,
        priority: ['better-sqlite3'],
      })
    );

    const firstAgent = trackAgent(new AgentOS());
    activeAgent = firstAgent;
    await firstAgent.initialize(
      createConfig({
        storageAdapter: firstStorage,
        standaloneMemory: {
          memory,
          tools: true,
        },
      })
    );

    const initialChunks = await collectStream(
      firstAgent.processRequest({
        userId: 'user-1',
        sessionId: 'session-persisted-restart',
        conversationId: 'conv-persisted-restart',
        textInput: 'Search memory for my menu preferences.',
        selectedPersonaId: 'test-persona',
      })
    );

    const toolRequestChunk = initialChunks.find(
      (chunk) => chunk.type === AgentOSResponseChunkType.TOOL_CALL_REQUEST
    );
    expect(toolRequestChunk).toBeDefined();
    expect(
      initialChunks.some((chunk) => chunk.type === AgentOSResponseChunkType.FINAL_RESPONSE)
    ).toBe(false);

    await firstAgent.shutdown();
    untrackAgent(firstAgent);
    await firstStorage.close();
    untrackAdapter(firstStorage);
    await memory.close();
    untrackMemory(memory);

    const secondStorage = trackAdapter(
      await createDatabase({
        file: conversationDbPath,
        priority: ['better-sqlite3'],
      })
    );

    const savedConversation = await secondStorage.get<{ session_details: string }>(
      'SELECT session_details FROM conversations WHERE id = ?',
      ['conv-persisted-restart']
    );
    expect(savedConversation).not.toBeNull();
    const savedMetadata = JSON.parse(savedConversation!.session_details);
    expect(savedMetadata.agentosPendingExternalToolRequest).toMatchObject({
      conversationId: 'conv-persisted-restart',
      userId: 'user-1',
      toolCalls: [expect.objectContaining({ id: toolCall.id, name: 'memory_search' })],
    });

    const savedMessages = await secondStorage.all<{ role: string; tool_calls: string | null }>(
      'SELECT role, tool_calls FROM conversation_messages WHERE conversation_id = ? ORDER BY timestamp ASC',
      ['conv-persisted-restart']
    );
    expect(
      savedMessages.some(
        (message) =>
          message.role === 'assistant' &&
          Boolean(message.tool_calls) &&
          JSON.parse(message.tool_calls!)[0]?.id === toolCall.id
      )
    ).toBe(true);

    memory = trackMemory(
      await Memory.create({
        path: brainDbPath,
        selfImprove: true,
      })
    );

    phase = 'resumed';
    const secondAgent = trackAgent(new AgentOS());
    activeAgent = secondAgent;
    await secondAgent.initialize(
      createConfig({
        storageAdapter: secondStorage,
        standaloneMemory: {
          memory,
          tools: true,
        },
      })
    );

    const pendingRequest = await secondAgent.getPendingExternalToolRequest(
      'conv-persisted-restart',
      'user-1'
    );
    expect(pendingRequest).toMatchObject({
      conversationId: 'conv-persisted-restart',
      userId: 'user-1',
      toolCalls: [expect.objectContaining({ id: toolCall.id, name: 'memory_search' })],
    });

    const tool = await secondAgent.getToolOrchestrator().getTool('memory_search');
    expect(tool).toBeDefined();

    const execution = await tool!.execute(toolCall.arguments, {
      gmiId: 'gmi-memory-tool-persisted-resumed',
      personaId: 'test-persona',
      userContext: { userId: 'user-1' } as any,
    } satisfies ToolExecutionContext);
    expect(execution.success).toBe(true);

    const resumedChunks = await collectStream(
      secondAgent.resumeExternalToolRequest(pendingRequest!, [
        {
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          toolOutput: execution.output,
          isSuccess: execution.success,
          errorMessage: execution.error,
        },
      ])
    );

    const finalChunk = resumedChunks.find(
      (chunk) => chunk.type === AgentOSResponseChunkType.FINAL_RESPONSE
    );

    expect(finalChunk).toMatchObject({
      type: AgentOSResponseChunkType.FINAL_RESPONSE,
    });
    expect((finalChunk as any)?.finalResponseText).toContain(
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
      await secondAgent.getPendingExternalToolRequest('conv-persisted-restart', 'user-1')
    ).toBeNull();

    const clearedConversation = await secondStorage.get<{ session_details: string }>(
      'SELECT session_details FROM conversations WHERE id = ?',
      ['conv-persisted-restart']
    );
    expect(
      JSON.parse(clearedConversation!.session_details).agentosPendingExternalToolRequest
    ).toBeUndefined();
  });

  it('reloads a persisted batched external memory-tool pause from SQLite and resumes it after restart', async () => {
    const dir = await createTempDir();
    const conversationDbPath = path.join(dir, 'conversations.sqlite');
    const brainDbPath = path.join(dir, 'brain.sqlite');

    let memory = trackMemory(
      await Memory.create({
        path: brainDbPath,
        selfImprove: true,
      })
    );
    await memory.remember('User preference: keyboard shortcuts over nested menus.', {
      type: 'semantic',
      scope: 'user',
      scopeId: 'user-1',
      tags: ['preferences'],
    });

    const toolCalls = [
      {
        id: 'tool-call-memory-search-persisted-batch',
        name: 'memory_search',
        arguments: {
          query: 'keyboard shortcuts',
          scope: 'user',
          limit: 3,
        },
      },
      {
        id: 'tool-call-memory-add-persisted-batch',
        name: 'memory_add',
        arguments: {
          content: 'Remember this preference for future UI suggestions.',
          type: 'semantic',
          scope: 'user',
          tags: ['preferences'],
        },
      },
    ] as const;

    const fakePersona = {
      id: 'test-persona',
      name: 'Test Persona',
      version: '1.0.0',
      baseSystemPrompt: 'You are a memory-aware assistant.',
    };

    const firstGmi = {
      getCurrentPrimaryPersonaId: () => 'test-persona',
      getGMIId: () => 'gmi-memory-tool-persisted-batch-initial',
      getPersona: () => fakePersona,
      processTurnStream: async function* (): AsyncGenerator<any, GMIOutput, undefined> {
        yield {
          type: GMIOutputChunkType.TOOL_CALL_REQUEST,
          content: toolCalls,
          interactionId: 'interaction-memory-tool-persisted-batch-initial',
          timestamp: new Date(),
          metadata: {
            executionMode: 'external',
            requiresExternalToolResult: true,
          },
        };

        return {
          isFinal: false,
          responseText: 'I need to search and update memory before I can answer.',
          toolCalls: [...toolCalls],
        };
      },
    };

    const resumedGmi = {
      getCurrentPrimaryPersonaId: () => 'test-persona',
      getGMIId: () => 'gmi-memory-tool-persisted-batch-resumed',
      getPersona: () => fakePersona,
      hydrateConversationHistory: vi.fn(),
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

    let activeAgent: AgentOS | null = null;
    let phase: 'initial' | 'resumed' = 'initial';

    vi.spyOn(GMIManager.prototype, 'getOrCreateGMIForSession').mockImplementation(
      async (userId: string, sessionId: string, personaId: string, conversationId?: string) => {
        const agent = activeAgent;
        if (!agent || !conversationId) {
          throw new Error('Test GMI bootstrap requires an active agent and conversation ID.');
        }

        const gmi = phase === 'initial' ? firstGmi : resumedGmi;
        const conversationContext = await agent
          .getConversationManager()
          .getOrCreateConversationContext(conversationId, userId, gmi.getGMIId(), personaId, {
            userId,
            activePersonaId: personaId,
          });

        return {
          gmi,
          conversationContext,
        } as any;
      }
    );

    const firstStorage = trackAdapter(
      await createDatabase({
        file: conversationDbPath,
        priority: ['better-sqlite3'],
      })
    );

    const firstAgent = trackAgent(new AgentOS());
    activeAgent = firstAgent;
    await firstAgent.initialize(
      createConfig({
        storageAdapter: firstStorage,
        standaloneMemory: {
          memory,
          tools: true,
        },
      })
    );

    const initialChunks = await collectStream(
      firstAgent.processRequest({
        userId: 'user-1',
        sessionId: 'session-persisted-restart-batch',
        conversationId: 'conv-persisted-restart-batch',
        textInput: 'Search memory and save my preference.',
        selectedPersonaId: 'test-persona',
      })
    );

    const toolRequestChunk = initialChunks.find(
      (chunk) => chunk.type === AgentOSResponseChunkType.TOOL_CALL_REQUEST
    ) as (AgentOSResponse & { toolCalls?: unknown[] }) | undefined;
    expect(toolRequestChunk).toBeDefined();
    expect(toolRequestChunk?.toolCalls).toHaveLength(2);
    expect(
      initialChunks.some((chunk) => chunk.type === AgentOSResponseChunkType.FINAL_RESPONSE)
    ).toBe(false);

    await firstAgent.shutdown();
    untrackAgent(firstAgent);
    await firstStorage.close();
    untrackAdapter(firstStorage);
    await memory.close();
    untrackMemory(memory);

    const secondStorage = trackAdapter(
      await createDatabase({
        file: conversationDbPath,
        priority: ['better-sqlite3'],
      })
    );

    const savedConversation = await secondStorage.get<{ session_details: string }>(
      'SELECT session_details FROM conversations WHERE id = ?',
      ['conv-persisted-restart-batch']
    );
    expect(savedConversation).not.toBeNull();
    const savedMetadata = JSON.parse(savedConversation!.session_details);
    expect(savedMetadata.agentosPendingExternalToolRequest).toMatchObject({
      conversationId: 'conv-persisted-restart-batch',
      userId: 'user-1',
    });
    expect(savedMetadata.agentosPendingExternalToolRequest.toolCalls).toHaveLength(2);

    const savedMessages = await secondStorage.all<{ role: string; tool_calls: string | null }>(
      'SELECT role, tool_calls FROM conversation_messages WHERE conversation_id = ? ORDER BY timestamp ASC',
      ['conv-persisted-restart-batch']
    );
    expect(
      savedMessages.some((message) => {
        if (message.role !== 'assistant' || !message.tool_calls) {
          return false;
        }
        const parsedToolCalls = JSON.parse(message.tool_calls) as Array<{ id: string }>;
        return (
          parsedToolCalls.length === 2 &&
          parsedToolCalls[0]?.id === toolCalls[0].id &&
          parsedToolCalls[1]?.id === toolCalls[1].id
        );
      })
    ).toBe(true);

    memory = trackMemory(
      await Memory.create({
        path: brainDbPath,
        selfImprove: true,
      })
    );

    phase = 'resumed';
    const secondAgent = trackAgent(new AgentOS());
    activeAgent = secondAgent;
    await secondAgent.initialize(
      createConfig({
        storageAdapter: secondStorage,
        standaloneMemory: {
          memory,
          tools: true,
        },
      })
    );

    const pendingRequest = await secondAgent.getPendingExternalToolRequest(
      'conv-persisted-restart-batch',
      'user-1'
    );
    expect(pendingRequest).toMatchObject({
      conversationId: 'conv-persisted-restart-batch',
      userId: 'user-1',
    });
    expect(pendingRequest?.toolCalls).toHaveLength(2);

    const toolResults = [];
    for (const toolCall of toolCalls) {
      const tool = await secondAgent.getToolOrchestrator().getTool(toolCall.name);
      expect(tool).toBeDefined();

      const execution = await tool!.execute(toolCall.arguments, {
        gmiId: 'gmi-memory-tool-persisted-batch-resumed',
        personaId: 'test-persona',
        userContext: { userId: 'user-1' } as any,
      } satisfies ToolExecutionContext);
      expect(execution.success).toBe(true);

      toolResults.push({
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        toolOutput: execution.output,
        isSuccess: execution.success,
        errorMessage: execution.error,
      });
    }

    const resumedChunks = await collectStream(
      secondAgent.resumeExternalToolRequest(pendingRequest!, toolResults)
    );

    const finalChunk = resumedChunks.find(
      (chunk) => chunk.type === AgentOSResponseChunkType.FINAL_RESPONSE
    );
    expect(finalChunk).toMatchObject({
      type: AgentOSResponseChunkType.FINAL_RESPONSE,
    });
    expect((finalChunk as any)?.finalResponseText).toContain(
      'User preference: keyboard shortcuts over nested menus.'
    );
    expect((finalChunk as any)?.finalResponseText).toContain('Saved trace:');

    expect(resumedGmi.handleToolResults).toHaveBeenCalledTimes(1);
    expect(resumedGmi.hydrateConversationHistory).toHaveBeenCalledTimes(1);

    const hydratedHistory = resumedGmi.hydrateConversationHistory.mock.calls[0]?.[0] as
      | Array<{ tool_calls?: Array<{ id: string }> }>
      | undefined;
    expect(
      hydratedHistory?.some((message) => {
        if (!Array.isArray(message.tool_calls)) {
          return false;
        }
        return (
          message.tool_calls.length === 2 &&
          message.tool_calls[0]?.id === toolCalls[0].id &&
          message.tool_calls[1]?.id === toolCalls[1].id
        );
      })
    ).toBe(true);

    const addedHits = await memory.recall('future UI suggestions', {
      scope: 'user',
      scopeId: 'user-1',
      limit: 5,
    });
    expect(
      addedHits.some((hit) =>
        hit.trace.content.includes('Remember this preference for future UI suggestions.')
      )
    ).toBe(true);

    expect(
      await secondAgent.getPendingExternalToolRequest('conv-persisted-restart-batch', 'user-1')
    ).toBeNull();

    const clearedConversation = await secondStorage.get<{ session_details: string }>(
      'SELECT session_details FROM conversations WHERE id = ?',
      ['conv-persisted-restart-batch']
    );
    expect(
      JSON.parse(clearedConversation!.session_details).agentosPendingExternalToolRequest
    ).toBeUndefined();
  });

  it('re-applies organization context when resuming an organization-scoped memory pause after restart', async () => {
    const dir = await createTempDir();
    const conversationDbPath = path.join(dir, 'conversations-org.sqlite');
    const brainDbPath = path.join(dir, 'brain-org.sqlite');

    let memory = trackMemory(
      await Memory.create({
        path: brainDbPath,
        selfImprove: true,
      })
    );
    await memory.remember('Org default: favor keyboard shortcuts over menu nesting.', {
      type: 'semantic',
      scope: 'organization',
      scopeId: 'org-alpha',
      tags: ['org-defaults'],
    });

    const toolCall = {
      id: 'tool-call-memory-search-org-persisted',
      name: 'memory_search',
      arguments: {
        query: 'keyboard shortcuts',
        scope: 'organization',
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
      getGMIId: () => 'gmi-memory-tool-org-persisted-initial',
      getPersona: () => fakePersona,
      processTurnStream: async function* (): AsyncGenerator<any, GMIOutput, undefined> {
        yield {
          type: GMIOutputChunkType.TOOL_CALL_REQUEST,
          content: [toolCall],
          interactionId: 'interaction-memory-tool-org-persisted-initial',
          timestamp: new Date(),
          metadata: {
            executionMode: 'external',
            requiresExternalToolResult: true,
          },
        };

        return {
          isFinal: false,
          responseText: 'I need to search organization memory before I can answer.',
          toolCalls: [toolCall],
        };
      },
    };

    const resumedGmi = {
      getCurrentPrimaryPersonaId: () => 'test-persona',
      getGMIId: () => 'gmi-memory-tool-org-persisted-resumed',
      getPersona: () => fakePersona,
      hydrateConversationHistory: vi.fn(),
      hydrateTurnContext: vi.fn(),
      handleToolResult: vi.fn(
        async (_toolCallId: string, _toolName: string, resultPayload: any): Promise<GMIOutput> => {
          const firstResult =
            resultPayload.type === 'success' ? resultPayload.result?.results?.[0]?.content : null;

          return {
            isFinal: true,
            responseText: firstResult
              ? `Recovered organization memory: ${firstResult}`
              : 'No matching organization memory found after restart.',
          };
        }
      ),
    };

    let activeAgent: AgentOS | null = null;
    let phase: 'initial' | 'resumed' = 'initial';

    vi.spyOn(GMIManager.prototype, 'getOrCreateGMIForSession').mockImplementation(
      async (userId: string, _sessionId: string, personaId: string, conversationId?: string) => {
        const agent = activeAgent;
        if (!agent || !conversationId) {
          throw new Error('Test GMI bootstrap requires an active agent and conversation ID.');
        }

        const gmi = phase === 'initial' ? firstGmi : resumedGmi;
        const conversationContext = await agent
          .getConversationManager()
          .getOrCreateConversationContext(conversationId, userId, gmi.getGMIId(), personaId, {
            userId,
            activePersonaId: personaId,
          });

        return {
          gmi,
          conversationContext,
        } as any;
      }
    );

    const firstStorage = trackAdapter(
      await createDatabase({
        file: conversationDbPath,
        priority: ['better-sqlite3'],
      })
    );

    const firstAgent = trackAgent(new AgentOS());
    activeAgent = firstAgent;
    await firstAgent.initialize(
      createConfig({
        storageAdapter: firstStorage,
        standaloneMemory: {
          memory,
          tools: true,
        },
      })
    );

    const initialChunks = await collectStream(
      firstAgent.processRequest({
        userId: 'user-1',
        organizationId: 'org-alpha',
        sessionId: 'session-persisted-org-restart',
        conversationId: 'conv-persisted-org-restart',
        textInput: 'Search organization memory for our keyboard-shortcut defaults.',
        selectedPersonaId: 'test-persona',
      })
    );

    expect(
      initialChunks.some((chunk) => chunk.type === AgentOSResponseChunkType.TOOL_CALL_REQUEST)
    ).toBe(true);
    expect(
      initialChunks.some((chunk) => chunk.type === AgentOSResponseChunkType.FINAL_RESPONSE)
    ).toBe(false);

    await firstAgent.shutdown();
    untrackAgent(firstAgent);
    await firstStorage.close();
    untrackAdapter(firstStorage);
    await memory.close();
    untrackMemory(memory);

    const secondStorage = trackAdapter(
      await createDatabase({
        file: conversationDbPath,
        priority: ['better-sqlite3'],
      })
    );

    memory = trackMemory(
      await Memory.create({
        path: brainDbPath,
        selfImprove: true,
      })
    );

    phase = 'resumed';
    const secondAgent = trackAgent(new AgentOS());
    activeAgent = secondAgent;
    await secondAgent.initialize(
      createConfig({
        storageAdapter: secondStorage,
        standaloneMemory: {
          memory,
          tools: true,
        },
      })
    );

    const pendingRequest = await secondAgent.getPendingExternalToolRequest(
      'conv-persisted-org-restart',
      'user-1'
    );
    expect(pendingRequest).toMatchObject({
      conversationId: 'conv-persisted-org-restart',
      userId: 'user-1',
      toolCalls: [expect.objectContaining({ id: toolCall.id, name: 'memory_search' })],
    });

    const resumedChunks = await collectStream(
      resumeExternalToolRequestWithRegisteredTools(secondAgent, pendingRequest!, {
        organizationId: 'org-alpha',
      })
    );

    const finalChunk = resumedChunks.find(
      (chunk) => chunk.type === AgentOSResponseChunkType.FINAL_RESPONSE
    );
    expect(finalChunk).toMatchObject({
      type: AgentOSResponseChunkType.FINAL_RESPONSE,
    });
    expect((finalChunk as any)?.finalResponseText).toContain(
      'Recovered organization memory: Org default: favor keyboard shortcuts over menu nesting.'
    );

    expect(resumedGmi.hydrateConversationHistory).toHaveBeenCalledTimes(1);
    expect(resumedGmi.hydrateTurnContext).toHaveBeenCalledWith({
      sessionId: 'session-persisted-org-restart',
      conversationId: 'conv-persisted-org-restart',
      organizationId: 'org-alpha',
    });
    expect(resumedGmi.handleToolResult).toHaveBeenCalledTimes(1);
  });
});
