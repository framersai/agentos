# workflow() DSL

`workflow()` is the sequential/pipeline authoring API in the Unified Orchestration Layer. It compiles to the same `CompiledExecutionGraph` IR as `AgentGraph` and `mission()`, but enforces that the result is a strict DAG — cycles are detected and rejected at compile time.

Use `workflow()` when your steps are known upfront and execute in a well-defined order. For cyclic agent loops or complex graph structures, see [AgentGraph](./agent-graph.md). For goal-driven orchestration where steps emerge at runtime, see [mission()](./mission-api.md).

## Quick Start

```typescript
import { workflow } from '@framers/agentos/orchestration';
import { z } from 'zod';

const wf = workflow('summarize-and-tag')
  .input(z.object({ url: z.string() }))
  .returns(z.object({ summary: z.string(), tags: z.array(z.string()) }))
  .step('fetch', { tool: 'web_fetch', effectClass: 'external' })
  .step('summarize', { gmi: { instructions: 'Summarize the document in 3 sentences.' } })
  .step('tag', { gmi: { instructions: 'Extract 5 topic tags.' } })
  .compile();

const result = await wf.invoke({ url: 'https://example.com/article' });
```

## Factory Function

```typescript
workflow(name: string): WorkflowBuilder
```

Returns a new `WorkflowBuilder`. The name is used as the compiled graph's display name and as a prefix for run ids and checkpoint keys.

## Schema Declaration

Both `.input()` and `.returns()` are required. Compilation throws if either is missing.

```typescript
workflow('my-pipeline')
  .input(z.object({ query: z.string(), limit: z.number().default(10) }))
  .returns(z.object({ results: z.array(z.string()), count: z.number() }))
```

Both accept Zod schemas or plain JSON Schema objects.

## Step Primitives

### step() / then()

Appends a single named step. `then()` is an alias for `step()` — it reads more naturally when chaining.

```typescript
wf.step('fetch', { tool: 'web_search' })
  .then('extract', { gmi: { instructions: 'Extract the key facts.' } })
  .then('approve', { human: { prompt: 'Approve these facts?' } })
```

**StepConfig — execution strategies (pick one):**

| Field | Description |
|---|---|
| `tool` | Name of a registered `ITool` to invoke |
| `gmi` | LLM call with `instructions` string. Always runs as `single_turn` |
| `human` | Suspend and surface `prompt` to a human operator |
| `extension` | Call `method` on registered `extensionId` |
| `subgraph` | Delegate to a `CompiledExecutionGraph` |

**StepConfig — optional policies:**

```typescript
{
  tool: 'web_search',

  // Side-effect classification
  effectClass: 'external',  // 'pure' | 'read' | 'write' | 'external' | 'human'

  // Memory
  memory: {
    consistency: 'snapshot',
    read: { types: ['episodic'], maxTraces: 5 },
    write: { autoEncode: true, type: 'episodic', scope: 'session' },
  },

  // Guardrails
  guardrails: {
    output: ['pii-redaction'],
    onViolation: 'sanitize',
  },

  // Failure handling
  onFailure: 'retry',
  retryPolicy: { maxAttempts: 3, backoff: 'exponential', backoffMs: 500 },

  // Timeout
  timeout: 30_000,

  // Human approval gate before proceeding
  requiresApproval: true,
}
```

### branch()

Appends a conditional fan-out. The `condition` function evaluates `GraphState` at runtime and returns a route key. Each route key maps to a step config. All branches become the new tail — the next declared step connects from all of them.

```typescript
wf.step('classify', { tool: 'classifier' })
  .branch(
    (state) => state.scratch.category, // returns a route key
    {
      premium: { gmi: { instructions: 'Generate premium-tier response.' } },
      standard: { gmi: { instructions: 'Generate standard response.' } },
      rejected: { tool: 'log_rejection' },
    }
  )
  .step('send', { tool: 'send_email' }) // connects from all three branches
```

The condition function must return one of the route keys. Returning an unrecognised key causes a `BRANCH_ROUTE_NOT_FOUND` runtime error.

### parallel()

Appends a concurrent fan-out. All steps execute simultaneously (subject to runtime scheduling). After all complete, their outputs are merged using the `join.merge` reducers.

