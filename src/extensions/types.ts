import type { ILogger } from '../logging/ILogger';
import type { IGuardrailService } from '../core/guardrails/IGuardrailService';
import type { ITool } from '../core/tools/ITool';
import type {
  WorkflowDescriptorPayload,
  WorkflowInstance,
  WorkflowTaskDefinition,
  WorkflowTaskStatus,
} from '../core/workflows/WorkflowTypes';

/**
 * Represents the broad category an extension descriptor belongs to.
 * Well-known kinds include `tool`, `guardrail`, and `response-processor`,
 * but the system allows arbitrary strings for future expansion.
 */
export type ExtensionKind = string;

/**
 * Metadata describing where a descriptor originated from. Useful for debugging,
 * audit logs, or surfacing provenance in developer tooling.
 */
export interface ExtensionSourceMetadata {
  /**
   * Human-friendly name of the pack providing the descriptor (e.g. package name).
   */
  sourceName: string;
  /**
   * Optional semantic version of the pack.
   */
  sourceVersion?: string;
  /**
   * Identifier of the pack entry inside a manifest (path, local file, etc.).
   */
  identifier?: string;
}

/**
 * Context object passed to lifecycle hooks when descriptors are activated or
 * deactivated. Additional properties can be added as the extension runtime
 * evolves.
 */
export interface ExtensionLifecycleContext {
  logger?: ILogger;
}

/**
 * Unified descriptor contract consumed by the extension registry. Concrete
 * descriptor types (e.g., tools, guardrails) extend this shape with payloads
 * specific to their domain.
 */
export interface ExtensionDescriptor<TPayload = unknown> {
  /**
   * Unique identifier for the descriptor within its kind. Subsequent
   * descriptors with the same id stack on top of previous entries.
   */
  id: string;
  /**
   * High-level category of the descriptor (tool, guardrail, etc.).
   */
  kind: ExtensionKind;
  /**
   * Optional priority used during manifest loading. Higher numbers load later,
   * allowing them to supersede earlier descriptors with the same id.
   */
  priority?: number;
  /**
   * Flag indicating whether the descriptor should be enabled by default when
   * discovered. Manifests or overrides can still disable it explicitly.
   */
  enableByDefault?: boolean;
  /**
   * Arbitrary metadata for tooling or pack-specific usage.
   */
  metadata?: Record<string, unknown>;
  /**
   * The payload consumed by the runtime (e.g., tool factory function).
   */
  payload: TPayload;
  /**
   * Provenance information for the descriptor.
   */
  source?: ExtensionSourceMetadata;
  /**
   * Optional lifecycle hook invoked when the descriptor becomes the active
   * entry for its id.
   */
  onActivate?: (context: ExtensionLifecycleContext) => Promise<void> | void;
  /**
   * Optional lifecycle hook invoked when the descriptor is superseded or
   * removed.
   */
  onDeactivate?: (context: ExtensionLifecycleContext) => Promise<void> | void;
}

/**
 * Active descriptor paired with resolved priority and original stack index.
 */
export interface ActiveExtensionDescriptor<TPayload = unknown>
  extends ExtensionDescriptor<TPayload> {
  /**
   * Resolved numeric priority used to order descriptors inside a stack.
   */
  resolvedPriority: number;
  /**
   * 0-based insertion position within the stack (lower is older).
   */
  stackIndex: number;
}

export const EXTENSION_KIND_TOOL = 'tool';
export const EXTENSION_KIND_GUARDRAIL = 'guardrail';
export const EXTENSION_KIND_RESPONSE_PROCESSOR = 'response-processor';
export const EXTENSION_KIND_WORKFLOW = 'workflow';
export const EXTENSION_KIND_WORKFLOW_EXECUTOR = 'workflow-executor';

export type ToolDescriptor = ExtensionDescriptor<ITool> & { kind: typeof EXTENSION_KIND_TOOL };
export type GuardrailDescriptor = ExtensionDescriptor<IGuardrailService> & { kind: typeof EXTENSION_KIND_GUARDRAIL };
export type WorkflowDescriptor = ExtensionDescriptor<WorkflowDescriptorPayload> & {
  kind: typeof EXTENSION_KIND_WORKFLOW;
};

export interface WorkflowExtensionExecutionContext {
  workflow: WorkflowInstance;
  task: WorkflowTaskDefinition;
}

export interface WorkflowExtensionExecutionResult {
  output?: unknown;
  status?: WorkflowTaskStatus;
  metadata?: Record<string, unknown>;
}

export type WorkflowExtensionExecutor = (
  context: WorkflowExtensionExecutionContext,
) => Promise<WorkflowExtensionExecutionResult> | WorkflowExtensionExecutionResult;

export type WorkflowExecutorDescriptor = ExtensionDescriptor<WorkflowExtensionExecutor> & {
  kind: typeof EXTENSION_KIND_WORKFLOW_EXECUTOR;
};

