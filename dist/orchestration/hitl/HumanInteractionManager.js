/**
 * @file HumanInteractionManager.ts
 * @description Implementation of the Human-in-the-Loop Manager for AgentOS.
 * Manages structured collaboration between AI agents and human operators.
 *
 * @module AgentOS/HITL
 * @version 1.0.0
 */
// ============================================================================
// HumanInteractionManager Implementation
// ============================================================================
/**
 * Implementation of the Human-in-the-Loop Manager.
 *
 * Features:
 * - Approval requests with severity levels
 * - Clarification requests with options
 * - Output review and editing
 * - Escalation handling
 * - Workflow checkpoints
 * - Feedback collection for learning
 *
 * @implements {IHumanInteractionManager}
 */
export class HumanInteractionManager {
    /**
     * Creates a new HumanInteractionManager instance.
     *
     * @param config - Configuration options
     */
    constructor(config = {}) {
        /** Pending approval requests */
        this.pendingApprovals = new Map();
        /** Pending clarification requests */
        this.pendingClarifications = new Map();
        /** Pending edit requests */
        this.pendingEdits = new Map();
        /** Pending escalations */
        this.pendingEscalations = new Map();
        /** Pending checkpoints */
        this.pendingCheckpoints = new Map();
        /** Feedback history */
        this.feedbackHistory = [];
        /** Statistics */
        this.stats = {
            totalApprovalRequests: 0,
            approvalRate: 0,
            totalClarifications: 0,
            avgResponseTimeMs: 0,
            totalEscalations: 0,
            escalationsByReason: {},
            pendingRequests: 0,
            timedOutRequests: 0,
        };
        this.approvedCount = 0;
        this.totalResponseTimeMs = 0;
        this.responseCount = 0;
        this.logger = config.logger;
        this.defaultTimeoutMs = config.defaultTimeoutMs ?? 300000; // 5 minutes
        this.maxPendingPerType = config.maxPendingPerType ?? 100;
        this.autoRejectOnTimeout = config.autoRejectOnTimeout ?? false;
        this.notificationHandler = config.notificationHandler;
        this.logger?.info?.('HumanInteractionManager initialized');
    }
    // ==========================================================================
    // Approval
    // ==========================================================================
    /**
     * Requests human approval before executing an action.
     */
    async requestApproval(action) {
        this.stats.totalApprovalRequests++;
        const timeoutMs = action.timeoutMs ?? this.defaultTimeoutMs;
        return new Promise((resolve, reject) => {
            const wrapper = {
                request: action,
                resolve,
                reject,
                createdAt: new Date(),
            };
            // Set timeout
            wrapper.timeoutId = setTimeout(() => {
                this.pendingApprovals.delete(action.actionId);
                this.stats.timedOutRequests++;
                this.updatePendingCount();
                if (this.autoRejectOnTimeout) {
                    resolve({
                        actionId: action.actionId,
                        approved: false,
                        rejectionReason: 'Request timed out',
                        decidedBy: 'system',
                        decidedAt: new Date(),
                    });
                }
                else {
                    reject(new Error(`Approval request timed out: ${action.actionId}`));
                }
            }, timeoutMs);
            this.pendingApprovals.set(action.actionId, wrapper);
            this.updatePendingCount();
            // Send notification
            this.sendNotification({
                type: 'approval_required',
                requestId: action.actionId,
                agentId: action.agentId,
                summary: `${action.severity.toUpperCase()}: ${action.description}`,
                urgency: action.severity === 'critical' ? 'critical' : action.severity === 'high' ? 'high' : 'medium',
                expiresAt: new Date(Date.now() + timeoutMs),
            });
            this.logger?.info?.('Approval requested', {
                actionId: action.actionId,
                severity: action.severity,
                category: action.category,
            });
        });
    }
    /**
     * Submits an approval decision.
     */
    async submitApprovalDecision(decision) {
        const wrapper = this.pendingApprovals.get(decision.actionId);
        if (!wrapper) {
            this.logger?.warn?.('Approval decision for unknown request', { actionId: decision.actionId });
            return;
        }
        if (wrapper.timeoutId) {
            clearTimeout(wrapper.timeoutId);
        }
        this.pendingApprovals.delete(decision.actionId);
        this.updatePendingCount();
        // Update statistics
        if (decision.approved) {
            this.approvedCount++;
        }
        this.stats.approvalRate = this.approvedCount / this.stats.totalApprovalRequests;
        this.updateResponseTime(wrapper.createdAt);
        wrapper.resolve(decision);
        this.logger?.info?.('Approval decision submitted', {
            actionId: decision.actionId,
            approved: decision.approved,
        });
    }
    // ==========================================================================
    // Clarification
    // ==========================================================================
    /**
     * Requests clarification from a human.
     */
    async requestClarification(request) {
        this.stats.totalClarifications++;
        const timeoutMs = request.timeoutMs ?? this.defaultTimeoutMs;
        return new Promise((resolve, reject) => {
            const wrapper = {
                request,
                resolve,
                reject,
                createdAt: new Date(),
            };
            wrapper.timeoutId = setTimeout(() => {
                this.pendingClarifications.delete(request.requestId);
                this.stats.timedOutRequests++;
                this.updatePendingCount();
                reject(new Error(`Clarification request timed out: ${request.requestId}`));
            }, timeoutMs);
            this.pendingClarifications.set(request.requestId, wrapper);
            this.updatePendingCount();
            this.sendNotification({
                type: 'clarification_needed',
                requestId: request.requestId,
                agentId: request.agentId,
                summary: request.question,
                urgency: 'medium',
                expiresAt: new Date(Date.now() + timeoutMs),
            });
            this.logger?.info?.('Clarification requested', {
                requestId: request.requestId,
                type: request.clarificationType,
            });
        });
    }
    /**
     * Submits a clarification response.
     */
    async submitClarification(response) {
        const wrapper = this.pendingClarifications.get(response.requestId);
        if (!wrapper) {
            this.logger?.warn?.('Clarification for unknown request', { requestId: response.requestId });
            return;
        }
        if (wrapper.timeoutId) {
            clearTimeout(wrapper.timeoutId);
        }
        this.pendingClarifications.delete(response.requestId);
        this.updatePendingCount();
        this.updateResponseTime(wrapper.createdAt);
        wrapper.resolve(response);
    }
    // ==========================================================================
    // Output Review
    // ==========================================================================
    /**
     * Requests human review and potential editing of agent output.
     */
    async requestEdit(draft) {
        const timeoutMs = draft.timeoutMs ?? this.defaultTimeoutMs;
        return new Promise((resolve, reject) => {
            const wrapper = {
                request: draft,
                resolve,
                reject,
                createdAt: new Date(),
            };
            wrapper.timeoutId = setTimeout(() => {
                this.pendingEdits.delete(draft.draftId);
                this.stats.timedOutRequests++;
                this.updatePendingCount();
                // Return unchanged on timeout
                resolve({
                    draftId: draft.draftId,
                    editedContent: draft.content,
                    hasSignificantChanges: false,
                    editedBy: 'system',
                    editedAt: new Date(),
                    feedback: 'Review timed out - using original content',
                });
            }, timeoutMs);
            this.pendingEdits.set(draft.draftId, wrapper);
            this.updatePendingCount();
            this.sendNotification({
                type: 'edit_requested',
                requestId: draft.draftId,
                agentId: draft.agentId,
                summary: `Review ${draft.contentType} output: ${draft.purpose}`,
                urgency: draft.confidence < 0.5 ? 'high' : 'medium',
                expiresAt: new Date(Date.now() + timeoutMs),
            });
            this.logger?.info?.('Edit requested', {
                draftId: draft.draftId,
                contentType: draft.contentType,
                confidence: draft.confidence,
            });
        });
    }
    /**
     * Submits an edited output.
     */
    async submitEdit(edited) {
        const wrapper = this.pendingEdits.get(edited.draftId);
        if (!wrapper) {
            this.logger?.warn?.('Edit for unknown draft', { draftId: edited.draftId });
            return;
        }
        if (wrapper.timeoutId) {
            clearTimeout(wrapper.timeoutId);
        }
        this.pendingEdits.delete(edited.draftId);
        this.updatePendingCount();
        this.updateResponseTime(wrapper.createdAt);
        wrapper.resolve(edited);
    }
    // ==========================================================================
    // Escalation
    // ==========================================================================
    /**
     * Escalates a situation to human control.
     */
    async escalate(context) {
        this.stats.totalEscalations++;
        this.stats.escalationsByReason[context.reason] =
            (this.stats.escalationsByReason[context.reason] ?? 0) + 1;
        return new Promise((resolve, reject) => {
            const wrapper = {
                request: context,
                resolve,
                reject,
                createdAt: new Date(),
            };
            // Escalations typically don't timeout - they require resolution
            this.pendingEscalations.set(context.escalationId, wrapper);
            this.updatePendingCount();
            this.sendNotification({
                type: 'escalation',
                requestId: context.escalationId,
                agentId: context.agentId,
                summary: `${context.urgency.toUpperCase()} ESCALATION: ${context.reason} - ${context.explanation}`,
                urgency: context.urgency,
            });
            this.logger?.warn?.('Escalation created', {
                escalationId: context.escalationId,
                reason: context.reason,
                urgency: context.urgency,
            });
        });
    }
    /**
     * Submits an escalation decision.
     */
    async submitEscalationDecision(escalationId, decision) {
        const wrapper = this.pendingEscalations.get(escalationId);
        if (!wrapper) {
            this.logger?.warn?.('Decision for unknown escalation', { escalationId });
            return;
        }
        this.pendingEscalations.delete(escalationId);
        this.updatePendingCount();
        this.updateResponseTime(wrapper.createdAt);
        wrapper.resolve(decision);
        this.logger?.info?.('Escalation resolved', {
            escalationId,
            decisionType: decision.type,
        });
    }
    // ==========================================================================
    // Checkpoints
    // ==========================================================================
    /**
     * Creates a checkpoint for human review.
     */
    async checkpoint(checkpoint) {
        return new Promise((resolve, reject) => {
            const wrapper = {
                request: checkpoint,
                resolve,
                reject,
                createdAt: new Date(),
            };
            this.pendingCheckpoints.set(checkpoint.checkpointId, wrapper);
            this.updatePendingCount();
            this.sendNotification({
                type: 'checkpoint',
                requestId: checkpoint.checkpointId,
                agentId: 'workflow',
                summary: `Checkpoint: ${checkpoint.currentPhase} (${Math.round(checkpoint.progress * 100)}% complete)`,
                urgency: checkpoint.issues.length > 0 ? 'high' : 'low',
            });
            this.logger?.info?.('Checkpoint created', {
                checkpointId: checkpoint.checkpointId,
                workflowId: checkpoint.workflowId,
                progress: checkpoint.progress,
            });
        });
    }
    /**
     * Submits a checkpoint decision.
     */
    async submitCheckpointDecision(decision) {
        const wrapper = this.pendingCheckpoints.get(decision.checkpointId);
        if (!wrapper) {
            this.logger?.warn?.('Decision for unknown checkpoint', { checkpointId: decision.checkpointId });
            return;
        }
        this.pendingCheckpoints.delete(decision.checkpointId);
        this.updatePendingCount();
        this.updateResponseTime(wrapper.createdAt);
        wrapper.resolve(decision);
    }
    // ==========================================================================
    // Feedback
    // ==========================================================================
    /**
     * Records human feedback for agent improvement.
     */
    async recordFeedback(feedback) {
        this.feedbackHistory.push(feedback);
        // Limit history size
        if (this.feedbackHistory.length > 1000) {
            this.feedbackHistory.shift();
        }
        this.logger?.info?.('Feedback recorded', {
            feedbackId: feedback.feedbackId,
            agentId: feedback.agentId,
            type: feedback.feedbackType,
        });
    }
    /**
     * Gets feedback history for an agent.
     */
    async getFeedbackHistory(agentId, options) {
        let filtered = this.feedbackHistory.filter((f) => f.agentId === agentId);
        if (options?.since) {
            filtered = filtered.filter((f) => f.providedAt >= options.since);
        }
        if (options?.type) {
            filtered = filtered.filter((f) => f.feedbackType === options.type);
        }
        if (options?.limit) {
            filtered = filtered.slice(-options.limit);
        }
        return filtered;
    }
    // ==========================================================================
    // Pending Requests
    // ==========================================================================
    /**
     * Gets all pending requests awaiting human response.
     */
    async getPendingRequests() {
        return {
            approvals: Array.from(this.pendingApprovals.values()).map((w) => w.request),
            clarifications: Array.from(this.pendingClarifications.values()).map((w) => w.request),
            edits: Array.from(this.pendingEdits.values()).map((w) => w.request),
            escalations: Array.from(this.pendingEscalations.values()).map((w) => w.request),
            checkpoints: Array.from(this.pendingCheckpoints.values()).map((w) => w.request),
        };
    }
    /**
     * Cancels a pending request.
     */
    async cancelRequest(requestId, reason) {
        // Check all types
        const approvalWrapper = this.pendingApprovals.get(requestId);
        if (approvalWrapper) {
            if (approvalWrapper.timeoutId)
                clearTimeout(approvalWrapper.timeoutId);
            this.pendingApprovals.delete(requestId);
            approvalWrapper.reject(new Error(`Request cancelled: ${reason}`));
        }
        const clarificationWrapper = this.pendingClarifications.get(requestId);
        if (clarificationWrapper) {
            if (clarificationWrapper.timeoutId)
                clearTimeout(clarificationWrapper.timeoutId);
            this.pendingClarifications.delete(requestId);
            clarificationWrapper.reject(new Error(`Request cancelled: ${reason}`));
        }
        const editWrapper = this.pendingEdits.get(requestId);
        if (editWrapper) {
            if (editWrapper.timeoutId)
                clearTimeout(editWrapper.timeoutId);
            this.pendingEdits.delete(requestId);
            editWrapper.reject(new Error(`Request cancelled: ${reason}`));
        }
        const escalationWrapper = this.pendingEscalations.get(requestId);
        if (escalationWrapper) {
            this.pendingEscalations.delete(requestId);
            escalationWrapper.reject(new Error(`Request cancelled: ${reason}`));
        }
        const checkpointWrapper = this.pendingCheckpoints.get(requestId);
        if (checkpointWrapper) {
            this.pendingCheckpoints.delete(requestId);
            checkpointWrapper.reject(new Error(`Request cancelled: ${reason}`));
        }
        this.updatePendingCount();
        this.logger?.info?.('Request cancelled', { requestId, reason });
    }
    // ==========================================================================
    // Configuration & Statistics
    // ==========================================================================
    /**
     * Gets HITL interaction statistics.
     */
    getStatistics() {
        return { ...this.stats };
    }
    /**
     * Sets the notification handler.
     */
    setNotificationHandler(handler) {
        this.notificationHandler = handler;
    }
    // ==========================================================================
    // Private Helpers
    // ==========================================================================
    async sendNotification(notification) {
        if (this.notificationHandler) {
            try {
                await this.notificationHandler(notification);
            }
            catch (error) {
                this.logger?.error?.('Failed to send HITL notification', {
                    type: notification.type,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }
    }
    updatePendingCount() {
        this.stats.pendingRequests =
            this.pendingApprovals.size +
                this.pendingClarifications.size +
                this.pendingEdits.size +
                this.pendingEscalations.size +
                this.pendingCheckpoints.size;
    }
    updateResponseTime(createdAt) {
        const responseTime = Date.now() - createdAt.getTime();
        this.totalResponseTimeMs += responseTime;
        this.responseCount++;
        this.stats.avgResponseTimeMs = this.totalResponseTimeMs / this.responseCount;
    }
}
//# sourceMappingURL=HumanInteractionManager.js.map