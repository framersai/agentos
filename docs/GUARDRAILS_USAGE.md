# Guardrails Usage Guide

Guardrails are safety mechanisms that intercept and evaluate content before it enters or exits the AgentOS pipeline. They enable content filtering, PII redaction, policy enforcement, and mid-stream decision overrides.

## Overview

Guardrails intercept content at two points:

1. **Input Guardrails** - Evaluate user messages before orchestration
2. **Output Guardrails** - Evaluate agent responses before streaming to client

```
User Input → [Input Guardrails] → Orchestration → [Output Guardrails] → Client
```

## Quick Start

```typescript
import { AgentOS } from '@framers/agentos';
import { createTestAgentOSConfig } from '@framers/agentos/config/AgentOSConfig';
import {
  IGuardrailService,
  GuardrailAction,
  type GuardrailInputPayload,
  type GuardrailOutputPayload,
  type GuardrailEvaluationResult,
} from '@framers/agentos/core/guardrails';

// Simple content filter
class ContentFilter implements IGuardrailService {
  async evaluateInput({ input }: GuardrailInputPayload): Promise<GuardrailEvaluationResult | null> {
    if (input.textInput?.toLowerCase().includes('prohibited')) {
      return {
        action: GuardrailAction.BLOCK,
        reason: 'Content violates usage policy',
        reasonCode: 'CONTENT_POLICY_001',
      };
    }
    return null; // Allow
  }
}

// Initialize with guardrail
const agent = new AgentOS();
const base = await createTestAgentOSConfig();
await agent.initialize({
  ...base,
  guardrailService: new ContentFilter(), // Optional config-scoped guardrail
});
```

## Guardrail Actions

| Action | Effect |
|--------|--------|
| `ALLOW` | Pass content unchanged |
| `FLAG` | Pass content, record metadata for audit |
| `SANITIZE` | Replace content with modified version |
| `BLOCK` | Reject/terminate the interaction |

## Mid-Stream Decision Override ("Changing Mind")

Guardrails can evaluate streaming chunks in real-time and "change their mind" about allowing content. This enables:

- Stopping generation when cost ceiling is exceeded
- Blocking harmful content as it's being generated
- Redacting sensitive information mid-stream

### Example 1: Cost Ceiling Guardrail

Stop generation when the response exceeds a token budget:

```typescript
class CostCeilingGuardrail implements IGuardrailService {
  // Enable streaming evaluation
  config = {
    evaluateStreamingChunks: true,
    maxStreamingEvaluations: 100  // Rate limit
  };

  private tokenCount = 0;
  private readonly maxTokens = 1000;

  async evaluateOutput({ chunk }: GuardrailOutputPayload): Promise<GuardrailEvaluationResult | null> {
    // Only evaluate text chunks
    if (chunk.type !== 'TEXT_DELTA' || !chunk.textDelta) {
      return null;
    }

    // Estimate tokens (rough: 1 token ≈ 4 chars)
    this.tokenCount += Math.ceil(chunk.textDelta.length / 4);

    if (this.tokenCount > this.maxTokens) {
      // "Change mind" - stop generating mid-stream
      return {
        action: GuardrailAction.BLOCK,
        reason: 'Response exceeded token budget. Please refine your request.',
        reasonCode: 'COST_CEILING_EXCEEDED',
        metadata: { tokensUsed: this.tokenCount, limit: this.maxTokens },
      };
    }

    return null;
  }
}
```

### Example 2: Real-Time PII Redaction

Redact sensitive information as it streams:

```typescript
class PIIRedactionGuardrail implements IGuardrailService {
  config = {
    evaluateStreamingChunks: true,
    maxStreamingEvaluations: 200
  };

  private readonly patterns = [
    { regex: /\b\d{3}-\d{2}-\d{4}\b/g, replacement: '[SSN REDACTED]' },
    { regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, replacement: '[EMAIL REDACTED]' },
    { regex: /\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/g, replacement: '[CARD REDACTED]' },
  ];

  async evaluateOutput({ chunk }: GuardrailOutputPayload): Promise<GuardrailEvaluationResult | null> {
    if (chunk.type !== 'TEXT_DELTA' || !chunk.textDelta) {
      return null;
    }

    let text = chunk.textDelta;
    let modified = false;

    for (const { regex, replacement } of this.patterns) {
      const newText = text.replace(regex, replacement);
      if (newText !== text) {
        text = newText;
        modified = true;
      }
    }

    if (modified) {
      return {
        action: GuardrailAction.SANITIZE,
        modifiedText: text,
        reasonCode: 'PII_REDACTED',
      };
    }

    return null;
  }
}
```

