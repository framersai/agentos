import { describe, expect, it, vi } from 'vitest';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

vi.mock('p-queue', () => {
  class ImmediateQueue {
    public add<T>(task: () => Promise<T> | T): Promise<T> {
      return Promise.resolve().then(task);
    }

    public onIdle(): Promise<void> {
      return Promise.resolve();
    }
  }

  return { default: ImmediateQueue };
});

import { WorkflowRuntime } from '../../../src/core/workflows/runtime/WorkflowRuntime';
import type {
  WorkflowDefinition,
  WorkflowInstance,
  WorkflowTaskDefinition,
} from '../../../src/core/workflows/WorkflowTypes';
import { WorkflowTaskStatus } from '../../../src/core/workflows/WorkflowTypes';
import type { WorkflowEngine } from '../../../src/core/workflows/WorkflowEngine';
import type { GMIManager } from '../../../src/cognitive_substrate/GMIManager';
import type { StreamingManager } from '../../../src/core/streaming/StreamingManager';
import type { IToolOrchestrator } from '../../../src/core/tools/IToolOrchestrator';
import type { ToolExecutionRequestDetails } from '../../../src/core/tools/ToolExecutor';
import { AgencyRegistry } from '../../../src/core/agency/AgencyRegistry';
import {
  GMIInteractionType,
  GMIOutputChunkType,
  type GMIOutputChunk,
  type GMITurnInput,
} from '../../../src/cognitive_substrate/IGMI';
import type { IGMI } from '../../../src/cognitive_substrate/IGMI';
import { AgentOSResponseChunkType } from '../../../src/api/types/AgentOSResponse';
import { ExtensionManager } from '../../../src/extensions';
import {
  EXTENSION_KIND_WORKFLOW_EXECUTOR,
  type WorkflowExtensionExecutor,
} from '../../../src/extensions/types';

interface RuntimeOptions {
  definition?: WorkflowDefinition;
  instance?: WorkflowInstance;
  toolResult?: { success: boolean; output?: unknown; isError?: boolean; errorDetails?: unknown };
  extensionHandlers?: Record<string, WorkflowExtensionExecutor>;
}

const baseWorkflowDefinition: WorkflowDefinition = {
  id: 'definition-1',
  displayName: 'Test Workflow',
  description: 'Testing',
  tasks: [
    {
      id: 'task-1',
      name: 'Research',
      executor: {
        type: 'gmi',
        roleId: 'researcher',
        instructions: 'Gather the latest findings.',
      },
    } as WorkflowTaskDefinition,
  ],
  roles: [
    {
      roleId: 'researcher',
      displayName: 'Researcher',
      personaId: 'persona-1',
      evolutionRules: [{ id: 'focus', trigger: 'always', patch: { mood: 'focused' } }],
      personaCapabilityRequirements: ['research'],
    },
  ],
};

const baseWorkflowInstance: WorkflowInstance = {
  workflowId: 'workflow-1',
  definitionId: baseWorkflowDefinition.id,
  status: WorkflowTaskStatus.RUNNING,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  conversationId: 'conversation-1',
  createdByUserId: 'user-1',
  tasks: {
    'task-1': {
      definitionId: 'task-1',
      status: WorkflowTaskStatus.READY,
    },
  },
  metadata: {},
};

const buildRuntime = (options: RuntimeOptions = {}) => {
  const definition = options.definition ?? clone(baseWorkflowDefinition);
  const instance = options.instance ?? clone(baseWorkflowInstance);

  const applyTaskUpdatesMock = vi.fn().mockResolvedValue(instance);
  const updateWorkflowAgencyState = vi.fn().mockResolvedValue(instance);
  const workflowEngine = {
    listWorkflowDefinitions: vi.fn().mockReturnValue([definition]),
    getWorkflow: vi.fn().mockResolvedValue(instance),
    applyTaskUpdates: applyTaskUpdatesMock,
    updateWorkflowAgencyState,
    onEvent: vi.fn(),
    offEvent: vi.fn(),
  } as unknown as WorkflowEngine;

  const streamingManager = {
    pushChunk: vi.fn().mockResolvedValue(undefined),
  } as unknown as StreamingManager;

  const agencyRegistry = new AgencyRegistry();

  const gmi: IGMI = {
    gmiId: 'gmi-1',
    getPersona: () => ({ id: 'persona-1' } as any),
    processTurnStream: (_input: GMITurnInput) =>
      (async function* () {
        const chunk1: GMIOutputChunk = {
          type: GMIOutputChunkType.TEXT_DELTA,
          content: 'Hello ',
          metadata: {},
        } as unknown as GMIOutputChunk;
        const chunk2: GMIOutputChunk = {
          type: GMIOutputChunkType.FINAL_RESPONSE,
          content: { finalResponseText: 'World' },
          metadata: {},
        } as unknown as GMIOutputChunk;
        yield chunk1;
        yield chunk2;
        return undefined;
      })(),
    handleToolResult: vi.fn(),
    getReasoningTrace: () => ({ entries: [] } as any),
    shutdown: vi.fn(),
    onMemoryLifecycleEvent: vi.fn(),
    analyzeAndReportMemoryHealth: vi.fn(),
    getOverallHealth: vi.fn(),
  } as unknown as IGMI;

  const conversationMetadata = new Map<string, unknown>();
  const conversationContext = {
    setMetadata: (key: string, value: unknown) => conversationMetadata.set(key, value),
    getMetadata: (key: string) => conversationMetadata.get(key),
  } as any;

  const getOrCreateGMIForSession = vi.fn().mockResolvedValue({
    gmi,
    conversationContext,
  });

  const gmiManager = {
    getOrCreateGMIForSession,
  } as unknown as GMIManager;

  const toolResult = options.toolResult ?? { success: true, output: { data: 'ok' } };
  const toolOrchestrator = {
    processToolCall: vi.fn().mockResolvedValue(toolResult),
  } as unknown as IToolOrchestrator;

  const extensionManager = new ExtensionManager();
  const extensionRegistry =
    extensionManager.getRegistry<WorkflowExtensionExecutor>(EXTENSION_KIND_WORKFLOW_EXECUTOR);
  if (options.extensionHandlers) {
    for (const [id, handler] of Object.entries(options.extensionHandlers)) {
      extensionRegistry.register({
        id,
        kind: EXTENSION_KIND_WORKFLOW_EXECUTOR,
        payload: handler,
        metadata: {},
        priority: 0,
      });
    }
  }

  const loggerError = vi.fn();
  const loggerWarn = vi.fn();
  const runtime = new WorkflowRuntime({
    workflowEngine,
    gmiManager,
    streamingManager,
    toolOrchestrator,
    extensionManager,
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: loggerWarn,
      error: loggerError,
      child: vi.fn().mockReturnValue({
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      }),
    },
  });

  (runtime as any).definitionCache.set(definition.id, definition);

  return {
    runtime,
    workflowEngine,
    streamingManager,
    applyTaskUpdatesMock,
    updateWorkflowAgencyState,
    getOrCreateGMIForSession,
    toolOrchestrator,
    loggerError,
  };
};

