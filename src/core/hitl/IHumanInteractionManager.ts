/**
 * @file IHumanInteractionManager.ts
 * @description Interface for Human-in-the-Loop (HITL) interactions in AgentOS.
 * Enables agents to request human approval, input, and collaboration at key decision points.
 *
 * HITL is critical for:
 * - High-stakes decisions requiring human judgment
 * - Ambiguous situations needing clarification
 * - Quality assurance and output review
 * - Learning from human corrections
 *
 * @module AgentOS/HITL
 * @version 1.0.0
 *
 * @example
 * ```typescript
 * const hitlManager = new HumanInteractionManager(config);
 *
 * // Request approval before critical action
 * const approval = await hitlManager.requestApproval({
 *   actionId: 'delete-all-records',
 *   description: 'Delete all customer records from database',
 *   severity: 'critical',
 *   context: { recordCount: 50000 },
 * });
 *
 * if (approval.approved) {
 *   await executeAction();
 * }
 * ```
 */

import type { ILogger } from '../../logging/ILogger';

// ============================================================================
// Approval Types
// ============================================================================

/**
 * Severity levels for actions requiring approval.
 */
export type ActionSeverity = 'low' | 'medium' | 'high' | 'critical';

/**
 * A pending action awaiting human approval.
 */
export interface PendingAction {
  /** Unique action identifier */
  actionId: string;
  /** Human-readable description of the action */
  description: string;
  /** Action severity/risk level */
  severity: ActionSeverity;
  /** Category of action */
  category?: 'data_modification' | 'external_api' | 'financial' | 'communication' | 'system' | 'other';
  /** Agent requesting approval */
  agentId: string;
  /** Context/parameters of the action */
  context: Record<string, unknown>;
  /** Potential consequences if approved */
  potentialConsequences?: string[];
  /** Reversibility of the action */
  reversible: boolean;
  /** Estimated cost (if applicable) */
  estimatedCost?: { amount: number; currency: string };
  /** Timestamp when request was made */
  requestedAt: Date;
  /** Timeout for approval (ms) */
  timeoutMs?: number;
  /** Alternative actions available */
  alternatives?: AlternativeAction[];
}

/**
 * An alternative action that could be taken.
 */
export interface AlternativeAction {
  /** Alternative identifier */
  alternativeId: string;
  /** Description of alternative */
  description: string;
  /** Trade-offs of this alternative */
  tradeoffs?: string;
}

/**
 * Human's decision on a pending action.
 */
export interface ApprovalDecision {
  /** Original action ID */
  actionId: string;
  /** Whether approved */
  approved: boolean;
  /** If rejected, the reason */
  rejectionReason?: string;
  /** If alternative selected, which one */
  selectedAlternativeId?: string;
  /** Human's additional instructions */
  instructions?: string;
  /** Who made the decision */
  decidedBy: string;
  /** Timestamp of decision */
  decidedAt: Date;
  /** Feedback for agent learning */
  feedback?: string;
}

// ============================================================================
// Clarification Types
// ============================================================================

/**
 * A request for clarification from a human.
 */
export interface ClarificationRequest {
  /** Unique request identifier */
  requestId: string;
  /** The question needing clarification */
  question: string;
  /** Context for the question */
  context: string;
  /** Agent requesting clarification */
  agentId: string;
  /** Type of clarification needed */
  clarificationType: 'ambiguity' | 'missing_info' | 'preference' | 'verification' | 'guidance';
  /** Suggested options (if multiple choice) */
  options?: ClarificationOption[];
  /** Whether free-form response is allowed */
  allowFreeform: boolean;
  /** Timestamp */
  requestedAt: Date;
  /** Timeout (ms) */
  timeoutMs?: number;
}

/**
 * An option for clarification.
 */
export interface ClarificationOption {
  /** Option identifier */
  optionId: string;
  /** Option label */
  label: string;
  /** Option description */
  description?: string;
}

/**
 * Human's response to a clarification request.
 */