### Example 3: Content Policy Mid-Stream

Block harmful content as it's being generated:

```typescript
class ContentPolicyGuardrail implements IGuardrailService {
  config = { evaluateStreamingChunks: true };

  private readonly prohibitedPatterns = [
    /how to make.*bomb/i,
    /instructions for.*weapon/i,
    // ... more patterns
  ];

  private accumulatedText = '';

  async evaluateOutput({ chunk }: GuardrailOutputPayload): Promise<GuardrailEvaluationResult | null> {
    if (chunk.type === 'TEXT_DELTA' && chunk.textDelta) {
      this.accumulatedText += chunk.textDelta;

      for (const pattern of this.prohibitedPatterns) {
        if (pattern.test(this.accumulatedText)) {
          return {
            action: GuardrailAction.BLOCK,
            reason: 'Response contains content that violates our usage policy.',
            reasonCode: 'CONTENT_POLICY_VIOLATION',
          };
        }
      }
    }

    return null;
  }
}
```

## Cross-Agent Guardrails

Cross-agent guardrails enable one agent (supervisor) to monitor and intervene in other agents' outputs. This is useful for:

- Supervisor patterns in multi-agent systems
- Quality gates across an agency
- Organization-wide policy enforcement

### Supervisor Pattern

```typescript
import {
  ICrossAgentGuardrailService,
  GuardrailAction,
  type CrossAgentOutputPayload,
  type GuardrailEvaluationResult,
} from '@framers/agentos/core/guardrails';

class SupervisorGuardrail implements ICrossAgentGuardrailService {
  // Observe specific worker agents (empty = all agents)
  observeAgentIds = ['worker-analyst', 'worker-writer'];

  // Allow this guardrail to block/modify other agents' streams
  canInterruptOthers = true;

  // Evaluate streaming chunks in real-time
  config = { evaluateStreamingChunks: true };

  async evaluateCrossAgentOutput({
    sourceAgentId,
    chunk,
    context,
  }: CrossAgentOutputPayload): Promise<GuardrailEvaluationResult | null> {
    // Check for confidential information leakage
    if (chunk.type === 'TEXT_DELTA' && chunk.textDelta?.includes('CONFIDENTIAL')) {
      return {
        action: GuardrailAction.BLOCK,
        reason: `Agent ${sourceAgentId} attempted to expose confidential information`,
        reasonCode: 'CROSS_AGENT_CONFIDENTIAL_LEAK',
        metadata: {
          blockedAgent: sourceAgentId,
          supervisor: 'supervisor-agent'
        },
      };
    }

    return null;
  }
}
```

### Quality Gate Guardrail

```typescript
class QualityGateGuardrail implements ICrossAgentGuardrailService {
  observeAgentIds = []; // Observe all agents
  canInterruptOthers = true;

  async evaluateCrossAgentOutput({
    sourceAgentId,
    chunk,
  }: CrossAgentOutputPayload): Promise<GuardrailEvaluationResult | null> {
    // Only evaluate final responses
    if (chunk.type !== 'FINAL_RESPONSE') {
      return null;
    }

    const response = chunk.finalResponseText;

    // Check response quality
    if (response && response.length < 50) {
      return {
        action: GuardrailAction.FLAG,
        reason: 'Response may be too brief',
        reasonCode: 'QUALITY_WARNING',
        metadata: {
          responseLength: response.length,
          agent: sourceAgentId
        },
      };
    }

    return null;
  }
}
```

## Configuration Options

### GuardrailConfig

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `evaluateStreamingChunks` | `boolean` | `false` | Evaluate TEXT_DELTA chunks (real-time) vs only FINAL_RESPONSE |
| `maxStreamingEvaluations` | `number` | `undefined` | Rate limit streaming evaluations per request |

### Performance Considerations

| Mode | Latency | Cost | Use Case |
|------|---------|------|----------|
| **Final-only** (default) | +1-500ms once | Low | Policy checks needing full context |
| **Streaming** | +1-500ms per chunk | High | Real-time PII redaction, immediate blocking |