describe('WorkflowRuntime', () => {
  it('executes GMI tasks using Agency overlays and streams updates', async () => {
    const {
      runtime,
      applyTaskUpdatesMock,
      streamingManager, loggerError,
      updateWorkflowAgencyState,
    } = buildRuntime();

    await (runtime as any).enqueueTaskExecution(
      baseWorkflowInstance.workflowId,
      baseWorkflowDefinition.id,
      'task-1',
    );




    const statuses = applyTaskUpdatesMock.mock.calls.map(([, updates]) =>
      updates.map((update: any) => update.status),
    );
    console.log('updates', JSON.stringify(applyTaskUpdatesMock.mock.calls)); console.log('loggerError', JSON.stringify(loggerError.mock.calls)); expect(statuses.flat()).toEqual(
      expect.arrayContaining([WorkflowTaskStatus.IN_PROGRESS, WorkflowTaskStatus.COMPLETED]),
    );

    expect(loggerError).not.toHaveBeenCalled();

    expect(streamingManager.pushChunk).toHaveBeenCalled();
    const chunk = streamingManager.pushChunk.mock.calls[0][1];
    expect(chunk.type).toBe(AgentOSResponseChunkType.AGENCY_UPDATE);

    expect(updateWorkflowAgencyState).toHaveBeenCalled();
  });

  it('executes tool tasks via the tool orchestrator', async () => {
    const toolTaskDefinition: WorkflowTaskDefinition = {
      id: 'tool-task',
      name: 'Lookup',
      executor: {
        type: 'tool',
        extensionId: 'lookupTool',
      },
      metadata: {
        toolArgs: { query: 'hello' },
      },
    };

    const definition: WorkflowDefinition = {
      ...clone(baseWorkflowDefinition),
      tasks: [toolTaskDefinition],
    };

    const instance: WorkflowInstance = {
      ...clone(baseWorkflowInstance),
      tasks: {
        'tool-task': { definitionId: 'tool-task', status: WorkflowTaskStatus.READY },
      },
    };

    const { runtime, applyTaskUpdatesMock, toolOrchestrator } = buildRuntime({
      definition,
      instance,
      toolResult: { success: true, output: { answer: 42 } },
    });

    await (runtime as any).enqueueTaskExecution(instance.workflowId, definition.id, 'tool-task');

    expect(toolOrchestrator.processToolCall).toHaveBeenCalled();
    const request: ToolExecutionRequestDetails = toolOrchestrator.processToolCall.mock.calls[0][0];
    expect(request.toolCallRequest.name).toBe('lookupTool');
    expect(request.toolCallRequest.arguments).toEqual({ query: 'hello' });

    const statuses = applyTaskUpdatesMock.mock.calls.flatMap(([, updates]) =>
      updates.map((update: any) => update.status),
    );
    expect(statuses).toContain(WorkflowTaskStatus.COMPLETED);
  });

  it('executes extension tasks via registered workflow executors', async () => {
    const extensionTask: WorkflowTaskDefinition = {
      id: 'extension-task',
      name: 'Custom Logic',
      executor: {
        type: 'extension',
        extensionId: 'custom-executor',
      },
    };

    const definition: WorkflowDefinition = {
      ...clone(baseWorkflowDefinition),
      tasks: [extensionTask],
    };

    const instance: WorkflowInstance = {
      ...clone(baseWorkflowInstance),
      tasks: {
        'extension-task': { definitionId: 'extension-task', status: WorkflowTaskStatus.READY },
      },
    };

    const executor: WorkflowExtensionExecutor = vi.fn().mockResolvedValue({
      output: { value: 'done' },
      status: WorkflowTaskStatus.COMPLETED,
    });

    const { runtime, applyTaskUpdatesMock } = buildRuntime({
      definition,
      instance,
      extensionHandlers: { 'custom-executor': executor },
    });

    await (runtime as any).enqueueTaskExecution(
      instance.workflowId,
      definition.id,
      'extension-task',
    );

    expect(executor).toHaveBeenCalled();
    const updates = applyTaskUpdatesMock.mock.calls.at(-1)?.[1];
    expect(updates?.[0]?.status).toBe(WorkflowTaskStatus.COMPLETED);
    expect(updates?.[0]?.output).toEqual({ value: 'done' });
  });
});



