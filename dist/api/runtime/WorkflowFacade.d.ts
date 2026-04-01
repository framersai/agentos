/**
 * @file WorkflowFacade.ts
 * @module api/WorkflowFacade
 *
 * @description
 * Encapsulates all workflow-related lifecycle operations previously embedded
 * directly in `AgentOS`. This includes workflow engine initialization,
 * runtime bootstrapping, descriptor registration/deregistration, event
 * handling, and public CRUD methods for workflow definitions and instances.
 *
 * The class owns the `WorkflowEngine`, `WorkflowRuntime`, `IWorkflowStore`,
 * and `AgencyRegistry` instances. It receives its remaining dependencies
 * (extension manager, tool orchestrator, orchestrator for broadcasting,
 * streaming/GMI managers, logger) via constructor injection.
 *
 * AgentOS retains thin public delegates that forward to this facade, so the
 * external API surface remains unchanged.
 */
import type { ILogger } from '../../logging/ILogger';
import type { IToolOrchestrator } from '../../core/tools/IToolOrchestrator';
import type { ExtensionManager, ExtensionLifecycleContext } from '../extensions';
import type { AgentOSOrchestrator } from './AgentOSOrchestrator';
import type { GMIManager } from '../../cognitive_substrate/GMIManager';
import type { StreamingManager } from '../../core/streaming/StreamingManager';
import type { WorkflowEngineConfig } from '../../orchestration/workflows/IWorkflowEngine';
import type { WorkflowDefinition, WorkflowInstance, WorkflowProgressUpdate, WorkflowStatus } from '../../orchestration/workflows/WorkflowTypes';
import type { IWorkflowStore, WorkflowQueryOptions, WorkflowTaskUpdate } from '../../orchestration/workflows/storage/IWorkflowStore';
import type { AgentOSInput } from '../types/AgentOSInput';
/**
 * Dependencies injected into the WorkflowFacade at construction time.
 * These are references to services owned and managed by AgentOS.
 */
export interface WorkflowFacadeDependencies {
    /** Extension manager for registry access and event subscription. */
    extensionManager: ExtensionManager;
    /** Logger scoped to the workflow subsystem. */
    logger: ILogger;
    /** Optional workflow engine configuration. */
    workflowEngineConfig?: WorkflowEngineConfig;
    /** Optional caller-supplied workflow store; defaults to in-memory. */
    workflowStore?: IWorkflowStore;
}
/**
 * Runtime dependencies that become available only after AgentOS finishes
 * bootstrapping the core services (GMI, streaming, tools). These are set
 * via {@link WorkflowFacade.setRuntimeDependencies} before calling
 * {@link WorkflowFacade.startRuntime}.
 */
export interface WorkflowFacadeRuntimeDependencies {
    gmiManager: GMIManager;
    streamingManager: StreamingManager;
    toolOrchestrator: IToolOrchestrator;
    /** The orchestrator used for broadcasting workflow progress updates. */
    orchestrator?: AgentOSOrchestrator;
}
/**
 * @class WorkflowFacade
 *
 * Owns the full workflow lifecycle: engine init, descriptor sync, runtime
 * start/stop, and public query/mutation methods. Extracted from AgentOS to
 * reduce the monolith's surface area.
 */
