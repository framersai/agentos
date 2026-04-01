import { EventEmitter } from 'node:events';
import { v4 as uuidv4 } from 'uuid';
import { createLogger } from '../../logging/loggerFactory.js';
import { WorkflowStatus, WorkflowTaskStatus, } from './WorkflowTypes.js';
const TERMINAL_STATUSES = [
    WorkflowStatus.COMPLETED,
    WorkflowStatus.CANCELLED,
    WorkflowStatus.ERRORED,
];
function isTerminal(status) {
    return TERMINAL_STATUSES.includes(status);
}
function cloneInstance(instance) {
    return JSON.parse(JSON.stringify(instance));
}
function buildInitialTasks(definition) {
    const dependencyMap = new Map();
    for (const task of definition.tasks) {
        dependencyMap.set(task.id, new Set(task.dependsOn ?? []));
    }
    const result = {};
    for (const task of definition.tasks) {
        const dependencies = dependencyMap.get(task.id);
        const initialStatus = !dependencies || dependencies.size === 0 ? WorkflowTaskStatus.READY : WorkflowTaskStatus.PENDING;
        result[task.id] = {
            definitionId: task.id,
            status: initialStatus,
            metadata: {},
        };
    }
    return result;
}
function validateWorkflowDefinition(definition) {
    const taskIds = new Set();
    for (const task of definition.tasks) {
        if (taskIds.has(task.id)) {
            throw new Error(`Workflow definition '${definition.id}' contains duplicate task id '${task.id}'.`);
        }
        taskIds.add(task.id);
    }
    const missingDeps = [];
    for (const task of definition.tasks) {
        for (const dependency of task.dependsOn ?? []) {
            if (!taskIds.has(dependency)) {
                missingDeps.push({ taskId: task.id, dependencyId: dependency });
            }
        }
    }
    if (missingDeps.length > 0) {
        const formatted = missingDeps
            .map(({ taskId, dependencyId }) => `'${taskId}' -> '${dependencyId}'`)
            .join(', ');
        throw new Error(`Workflow definition '${definition.id}' references missing task dependencies: ${formatted}`);
    }
    if (hasCycles(definition.tasks)) {
        throw new Error(`Workflow definition '${definition.id}' contains cyclic dependencies.`);
    }
}
function hasCycles(tasks) {
    const graph = new Map(tasks.map((task) => [task.id, task.dependsOn ?? []]));
    const visiting = new Set();
    const visited = new Set();
    const visit = (node) => {
        if (visiting.has(node)) {
            return true;
        }
        if (visited.has(node)) {
            return false;
        }
        visiting.add(node);
        for (const dep of graph.get(node) ?? []) {
            if (visit(dep)) {
                return true;
            }
        }
        visiting.delete(node);
        visited.add(node);
        return false;
    };
    for (const node of graph.keys()) {
        if (visit(node)) {
            return true;
        }
    }
    return false;
}
export class WorkflowEngine {
    constructor() {
        this.initialized = false;
        this.config = {
            maxConcurrentWorkflows: Number.POSITIVE_INFINITY,
            defaultWorkflowTimeoutSeconds: 0,
        };
        this.definitions = new Map();
        this.emitter = new EventEmitter();
        this.logger = createLogger('WorkflowEngine');
        this.activeWorkflowCount = 0;
    }
    async initialize(config, deps) {
        this.config = {
            maxConcurrentWorkflows: config.maxConcurrentWorkflows ?? Number.POSITIVE_INFINITY,
            defaultWorkflowTimeoutSeconds: config.defaultWorkflowTimeoutSeconds ?? 0,
        };
        this.store = deps.store;
        this.logger = deps.logger ?? createLogger('WorkflowEngine');
        this.initialized = true;
        this.logger.info('Workflow engine initialised', {
            maxConcurrentWorkflows: this.config.maxConcurrentWorkflows,
        });
    }
    async registerWorkflowDescriptor(descriptor) {
        this.ensureInitialized();
        const { definition, metadata } = descriptor;
        validateWorkflowDefinition(definition);
        this.definitions.set(definition.id, { definition, metadata });
        this.logger.debug?.('Registered workflow definition', { definitionId: definition.id });
    }
    async unregisterWorkflowDescriptor(workflowDefinitionId) {
        this.ensureInitialized();
        this.definitions.delete(workflowDefinitionId);
        this.logger.debug?.('Unregistered workflow definition', { workflowDefinitionId });
    }
    listWorkflowDefinitions() {
        this.ensureInitialized();
        return Array.from(this.definitions.values()).map(({ definition }) => ({ ...definition }));
    }
    async startWorkflow(options) {
        this.ensureInitialized();
        if (this.config.maxConcurrentWorkflows !== Number.POSITIVE_INFINITY &&
            this.activeWorkflowCount >= this.config.maxConcurrentWorkflows) {
            throw new Error('WorkflowEngine capacity exceeded.');
        }
        const { definition } = options;
        const registered = this.definitions.get(definition.id);
        if (!registered) {
            throw new Error(`Workflow definition '${definition.id}' is not registered.`);
        }
        const workflowId = options.workflowId ?? uuidv4();
        const nowIso = new Date().toISOString();
        const conversationId = options.conversationId ?? options.input.conversationId ?? options.input.sessionId;
        const createdByUserId = options.createdByUserId ?? options.input.userId;
        const tasks = buildInitialTasks(registered.definition);
        const instance = await this.store.createInstance({
            workflowId,
            definitionId: registered.definition.id,
            definitionVersion: registered.definition.version,
            createdAt: nowIso,
            createdByUserId,
            conversationId,
            context: options.context,
            roleAssignments: options.roleAssignments,
            metadata: options.metadata,
        }, tasks);
        const runningInstance = (await this.store.updateInstance(workflowId, {
            status: WorkflowStatus.RUNNING,
            updatedAt: nowIso,
        })) ?? instance;
        const createdEvent = {
            eventId: uuidv4(),
            workflowId: runningInstance.workflowId,
            definitionId: runningInstance.definitionId,
            timestamp: nowIso,
            type: 'workflow_created',
            payload: {
                conversationId,
                createdByUserId,
                input: {
                    userId: options.input.userId,
                    sessionId: options.input.sessionId,
                    selectedPersonaId: options.input.selectedPersonaId,
                },
            },
        };
        await this.recordEvents([createdEvent]);
        this.activeWorkflowCount += 1;
        this.logger.info('Workflow started', { workflowId: runningInstance.workflowId });
        return cloneInstance(runningInstance);
    }
    async getWorkflow(workflowId) {
        this.ensureInitialized();
        const instance = await this.store.getInstance(workflowId);
        return instance ? cloneInstance(instance) : null;
    }
    async updateWorkflowStatus(workflowId, status) {
        this.ensureInitialized();
        const nowIso = new Date().toISOString();
        const updated = await this.store.updateInstance(workflowId, {
            status,
            updatedAt: nowIso,
        });
        if (!updated) {
            return null;
        }
        if (isTerminal(status)) {
            this.activeWorkflowCount = Math.max(0, this.activeWorkflowCount - 1);
        }
        const event = {
            eventId: uuidv4(),
            workflowId,
            definitionId: updated.definitionId,
            timestamp: nowIso,
            type: 'workflow_status_changed',
            payload: { status },
        };
        await this.recordEvents([event]);
        this.logger.debug?.('Workflow status updated', { workflowId, status });
        return cloneInstance(updated);
    }
    async applyTaskUpdates(workflowId, updates) {
        this.ensureInitialized();
        if (updates.length === 0) {
            return this.getWorkflow(workflowId);
        }
        const nowIso = new Date().toISOString();
        const updated = await this.store.updateTasks(workflowId, updates);
        if (!updated) {
            return null;
        }
        const events = [];
        for (const update of updates) {
            if (update.status) {
                events.push({
                    eventId: uuidv4(),
                    workflowId,
                    definitionId: updated.definitionId,
                    taskId: update.taskId,
                    timestamp: nowIso,
                    type: 'task_status_changed',
                    payload: {
                        status: update.status,
                        assignedExecutorId: update.assignedExecutorId,
                    },
                });
            }
            if (update.output !== undefined) {
                events.push({
                    eventId: uuidv4(),
                    workflowId,
                    definitionId: updated.definitionId,
                    taskId: update.taskId,
                    timestamp: nowIso,
                    type: 'task_output_emitted',
                    payload: { output: update.output },
                });
            }
            if (update.error) {
                events.push({
                    eventId: uuidv4(),
                    workflowId,
                    definitionId: updated.definitionId,
                    taskId: update.taskId,
                    timestamp: nowIso,
                    type: 'error',
                    payload: update.error,
                });
            }
        }
        if (events.length > 0) {
            await this.recordEvents(events);
        }
        this.logger.debug?.('Workflow tasks updated', { workflowId, updatesCount: updates.length });
        return cloneInstance(updated);
    }
    async updateWorkflowAgencyState(workflowId, agencyState) {
        this.ensureInitialized();
        const nowIso = new Date().toISOString();
        const updated = await this.store.updateInstance(workflowId, {
            agencyState,
            updatedAt: nowIso,
        });
        if (updated) {
            this.logger.debug?.('Workflow agency state updated', {
                workflowId,
                agencyId: agencyState?.agencyId,
            });
        }
        return updated ? cloneInstance(updated) : null;
    }
    async recordEvents(events) {
        if (!events.length) {
            return;
        }
        await this.store.appendEvents(events);
        for (const event of events) {
            this.emitter.emit('event', event);
        }
    }
    async listWorkflows(options) {
        this.ensureInitialized();
        const instances = await this.store.listInstances(options);
        return instances.map(cloneInstance);
    }
    async getWorkflowProgress(workflowId, sinceTimestamp) {
        this.ensureInitialized();
        return this.store.buildProgressUpdate(workflowId, sinceTimestamp);
    }
    onEvent(listener) {
        this.emitter.on('event', listener);
    }
    offEvent(listener) {
        this.emitter.off('event', listener);
    }
    ensureInitialized() {
        if (!this.initialized) {
            throw new Error('WorkflowEngine has not been initialised.');
        }
    }
}
//# sourceMappingURL=WorkflowEngine.js.map