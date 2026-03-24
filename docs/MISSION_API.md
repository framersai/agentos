# mission() API

`mission()` is the intent-driven authoring API in the Unified Orchestration Layer. Instead of declaring nodes and edges, you describe a goal. The PlanningEngine decomposes the goal into an execution graph at runtime.

Use `mission()` when you don't know the exact steps upfront, when you're prototyping, or when the planner should adapt based on what it discovers. When the steps stabilise, call `.toWorkflow()` to export a fixed `CompiledExecutionGraph` and switch to [workflow()](./workflow-dsl.md) or [AgentGraph](./agent-graph.md) for production.

## Quick Start

```typescript
import { mission } from '@framers/agentos/orchestration';
import { z } from 'zod';

const research = mission('deep-research')
  .input(z.object({ topic: z.string() }))
  .goal('Research {{topic}} and produce a structured report with sources')
  .returns(z.object({ report: z.string(), sources: z.array(z.string()) }))
  .planner({ strategy: 'linear', maxSteps: 8 })
  .compile();

const result = await research.invoke({ topic: 'quantum computing' });
```

## Factory Function

```typescript
mission(name: string): MissionBuilder
```

Returns a new `MissionBuilder`. The name is used as the graph's display name and as a prefix for run ids and checkpoint keys.

## Builder API

All methods return `this` for chaining. `.compile()` throws if `input`, `goal`, `returns`, or `planner` are missing.

### .input(schema)

Declares the input schema. Accepts a Zod schema or a plain JSON Schema object.

```typescript
.input(z.object({
  topic: z.string(),
  depth: z.enum(['brief', 'detailed']).default('detailed'),
}))
```

Variables declared in the input schema can be referenced in the goal template via `{{variable}}` syntax.

### .goal(template)

Sets the goal template. The template is a free-form string with optional `{{variable}}` placeholders that are interpolated from the input payload at plan-generation time.

```typescript
.goal('Research {{topic}} at {{depth}} depth and produce a structured report')
```

The PlanningEngine receives the interpolated goal and decomposes it into a sequence of steps. The template is the primary instruction to the planner.

### .returns(schema)

Declares the output schema. Accepts a Zod schema or a plain JSON Schema object.

```typescript
.returns(z.object({
  report: z.string(),
  sources: z.array(z.string()),
  confidence: z.number(),
}))
```

### .planner(config)

Configures the planner that decomposes the goal.

```typescript
.planner({
  strategy: 'linear',   // see strategies below
  maxSteps: 8,          // maximum nodes the planner may generate
})
```

**Planner strategies:**

| Strategy | Description |
|---|---|
| `linear` | Plans steps sequentially, no branching. Fastest, most predictable. |
| `tree` | Generates a branching plan; the runtime selects paths based on intermediate results. |
| `adaptive` | Re-plans after each step based on what was learned. Slowest, most flexible. |
| `critic` | Generates a draft plan, then a critic pass refines it before execution. |
| `hierarchical` | Decomposes goal into sub-goals, each planned independently. |
| `react` | Plans one step at a time in a ReAct loop (plan → act → observe → plan). |

### .policy(config)

Applies mission-level policy overrides to all compiled nodes. Node-level policies take precedence over mission-level policies.

```typescript
.policy({
  guardrails: ['content-safety', 'pii-redaction'],
  memory: {
    consistency: 'snapshot',
    write: { autoEncode: true, type: 'episodic', scope: 'session' },
  },
  onViolation: 'block',
})
```

### .anchor(id, node, constraints)

Splices a pre-built `GraphNode` into the execution order at a precise position. Anchors let you inject validation steps, human checkpoints, or specialised tool calls without modifying the planner output.

```typescript
import { toolNode, humanNode } from '@framers/agentos/orchestration';

mission('research')
  .anchor(
    'source-verify',
    toolNode('citation_checker', {}, { effectClass: 'read' }),
    {
      phase: 'gather',    // inject into the 'gather' phase of the plan
      after: 'search',    // run after the 'search' step
      before: 'summarize', // run before the 'summarize' step
    }
  )
  .anchor(
    'human-review',
    humanNode({ prompt: 'Review the draft before publishing.' }),
    { phase: 'output', after: 'draft' }
  )
```

**Anchor constraints:**

| Field | Description |
|---|---|
| `phase` | The plan phase to inject into (planner-defined: `gather`, `analyze`, `output`, etc.) |
| `after` | Node id this anchor must run after |
| `before` | Node id this anchor must run before |

