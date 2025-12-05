/**
 * @file HumanInteractionManager.spec.ts
 * @description Unit tests for the AgentOS Human-in-the-Loop Manager.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  HumanInteractionManager,
} from '../../../src/core/hitl/HumanInteractionManager';
import type {
  PendingAction,
  ApprovalDecision,
  ClarificationRequest,
  ClarificationResponse,
  DraftOutput,
  EditedOutput,
  EscalationContext,
  EscalationDecision,
} from '../../../src/core/hitl/IHumanInteractionManager';

describe('HumanInteractionManager', () => {
  let manager: HumanInteractionManager;
  let notificationHandler: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    notificationHandler = vi.fn().mockResolvedValue(undefined);
    manager = new HumanInteractionManager({
      defaultTimeoutMs: 1000,
      notificationHandler,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('approval requests', () => {
    it('should send notification when approval requested', async () => {
      const action: PendingAction = {
        actionId: 'action-1',
        description: 'Delete all records',
        severity: 'critical',
        agentId: 'cleanup-agent',
        context: { count: 1000 },
        reversible: false,
        requestedAt: new Date(),
      };

      const approvalPromise = manager.requestApproval(action);

      expect(notificationHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'approval_required',
          requestId: 'action-1',
          agentId: 'cleanup-agent',
          urgency: 'critical',
        }),
      );

      const decision: ApprovalDecision = {
        actionId: 'action-1',
        approved: true,
        decidedBy: 'admin',
        decidedAt: new Date(),
      };
      await manager.submitApprovalDecision(decision);

      const result = await approvalPromise;
      expect(result.approved).toBe(true);
      expect(result.decidedBy).toBe('admin');
    });

    it('should reject when approval times out with autoReject', async () => {
      const autoRejectManager = new HumanInteractionManager({
        defaultTimeoutMs: 100,
        autoRejectOnTimeout: true,
      });

      const action: PendingAction = {
        actionId: 'action-2',
        description: 'Risky operation',
        severity: 'high',
        agentId: 'test-agent',
        context: {},
        reversible: false,
        requestedAt: new Date(),
      };

      const result = await autoRejectManager.requestApproval(action);

      expect(result.approved).toBe(false);
      expect(result.rejectionReason).toContain('timed out');
      expect(result.decidedBy).toBe('system');
    });

    it('should throw when approval times out without autoReject', async () => {
      const action: PendingAction = {
        actionId: 'action-3',
        description: 'Test',
        severity: 'low',
        agentId: 'test-agent',
        context: {},
        reversible: true,
        requestedAt: new Date(),
        timeoutMs: 50,
      };

      await expect(manager.requestApproval(action)).rejects.toThrow('timed out');
    });

    it('should track approval statistics', async () => {
      const action1: PendingAction = {
        actionId: 'action-stat-1',
        description: 'Test 1',
        severity: 'low',
        agentId: 'test-agent',
        context: {},
        reversible: true,
        requestedAt: new Date(),
      };

      const approvalPromise = manager.requestApproval(action1);

      await manager.submitApprovalDecision({
        actionId: 'action-stat-1',
        approved: true,
        decidedBy: 'admin',
        decidedAt: new Date(),
      });

      await approvalPromise;

      const stats = manager.getStatistics();
      expect(stats.totalApprovalRequests).toBe(1);
      expect(stats.approvalRate).toBe(1);
    });
  });

  describe('clarification requests', () => {
    it('should request clarification with options', async () => {
      const request: ClarificationRequest = {
        requestId: 'clarify-1',
        question: 'Which format do you prefer?',
        context: 'Generating report',
        agentId: 'report-agent',
        clarificationType: 'preference',
        options: [
          { optionId: 'pdf', label: 'PDF', description: 'Portable format' },
          { optionId: 'html', label: 'HTML', description: 'Web format' },
        ],
        allowFreeform: false,
        requestedAt: new Date(),
      };

      const clarifyPromise = manager.requestClarification(request);

      expect(notificationHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'clarification_needed',
          requestId: 'clarify-1',
        }),
      );

      const response: ClarificationResponse = {
        requestId: 'clarify-1',
        selectedOptionId: 'pdf',
        respondedBy: 'user',
        respondedAt: new Date(),
      };
      await manager.submitClarification(response);

      const result = await clarifyPromise;
      expect(result.selectedOptionId).toBe('pdf');
    });
  });

  describe('output review', () => {
    it('should request edit and receive changes', async () => {
      const draft: DraftOutput = {
        draftId: 'draft-1',
        contentType: 'markdown',
        content: '# Report\n\nOriginal content',
        agentId: 'writer-agent',
        purpose: 'Quarterly report',
        confidence: 0.8,
        generatedAt: new Date(),
      };

      const editPromise = manager.requestEdit(draft);

      const edited: EditedOutput = {
        draftId: 'draft-1',
        editedContent: '# Report\n\nEdited and improved content',
        hasSignificantChanges: true,
        changeSummary: 'Improved clarity',
        editedBy: 'editor',
        editedAt: new Date(),
        feedback: 'Good start but needs more detail',
      };
      await manager.submitEdit(edited);

      const result = await editPromise;
      expect(result.hasSignificantChanges).toBe(true);
      expect(result.feedback).toBe('Good start but needs more detail');
    });
  });

  describe('escalation', () => {
    it('should escalate to human and receive decision', async () => {
      const context: EscalationContext = {
        escalationId: 'esc-1',
        reason: 'low_confidence',
        explanation: 'Unable to determine correct action',
        agentId: 'uncertain-agent',
        currentState: { step: 5, progress: 0.5 },
        attemptedActions: ['Action A', 'Action B'],
        assessment: 'Need human guidance',
        urgency: 'high',
        escalatedAt: new Date(),
      };

      const escalatePromise = manager.escalate(context);

      const decision: EscalationDecision = {
        type: 'agent_continue',
        guidance: 'Try approach C instead',
        adjustedParameters: { retry: true },
      };
      await manager.submitEscalationDecision('esc-1', decision);

      const result = await escalatePromise;
      expect(result.type).toBe('agent_continue');
    });
  });

  describe('feedback', () => {
    it('should record and retrieve feedback', async () => {
      await manager.recordFeedback({
        feedbackId: 'fb-1',
        agentId: 'agent-1',
        feedbackType: 'correction',
        aspect: 'accuracy',
        content: 'The calculation was wrong',
        importance: 4,
        providedBy: 'user',
        providedAt: new Date(),
      });

      const allFeedback = await manager.getFeedbackHistory('agent-1');
      expect(allFeedback).toHaveLength(1);

      const corrections = await manager.getFeedbackHistory('agent-1', {
        type: 'correction',
      });
      expect(corrections).toHaveLength(1);
    });
  });

  describe('pending requests', () => {
    it('should list all pending requests', async () => {
      const approvalPromise = manager.requestApproval({
        actionId: 'pending-approval',
        description: 'Test',
        severity: 'low',
        agentId: 'agent',
        context: {},
        reversible: true,
        requestedAt: new Date(),
      });

      const pending = await manager.getPendingRequests();
      expect(pending.approvals).toHaveLength(1);

      await manager.submitApprovalDecision({
        actionId: 'pending-approval',
        approved: false,
        decidedBy: 'test',
        decidedAt: new Date(),
      });
      await approvalPromise.catch(() => {});
    });

    it('should cancel pending requests', async () => {
      const approvalPromise = manager.requestApproval({
        actionId: 'cancel-me',
        description: 'To be cancelled',
        severity: 'low',
        agentId: 'agent',
        context: {},
        reversible: true,
        requestedAt: new Date(),
      });

      await manager.cancelRequest('cancel-me', 'Test cancellation');

      await expect(approvalPromise).rejects.toThrow('cancelled');
    });
  });

  describe('statistics', () => {
    it('should track pending request count', async () => {
      const promise = manager.requestApproval({
        actionId: 'stat-pending',
        description: 'Test',
        severity: 'low',
        agentId: 'agent',
        context: {},
        reversible: true,
        requestedAt: new Date(),
      });

      let stats = manager.getStatistics();
      expect(stats.pendingRequests).toBe(1);

      await manager.submitApprovalDecision({
        actionId: 'stat-pending',
        approved: true,
        decidedBy: 'admin',
        decidedAt: new Date(),
      });

      await promise;

      stats = manager.getStatistics();
      expect(stats.pendingRequests).toBe(0);
    });
  });
});