export interface ClarificationResponse {
  /** Original request ID */
  requestId: string;
  /** Selected option ID (if applicable) */
  selectedOptionId?: string;
  /** Free-form response */
  freeformResponse?: string;
  /** Who responded */
  respondedBy: string;
  /** Timestamp */
  respondedAt: Date;
}

// ============================================================================
// Edit/Review Types
// ============================================================================

/**
 * Draft output for human review/editing.
 */
export interface DraftOutput {
  /** Draft identifier */
  draftId: string;
  /** Type of content */
  contentType: 'text' | 'code' | 'json' | 'markdown' | 'html';
  /** The draft content */
  content: string;
  /** Agent that generated it */
  agentId: string;
  /** Purpose/context of the output */
  purpose: string;
  /** Specific areas to review */
  reviewFocus?: string[];
  /** Agent's confidence in the output */
  confidence: number;
  /** Timestamp */
  generatedAt: Date;
  /** Timeout (ms) */
  timeoutMs?: number;
}

/**
 * Human's edited version of draft output.
 */
export interface EditedOutput {
  /** Original draft ID */
  draftId: string;
  /** Edited content */
  editedContent: string;
  /** Whether significant changes were made */
  hasSignificantChanges: boolean;
  /** Summary of changes */
  changeSummary?: string;
  /** Who edited */
  editedBy: string;
  /** Timestamp */
  editedAt: Date;
  /** Feedback for agent improvement */
  feedback?: string;
}

// ============================================================================
// Escalation Types
// ============================================================================

/**
 * Context for escalating to human control.
 */
export interface EscalationContext {
  /** Escalation identifier */
  escalationId: string;
  /** Reason for escalation */
  reason: EscalationReason;
  /** Detailed explanation */
  explanation: string;
  /** Agent requesting escalation */
  agentId: string;
  /** Current task/goal state */
  currentState: Record<string, unknown>;
  /** What agent has tried so far */
  attemptedActions: string[];
  /** Agent's assessment of the situation */
  assessment: string;
  /** Recommended human actions */
  recommendations?: string[];
  /** Urgency level */
  urgency: 'low' | 'medium' | 'high' | 'critical';
  /** Timestamp */
  escalatedAt: Date;
}

/**
 * Reasons for escalation.
 */
export type EscalationReason =
  | 'low_confidence'
  | 'repeated_failures'
  | 'ethical_concern'
  | 'out_of_scope'
  | 'resource_limit'
  | 'conflicting_instructions'
  | 'safety_concern'
  | 'user_requested'
  | 'policy_violation'
  | 'unknown_territory';

/**
 * Human response to escalation.
 */
export type EscalationDecision =
  | { type: 'human_takeover'; instructions?: string }
  | { type: 'agent_continue'; guidance: string; adjustedParameters?: Record<string, unknown> }
  | { type: 'abort'; reason: string }
  | { type: 'delegate'; targetAgentId: string; instructions: string };

// ============================================================================
// Checkpoint Types
// ============================================================================

/**
 * Workflow state for checkpoint review.
 */
export interface WorkflowCheckpoint {
  /** Checkpoint identifier */
  checkpointId: string;
  /** Workflow/plan identifier */
  workflowId: string;
  /** Current step/phase */
  currentPhase: string;
  /** Progress (0-1) */
  progress: number;
  /** Summary of work completed */
  completedWork: string[];
  /** Upcoming work */
  upcomingWork: string[];
  /** Any issues or concerns */
  issues: string[];
  /** Agent's notes */
  notes?: string;
  /** Timestamp */
  checkpointAt: Date;
}

/**
 * Human's decision at a checkpoint.
 */
export interface CheckpointDecision {
  /** Checkpoint ID */
  checkpointId: string;
  /** Decision */
  decision: 'continue' | 'pause' | 'modify' | 'abort';
  /** Modifications if any */
  modifications?: {
    adjustedGoal?: string;
    skipSteps?: string[];
    addSteps?: string[];
    parameterChanges?: Record<string, unknown>;
  };
  /** Instructions for agent */
  instructions?: string;
  /** Who decided */
  decidedBy: string;
  /** Timestamp */
  decidedAt: Date;
}

