import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentOS, type AgentOSConfig } from '../../src/api/AgentOS';
import { AgentOSOrchestrator } from '../../src/api/AgentOSOrchestrator';
import { GMIManager } from '../../src/cognitive_substrate/GMIManager';
import { PromptEngine } from '../../src/core/llm/PromptEngine';
import { Memory } from '../../src/memory/facade/Memory';

function createConfig(
  overrides: Partial<AgentOSConfig> = {},
): AgentOSConfig {
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

describe('AgentOS memory tool auto-registration', () => {
  const tempDirs: string[] = [];
  let agentOSOrchestratorInitializeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.spyOn(AgentOS.prototype as any, 'initializeWorkflowRuntime').mockResolvedValue(undefined);
    vi.spyOn(AgentOS.prototype as any, 'startWorkflowRuntime').mockResolvedValue(undefined);
    vi.spyOn(AgentOS.prototype as any, 'initializeTurnPlanner').mockResolvedValue(undefined);
    vi.spyOn(AgentOS.prototype as any, 'initializeRagSubsystem').mockResolvedValue(undefined);
    vi.spyOn(PromptEngine.prototype, 'initialize').mockResolvedValue(undefined);
    vi.spyOn(PromptEngine.prototype, 'clearCache').mockResolvedValue(undefined);
    vi.spyOn(GMIManager.prototype, 'initialize').mockResolvedValue(undefined);
    vi.spyOn(GMIManager.prototype, 'shutdown').mockResolvedValue(undefined);
    agentOSOrchestratorInitializeSpy = vi
      .spyOn(AgentOSOrchestrator.prototype, 'initialize')
      .mockResolvedValue(undefined);
    vi.spyOn(AgentOSOrchestrator.prototype, 'shutdown').mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function createTempMemory(selfImprove = true): Memory {
    const dir = mkdtempSync(join(tmpdir(), 'agentos-memory-tools-'));
    tempDirs.push(dir);
    return new Memory({
      path: join(dir, 'brain.sqlite'),
      selfImprove,
    });
  }

  it('loads standalone memory tools from AgentOS config during initialize()', async () => {
    const agentos = new AgentOS();
    const memory = createTempMemory(true);

    await agentos.initialize(
      createConfig({
        memoryTools: {
          memory,
        },
      }),
    );

    const toolOrchestrator = agentos.getToolOrchestrator();
    expect(await toolOrchestrator.getTool('memory_add')).toBeDefined();
    expect(await toolOrchestrator.getTool('memory_search')).toBeDefined();
    expect(await toolOrchestrator.getTool('memory_reflect')).toBeDefined();

    const loadedPack = agentos
      .getExtensionManager()
      .listLoadedPacks()
      .find((pack) => pack.identifier === 'config-memory-tools');
    expect(loadedPack?.name).toBe('agentos-memory-tools');

    await agentos.shutdown();
    await memory.close();
  });

  it('respects includeReflect=false in AgentOS memoryTools config', async () => {
    const agentos = new AgentOS();
    const memory = createTempMemory(true);

    await agentos.initialize(
      createConfig({
        memoryTools: {
          memory,
          includeReflect: false,
          identifier: 'custom-memory-tools',
        },
      }),
    );

    const toolOrchestrator = agentos.getToolOrchestrator();
    expect(await toolOrchestrator.getTool('memory_add')).toBeDefined();
    expect(await toolOrchestrator.getTool('memory_reflect')).toBeUndefined();

    const loadedPack = agentos
      .getExtensionManager()
      .listLoadedPacks()
      .find((pack) => pack.identifier === 'custom-memory-tools');
    expect(loadedPack?.name).toBe('agentos-memory-tools');

    await agentos.shutdown();
    await memory.close();
  });

  it('can manage the standalone memory lifecycle during AgentOS shutdown', async () => {
    const agentos = new AgentOS();
    const memory = createTempMemory(true);
    const closeSpy = vi.spyOn(memory, 'close');

    await agentos.initialize(
      createConfig({
        memoryTools: {
          memory,
          manageLifecycle: true,
        },
      }),
    );

    await agentos.shutdown();

    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  it('derives tools, long-term retrieval, and rolling-summary persistence from standaloneMemory config', async () => {
    const agentos = new AgentOS();
    const memory = createTempMemory(true);
    const closeSpy = vi.spyOn(memory, 'close');

    await agentos.initialize(
      createConfig({
        standaloneMemory: {
          memory,
          manageLifecycle: true,
          tools: { includeReflect: false },
          longTermRetriever: true,
          rollingSummarySink: true,
        },
      }),
    );

    expect(await agentos.getToolOrchestrator().getTool('memory_add')).toBeDefined();
    expect(await agentos.getToolOrchestrator().getTool('memory_reflect')).toBeUndefined();

    const orchestratorDeps = agentOSOrchestratorInitializeSpy.mock.calls[0]?.[1] as any;
    expect(orchestratorDeps?.longTermMemoryRetriever).toBeDefined();
    expect(orchestratorDeps?.rollingSummaryMemorySink).toBeDefined();

    await agentos.shutdown();

    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  it('rejects memoryTools config without a createTools() backend', async () => {
    const agentos = new AgentOS();

    await expect(
      agentos.initialize(
        createConfig({
          memoryTools: {
            memory: {} as any,
          } as any,
        }),
      ),
    ).rejects.toThrow(/memoryTools\.memory\.createTools/);
  });

  it('rejects standaloneMemory long-term retrieval config without a recall() backend', async () => {
    const agentos = new AgentOS();

    await expect(
      agentos.initialize(
        createConfig({
          standaloneMemory: {
            memory: {
              remember: async () => ({ id: 'x' }),
              forget: async () => undefined,
            },
            longTermRetriever: true,
          } as any,
        }),
      ),
    ).rejects.toThrow(/standaloneMemory\.memory\.recall/);
  });

  it('rejects manageLifecycle=true when the memory backend cannot close()', async () => {
    const agentos = new AgentOS();

    await expect(
      agentos.initialize(
        createConfig({
          memoryTools: {
            memory: {
              createTools: () => [],
            },
            manageLifecycle: true,
          } as any,
        }),
      ),
    ).rejects.toThrow(/memoryTools\.memory\.close/);
  });

  it('rejects standaloneMemory manageLifecycle=true when the memory backend cannot close()', async () => {
    const agentos = new AgentOS();

    await expect(
      agentos.initialize(
        createConfig({
          standaloneMemory: {
            memory: {
              remember: async () => ({ id: 'x' }),
              recall: async () => [],
              forget: async () => undefined,
            },
            manageLifecycle: true,
          } as any,
        }),
      ),
    ).rejects.toThrow(/standaloneMemory\.memory\.close/);
  });
});
