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
import { EXTENSION_KIND_WORKFLOW } from '../extensions/index.js';
import { WorkflowEngine } from '../../orchestration/workflows/WorkflowEngine.js';
import { InMemoryWorkflowStore } from '../../orchestration/workflows/storage/InMemoryWorkflowStore.js';
import { WorkflowRuntime } from '../../orchestration/workflows/runtime/WorkflowRuntime.js';
import { AgencyRegistry } from '../../agents/agency/AgencyRegistry.js';
import { AgentOSServiceError } from '../errors.js';
import { GMIErrorCode } from '../../core/utils/errors.js';
/**
 * @class WorkflowFacade
 *
 * Owns the full workflow lifecycle: engine init, descriptor sync, runtime
 * start/stop, and public query/mutation methods. Extracted from AgentOS to
 * reduce the monolith's surface area.
 */
export class WorkflowFacade {
    constructor(deps) {
        this.deps = deps;
    }
    // ---------------------------------------------------------------------------
    // Initialization
    // ---------------------------------------------------------------------------
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
    async initialize(context) {
        this.workflowStore = this.deps.workflowStore ?? new InMemoryWorkflowStore();
        this.workflowEngine = new WorkflowEngine();
        const workflowLogger = this.deps.logger.child?.({ component: 'WorkflowEngine' }) ?? this.deps.logger;
        await this.workflowEngine.initialize(this.deps.workflowEngineConfig ?? {}, {
            store: this.workflowStore,
            logger: workflowLogger,
        });
        const agencyLogger = this.deps.logger.child?.({ component: 'AgencyRegistry' }) ?? this.deps.logger;
        this.agencyRegistry = new AgencyRegistry(agencyLogger);
        await this.registerWorkflowDescriptorsFromRegistry();
        this.workflowExtensionListener = async (event) => {
            if (!this.workflowEngine) {
                return;
            }
            if (event.type === 'descriptor:activated' && event.kind === EXTENSION_KIND_WORKFLOW) {
                const descriptor = event.descriptor;
                await this.handleWorkflowDescriptorActivated({
                    id: descriptor.id,
                    payload: descriptor.payload,
                });
            }
            else if (event.type === 'descriptor:deactivated' &&
                event.kind === EXTENSION_KIND_WORKFLOW) {
                const descriptor = event.descriptor;
                await this.handleWorkflowDescriptorDeactivated({
                    id: descriptor.id,
                    payload: descriptor.payload,
                });
            }
        };
        this.deps.extensionManager.on(this.workflowExtensionListener);
        this.workflowEngineListener = async (event) => {
            await this.handleWorkflowEngineEvent(event);
        };
        this.workflowEngine.onEvent(this.workflowEngineListener);
    }
    /**
     * Provide runtime dependencies that only become available after AgentOS
     * finishes initializing GMI, streaming, and tools. Must be called before
     * {@link startRuntime}.
     */
    setRuntimeDependencies(runtimeDeps) {
        this.runtimeDeps = runtimeDeps;
    }
    /**
     * Start the workflow runtime. Requires that both {@link initialize} and
     * {@link setRuntimeDependencies} have been called.
     */
    async startRuntime() {
        if (!this.workflowEngine) {
            return;
        }
        if (this.workflowRuntime) {
            return;
        }
        if (!this.runtimeDeps) {
            this.deps.logger.warn('Workflow runtime start skipped because runtime dependencies are not set.');
            return;
        }
        const { gmiManager, streamingManager, toolOrchestrator } = this.runtimeDeps;
        if (!gmiManager || !streamingManager || !toolOrchestrator) {
            this.deps.logger.warn('Workflow runtime start skipped because core dependencies are not ready.');
            return;
        }
        if (!this.agencyRegistry) {
            const agencyLogger = this.deps.logger.child?.({ component: 'AgencyRegistry' }) ?? this.deps.logger;
            this.agencyRegistry = new AgencyRegistry(agencyLogger);
        }
        const runtimeLogger = this.deps.logger.child?.({ component: 'WorkflowRuntime' }) ?? this.deps.logger;
        this.workflowRuntime = new WorkflowRuntime({
            workflowEngine: this.workflowEngine,
            gmiManager,
            streamingManager,
            toolOrchestrator,
            extensionManager: this.deps.extensionManager,
            agencyRegistry: this.agencyRegistry,
            logger: runtimeLogger,
        });
        await this.workflowRuntime.start();
    }
    // ---------------------------------------------------------------------------
    // Shutdown
    // ---------------------------------------------------------------------------
    /**
     * Gracefully shut down all workflow-owned resources: listeners, runtime,
     * engine, agency registry.
     */
    async shutdown() {
        if (this.workflowEngineListener && this.workflowEngine) {
            this.workflowEngine.offEvent(this.workflowEngineListener);
            this.workflowEngineListener = undefined;
        }
        if (this.workflowExtensionListener && this.deps.extensionManager) {
            this.deps.extensionManager.off(this.workflowExtensionListener);
            this.workflowExtensionListener = undefined;
        }
        if (this.workflowRuntime) {
            await this.workflowRuntime.stop();
            this.workflowRuntime = undefined;
        }
        this.agencyRegistry = undefined;
    }
    // ---------------------------------------------------------------------------
    // Public query / mutation helpers (used by AgentOS delegates)
    // ---------------------------------------------------------------------------
    /**
     * List all registered workflow definitions.
     *
     * @returns An array of workflow definitions known to the engine.
     */
    listWorkflowDefinitions() {
        return this.workflowEngine.listWorkflowDefinitions();
    }
    /**
     * Start a new workflow instance from the given definition.
     *
     * @param definitionId - The ID of the workflow definition to instantiate.
     * @param input        - The AgentOS input triggering the workflow.
     * @param options      - Optional overrides for the workflow instance.
     * @returns The newly created workflow instance.
     * @throws {AgentOSServiceError} When the definition is not found.
     */
    async startWorkflow(definitionId, input, options = {}) {
        const definition = this.workflowEngine
            .listWorkflowDefinitions()
            .find((item) => item.id === definitionId);
        if (!definition) {
            throw new AgentOSServiceError(`Workflow definition '${definitionId}' not found.`, GMIErrorCode.CONFIGURATION_ERROR, { definitionId });
        }
        return this.workflowEngine.startWorkflow({
            input,
            definition,
            workflowId: options.workflowId,
            conversationId: options.conversationId,
            createdByUserId: options.createdByUserId,
            context: options.context,
            roleAssignments: options.roleAssignments,
            metadata: options.metadata,
        });
    }
    /**
     * Retrieve a single workflow instance by ID.
     *
     * @param workflowId - The unique identifier of the workflow.
     * @returns The workflow instance, or `null` if not found.
     */
    async getWorkflow(workflowId) {
        return this.workflowEngine.getWorkflow(workflowId);
    }
    /**
     * List workflow instances, optionally filtered by query options.
     *
     * @param options - Optional filter/sort/pagination criteria.
     * @returns An array of matching workflow instances.
     */
    async listWorkflows(options) {
        return this.workflowEngine.listWorkflows(options);
    }
    /**
     * Retrieve progress information for a given workflow.
     *
     * @param workflowId     - The workflow to query.
     * @param sinceTimestamp  - Optional ISO-8601 timestamp; only return events after this point.
     * @returns Progress update payload, or `null` if not found.
     */
    async getWorkflowProgress(workflowId, sinceTimestamp) {
        return this.workflowEngine.getWorkflowProgress(workflowId, sinceTimestamp);
    }
    /**
     * Update the status of a workflow instance.
     *
     * @param workflowId - Target workflow.
     * @param status     - New status to apply.
     * @returns The updated workflow instance, or `null` if not found.
     */
    async updateWorkflowStatus(workflowId, status) {
        return this.workflowEngine.updateWorkflowStatus(workflowId, status);
    }
    /**
     * Apply a batch of task-level updates to a workflow instance.
     *
     * @param workflowId - Target workflow.
     * @param updates    - Array of task updates.
     * @returns The updated workflow instance, or `null` if not found.
     */
    async applyWorkflowTaskUpdates(workflowId, updates) {
        return this.workflowEngine.applyTaskUpdates(workflowId, updates);
    }
    // ---------------------------------------------------------------------------
    // Internal helpers
    // ---------------------------------------------------------------------------
    /**
     * Register all active workflow descriptors found in the extension registry.
     */
    async registerWorkflowDescriptorsFromRegistry() {
        const registry = this.deps.extensionManager.getRegistry(EXTENSION_KIND_WORKFLOW);
        const activeDescriptors = registry.listActive();
        for (const descriptor of activeDescriptors) {
            await this.handleWorkflowDescriptorActivated({
                id: descriptor.id,
                payload: descriptor.payload,
            });
        }
    }
    /**
     * Handle activation of a workflow descriptor by registering it with the engine.
     */
    async handleWorkflowDescriptorActivated(descriptor) {
        try {
            await this.workflowEngine.registerWorkflowDescriptor(descriptor.payload);
            this.deps.logger.debug?.('Workflow descriptor registered', {
                descriptorId: descriptor.id,
                workflowDefinitionId: descriptor.payload.definition.id,
            });
        }
        catch (error) {
            this.deps.logger.error('Failed to register workflow descriptor', {
                descriptorId: descriptor.id,
                workflowDefinitionId: descriptor.payload.definition.id,
                error,
            });
        }
    }
    /**
     * Handle deactivation of a workflow descriptor by unregistering it from the engine.
     */
    async handleWorkflowDescriptorDeactivated(descriptor) {
        try {
            await this.workflowEngine.unregisterWorkflowDescriptor(descriptor.payload.definition.id);
            this.deps.logger.debug?.('Workflow descriptor unregistered', {
                descriptorId: descriptor.id,
                workflowDefinitionId: descriptor.payload.definition.id,
            });
        }
        catch (error) {
            this.deps.logger.error('Failed to unregister workflow descriptor', {
                descriptorId: descriptor.id,
                workflowDefinitionId: descriptor.payload.definition.id,
                error,
            });
        }
    }
    /**
     * Handle a workflow engine event by emitting a progress update.
     */
    async handleWorkflowEngineEvent(event) {
        try {
            await this.emitWorkflowUpdate(event.workflowId);
        }
        catch (error) {
            this.deps.logger.error('Failed to handle workflow engine event', {
                workflowId: event.workflowId,
                eventType: event.type,
                error,
            });
        }
    }
    /**
     * Emit a workflow progress update via the orchestrator's broadcast channel.
     */
    async emitWorkflowUpdate(workflowId) {
        if (!this.workflowEngine) {
            return;
        }
        try {
            const update = await this.workflowEngine.getWorkflowProgress(workflowId);
            if (!update) {
                return;
            }
            this.deps.logger.debug?.('Workflow progress update ready', {
                workflowId,
                status: update.workflow.status,
            });
            if (this.runtimeDeps?.orchestrator &&
                typeof this.runtimeDeps.orchestrator.broadcastWorkflowUpdate === 'function') {
                await this.runtimeDeps.orchestrator.broadcastWorkflowUpdate(update);
            }
            else {
                this.deps.logger.warn('Workflow update could not be broadcast - orchestrator unavailable', { workflowId });
            }
        }
        catch (error) {
            this.deps.logger.error('Failed to generate workflow progress update', {
                workflowId,
                error,
            });
        }
    }
}
//# sourceMappingURL=WorkflowFacade.js.map