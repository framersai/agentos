import { EventEmitter } from 'node:events';
import { v4 as uuidv4 } from 'uuid';

import type { ILogger } from '../../logging/ILogger';
import { createLogger } from '../../logging/loggerFactory';
import {
  WorkflowDefinition,
  WorkflowDescriptorPayload,
  WorkflowEvent,
  WorkflowInstance,
  WorkflowProgressUpdate,
  WorkflowStatus,
  WorkflowTaskDefinition,
  WorkflowTaskInstance,
  WorkflowTaskStatus,
} from './WorkflowTypes';
import type {
  IWorkflowStore,
  WorkflowQueryOptions,
  WorkflowTaskUpdate,
} from './storage/IWorkflowStore';
import type {
  IWorkflowEngine,
  StartWorkflowOptions,
  WorkflowEngineConfig,
  WorkflowEngineDependencies,
  WorkflowEngineEventListener,
} from './IWorkflowEngine';

interface RegisteredWorkflow {
  definition: WorkflowDefinition;
  metadata?: Record<string, unknown>;
}

const TERMINAL_STATUSES: WorkflowStatus[] = [
  WorkflowStatus.COMPLETED,
  WorkflowStatus.CANCELLED,
  WorkflowStatus.ERRORED,
];

function isTerminal(status: WorkflowStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

function cloneInstance(instance: WorkflowInstance): WorkflowInstance {
  return JSON.parse(JSON.stringify(instance));
}

function buildInitialTasks(definition: WorkflowDefinition): Record<string, WorkflowTaskInstance> {
  const dependencyMap = new Map<string, Set<string>>();
  for (const task of definition.tasks) {
    dependencyMap.set(task.id, new Set(task.dependsOn ?? []));
  }

  const result: Record<string, WorkflowTaskInstance> = {};
  for (const task of definition.tasks) {
    const dependencies = dependencyMap.get(task.id);
    const initialStatus: WorkflowTaskStatus =
      !dependencies || dependencies.size === 0 ? WorkflowTaskStatus.READY : WorkflowTaskStatus.PENDING;
    result[task.id] = {
      definitionId: task.id,
      status: initialStatus,
      metadata: {},
    };
  }
  return result;
}

function validateWorkflowDefinition(definition: WorkflowDefinition): void {
  const taskIds = new Set<string>();
  for (const task of definition.tasks) {
    if (taskIds.has(task.id)) {
      throw new Error(
        `Workflow definition '${definition.id}' contains duplicate task id '${task.id}'.`,
      );
    }
    taskIds.add(task.id);
  }

  const missingDeps: Array<{ taskId: string; dependencyId: string }> = [];
  for (const task of definition.tasks) {
    for (const dependency of task.dependsOn ?? []) {
      if (!taskIds.has(dependency)) {
        missingDeps.push({ taskId: task.id, dependencyId: dependency });
      }
    }
  }
  if (missingDeps.length > 0) {
    const formatted = missingDeps
      .map(({ taskId, dependencyId }) => `'${taskId}' -> '${dependencyId}'`)
      .join(', ');
    throw new Error(
      `Workflow definition '${definition.id}' references missing task dependencies: ${formatted}`,
    );
  }

  if (hasCycles(definition.tasks)) {
    throw new Error(`Workflow definition '${definition.id}' contains cyclic dependencies.`);
  }
}

function hasCycles(tasks: WorkflowTaskDefinition[]): boolean {
  const graph = new Map<string, string[]>(tasks.map((task) => [task.id, task.dependsOn ?? []]));
  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (node: string): boolean => {
    if (visiting.has(node)) {
      return true;
    }
    if (visited.has(node)) {
      return false;
    }
    visiting.add(node);
    for (const dep of graph.get(node) ?? []) {
      if (visit(dep)) {
        return true;
      }
    }
    visiting.delete(node);
    visited.add(node);
    return false;
  };

  for (const node of graph.keys()) {
    if (visit(node)) {
      return true;
    }
  }
  return false;
}

export class WorkflowEngine implements IWorkflowEngine {
  private initialized = false;
  private config: Required<WorkflowEngineConfig> = {
    maxConcurrentWorkflows: Number.POSITIVE_INFINITY,
    defaultWorkflowTimeoutSeconds: 0,
  };
  private store!: IWorkflowStore;
  private readonly definitions = new Map<string, RegisteredWorkflow>();
  private readonly emitter = new EventEmitter();
  private logger: ILogger = createLogger('WorkflowEngine');
  private activeWorkflowCount = 0;

  public async initialize(
    config: WorkflowEngineConfig,
    deps: WorkflowEngineDependencies,
  ): Promise<void> {
    this.config = {
      maxConcurrentWorkflows:
        config.maxConcurrentWorkflows ?? Number.POSITIVE_INFINITY,
      defaultWorkflowTimeoutSeconds: config.defaultWorkflowTimeoutSeconds ?? 0,
    };

    this.store = deps.store;
    this.logger = deps.logger ?? createLogger('WorkflowEngine');
    this.initialized = true;
    this.logger.info('Workflow engine initialised', {
      maxConcurrentWorkflows: this.config.maxConcurrentWorkflows,
    });
  }

  public async registerWorkflowDescriptor(descriptor: WorkflowDescriptorPayload): Promise<void> {
    this.ensureInitialized();
    const { definition, metadata } = descriptor;
    validateWorkflowDefinition(definition);
    this.definitions.set(definition.id, { definition, metadata });
    this.logger.debug?.('Registered workflow definition', { definitionId: definition.id });
  }

  public async unregisterWorkflowDescriptor(workflowDefinitionId: string): Promise<void> {
    this.ensureInitialized();
    this.definitions.delete(workflowDefinitionId);
    this.logger.debug?.('Unregistered workflow definition', { workflowDefinitionId });
  }

  public listWorkflowDefinitions(): WorkflowDefinition[] {
    this.ensureInitialized();
    return Array.from(this.definitions.values()).map(({ definition }) => ({ ...definition }));
  }

  public async startWorkflow(options: StartWorkflowOptions): Promise<WorkflowInstance> {
    this.ensureInitialized();
    if (
      this.config.maxConcurrentWorkflows !== Number.POSITIVE_INFINITY &&
      this.activeWorkflowCount >= this.config.maxConcurrentWorkflows
    ) {
      throw new Error('WorkflowEngine capacity exceeded.');
    }

    const { definition } = options;
    const registered = this.definitions.get(definition.id);
    if (!registered) {
      throw new Error(`Workflow definition '${definition.id}' is not registered.`);
    }

    const workflowId = options.workflowId ?? uuidv4();
    const nowIso = new Date().toISOString();
    const conversationId =
      options.conversationId ?? options.input.conversationId ?? options.input.sessionId;
    const createdByUserId = options.createdByUserId ?? options.input.userId;
    const tasks = buildInitialTasks(registered.definition);

    const instance = await this.store.createInstance(
      {
        workflowId,
        definitionId: registered.definition.id,
        definitionVersion: registered.definition.version,
        createdAt: nowIso,
        createdByUserId,
        conversationId,
        context: options.context,
        roleAssignments: options.roleAssignments,
        metadata: options.metadata,
      },
      tasks,
    );

    const runningInstance =
      (await this.store.updateInstance(workflowId, {
        status: WorkflowStatus.RUNNING,
        updatedAt: nowIso,
      })) ?? instance;

    const createdEvent: WorkflowEvent = {
      eventId: uuidv4(),
      workflowId: runningInstance.workflowId,
      definitionId: runningInstance.definitionId,
      timestamp: nowIso,
      type: 'workflow_created',
      payload: {
        conversationId,
        createdByUserId,
        input: {
          userId: options.input.userId,
          sessionId: options.input.sessionId,
          selectedPersonaId: options.input.selectedPersonaId,
        },
      },
    };

    await this.recordEvents([createdEvent]);
    this.activeWorkflowCount += 1;
    this.logger.info('Workflow started', { workflowId: runningInstance.workflowId });
    return cloneInstance(runningInstance);
  }

  public async getWorkflow(workflowId: string): Promise<WorkflowInstance | null> {
    this.ensureInitialized();
    const instance = await this.store.getInstance(workflowId);
    return instance ? cloneInstance(instance) : null;
  }

  public async updateWorkflowStatus(
    workflowId: string,
    status: WorkflowStatus,
  ): Promise<WorkflowInstance | null> {
    this.ensureInitialized();
    const nowIso = new Date().toISOString();
    const updated = await this.store.updateInstance(workflowId, {
      status,
      updatedAt: nowIso,
    });
    if (!updated) {
      return null;
    }

    if (isTerminal(status)) {
      this.activeWorkflowCount = Math.max(0, this.activeWorkflowCount - 1);
    }

    const event: WorkflowEvent = {
      eventId: uuidv4(),
      workflowId,
      definitionId: updated.definitionId,
      timestamp: nowIso,
      type: 'workflow_status_changed',
      payload: { status },
    };
    await this.recordEvents([event]);
    this.logger.debug?.('Workflow status updated', { workflowId, status });
    return cloneInstance(updated);
  }

  public async applyTaskUpdates(
    workflowId: string,
    updates: WorkflowTaskUpdate[],
  ): Promise<WorkflowInstance | null> {
    this.ensureInitialized();
    if (updates.length === 0) {
      return this.getWorkflow(workflowId);
    }

    const nowIso = new Date().toISOString();
    const updated = await this.store.updateTasks(workflowId, updates);
    if (!updated) {
      return null;
    }

    const events: WorkflowEvent[] = [];
    for (const update of updates) {
      if (update.status) {
        events.push({
          eventId: uuidv4(),
          workflowId,
          definitionId: updated.definitionId,
          taskId: update.taskId,
          timestamp: nowIso,
          type: 'task_status_changed',
          payload: {
            status: update.status,
            assignedExecutorId: update.assignedExecutorId,
          },
        });
      }
      if (update.output !== undefined) {
        events.push({
          eventId: uuidv4(),
          workflowId,
          definitionId: updated.definitionId,
          taskId: update.taskId,
          timestamp: nowIso,
          type: 'task_output_emitted',
          payload: { output: update.output },
        });
      }
      if (update.error) {
        events.push({
          eventId: uuidv4(),
          workflowId,
          definitionId: updated.definitionId,
          taskId: update.taskId,
          timestamp: nowIso,
          type: 'error',
          payload: update.error,
        });
      }
    }

    if (events.length > 0) {
      await this.recordEvents(events);
    }
    this.logger.debug?.('Workflow tasks updated', { workflowId, updatesCount: updates.length });
    return cloneInstance(updated);
  }

  public async updateWorkflowAgencyState(
    workflowId: string,
    agencyState: WorkflowInstance['agencyState'],
  ): Promise<WorkflowInstance | null> {
    this.ensureInitialized();
    const nowIso = new Date().toISOString();
    const updated = await this.store.updateInstance(workflowId, {
      agencyState,
      updatedAt: nowIso,
    });
    if (updated) {
      this.logger.debug?.('Workflow agency state updated', {
        workflowId,
        agencyId: agencyState?.agencyId,
      });
    }
    return updated ? cloneInstance(updated) : null;
  }

  public async recordEvents(events: WorkflowEvent[]): Promise<void> {
    if (!events.length) {
      return;
    }
    await this.store.appendEvents(events);
    for (const event of events) {
      this.emitter.emit('event', event);
    }
  }

  public async listWorkflows(options?: WorkflowQueryOptions): Promise<WorkflowInstance[]> {
    this.ensureInitialized();
    const instances = await this.store.listInstances(options);
    return instances.map(cloneInstance);
  }

  public async getWorkflowProgress(
    workflowId: string,
    sinceTimestamp?: string,
  ): Promise<WorkflowProgressUpdate | null> {
    this.ensureInitialized();
    return this.store.buildProgressUpdate(workflowId, sinceTimestamp);
  }

  public onEvent(listener: WorkflowEngineEventListener): void {
    this.emitter.on('event', listener);
  }

  public offEvent(listener: WorkflowEngineEventListener): void {
    this.emitter.off('event', listener);
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('WorkflowEngine has not been initialised.');
    }
  }
}