// ============================================================================
// Feedback & Learning
// ============================================================================

/**
 * Human feedback on agent performance.
 */
export interface HumanFeedback {
  /** Feedback identifier */
  feedbackId: string;
  /** Agent receiving feedback */
  agentId: string;
  /** Type of feedback */
  feedbackType: 'correction' | 'praise' | 'guidance' | 'preference' | 'complaint';
  /** Specific aspect being addressed */
  aspect: 'accuracy' | 'style' | 'speed' | 'judgment' | 'communication' | 'other';
  /** Detailed feedback */
  content: string;
  /** Severity/importance (1-5) */
  importance: number;
  /** Context of the feedback */
  context?: Record<string, unknown>;
  /** Who provided feedback */
  providedBy: string;
  /** Timestamp */
  providedAt: Date;
}

// ============================================================================
// Manager Statistics
// ============================================================================

/**
 * Statistics about HITL interactions.
 */
export interface HITLStatistics {
  /** Total approval requests */
  totalApprovalRequests: number;
  /** Approval rate */
  approvalRate: number;
  /** Total clarifications requested */
  totalClarifications: number;
  /** Average response time (ms) */
  avgResponseTimeMs: number;
  /** Total escalations */
  totalEscalations: number;
  /** Escalations by reason */
  escalationsByReason: Record<EscalationReason, number>;
  /** Pending requests */
  pendingRequests: number;
  /** Timed out requests */
  timedOutRequests: number;
}

// ============================================================================
// IHumanInteractionManager Interface
// ============================================================================

/**
 * Interface for the AgentOS Human-in-the-Loop Manager.
 *
 * The HITL Manager enables structured collaboration between AI agents
 * and human operators, ensuring human oversight for critical decisions
 * while maintaining efficient autonomous operation.
 *
 * Key capabilities:
 * - **Approval Requests**: Seek human approval for high-risk actions
 * - **Clarification**: Ask humans to resolve ambiguity
 * - **Output Review**: Have humans review and edit agent outputs
 * - **Escalation**: Transfer control when agents are uncertain
 * - **Checkpoints**: Regular human review of ongoing work
 * - **Feedback Loop**: Learn from human corrections
 *
 * @example
 * ```typescript
 * const hitl = new HumanInteractionManager({
 *   notificationHandler: async (req) => {
 *     // Send to UI/Slack/email
 *     await notifyHuman(req);
 *   },
 *   defaultTimeoutMs: 300000, // 5 minutes
 * });
 *
 * // Register response handler
 * hitl.onApprovalResponse((decision) => {
 *   console.log(`Action ${decision.actionId}: ${decision.approved ? 'Approved' : 'Rejected'}`);
 * });
 *
 * // Request approval
 * const decision = await hitl.requestApproval({
 *   actionId: 'send-mass-email',
 *   description: 'Send promotional email to 10,000 subscribers',
 *   severity: 'high',
 *   context: { recipientCount: 10000, template: 'promo-q4' },
 *   reversible: false,
 * });
 * ```
 */
export interface IHumanInteractionManager {
  // ==========================================================================
  // Approval
  // ==========================================================================

  /**
   * Requests human approval before executing an action.
   *
   * @param action - The action requiring approval
   * @returns Human's approval decision
   *
   * @example
   * ```typescript
   * const decision = await hitl.requestApproval({
   *   actionId: 'delete-records',
   *   description: 'Delete inactive user accounts older than 2 years',
   *   severity: 'high',
   *   category: 'data_modification',
   *   agentId: 'cleanup-agent',
   *   context: { accountCount: 5000, criteria: 'inactive > 2y' },
   *   reversible: false,
   *   potentialConsequences: ['Data loss', 'User complaints'],
   * });
   * ```
   */
  requestApproval(action: PendingAction): Promise<ApprovalDecision>;

  /**
   * Submits an approval decision (typically called by UI/webhook handler).
   *
   * @param decision - The approval decision
   */
  submitApprovalDecision(decision: ApprovalDecision): Promise<void>;

