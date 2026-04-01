import { WorkflowEvent, WorkflowInstance, WorkflowProgressUpdate } from '../WorkflowTypes';
import type { IWorkflowStore, WorkflowCreateInput, WorkflowQueryOptions, WorkflowTaskUpdate } from './IWorkflowStore';
export declare class InMemoryWorkflowStore implements IWorkflowStore {
    private readonly instances;
    private readonly events;
    createInstance(data: WorkflowCreateInput, initialTasks: WorkflowInstance['tasks']): Promise<WorkflowInstance>;
    getInstance(workflowId: string): Promise<WorkflowInstance | null>;
    updateInstance(workflowId: string, patch: Partial<Pick<WorkflowInstance, 'status' | 'updatedAt' | 'metadata' | 'context' | 'roleAssignments' | 'agencyState'>>): Promise<WorkflowInstance | null>;
    updateTasks(workflowId: string, updates: WorkflowTaskUpdate[]): Promise<WorkflowInstance | null>;
    appendEvents(events: WorkflowEvent[]): Promise<void>;
    listInstances(options?: WorkflowQueryOptions): Promise<WorkflowInstance[]>;
    buildProgressUpdate(workflowId: string, sinceTimestamp?: string): Promise<WorkflowProgressUpdate | null>;
}
//# sourceMappingURL=InMemoryWorkflowStore.d.ts.map