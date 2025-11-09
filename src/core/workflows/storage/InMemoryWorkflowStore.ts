import {
  WorkflowEvent,
  WorkflowInstance,
  WorkflowProgressUpdate,
  WorkflowStatus,
  WorkflowTaskStatus,
} from '../WorkflowTypes';
import type {
  IWorkflowStore,
  WorkflowCreateInput,
  WorkflowQueryOptions,
  WorkflowTaskUpdate,
} from './IWorkflowStore';

function cloneInstance(instance: WorkflowInstance): WorkflowInstance {
  return JSON.parse(JSON.stringify(instance));
}

function cloneEvent(event: WorkflowEvent): WorkflowEvent {
  return JSON.parse(JSON.stringify(event));
}

export class InMemoryWorkflowStore implements IWorkflowStore {
  private readonly instances = new Map<string, WorkflowInstance>();
  private readonly events = new Map<string, WorkflowEvent[]>();

  public async createInstance(
    data: WorkflowCreateInput,
    initialTasks: WorkflowInstance['tasks'],
  ): Promise<WorkflowInstance> {
    const instance: WorkflowInstance = {
      workflowId: data.workflowId,
      definitionId: data.definitionId,
      definitionVersion: data.definitionVersion,
      status: WorkflowStatus.PENDING,
      createdAt: data.createdAt,
      updatedAt: data.createdAt,
      conversationId: data.conversationId,
      createdByUserId: data.createdByUserId,
      context: data.context,
      roleAssignments: data.roleAssignments,
      metadata: data.metadata,
      tasks: JSON.parse(JSON.stringify(initialTasks)),
    };

    this.instances.set(instance.workflowId, instance);
    this.events.set(instance.workflowId, []);
    return cloneInstance(instance);
  }

  public async getInstance(workflowId: string): Promise<WorkflowInstance | null> {
    const instance = this.instances.get(workflowId);
    return instance ? cloneInstance(instance) : null;
  }

  public async updateInstance(
    workflowId: string,
    patch: Partial<
      Pick<WorkflowInstance, 'status' | 'updatedAt' | 'metadata' | 'context' | 'roleAssignments' | 'agencyState'>
    >,
  ): Promise<WorkflowInstance | null> {
    const existing = this.instances.get(workflowId);
    if (!existing) {
      return null;
    }
    const updated: WorkflowInstance = {
      ...existing,
      ...patch,
    };
    this.instances.set(workflowId, updated);
    return cloneInstance(updated);
  }

  public async updateTasks(
    workflowId: string,
    updates: WorkflowTaskUpdate[],
  ): Promise<WorkflowInstance | null> {
    const existing = this.instances.get(workflowId);
    if (!existing) {
      return null;
    }

    const tasks = { ...existing.tasks };
    for (const update of updates) {
      const prior = tasks[update.taskId] ?? {
        definitionId: update.taskId,
        status: WorkflowTaskStatus.PENDING,
      };
      tasks[update.taskId] = {
        ...prior,
        status: update.status ?? prior.status,
        assignedExecutorId: update.assignedExecutorId ?? prior.assignedExecutorId,
        startedAt: update.startedAt ?? prior.startedAt,
        completedAt: update.completedAt ?? prior.completedAt,
        output: update.output ?? prior.output,
        error: update.error ?? prior.error,
        metadata: update.metadata ?? prior.metadata,
      };
    }

    const updatedInstance: WorkflowInstance = {
      ...existing,
      tasks,
      updatedAt: new Date().toISOString(),
    };

    this.instances.set(workflowId, updatedInstance);
    return cloneInstance(updatedInstance);
  }

  public async appendEvents(events: WorkflowEvent[]): Promise<void> {
    for (const event of events) {
      const workflowEvents = this.events.get(event.workflowId);
      if (!workflowEvents) {
        this.events.set(event.workflowId, [cloneEvent(event)]);
        continue;
      }
      workflowEvents.push(cloneEvent(event));
    }
  }

  public async listInstances(options?: WorkflowQueryOptions): Promise<WorkflowInstance[]> {
    const result: WorkflowInstance[] = [];
    for (const instance of this.instances.values()) {
      if (options?.conversationId && instance.conversationId !== options.conversationId) {
        continue;
      }
      if (options?.definitionId && instance.definitionId !== options.definitionId) {
        continue;
      }
      if (
        options?.statuses &&
        options.statuses.length > 0 &&
        !options.statuses.includes(instance.status)
      ) {
        continue;
      }
      result.push(cloneInstance(instance));
      if (options?.limit && result.length >= options.limit) {
        break;
      }
    }
    return result;
  }

  public async buildProgressUpdate(
    workflowId: string,
    sinceTimestamp?: string,
  ): Promise<WorkflowProgressUpdate | null> {
    const instance = this.instances.get(workflowId);
    if (!instance) {
      return null;
    }

    let recentEvents: WorkflowEvent[] | undefined;
    const events = this.events.get(workflowId) ?? [];
    if (sinceTimestamp) {
      recentEvents = events
        .filter((event) => event.timestamp > sinceTimestamp)
        .map((event) => cloneEvent(event));
    } else {
      recentEvents = events.slice(-10).map((event) => cloneEvent(event));
    }

    return {
      workflow: cloneInstance(instance),
      recentEvents,
    };
  }
}
