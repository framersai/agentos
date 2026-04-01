import type { WorkflowEngine } from '../WorkflowEngine';
import type { WorkflowTaskDefinition } from '../WorkflowTypes';
import type { GMIManager } from '../../../cognitive_substrate/GMIManager';
import type { StreamingManager } from '../../../core/streaming/StreamingManager';
import type { IToolOrchestrator } from '../../../core/tools/IToolOrchestrator';
import type { ILogger } from '../../../logging/ILogger';
import { AgencyRegistry } from '../../../agents/agency/AgencyRegistry';
import type { AgencySession } from '../../../agents/agency/AgencyTypes';
import type { ExtensionManager } from '../../../extensions';
/**
 * Dependencies required to bootstrap the workflow runtime.
 */
export interface WorkflowRuntimeDependencies {
    workflowEngine: WorkflowEngine;
    gmiManager: GMIManager;
    streamingManager: StreamingManager;
    toolOrchestrator: IToolOrchestrator;
    agencyRegistry?: AgencyRegistry;
    extensionManager: ExtensionManager;
    logger?: ILogger;
}
export declare class WorkflowRuntime {
    private readonly deps;
    private readonly queue;
    private readonly agencyRegistry;
    private readonly extensionManager;
    private workflowListener?;
    private started;
    private readonly definitionCache;
    constructor(deps: WorkflowRuntimeDependencies);
    /**
     * Begins listening to workflow engine events and prepares the execution queue.
     */
    start(): Promise<void>;
    /**
     * Stops the runtime, drains queued tasks, and detaches event listeners.
     */
    stop(): Promise<void>;
    /**
     * Handles workflow engine events. At this stage we only log structural changes; execution
     * hooks will be connected as the multi-GMI runtime evolves.
     */
    private handleWorkflowEvent;
    /**
     * Enqueues a single workflow task for execution.
     * @param workflowId - Identifier of the workflow instance.
     * @param definitionId - Identifier of the workflow definition.
     * @param taskId - Identifier of the task ready for execution.
     */
    private enqueueTaskExecution;
    /**
     * Helper used by future implementations to resolve a task definition from the workflow definition catalogue.
     * Provided here to keep the scaffolding self-contained.
     */
    protected resolveTaskDefinition(definitionId: string, taskId: string): WorkflowTaskDefinition | undefined;
    /**
     * Emits an Agency update to downstream consumers. Placeholder implementation until the runtime
     * fully manages stream identifiers per Agency seat.
     */
    protected emitAgencyUpdate(session: AgencySession): Promise<void>;
    private getWorkflowDefinition;
    private executeGmiTask;
    private executeToolTask;
    private executeExtensionTask;
    private collectGmiResponse;
    private buildOutputPreview;
    private buildEvolutionContext;
    private syncWorkflowAgencyState;
}
//# sourceMappingURL=WorkflowRuntime.d.ts.map