## Using Multiple Guardrails

Multiple guardrails are evaluated in sequence. Each can modify the content before passing to the next:

```typescript
const guardrails = [
  new PIIRedactionGuardrail(),     // First: redact PII
  new ContentPolicyGuardrail(),    // Second: check policy
  new CostCeilingGuardrail(),      // Third: enforce budget
];

// AgentOSConfig.guardrailService is a single guardrail instance. To use multiple,
// register them as extension-pack descriptors (recommended) or wrap them in a composite.
```

**Evaluation Order:**
1. Input guardrails run in array order before orchestration
2. If any returns `BLOCK`, processing stops
3. If any returns `SANITIZE`, modified input passes to next guardrail
4. Output guardrails wrap the stream in array order

## API Reference

### IGuardrailService

```typescript
interface IGuardrailService {
  config?: GuardrailConfig;
  evaluateInput?(payload: GuardrailInputPayload): Promise<GuardrailEvaluationResult | null>;
  evaluateOutput?(payload: GuardrailOutputPayload): Promise<GuardrailEvaluationResult | null>;
}
```

### ICrossAgentGuardrailService

```typescript
interface ICrossAgentGuardrailService extends IGuardrailService {
  observeAgentIds?: string[];      // Agents to observe (empty = all)
  canInterruptOthers?: boolean;    // Can BLOCK/SANITIZE other agents
  evaluateCrossAgentOutput?(payload: CrossAgentOutputPayload): Promise<GuardrailEvaluationResult | null>;
}
```

### GuardrailAction

```typescript
enum GuardrailAction {
  ALLOW = 'allow',      // Pass unchanged
  FLAG = 'flag',        // Pass, record metadata
  SANITIZE = 'sanitize', // Replace content
  BLOCK = 'block',      // Reject/terminate
}
```

### GuardrailEvaluationResult

```typescript
interface GuardrailEvaluationResult {
  action: GuardrailAction;
  reason?: string;           // User-facing message
  reasonCode?: string;       // Machine-readable code
  metadata?: Record<string, unknown>;
  modifiedText?: string | null;  // For SANITIZE action
}
```

## Best Practices

1. **Start with final-only evaluation** - Enable streaming only when real-time filtering is required
2. **Use rate limiting** - Set `maxStreamingEvaluations` to control costs
3. **Be specific with reason codes** - Use consistent, machine-readable codes for analytics
4. **Log FLAG actions** - Use FLAG for monitoring without blocking user experience
5. **Test edge cases** - Test with partial PII, edge cases in streaming chunks
6. **Consider latency** - Each streaming evaluation adds latency to user experience

## Folder-Level Permissions & Safe Guardrails

In addition to content guardrails, Wunderland provides **folder-level permission guardrails** that validate filesystem access before tool execution. This prevents agents from accessing sensitive system files or directories outside their permitted scope.

### Overview

Safe Guardrails intercept tool calls (like `file_read`, `file_write`, `shell_execute`) and validate filesystem paths against folder permission rules **before execution**.

```
Tool Call → Safe Guardrails → Folder Permission Check → Allow/Deny → Execution
```

### Quick Example

```json
{
  "security": {
    "tier": "balanced",
    "folderPermissions": {
      "defaultPolicy": "deny",
      "inheritFromTier": true,
      "rules": [
        { "pattern": "~/workspace/**", "read": true, "write": true },
        { "pattern": "/tmp/**", "read": true, "write": true },
        { "pattern": "/var/log/**", "read": true, "write": false },
        { "pattern": "!/sensitive/*", "read": false, "write": false }
      ]
    }
  }
}
```

### Folder Permission Rules

Each rule supports glob patterns with first-match-wins evaluation:

| Pattern | Matches | Example |
|---------|---------|---------|
| `~/workspace/**` | All files under workspace recursively | `~/workspace/data/file.txt` |
| `/tmp/*` | Direct children of /tmp | `/tmp/test.txt` |
| `!/sensitive/*` | Negation: blocks all files | `/sensitive/data.json` (blocked) |
| `/var/log/**` | System logs recursively | `/var/log/system/app.log` |

### Security Tier Defaults

Each security tier includes default folder permissions:

**Dangerous** - Allow everything:
```json
{
  "defaultPolicy": "allow",
  "rules": []
}
```

