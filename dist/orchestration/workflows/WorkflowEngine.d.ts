import { WorkflowDefinition, WorkflowDescriptorPayload, WorkflowEvent, WorkflowInstance, WorkflowProgressUpdate, WorkflowStatus } from './WorkflowTypes';
import type { WorkflowQueryOptions, WorkflowTaskUpdate } from './storage/IWorkflowStore';
import type { IWorkflowEngine, StartWorkflowOptions, WorkflowEngineConfig, WorkflowEngineDependencies, WorkflowEngineEventListener } from './IWorkflowEngine';
export declare class WorkflowEngine implements IWorkflowEngine {
    private initialized;
    private config;
    private store;
    private readonly definitions;
    private readonly emitter;
    private logger;
    private activeWorkflowCount;
    initialize(config: WorkflowEngineConfig, deps: WorkflowEngineDependencies): Promise<void>;
    registerWorkflowDescriptor(descriptor: WorkflowDescriptorPayload): Promise<void>;
    unregisterWorkflowDescriptor(workflowDefinitionId: string): Promise<void>;
    listWorkflowDefinitions(): WorkflowDefinition[];
    startWorkflow(options: StartWorkflowOptions): Promise<WorkflowInstance>;
    getWorkflow(workflowId: string): Promise<WorkflowInstance | null>;
    updateWorkflowStatus(workflowId: string, status: WorkflowStatus): Promise<WorkflowInstance | null>;
    applyTaskUpdates(workflowId: string, updates: WorkflowTaskUpdate[]): Promise<WorkflowInstance | null>;
    updateWorkflowAgencyState(workflowId: string, agencyState: WorkflowInstance['agencyState']): Promise<WorkflowInstance | null>;
    recordEvents(events: WorkflowEvent[]): Promise<void>;
    listWorkflows(options?: WorkflowQueryOptions): Promise<WorkflowInstance[]>;
    getWorkflowProgress(workflowId: string, sinceTimestamp?: string): Promise<WorkflowProgressUpdate | null>;
    onEvent(listener: WorkflowEngineEventListener): void;
    offEvent(listener: WorkflowEngineEventListener): void;
    private ensureInitialized;
}
//# sourceMappingURL=WorkflowEngine.d.ts.map