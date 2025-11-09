import type {
  WorkflowEvent,
  WorkflowInstance,
  WorkflowProgressUpdate,
  WorkflowStatus,
  WorkflowTaskStatus,
} from '../WorkflowTypes';

/**
 * Input payload used when creating a workflow instance.
 */
export interface WorkflowCreateInput {
  workflowId: string;
  definitionId: string;
  definitionVersion?: string;
  createdAt: string;
  createdByUserId?: string;
  conversationId?: string;
  context?: Record<string, unknown>;
  roleAssignments?: Record<string, string>;
  metadata?: Record<string, unknown>;
}

/**
 * Options supplied when querying for workflow instances.
 */
export interface WorkflowQueryOptions {
  conversationId?: string;
  definitionId?: string;
  statuses?: WorkflowStatus[];
  limit?: number;
}

/**
 * Atomic update payload for a task within a workflow.
 */
export interface WorkflowTaskUpdate {
  taskId: string;
  status?: WorkflowTaskStatus;
  assignedExecutorId?: string;
  startedAt?: string;
  completedAt?: string;
  output?: unknown;
  error?: {
    message: string;
    code?: string;
    details?: unknown;
  } | null;
  metadata?: Record<string, unknown>;
}

/**
 * Interface implemented by persistence layers capable of storing workflow state.
 */
export interface IWorkflowStore {
  /**
   * Persists a newly created workflow instance and its initial tasks snapshot.
   */
  createInstance(
    data: WorkflowCreateInput,
    initialTasks: WorkflowInstance['tasks'],
  ): Promise<WorkflowInstance>;

  /**
   * Retrieves a workflow instance by identifier.
   */
  getInstance(workflowId: string): Promise<WorkflowInstance | null>;

  /**
   * Applies a partial update to the workflow instance metadata/state.
   */
  updateInstance(
    workflowId: string,
    patch: Partial<
      Pick<
        WorkflowInstance,
        'status' | 'updatedAt' | 'metadata' | 'context' | 'roleAssignments' | 'agencyState'
      >
    >,
  ): Promise<WorkflowInstance | null>;

  /**
   * Applies updates to one or more tasks within a workflow instance atomically.
   */
  updateTasks(workflowId: string, updates: WorkflowTaskUpdate[]): Promise<WorkflowInstance | null>;

  /**
   * Appends workflow events for auditing/streaming purposes.
   */
  appendEvents(events: WorkflowEvent[]): Promise<void>;

  /**
   * Lists workflow instances matching the supplied filters.
   */
  listInstances(options?: WorkflowQueryOptions): Promise<WorkflowInstance[]>;

  /**
   * Produces a payload representing the current workflow snapshot and optionally recent events.
   */
  buildProgressUpdate(workflowId: string, sinceTimestamp?: string): Promise<WorkflowProgressUpdate | null>;
}
