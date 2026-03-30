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
import { HumanInteractionManager } from '@framers/agentos/planning/hitl';

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

## LLM-as-Judge Handlers

### `hitl.llmJudge()` — Agency-Level

The `hitl.llmJudge()` factory creates an HITL handler that delegates approval
decisions to an LLM. The LLM evaluates the `ApprovalRequest` against a rubric
and returns a structured `{ approved, confidence, reasoning }` response. When
the confidence score falls below the threshold, the decision is escalated to a
fallback handler.

```typescript
import { agency, hitl } from '@framers/agentos';

const guarded = agency({
  model: 'openai:gpt-4o',
  agents: { worker: { instructions: 'Execute tasks.' } },
  hitl: {
    approvals: { beforeTool: ['delete-file', 'send-email'] },
    handler: hitl.llmJudge({
      model: 'gpt-4o-mini',
      provider: 'openai',
      criteria: 'Is this action safe, reversible, and aligned with the user intent?',
      confidenceThreshold: 0.8,
      fallback: hitl.cli(), // uncertain decisions go to human
    }),
  },
});
```

| Option | Type | Default | Description |
|---|---|---|---|
| `model` | `string` | `'gpt-4o-mini'` | LLM model for evaluation |
| `provider` | `string` | `'openai'` | LLM provider |
| `criteria` | `string` | `'Evaluate whether this action is safe, relevant, and appropriate.'` | Custom rubric |
| `confidenceThreshold` | `number` | `0.7` | Below this, delegate to fallback |
| `fallback` | `HitlHandler` | `hitl.autoReject(...)` | Handler for low-confidence decisions |
| `apiKey` | `string` | - | API key override |

### `humanNode` Options — Graph-Level

In the AgentGraph builder, `humanNode()` now supports automated resolution
strategies that bypass the default human interrupt:

```typescript
import { humanNode } from '@framers/agentos/orchestration/builders/nodes';

// Auto-accept (useful for tests/CI)
humanNode({ prompt: 'Approve?', autoAccept: true });

// Auto-reject with reason
humanNode({ prompt: 'Approve?', autoReject: 'Blocked by policy' });

// LLM judge with fallthrough to human interrupt
humanNode({
  prompt: 'Should we publish this content?',
  judge: {
    model: 'gpt-4o-mini',
    criteria: 'Is the content appropriate and factually accurate?',
    confidenceThreshold: 0.8,
  },
});

// Auto-accept on timeout instead of erroring
humanNode({
  prompt: 'Approve deployment?',
  timeout: 30_000,
  onTimeout: 'accept', // 'accept' | 'reject' | 'error'
});
```

**`humanNode` options:**

| Option | Type | Default | Description |
|---|---|---|---|
| `prompt` | `string` | (required) | Message shown to the human operator |
| `timeout` | `number` | - | Max milliseconds before timeout handling |
| `autoAccept` | `boolean` | `false` | Auto-accept without human input |
| `autoReject` | `boolean \| string` | `false` | Auto-reject; string value is the reason |
| `judge.model` | `string` | `'gpt-4o-mini'` | LLM model for the judge |
| `judge.provider` | `string` | `'openai'` | LLM provider |
| `judge.criteria` | `string` | `'Is this action safe, relevant, and appropriate?'` | Evaluation criteria |
| `judge.confidenceThreshold` | `number` | `0.7` | Below this, fall through to human interrupt |
| `onTimeout` | `'accept' \| 'reject' \| 'error'` | `'error'` | Behaviour when timeout expires |

### Example: Automated Testing Pipeline

Use LLM judge to gate quality without blocking CI:

```typescript
import { AgentGraph, humanNode, gmiNode } from '@framers/agentos';

const graph = new AgentGraph('test-pipeline');

const generate = gmiNode({ instructions: 'Generate a product description.' });
const review = humanNode({
  prompt: 'Review the generated content for accuracy.',
  judge: {
    model: 'gpt-4o-mini',
    criteria: 'Is this factually accurate, well-written, and free of hallucinations?',
    confidenceThreshold: 0.85,
  },
  timeout: 10_000,
  onTimeout: 'reject', // safety default: reject if judge hangs
});
const publish = gmiNode({ instructions: 'Format and publish the content.' });

graph.addNode(generate);
graph.addNode(review);
graph.addNode(publish);
graph.addEdge(generate.id, review.id);
graph.addEdge(review.id, publish.id);
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

## Guardrail Override

The guardrail override system adds a post-approval safety net to the HITL
pipeline. Even after a tool call is approved -- whether by auto-approve, an
LLM judge, or a human operator -- the configured guardrails run a final check
against the tool call arguments. If any guardrail returns `action: 'block'`,
the approval is overridden and the tool call is denied.

### Flow

```
Tool call -> HITL handler -> approved?
  YES -> Guardrail check (if enabled)
    -> Guardrail PASS -> execute tool
    -> Guardrail BLOCK -> DENY (override HITL approval)
  NO -> deny tool
