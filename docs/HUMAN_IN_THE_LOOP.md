# Human-in-the-Loop (HITL) Guide

## Overview

The Human-in-the-Loop (HITL) system in AgentOS enables structured collaboration between AI agents and human operators. This ensures human oversight for critical decisions while maintaining efficient autonomous operation.

## Why HITL?

Modern AI agents are powerful but not infallible. HITL provides:

1. **Safety**: Human approval for high-risk actions
2. **Quality**: Human review of important outputs
3. **Adaptability**: Human input for ambiguous situations
4. **Learning**: Feedback loops for continuous improvement

## Core Concepts

### Request Types

| Type | Purpose | Example |
|------|---------|---------|
| **Approval** | Authorize high-risk actions | "Delete 5000 user records?" |
| **Clarification** | Resolve ambiguity | "Which report format do you prefer?" |
| **Edit** | Review and modify outputs | "Please review this email draft" |
| **Escalation** | Transfer control to human | "I'm uncertain how to proceed" |
| **Checkpoint** | Progress review points | "Phase 1 complete, continue?" |

### Severity Levels

```typescript
type ActionSeverity = 'low' | 'medium' | 'high' | 'critical';
```

- **Low**: Informational, auto-approve after timeout OK
- **Medium**: Important, requires attention within hours
- **High**: Significant risk, requires prompt attention
- **Critical**: Urgent, immediate human response required

## Quick Start

### 1. Initialize the Manager

```typescript
import { HumanInteractionManager } from '@framers/agentos/core/hitl';

const hitlManager = new HumanInteractionManager({
  // Default timeout: 5 minutes
  defaultTimeoutMs: 300000,
  
  // Auto-reject timed-out requests (optional)
  autoRejectOnTimeout: false,
  
  // Notification handler (required for production)
  notificationHandler: async (notification) => {
    // Send to Slack, email, or UI
    await notifyHuman(notification);
  },
});
```

### 2. Request Approval

```typescript
// Before a risky action
const decision = await hitlManager.requestApproval({
  actionId: 'batch-delete-001',
  description: 'Delete all inactive accounts older than 2 years',
  severity: 'critical',
  category: 'data_modification',
  agentId: 'cleanup-agent',
  context: {
    accountCount: 5000,
    criteria: 'inactive > 2 years',
    estimatedStorage: '50GB',
  },
  reversible: false,
  potentialConsequences: [
    'Permanent data loss',
    'User complaints if accounts are needed',
  ],
  alternatives: [
    {
      alternativeId: 'archive',
      description: 'Archive instead of delete',
      tradeoffs: 'Uses storage but preserves data',
    },
  ],
});

if (decision.approved) {
  await executeDeletion();
} else {
  console.log(`Rejected: ${decision.rejectionReason}`);
  if (decision.selectedAlternativeId === 'archive') {
    await executeArchive();
  }
}
```

### 3. Request Clarification

```typescript
const response = await hitlManager.requestClarification({
  requestId: 'clarify-format-001',
  question: 'Which output format should I use for the quarterly report?',
  context: 'Generating Q4 2024 financial report',
  agentId: 'report-agent',
  clarificationType: 'preference',
  options: [
    { optionId: 'pdf', label: 'PDF Document' },
    { optionId: 'excel', label: 'Excel Spreadsheet' },
    { optionId: 'slides', label: 'PowerPoint Presentation' },
  ],
  allowFreeform: true,
});

const format = response.selectedOptionId || response.freeformResponse;
await generateReport(format);
```

### 4. Handle Escalations

```typescript
// When agent is uncertain
const decision = await hitlManager.escalate({
  escalationId: 'esc-001',
  reason: 'low_confidence',
  explanation: 'Multiple conflicting data sources found',
  agentId: 'research-agent',
  currentState: { step: 3, progress: 0.4 },
  attemptedActions: [
    'Queried primary database',
    'Checked secondary source',
    'Cross-referenced external API',
  ],
  recommendations: [
    'Manual verification of source reliability',
    'Contact domain expert',
    'Use most recent source only',
  ],
  urgency: 'high',
});

switch (decision.type) {
  case 'human_takeover':
    // Human will handle directly
    break;
  case 'agent_continue':
    // Continue with human guidance
    await continueWithGuidance(decision.guidance);
    break;
  case 'abort':
    // Stop the task
    await abortTask(decision.reason);
    break;
  case 'delegate':
    // Hand off to another agent
    await handoffTo(decision.targetAgentId, decision.instructions);
    break;
}
```

### 5. Workflow Checkpoints

```typescript
// During long-running workflows
const checkpointDecision = await hitlManager.checkpoint({
  checkpointId: 'cp-phase-1',
  workflowId: 'migration-workflow',
  currentPhase: 'Data Validation',
  progress: 0.5,
  completedWork: [
    'Exported 50,000 records',
    'Validated schema compatibility',
  ],
  upcomingWork: [
    'Transform data formats',
    'Import to new system',
    'Verify integrity',
  ],
  issues: ['3 records have invalid dates'],
});

if (checkpointDecision.decision === 'continue') {
  await continueWorkflow();
} else if (checkpointDecision.decision === 'modify') {
  // Apply modifications
  if (checkpointDecision.modifications?.skipSteps) {
    await skipSteps(checkpointDecision.modifications.skipSteps);
  }
}
```

### 6. Collect Feedback

