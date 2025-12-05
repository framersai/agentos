/**
 * @file HumanInteractionManager.ts
 * @description Implementation of the Human-in-the-Loop Manager for AgentOS.
 * Manages structured collaboration between AI agents and human operators.
 *
 * @module AgentOS/HITL
 * @version 1.0.0
 */

import type { ILogger } from '../../logging/ILogger';
import { uuidv4 } from '../../utils/uuid';
import type {
  IHumanInteractionManager,
  PendingAction,
  ApprovalDecision,
  ClarificationRequest,
  ClarificationResponse,
  DraftOutput,
  EditedOutput,
  EscalationContext,
  EscalationDecision,
  WorkflowCheckpoint,
  CheckpointDecision,
  HumanFeedback,
  HITLStatistics,
  HITLNotificationHandler,
  HITLNotification,
  EscalationReason,
} from './IHumanInteractionManager';

// ============================================================================
// Configuration
// ============================================================================

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
 * Internal pending request wrapper.
 */
interface PendingRequestWrapper<T, R> {
  request: T;
  resolve: (response: R) => void;
  reject: (error: Error) => void;
  timeoutId?: ReturnType<typeof setTimeout>;
  createdAt: Date;
}

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
export class HumanInteractionManager implements IHumanInteractionManager {
  private readonly logger?: ILogger;
  private readonly defaultTimeoutMs: number;
  private readonly maxPendingPerType: number;
  private readonly autoRejectOnTimeout: boolean;
  private notificationHandler?: HITLNotificationHandler;

  /** Pending approval requests */
  private readonly pendingApprovals = new Map<string, PendingRequestWrapper<PendingAction, ApprovalDecision>>();

  /** Pending clarification requests */
  private readonly pendingClarifications = new Map<string, PendingRequestWrapper<ClarificationRequest, ClarificationResponse>>();

  /** Pending edit requests */
  private readonly pendingEdits = new Map<string, PendingRequestWrapper<DraftOutput, EditedOutput>>();

  /** Pending escalations */
  private readonly pendingEscalations = new Map<string, PendingRequestWrapper<EscalationContext, EscalationDecision>>();

  /** Pending checkpoints */
  private readonly pendingCheckpoints = new Map<string, PendingRequestWrapper<WorkflowCheckpoint, CheckpointDecision>>();

  /** Feedback history */
  private readonly feedbackHistory: HumanFeedback[] = [];

  /** Statistics */
  private stats: HITLStatistics = {
    totalApprovalRequests: 0,
    approvalRate: 0,
    totalClarifications: 0,
    avgResponseTimeMs: 0,
    totalEscalations: 0,
    escalationsByReason: {} as Record<EscalationReason, number>,
    pendingRequests: 0,
    timedOutRequests: 0,
  };

  private approvedCount = 0;
  private totalResponseTimeMs = 0;
  private responseCount = 0;