All constraint fields are optional — an anchor with no constraints is appended at the end.

## Compilation

```typescript
const compiled = mission(...).compile({
  checkpointStore: new SqliteCheckpointStore('./missions.db'), // optional
});
```

`compile()` validates that all required fields are present and returns a `CompiledMission`. The IR is compiled lazily on each invocation, so the same `CompiledMission` always reflects the current builder state.

## Execution

```typescript
// Run to completion
const result = await compiled.invoke({ topic: 'quantum computing' });

// Stream events
for await (const event of compiled.stream({ topic: 'quantum computing' })) {
  console.log(event.type, event.nodeId);
}

// Resume after interruption
const result = await compiled.resume(checkpointId);
```

## Introspection

### explain()

Returns a human-readable execution plan without running the mission. Useful for debugging, testing, and "what will happen" previews in UIs.

```typescript
const { steps, ir } = await compiled.explain({ topic: 'quantum computing' });

console.log(steps);
// [
//   { id: 'plan-1', type: 'gmi', config: { type: 'gmi', instructions: '...' } },
//   { id: 'search-1', type: 'tool', config: { type: 'tool', toolName: 'web_search' } },
//   { id: 'summarize-1', type: 'gmi', config: { ... } },
// ]
```

### toWorkflow() / toIR()

Exports the compiled plan as a static `CompiledExecutionGraph`. Use this to "graduate" a dynamically-planned mission to a fixed workflow once you're satisfied with the plan shape.

```typescript
const ir = compiled.toWorkflow();

// Now wire it directly to GraphRuntime, or use it as a subgraph:
const outerGraph = new AgentGraph(outerState)
  .addNode('research', subgraphNode(ir))
  .compile();
```

## Complete Example — Deep Research Mission

```typescript
import { mission, toolNode, humanNode } from '@framers/agentos/orchestration';
import { SqliteCheckpointStore } from '@framers/agentos/orchestration/checkpoint';
import { z } from 'zod';

const deepResearch = mission('deep-research')
  .input(z.object({
    topic: z.string(),
    depth: z.enum(['brief', 'detailed']).default('detailed'),
  }))
  .goal('Research {{topic}} at {{depth}} depth. Gather diverse sources, evaluate credibility, and produce a structured report with citations.')
  .returns(z.object({
    report: z.string(),
    sources: z.array(z.string()),
    confidence: z.number().min(0).max(1),
  }))
  .planner({
    strategy: 'adaptive',
    maxSteps: 12,
  })
  .policy({
    guardrails: ['grounding-guard', 'pii-redaction'],
    onViolation: 'warn',
    memory: {
      consistency: 'snapshot',
      write: { autoEncode: true, type: 'semantic', scope: 'session' },
    },
  })

  // Inject a citation-verification step after any search phase node
  .anchor(
    'verify-sources',
    toolNode('citation_checker', { timeout: 15_000 }, { effectClass: 'read' }),
    { phase: 'gather', after: 'search' }
  )

  // Require human review before final output
  .anchor(
    'human-review',
    humanNode({ prompt: 'Review the draft report. Approve to publish.' }),
    { phase: 'output', before: 'finalize' }
  )

  .compile({
    checkpointStore: new SqliteCheckpointStore('./research.db'),
  });

// Inspect the plan before running
const { steps } = await deepResearch.explain({ topic: 'quantum computing', depth: 'detailed' });
console.log(`Plan has ${steps.length} steps:`);
steps.forEach((s, i) => console.log(`  ${i + 1}. [${s.type}] ${s.id}`));

// Run
const result = await deepResearch.invoke({ topic: 'quantum computing', depth: 'detailed' });
console.log(result.report);

// Stream with progress
for await (const event of deepResearch.stream({ topic: 'AI safety', depth: 'brief' })) {
  if (event.type === 'node_start') console.log(`Running: ${event.nodeId}`);
}

// Graduate to a static workflow once the plan shape is stable
const staticIR = deepResearch.toWorkflow();
// Save staticIR to a file or pass directly to AgentGraph as a subgraph
```

## See Also

- [AgentGraph](./agent-graph.md) — for explicit graph control
- [workflow() DSL](./workflow-dsl.md) — for deterministic DAG pipelines
- [Checkpointing](./checkpointing.md) — ICheckpointStore, resume semantics
- [Unified Orchestration](./unified-orchestration.md) — architecture overview