  // ==========================================================================
  // Clarification
  // ==========================================================================

  /**
   * Requests clarification from a human for ambiguous situations.
   *
   * @param request - The clarification request
   * @returns Human's clarification response
   */
  requestClarification(request: ClarificationRequest): Promise<ClarificationResponse>;

  /**
   * Submits a clarification response.
   *
   * @param response - The clarification response
   */
  submitClarification(response: ClarificationResponse): Promise<void>;

  // ==========================================================================
  // Output Review
  // ==========================================================================

  /**
   * Requests human review and potential editing of agent output.
   *
   * @param draft - The draft output to review
   * @returns Edited output (may be unchanged)
   */
  requestEdit(draft: DraftOutput): Promise<EditedOutput>;

  /**
   * Submits an edited output.
   *
   * @param edited - The edited output
   */
  submitEdit(edited: EditedOutput): Promise<void>;

  // ==========================================================================
  // Escalation
  // ==========================================================================

  /**
   * Escalates a situation to human control.
   *
   * @param context - Escalation context
   * @returns Human's decision on how to proceed
   */
  escalate(context: EscalationContext): Promise<EscalationDecision>;

  /**
   * Submits an escalation decision.
   *
   * @param escalationId - The escalation identifier
   * @param decision - The human's decision
   */
  submitEscalationDecision(escalationId: string, decision: EscalationDecision): Promise<void>;

  // ==========================================================================
  // Checkpoints
  // ==========================================================================

  /**
   * Creates a checkpoint for human review during long-running tasks.
   *
   * @param checkpoint - The checkpoint state
   * @returns Human's checkpoint decision
   */
  checkpoint(checkpoint: WorkflowCheckpoint): Promise<CheckpointDecision>;

  /**
   * Submits a checkpoint decision.
   *
   * @param decision - The checkpoint decision
   */
  submitCheckpointDecision(decision: CheckpointDecision): Promise<void>;

  // ==========================================================================
  // Feedback
  // ==========================================================================

  /**
   * Records human feedback for agent improvement.
   *
   * @param feedback - The feedback to record
   */
  recordFeedback(feedback: HumanFeedback): Promise<void>;

  /**
   * Gets feedback history for an agent.
   *
   * @param agentId - Agent identifier
   * @param options - Query options
   * @returns Feedback history
   */
  getFeedbackHistory(
    agentId: string,
    options?: {
      limit?: number;
      since?: Date;
      type?: HumanFeedback['feedbackType'];
    },
  ): Promise<HumanFeedback[]>;

  // ==========================================================================
  // Pending Requests
  // ==========================================================================

  /**
   * Gets all pending requests awaiting human response.
   *
   * @returns Pending requests by type
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
   *
   * @param requestId - Request identifier
   * @param reason - Cancellation reason
   */
  cancelRequest(requestId: string, reason: string): Promise<void>;

  // ==========================================================================
  // Configuration & Statistics
  // ==========================================================================

  /**
   * Gets HITL interaction statistics.
   *
   * @returns Current statistics
   */
  getStatistics(): HITLStatistics;

  /**
   * Sets the notification handler for outgoing requests.
   *
   * @param handler - Handler function
   */
  setNotificationHandler(handler: HITLNotificationHandler): void;
}

/**
 * Handler for sending notifications to humans.
 */
export type HITLNotificationHandler = (
  notification: HITLNotification,
) => Promise<void>;

/**
 * A notification sent to humans.
 */
export interface HITLNotification {
  /** Notification type */
  type: 'approval_required' | 'clarification_needed' | 'edit_requested' | 'escalation' | 'checkpoint';
  /** Request ID */
  requestId: string;
  /** Agent ID */
  agentId: string;
  /** Summary */
  summary: string;
  /** Urgency */
  urgency: 'low' | 'medium' | 'high' | 'critical';
  /** Expiration time */
  expiresAt?: Date;
  /** Deep link to handle the request */
  actionUrl?: string;
}