  /**
   * Creates a new HumanInteractionManager instance.
   *
   * @param config - Configuration options
   */
  constructor(config: HumanInteractionManagerConfig = {}) {
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
  public async requestApproval(action: PendingAction): Promise<ApprovalDecision> {
    this.stats.totalApprovalRequests++;
    const timeoutMs = action.timeoutMs ?? this.defaultTimeoutMs;

    return new Promise((resolve, reject) => {
      const wrapper: PendingRequestWrapper<PendingAction, ApprovalDecision> = {
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
        } else {
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
  public async submitApprovalDecision(decision: ApprovalDecision): Promise<void> {
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
  public async requestClarification(request: ClarificationRequest): Promise<ClarificationResponse> {
    this.stats.totalClarifications++;
    const timeoutMs = request.timeoutMs ?? this.defaultTimeoutMs;

    return new Promise((resolve, reject) => {
      const wrapper: PendingRequestWrapper<ClarificationRequest, ClarificationResponse> = {
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
  public async submitClarification(response: ClarificationResponse): Promise<void> {
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
  public async requestEdit(draft: DraftOutput): Promise<EditedOutput> {
    const timeoutMs = draft.timeoutMs ?? this.defaultTimeoutMs;

    return new Promise((resolve, reject) => {
      const wrapper: PendingRequestWrapper<DraftOutput, EditedOutput> = {
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
  public async submitEdit(edited: EditedOutput): Promise<void> {
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
  public async escalate(context: EscalationContext): Promise<EscalationDecision> {
    this.stats.totalEscalations++;
    this.stats.escalationsByReason[context.reason] = 
      (this.stats.escalationsByReason[context.reason] ?? 0) + 1;

    return new Promise((resolve, reject) => {
      const wrapper: PendingRequestWrapper<EscalationContext, EscalationDecision> = {
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
  public async submitEscalationDecision(escalationId: string, decision: EscalationDecision): Promise<void> {
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
  public async checkpoint(checkpoint: WorkflowCheckpoint): Promise<CheckpointDecision> {
    return new Promise((resolve, reject) => {
      const wrapper: PendingRequestWrapper<WorkflowCheckpoint, CheckpointDecision> = {
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
  public async submitCheckpointDecision(decision: CheckpointDecision): Promise<void> {
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
  public async recordFeedback(feedback: HumanFeedback): Promise<void> {
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
  public async getFeedbackHistory(
    agentId: string,
    options?: {
      limit?: number;
      since?: Date;
      type?: HumanFeedback['feedbackType'];
    },
  ): Promise<HumanFeedback[]> {
    let filtered = this.feedbackHistory.filter((f) => f.agentId === agentId);

    if (options?.since) {
      filtered = filtered.filter((f) => f.providedAt >= options.since!);
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
  public async getPendingRequests(): Promise<{
    approvals: PendingAction[];
    clarifications: ClarificationRequest[];
    edits: DraftOutput[];
    escalations: EscalationContext[];
    checkpoints: WorkflowCheckpoint[];
  }> {
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
  public async cancelRequest(requestId: string, reason: string): Promise<void> {
    // Check all types
    const approvalWrapper = this.pendingApprovals.get(requestId);
    if (approvalWrapper) {
      if (approvalWrapper.timeoutId) clearTimeout(approvalWrapper.timeoutId);
      this.pendingApprovals.delete(requestId);
      approvalWrapper.reject(new Error(`Request cancelled: ${reason}`));
    }

    const clarificationWrapper = this.pendingClarifications.get(requestId);
    if (clarificationWrapper) {
      if (clarificationWrapper.timeoutId) clearTimeout(clarificationWrapper.timeoutId);
      this.pendingClarifications.delete(requestId);
      clarificationWrapper.reject(new Error(`Request cancelled: ${reason}`));
    }

    const editWrapper = this.pendingEdits.get(requestId);
    if (editWrapper) {
      if (editWrapper.timeoutId) clearTimeout(editWrapper.timeoutId);
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
  public getStatistics(): HITLStatistics {
    return { ...this.stats };
  }

  /**
   * Sets the notification handler.
   */
  public setNotificationHandler(handler: HITLNotificationHandler): void {
    this.notificationHandler = handler;
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  private async sendNotification(notification: HITLNotification): Promise<void> {
    if (this.notificationHandler) {
      try {
        await this.notificationHandler(notification);
      } catch (error) {
        this.logger?.error?.('Failed to send HITL notification', {
          type: notification.type,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  private updatePendingCount(): void {
    this.stats.pendingRequests =
      this.pendingApprovals.size +
      this.pendingClarifications.size +
      this.pendingEdits.size +
      this.pendingEscalations.size +
      this.pendingCheckpoints.size;
  }

  private updateResponseTime(createdAt: Date): void {
    const responseTime = Date.now() - createdAt.getTime();
    this.totalResponseTimeMs += responseTime;
    this.responseCount++;
    this.stats.avgResponseTimeMs = this.totalResponseTimeMs / this.responseCount;
  }
}