```

### Why?

Auto-approve mode is convenient for development and CI, but it creates a
blind spot: destructive commands like `rm -rf /`, `kill -9`, or `DROP TABLE`
pass through without review. The guardrail override catches these patterns
even in fully autonomous mode.

### Configuration

#### Agency-level (API)

```typescript
import { agency, hitl } from '@framers/agentos';

const myAgency = agency({
  model: 'openai:gpt-4o',
  agents: { worker: { instructions: 'Execute tasks.' } },
  hitl: {
    approvals: { beforeTool: ['shell_execute'] },
    handler: hitl.autoApprove(),

    // Guardrail override is ON by default.
    guardrailOverride: true,

    // Default guardrails: ['pii-redaction', 'code-safety']
    postApprovalGuardrails: ['pii-redaction', 'code-safety'],
  },
});
```

#### Graph-level (humanNode)

```typescript
import { humanNode } from '@framers/agentos/orchestration/builders/nodes';

humanNode({
  prompt: 'Deploy to production?',
  autoAccept: true,
  guardrailOverride: true, // even though auto-accepted, guardrails can block
});
```

#### CLI

```bash
# Disable the post-approval safety net (full autonomy)
wunderland chat --no-guardrail-override
```

#### agent.config.json

```json
{
  "hitl": {
    "mode": "auto-approve",
    "guardrailOverride": false
  }
}
```

### Example: Auto-approve with guardrail catching `rm -rf`

```typescript
const myAgency = agency({
  agents: { worker: { instructions: 'Execute shell commands.' } },
  hitl: {
    approvals: { beforeTool: ['shell_execute'] },
    handler: hitl.autoApprove(), // approves everything
    // But guardrails catch destructive patterns:
    guardrailOverride: true,
    postApprovalGuardrails: ['code-safety'],
  },
  on: {
    guardrailHitlOverride: (event) => {
      console.warn(
        `[Safety] Guardrail "${event.guardrailId}" blocked tool "${event.toolName}": ${event.reason}`
      );
    },
  },
});

// This tool call will be auto-approved by HITL, then blocked by code-safety:
// [Guardrail] Overrode HITL approval for tool "shell_execute" -- code-safety: detected rm -rf pattern
```

### Built-in Guardrails

| ID | Description |
|---|---|
| `code-safety` | Blocks destructive shell commands (`rm -rf`, `kill -9`, `DROP TABLE`, `mkfs`, `dd`, `format`, `shutdown`, etc.) |
| `pii-redaction` | Blocks payloads containing unredacted SSNs or credit card numbers |

### Disabling the Override

Set `guardrailOverride: false` in the HITL config or pass `--no-guardrail-override`
on the CLI. This gives full autonomy to the HITL handler's decision with no
post-approval checks.

### Events

When a guardrail overrides an HITL approval, the `guardrailHitlOverride`
callback fires:

```typescript
interface GuardrailHitlOverrideEvent {
  guardrailId: string; // e.g., 'code-safety'
  reason: string;      // e.g., 'detected destructive pattern: rm\\s+-rf\\s+\\/'
  toolName: string;    // e.g., 'shell_execute'
  timestamp: number;
}
```

## FAQ

### Can guardrails override HITL approvals?

Yes. When `guardrailOverride` is enabled (the default), guardrails run a
post-approval check on every approved tool call. If any guardrail detects a
destructive pattern, the approval is vetoed and the tool call is denied.
This applies regardless of how the approval was made -- auto-approve, LLM
judge, or human operator.

The flow is: HITL approves -> guardrails check -> execute (or block).

To disable this behavior, set `guardrailOverride: false` in the HITL
config or pass `--no-guardrail-override` on the CLI.

## Related Documentation

- [Planning Engine](./PLANNING_ENGINE.md) - Autonomous goal pursuit
- [Agent Communication](./AGENT_COMMUNICATION.md) - Inter-agent messaging
- [Architecture](./ARCHITECTURE.md) - Full system overview


