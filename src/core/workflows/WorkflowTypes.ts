import type { JSONSchemaObject } from '../tools/ITool';

/**
 * High-level lifecycle states for a workflow instance.
 */
export enum WorkflowStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  AWAITING_INPUT = 'awaiting_input',
  ERRORED = 'errored',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
}

/**
 * Lifecycle states for a task within a workflow.
 */
export enum WorkflowTaskStatus {
  PENDING = 'pending',
  READY = 'ready',
  IN_PROGRESS = 'in_progress',
  BLOCKED = 'blocked',
  COMPLETED = 'completed',
  SKIPPED = 'skipped',
  FAILED = 'failed',
}

/**
 * Categories describing who or what executes a workflow task.
 */
export type WorkflowTaskExecutorType = 'gmi' | 'human' | 'tool' | 'extension';

/**
 * Declarative role definition referenced by workflow tasks.
 */
export interface WorkflowRoleDefinition {
  roleId: string;
  displayName: string;
  description?: string;
  personaId?: string;
  personaTraits?: Record<string, unknown>;
  evolutionRules?: PersonaEvolutionRule[];
  personaCapabilityRequirements?: string[];
  toolCapabilityRequirements?: string[];
  guardrailPolicyTags?: string[];
  defaultAssigneeStrategy?: 'primary_gmi' | 'conversation_owner' | 'host_supplied';
  metadata?: Record<string, unknown>;
}

/**
 * Declarative task definition within a workflow.
 */
export interface WorkflowTaskDefinition {
  id: string;
  name: string;
  description?: string;
  dependsOn?: string[];
  executor: {
    type: WorkflowTaskExecutorType;
    roleId?: string;
    personaId?: string;
    instructions?: string;
    extensionId?: string;
  };
  inputSchema?: JSONSchemaObject;
  outputSchema?: JSONSchemaObject;
  policyTags?: string[];
  retryPolicy?: {
    maxAttempts: number;
    backoffSeconds?: number;
    strategy?: 'exponential' | 'linear' | 'fixed';
  };
  skippable?: boolean;
  metadata?: Record<string, unknown>;
  handoff?: Record<string, unknown>;
}

/**
 * Declarative descriptor for a workflow definition.
 */
export interface WorkflowDefinition {
  id: string;
  version?: string;
  displayName: string;
  description?: string;
  goalSchema?: JSONSchemaObject;
  finalOutputSchema?: JSONSchemaObject;
  roles?: WorkflowRoleDefinition[];
  tasks: WorkflowTaskDefinition[];
  policyTags?: string[];
  requiresConversationContext?: boolean;
  metadata?: Record<string, unknown>;
}

/**
 * Runtime snapshot of a single task inside a workflow instance.
 */
export interface WorkflowTaskInstance {
  definitionId: string;
  status: WorkflowTaskStatus;
  assignedRoleId?: string;
  assignedExecutorId?: string;
  startedAt?: string;
  completedAt?: string;
  output?: unknown;
  error?: {
    message: string;
    code?: string;
    details?: unknown;
  };
  metadata?: Record<string, unknown>;
}

/**
 * Runtime snapshot of a workflow instance.
 */
export interface WorkflowInstance {
  workflowId: string;
  definitionId: string;
  definitionVersion?: string;
  status: WorkflowStatus;
  createdAt: string;
  updatedAt: string;
  conversationId?: string;
  createdByUserId?: string;
  context?: Record<string, unknown>;
  roleAssignments?: Record<string, string>;
  tasks: Record<string, WorkflowTaskInstance>;
  agencyState?: {
    agencyId: string;
    seats: Record<string, string>;
    metadata?: Record<string, unknown>;
  };
  metadata?: Record<string, unknown>;
}

/**
 * Structured event emitted as workflows progress.
 */
export interface WorkflowEvent {
  eventId: string;
  workflowId: string;
  definitionId: string;
  taskId?: string;
  timestamp: string;
  type:
    | 'workflow_created'
    | 'workflow_status_changed'
    | 'task_status_changed'
    | 'task_output_emitted'
    | 'guardrail_applied'
    | 'error'
    | 'custom';
  payload?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

/**
 * Payload streamed to clients describing workflow progress.
 */
export interface WorkflowProgressUpdate {
  workflow: WorkflowInstance;
  recentEvents?: WorkflowEvent[];
}

/**
 * Descriptor payload stored in the extension registry for workflows.
 */
export interface WorkflowDescriptorPayload {
  definition: WorkflowDefinition;
  metadata?: Record<string, unknown>;
}

export interface PersonaPatch {
  personaTraits?: Record<string, unknown>;
  mood?: string;
  metadata?: Record<string, unknown>;
}

export interface PersonaEvolutionRule {
  id: string;
  description?: string;
  trigger: string | Record<string, unknown>;
  patch: PersonaPatch;
  metadata?: Record<string, unknown>;
}