export declare class WorkflowFacade {
    private readonly deps;
    private workflowEngine;
    private workflowStore;
    private workflowRuntime?;
    private agencyRegistry?;
    private workflowEngineListener?;
    private workflowExtensionListener?;
    private runtimeDeps?;
    constructor(deps: WorkflowFacadeDependencies);
    /**
     * Initialize the workflow engine, agency registry, register existing
     * descriptors, and wire up extension/engine event listeners.
     *
     * Must be called during the AgentOS `initialize()` sequence, before
     * core services (tool orchestrator, GMI, etc.) are fully ready. The
     * runtime can be started later via {@link startRuntime}.
     *
     * @param context - Extension lifecycle context forwarded to registries.
     */
    initialize(context: ExtensionLifecycleContext): Promise<void>;
    /**
     * Provide runtime dependencies that only become available after AgentOS
     * finishes initializing GMI, streaming, and tools. Must be called before
     * {@link startRuntime}.
     */
    setRuntimeDependencies(runtimeDeps: WorkflowFacadeRuntimeDependencies): void;
    /**
     * Start the workflow runtime. Requires that both {@link initialize} and
     * {@link setRuntimeDependencies} have been called.
     */
    startRuntime(): Promise<void>;
    /**
     * Gracefully shut down all workflow-owned resources: listeners, runtime,
     * engine, agency registry.
     */
    shutdown(): Promise<void>;
    /**
     * List all registered workflow definitions.
     *
     * @returns An array of workflow definitions known to the engine.
     */
    listWorkflowDefinitions(): WorkflowDefinition[];
    /**
     * Start a new workflow instance from the given definition.
     *
     * @param definitionId - The ID of the workflow definition to instantiate.
     * @param input        - The AgentOS input triggering the workflow.
     * @param options      - Optional overrides for the workflow instance.
     * @returns The newly created workflow instance.
     * @throws {AgentOSServiceError} When the definition is not found.
     */
    startWorkflow(definitionId: string, input: AgentOSInput, options?: {
        workflowId?: string;
        conversationId?: string;
        createdByUserId?: string;
        context?: Record<string, unknown>;
        roleAssignments?: Record<string, string>;
        metadata?: Record<string, unknown>;
    }): Promise<WorkflowInstance>;
    /**
     * Retrieve a single workflow instance by ID.
     *
     * @param workflowId - The unique identifier of the workflow.
     * @returns The workflow instance, or `null` if not found.
     */
    getWorkflow(workflowId: string): Promise<WorkflowInstance | null>;
    /**
     * List workflow instances, optionally filtered by query options.
     *
     * @param options - Optional filter/sort/pagination criteria.
     * @returns An array of matching workflow instances.
     */
    listWorkflows(options?: WorkflowQueryOptions): Promise<WorkflowInstance[]>;
    /**
     * Retrieve progress information for a given workflow.
     *
     * @param workflowId     - The workflow to query.
     * @param sinceTimestamp  - Optional ISO-8601 timestamp; only return events after this point.
     * @returns Progress update payload, or `null` if not found.
     */
    getWorkflowProgress(workflowId: string, sinceTimestamp?: string): Promise<WorkflowProgressUpdate | null>;
    /**
     * Update the status of a workflow instance.
     *
     * @param workflowId - Target workflow.
     * @param status     - New status to apply.
     * @returns The updated workflow instance, or `null` if not found.
     */
    updateWorkflowStatus(workflowId: string, status: WorkflowStatus): Promise<WorkflowInstance | null>;
    /**
     * Apply a batch of task-level updates to a workflow instance.
     *
     * @param workflowId - Target workflow.
     * @param updates    - Array of task updates.
     * @returns The updated workflow instance, or `null` if not found.
     */
    applyWorkflowTaskUpdates(workflowId: string, updates: WorkflowTaskUpdate[]): Promise<WorkflowInstance | null>;
    /**
     * Register all active workflow descriptors found in the extension registry.
     */
    private registerWorkflowDescriptorsFromRegistry;
    /**
     * Handle activation of a workflow descriptor by registering it with the engine.
     */
    private handleWorkflowDescriptorActivated;
    /**
     * Handle deactivation of a workflow descriptor by unregistering it from the engine.
     */
    private handleWorkflowDescriptorDeactivated;
    /**
     * Handle a workflow engine event by emitting a progress update.
     */
    private handleWorkflowEngineEvent;
    /**
     * Emit a workflow progress update via the orchestrator's broadcast channel.
     */
    private emitWorkflowUpdate;
}
//# sourceMappingURL=WorkflowFacade.d.ts.map