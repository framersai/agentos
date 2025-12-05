/**
 * @file HITL Module Index
 * @description Human-in-the-Loop (HITL) module exports for AgentOS.
 *
 * The HITL module enables structured collaboration between AI agents
 * and human operators for:
 * - Approval of high-risk actions
 * - Clarification of ambiguous situations
 * - Review and editing of outputs
 * - Escalation handling
 * - Workflow checkpoints
 *
 * @module AgentOS/HITL
 */

// Interface
export type {
  IHumanInteractionManager,
  PendingAction,
  ApprovalDecision,
  ActionSeverity,
  AlternativeAction,
  ClarificationRequest,
  ClarificationResponse,
  ClarificationOption,
  DraftOutput,
  EditedOutput,
  EscalationContext,
  EscalationDecision,
  EscalationReason,
  WorkflowCheckpoint,
  CheckpointDecision,
  HumanFeedback,
  HITLStatistics,
  HITLNotificationHandler,
  HITLNotification,
} from './IHumanInteractionManager';

// Implementation
export {
  HumanInteractionManager,
  type HumanInteractionManagerConfig,
} from './HumanInteractionManager';