```typescript
// Record human feedback for learning
await hitlManager.recordFeedback({
  feedbackId: 'fb-001',
  agentId: 'writer-agent',
  feedbackType: 'correction',
  aspect: 'style',
  content: 'The tone was too formal. Use more casual language for this audience.',
  importance: 4,
  context: { taskType: 'social-media-post' },
  providedBy: 'marketing-lead',
});

// Query feedback history
const feedbackHistory = await hitlManager.getFeedbackHistory('writer-agent', {
  type: 'correction',
  limit: 10,
});
```

## Notification Handlers

### Slack Integration

```typescript
const slackHandler = async (notification) => {
  const urgencyEmoji = {
    critical: '🚨',
    high: '⚠️',
    medium: '📋',
    low: 'ℹ️',
  };

  await slack.chat.postMessage({
    channel: '#agent-approvals',
    text: `${urgencyEmoji[notification.urgency]} ${notification.summary}`,
    blocks: [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: notification.summary },
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Review' },
            url: notification.actionUrl,
          },
        ],
      },
    ],
  });
};
```

### Email Integration

```typescript
const emailHandler = async (notification) => {
  await sendEmail({
    to: 'approvals@company.com',
    subject: `[${notification.urgency.toUpperCase()}] Agent Request: ${notification.type}`,
    html: `
      <h2>${notification.summary}</h2>
      <p>Agent: ${notification.agentId}</p>
      <p>Expires: ${notification.expiresAt?.toLocaleString() || 'No expiry'}</p>
      <a href="${notification.actionUrl}">Take Action</a>
    `,
  });
};
```

## API Reference

### REST Endpoints

```
GET    /api/agentos/hitl/approvals              # List pending approvals
POST   /api/agentos/hitl/approvals              # Create approval request
POST   /api/agentos/hitl/approvals/:id/approve  # Approve action
POST   /api/agentos/hitl/approvals/:id/reject   # Reject action

GET    /api/agentos/hitl/clarifications         # List clarifications
POST   /api/agentos/hitl/clarifications         # Request clarification
POST   /api/agentos/hitl/clarifications/:id/respond  # Submit response

GET    /api/agentos/hitl/escalations            # List escalations
POST   /api/agentos/hitl/escalations            # Create escalation
POST   /api/agentos/hitl/escalations/:id/resolve  # Resolve escalation

GET    /api/agentos/hitl/feedback               # Get feedback history
POST   /api/agentos/hitl/feedback               # Submit feedback

GET    /api/agentos/hitl/stats                  # Get HITL statistics
```

### Statistics

```typescript
const stats = hitlManager.getStatistics();
// {
//   totalApprovalRequests: 150,
//   approvalRate: 0.87,           // 87% approved
//   totalClarifications: 45,
//   avgResponseTimeMs: 180000,    // 3 minutes average
//   totalEscalations: 12,
//   escalationsByReason: {
//     low_confidence: 8,
//     safety_concern: 2,
//     ethical_concern: 2,
//   },
//   pendingRequests: 3,
//   timedOutRequests: 5,
// }
```

## Best Practices

### 1. Right-Size Approval Requirements

Don't require approval for everything:

```typescript
// ✅ Good: Critical actions need approval
if (actionImpact === 'critical' || !isReversible) {
  await hitlManager.requestApproval(action);
}

// ❌ Bad: Approving trivial actions
await hitlManager.requestApproval({
  description: 'Send a thank you email',
  severity: 'low', // Don't require approval for this
});
```

### 2. Provide Rich Context

Help humans make informed decisions:

```typescript
// ✅ Good: Rich context
{
  description: 'Update pricing for 50 products',
  context: {
    productCount: 50,
    averageChange: '+5%',
    affectedRevenue: '$500,000/month',
    competitorComparison: 'Still 10% below market',
    customerImpact: 'Existing contracts unaffected',
  },
  potentialConsequences: [
    'May affect conversion rates',
    'Requires website update',
  ],
}

// ❌ Bad: Minimal context
{
  description: 'Change prices',
  context: {},
}
```

### 3. Set Appropriate Timeouts

Match timeout to urgency and human availability:

```typescript
// Critical: Short timeout
requestApproval({ severity: 'critical', timeoutMs: 60000 }); // 1 min

// Standard: Reasonable timeout
requestApproval({ severity: 'medium', timeoutMs: 3600000 }); // 1 hour

// Low priority: Longer timeout
requestApproval({ severity: 'low', timeoutMs: 86400000 }); // 24 hours
```

### 4. Use Feedback for Learning

Connect feedback to agent improvement:

```typescript
// Collect feedback
await hitlManager.recordFeedback({
  agentId: 'writer-agent',
  feedbackType: 'correction',
  aspect: 'accuracy',
  content: 'Statistics were outdated',
});

// Use feedback in prompts
const recentFeedback = await hitlManager.getFeedbackHistory(agentId, {
  type: 'correction',
  limit: 5,
});

const systemPrompt = `
Previous corrections:
${recentFeedback.map(f => `- ${f.content}`).join('\n')}
Please avoid these issues.
`;
```

## Troubleshooting

### Requests Timing Out

1. Check notification handler is working
2. Verify human operators are receiving notifications
3. Adjust timeout values based on response patterns
4. Enable `autoRejectOnTimeout` for non-critical requests

### Missing Responses

1. Check `getPendingRequests()` for stuck requests
2. Implement monitoring for pending request age
3. Set up alerts for escalations that haven't been resolved

### Performance Issues

1. Batch related approvals when possible
2. Use appropriate severity levels to prioritize
3. Consider pre-approved action patterns for common cases

## Related Documentation

- [Planning Engine](./PLANNING_ENGINE.md) - Autonomous goal pursuit
- [Agent Communication](./AGENT_COMMUNICATION.md) - Inter-agent messaging
- [Architecture](./ARCHITECTURE.md) - Full system overview


