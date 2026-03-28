import type { AgentOSInput } from '../../api/types/AgentOSInput';
import type {
  WorkflowDefinition,
  WorkflowDescriptorPayload,
  WorkflowEvent,
  WorkflowInstance,
  WorkflowProgressUpdate,
  WorkflowStatus,
} from './WorkflowTypes';
import type { WorkflowQueryOptions, IWorkflowStore, WorkflowTaskUpdate } from './storage/IWorkflowStore';
import type { ILogger } from '../../logging/ILogger';

export interface WorkflowEngineConfig {
  maxConcurrentWorkflows?: number;
  defaultWorkflowTimeoutSeconds?: number;
}

export interface StartWorkflowOptions {
  input: AgentOSInput;
  definition: WorkflowDefinition;
  workflowId?: string;
  conversationId?: string;
  createdByUserId?: string;
  context?: Record<string, unknown>;
  roleAssignments?: Record<string, string>;
  metadata?: Record<string, unknown>;
}

export interface WorkflowEngineDependencies {
  store: IWorkflowStore;
  logger?: ILogger;
}

export interface WorkflowEngineEventListener {
  (event: WorkflowEvent): void | Promise<void>;
}

export interface IWorkflowEngine {
  initialize(config: WorkflowEngineConfig, deps: WorkflowEngineDependencies): Promise<void>;

  registerWorkflowDescriptor(descriptor: WorkflowDescriptorPayload): Promise<void>;

  unregisterWorkflowDescriptor(workflowDefinitionId: string): Promise<void>;

  listWorkflowDefinitions(): WorkflowDefinition[];

  startWorkflow(options: StartWorkflowOptions): Promise<WorkflowInstance>;

  getWorkflow(workflowId: string): Promise<WorkflowInstance | null>;

  updateWorkflowStatus(workflowId: string, status: WorkflowStatus): Promise<WorkflowInstance | null>;

  applyTaskUpdates(workflowId: string, updates: WorkflowTaskUpdate[]): Promise<WorkflowInstance | null>;

  recordEvents(events: WorkflowEvent[]): Promise<void>;
  updateWorkflowAgencyState(workflowId: string, agencyState: WorkflowInstance['agencyState']): Promise<WorkflowInstance | null>;

  listWorkflows(options?: WorkflowQueryOptions): Promise<WorkflowInstance[]>;

  getWorkflowProgress(workflowId: string, sinceTimestamp?: string): Promise<WorkflowProgressUpdate | null>;

  onEvent(listener: WorkflowEngineEventListener): void;

  offEvent(listener: WorkflowEngineEventListener): void;
}
