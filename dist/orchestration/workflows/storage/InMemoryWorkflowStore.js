import { WorkflowStatus, WorkflowTaskStatus, } from '../WorkflowTypes.js';
function cloneInstance(instance) {
    return JSON.parse(JSON.stringify(instance));
}
function cloneEvent(event) {
    return JSON.parse(JSON.stringify(event));
}
export class InMemoryWorkflowStore {
    constructor() {
        this.instances = new Map();
        this.events = new Map();
    }
    async createInstance(data, initialTasks) {
        const instance = {
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
    async getInstance(workflowId) {
        const instance = this.instances.get(workflowId);
        return instance ? cloneInstance(instance) : null;
    }
    async updateInstance(workflowId, patch) {
        const existing = this.instances.get(workflowId);
        if (!existing) {
            return null;
        }
        const updated = {
            ...existing,
            ...patch,
        };
        this.instances.set(workflowId, updated);
        return cloneInstance(updated);
    }
    async updateTasks(workflowId, updates) {
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
        const updatedInstance = {
            ...existing,
            tasks,
            updatedAt: new Date().toISOString(),
        };
        this.instances.set(workflowId, updatedInstance);
        return cloneInstance(updatedInstance);
    }
    async appendEvents(events) {
        for (const event of events) {
            const workflowEvents = this.events.get(event.workflowId);
            if (!workflowEvents) {
                this.events.set(event.workflowId, [cloneEvent(event)]);
                continue;
            }
            workflowEvents.push(cloneEvent(event));
        }
    }
    async listInstances(options) {
        const result = [];
        for (const instance of this.instances.values()) {
            if (options?.conversationId && instance.conversationId !== options.conversationId) {
                continue;
            }
            if (options?.definitionId && instance.definitionId !== options.definitionId) {
                continue;
            }
            if (options?.statuses &&
                options.statuses.length > 0 &&
                !options.statuses.includes(instance.status)) {
                continue;
            }
            result.push(cloneInstance(instance));
            if (options?.limit && result.length >= options.limit) {
                break;
            }
        }
        return result;
    }
    async buildProgressUpdate(workflowId, sinceTimestamp) {
        const instance = this.instances.get(workflowId);
        if (!instance) {
            return null;
        }
        let recentEvents;
        const events = this.events.get(workflowId) ?? [];
        if (sinceTimestamp) {
            recentEvents = events
                .filter((event) => event.timestamp > sinceTimestamp)
                .map((event) => cloneEvent(event));
        }
        else {
            recentEvents = events.slice(-10).map((event) => cloneEvent(event));
        }
        return {
            workflow: cloneInstance(instance),
            recentEvents,
        };
    }
}
//# sourceMappingURL=InMemoryWorkflowStore.js.map