```typescript
wf.step('fetch', { tool: 'web_fetch' })
  .parallel(
    [
      { gmi: { instructions: 'Summarize in English.' } },
      { gmi: { instructions: 'Summarize in French.' } },
      { gmi: { instructions: 'Summarize in German.' } },
    ],
    {
      strategy: 'all',     // 'all' | 'any' | 'quorum'
      quorumCount: 2,      // only used when strategy is 'quorum'
      merge: {
        'scratch.summaries': 'concat',  // arrays get concatenated
      },
      timeout: 60_000,
    }
  )
  .step('combine', { gmi: { instructions: 'Pick the best summary.' } })
```

**Join strategies:**

| Strategy | Description |
|---|---|
| `all` | Wait for all parallel branches to complete |
| `any` | Continue as soon as the first branch completes |
| `quorum` | Wait for `quorumCount` branches to complete |

## DAG Enforcement

`workflow()` enforces acyclicity at compile time. Any attempt to create a cycle (even via subgraphs) throws a `WorkflowValidationError`:

```
Workflow validation failed: cycle detected involving nodes: fetch → process → fetch
```

If you need agent loops, use [AgentGraph](./agent-graph.md) instead.

GMI steps inside `workflow()` always run in `single_turn` mode — the `executionMode` field in `gmi` config is accepted in the type but ignored at runtime. This is a deliberate design choice: workflow steps must be cost-bounded and deterministic.

## Compilation

```typescript
const compiled = wf.compile({
  checkpointStore: new SqliteCheckpointStore('./runs.db'), // optional
});
```

The workflow compiler automatically sets `checkpointPolicy: 'every_node'` — every step is checkpointed by default, making long-running workflows resumable after any failure.

## Execution

```typescript
// Run to completion
const result = await compiled.invoke({ url: 'https://example.com' });

// Stream events
for await (const event of compiled.stream({ url: 'https://example.com' })) {
  console.log(event.type, event.nodeId);
}

// Resume after failure (checkpointId from GraphState.checkpointId)
const result = await compiled.resume(checkpointId);

// Export IR for subgraph embedding
const ir = compiled.toIR();
```

## Complete Example — Onboarding Workflow

```typescript
import { workflow } from '@framers/agentos/orchestration';
import { SqliteCheckpointStore } from '@framers/agentos/orchestration/checkpoint';
import { z } from 'zod';

const onboarding = workflow('user-onboarding')
  .input(z.object({
    userId: z.string(),
    plan: z.enum(['free', 'pro', 'enterprise']),
  }))
  .returns(z.object({
    welcomed: z.boolean(),
    resourcesCreated: z.array(z.string()),
  }))

  // Step 1: fetch the new user profile
  .step('fetch-user', {
    tool: 'get_user',
    effectClass: 'read',
  })

  // Step 2: branch on plan type
  .branch(
    (state) => state.scratch.plan,
    {
      free: {
        tool: 'provision_free_tier',
        effectClass: 'write',
      },
      pro: {
        tool: 'provision_pro_tier',
        effectClass: 'write',
        retryPolicy: { maxAttempts: 3, backoff: 'exponential', backoffMs: 1000 },
      },
      enterprise: {
        human: { prompt: 'Manually configure enterprise account for this user.' },
        requiresApproval: true,
      },
    }
  )

  // Step 3: parallel welcome actions
  .parallel(
    [
      { tool: 'send_welcome_email', effectClass: 'external' },
      { tool: 'create_default_workspace', effectClass: 'write' },
      { gmi: { instructions: 'Generate a personalised getting-started checklist.' } },
    ],
    {
      strategy: 'all',
      merge: {
        'scratch.provisioned': 'concat',
      },
    }
  )

  // Step 4: confirm
  .step('confirm', {
    gmi: {
      instructions: 'Confirm onboarding is complete and summarise what was created.',
      maxTokens: 256,
    },
  })

  .compile({
    checkpointStore: new SqliteCheckpointStore('./onboarding.db'),
  });

// Run
const result = await onboarding.invoke({ userId: 'u_123', plan: 'pro' });

// Stream with progress UI
for await (const event of onboarding.stream({ userId: 'u_456', plan: 'free' })) {
  if (event.type === 'node_start') updateProgressBar(event.nodeId);
}

// Resume a human-gated enterprise onboarding after approval
const result2 = await onboarding.resume(savedCheckpointId);
```

## See Also

- [AgentGraph](./agent-graph.md) — for cyclic graphs and full graph control
- [mission() API](./mission-api.md) — for goal-driven orchestration
- [Checkpointing](./checkpointing.md) — ICheckpointStore, resume semantics
- [Unified Orchestration](./unified-orchestration.md) — architecture overview
