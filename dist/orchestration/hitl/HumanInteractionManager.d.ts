/**
 * @file HumanInteractionManager.ts
 * @description Implementation of the Human-in-the-Loop Manager for AgentOS.
 * Manages structured collaboration between AI agents and human operators.
 *
 * @module AgentOS/HITL
 * @version 1.0.0
 */
import type { ILogger } from '../../logging/ILogger';
import type { IHumanInteractionManager, PendingAction, ApprovalDecision, ClarificationRequest, ClarificationResponse, DraftOutput, EditedOutput, EscalationContext, EscalationDecision, WorkflowCheckpoint, CheckpointDecision, HumanFeedback, HITLStatistics, HITLNotificationHandler } from './IHumanInteractionManager';
/**
 * Configuration for HumanInteractionManager.
 */
export interface HumanInteractionManagerConfig {
    /** Logger instance */
    logger?: ILogger;
    /** Default timeout for requests in ms */
    defaultTimeoutMs?: number;
    /** Notification handler */
    notificationHandler?: HITLNotificationHandler;
    /** Maximum pending requests per type */
    maxPendingPerType?: number;
    /** Auto-reject on timeout (vs returning timeout response) */
    autoRejectOnTimeout?: boolean;
}
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
export declare class HumanInteractionManager implements IHumanInteractionManager {
    private readonly logger?;
    private readonly defaultTimeoutMs;
    private readonly maxPendingPerType;
    private readonly autoRejectOnTimeout;
    private notificationHandler?;
    /** Pending approval requests */
    private readonly pendingApprovals;
    /** Pending clarification requests */
    private readonly pendingClarifications;
    /** Pending edit requests */
    private readonly pendingEdits;
    /** Pending escalations */
    private readonly pendingEscalations;
    /** Pending checkpoints */
    private readonly pendingCheckpoints;
    /** Feedback history */
    private readonly feedbackHistory;
    /** Statistics */
    private stats;
    private approvedCount;
    private totalResponseTimeMs;
    private responseCount;
    /**
     * Creates a new HumanInteractionManager instance.
     *
     * @param config - Configuration options
     */
    constructor(config?: HumanInteractionManagerConfig);
    /**
     * Requests human approval before executing an action.
     */
    requestApproval(action: PendingAction): Promise<ApprovalDecision>;
    /**
     * Submits an approval decision.
     */
    submitApprovalDecision(decision: ApprovalDecision): Promise<void>;
    /**
     * Requests clarification from a human.
     */
    requestClarification(request: ClarificationRequest): Promise<ClarificationResponse>;
    /**
     * Submits a clarification response.
     */
    submitClarification(response: ClarificationResponse): Promise<void>;
    /**
     * Requests human review and potential editing of agent output.
     */
    requestEdit(draft: DraftOutput): Promise<EditedOutput>;
    /**
     * Submits an edited output.
     */
    submitEdit(edited: EditedOutput): Promise<void>;
    /**
     * Escalates a situation to human control.
     */
    escalate(context: EscalationContext): Promise<EscalationDecision>;
    /**
     * Submits an escalation decision.
     */
    submitEscalationDecision(escalationId: string, decision: EscalationDecision): Promise<void>;
    /**
     * Creates a checkpoint for human review.
     */
    checkpoint(checkpoint: WorkflowCheckpoint): Promise<CheckpointDecision>;
    /**
     * Submits a checkpoint decision.
     */
    submitCheckpointDecision(decision: CheckpointDecision): Promise<void>;
    /**
     * Records human feedback for agent improvement.
     */
    recordFeedback(feedback: HumanFeedback): Promise<void>;
    /**
     * Gets feedback history for an agent.
     */
    getFeedbackHistory(agentId: string, options?: {
        limit?: number;
        since?: Date;
        type?: HumanFeedback['feedbackType'];
    }): Promise<HumanFeedback[]>;
    /**
     * Gets all pending requests awaiting human response.
     */
    getPendingRequests(): Promise<{
        approvals: PendingAction[];
        clarifications: ClarificationRequest[];
        edits: DraftOutput[];
        escalations: EscalationContext[];
        checkpoints: WorkflowCheckpoint[];
    }>;
    /**
     * Cancels a pending request.
     */
    cancelRequest(requestId: string, reason: string): Promise<void>;
    /**
     * Gets HITL interaction statistics.
     */
    getStatistics(): HITLStatistics;
    /**
     * Sets the notification handler.
     */
    setNotificationHandler(handler: HITLNotificationHandler): void;
    private sendNotification;
    private updatePendingCount;
    private updateResponseTime;
}
//# sourceMappingURL=HumanInteractionManager.d.ts.map