**Balanced** - Workspace + tmp + read-only logs:
```json
{
  "defaultPolicy": "deny",
  "rules": [
    { "pattern": "~/workspace/**", "read": true, "write": true },
    { "pattern": "/tmp/**", "read": true, "write": true },
    { "pattern": "/var/log/**", "read": true, "write": false }
  ]
}
```

**Paranoid** - Workspace only:
```json
{
  "defaultPolicy": "deny",
  "rules": [
    { "pattern": "~/workspace/**", "read": true, "write": true }
  ]
}
```

### Violation Handling

When an agent attempts unauthorized access, Safe Guardrails:

1. **Blocks the tool call** and returns an error
2. **Logs the violation** to `~/.wunderland/security/violations.log`
3. **Sends notifications** (webhooks/email) for high/critical severity
4. **Assesses severity** based on attempted path:
   - **Critical**: `/etc`, `/root`, `/boot`, `passwd`, `shadow`
   - **High**: `/usr`, `/var`, `/sys`, `.ssh`, credentials
   - **Medium**: Write operations
   - **Low**: Read operations

### Audit Log Format

```json
{"timestamp":"2026-02-09T10:30:00Z","level":"SECURITY_VIOLATION","agentId":"agent-123","toolId":"file_write","operation":"file_write","attemptedPath":"/etc/passwd","reason":"Path /etc not in allowed folders","severity":"critical"}
```

### Shell Command Parsing

Safe Guardrails extract paths from shell commands:

```typescript
// Agent tries: shell_execute({ command: "rm -rf /etc/config" })
// Guardrails extract: ["/etc/config"]
// Result: BLOCKED - /etc not permitted
```

Supported commands: `rm`, `cp`, `mv`, `cat`, `touch`, `mkdir`, `rmdir`, `chmod`, `chown`

### Read-Only vs Read-Write

Separate read and write permissions per folder:

```json
{
  "rules": [
    { "pattern": "/data/public/**", "read": true, "write": false },
    { "pattern": "~/workspace/**", "read": true, "write": true }
  ]
}
```

- Agent can **read** from `/data/public/` but **cannot write**
- Agent has **full access** to `~/workspace/`

### Configuration in agent.config.json

```json
{
  "seedId": "seed_research_bot",
  "displayName": "Research Bot",
  "security": {
    "tier": "balanced",
    "permissionSet": "autonomous",
    "folderPermissions": {
      "defaultPolicy": "deny",
      "inheritFromTier": true,
      "rules": [
        {
          "pattern": "~/workspace/**",
          "read": true,
          "write": true,
          "description": "Agent workspace - full access"
        },
        {
          "pattern": "/home/user/docs/**",
          "read": true,
          "write": false,
          "description": "Read-only document access"
        },
        {
          "pattern": "!/home/user/docs/sensitive/*",
          "read": false,
          "write": false,
          "description": "Block sensitive subdirectory"
        }
      ]
    }
  }
}
```

### Notification Configuration

Configure webhooks or email alerts for violations:

```typescript
const guardrails = new SafeGuardrails({
  auditLogPath: '~/.wunderland/security/violations.log',
  notificationWebhooks: ['https://hooks.slack.com/...'],
  emailConfig: {
    to: 'security@example.com',
    smtpHost: 'smtp.example.com',
    smtpPort: 587
  },
  enableAuditLogging: true,
  enableNotifications: true
});
```

### Querying Violations

```typescript
// Query recent violations
const violations = await auditLogger.queryViolations({
  agentId: 'agent-123',
  startTime: new Date('2026-02-08'),
  endTime: new Date('2026-02-09'),
  severity: 'critical'
});

// Get statistics
const stats = await guardrails.getViolationStats('agent-123', {
  start: new Date('2026-02-01'),
  end: new Date('2026-02-09')
});
// { total: 15, bySeverity: { critical: 3, high: 7, medium: 5 }, byTool: { file_write: 8, shell_execute: 7 } }
```

## Related Documentation

- [Architecture Overview](./ARCHITECTURE.md)
- [Human-in-the-Loop](./HUMAN_IN_THE_LOOP.md)
- [Agent Communication](./AGENT_COMMUNICATION.md)
- [Safety Primitives](./SAFETY_PRIMITIVES.md)
