# Unified Orchestration Layer

The AgentOS Unified Orchestration Layer gives you one runtime, three authoring APIs, and five capabilities no other framework offers.

> Runtime status note:
> The compiled IR, builders, checkpointing, and base graph runtime are real and usable today.
> Some advanced routing/execution paths are still partial in the shared runtime:
> discovery edges currently fall back when capability discovery is not wired,
> personality edges still use default branch behavior unless a trait source is injected,
> and `extension` / `subgraph` execution requires a bridge runtime rather than the bare `NodeExecutor`.

## The Problem It Solves

Before this layer, AgentOS had all the right primitives — a ReAct loop, a DAG workflow engine, a planning engine, capability discovery, cognitive memory, personality modeling, and guardrails — but they were fragmented across disconnected runtimes:

| Component | Location | Problem |
|---|---|---|
| ReAct loop | `GMI.ts` | Hardcoded `safetyBreak < 5`, no external composability |
| DAG workflows | `WorkflowEngine.ts` | Separate state machine, no memory access |
| Planning engine | `PlanningEngine.ts` | In-memory checkpoint Map, not wired to workflows |
| Capability discovery | `CapabilityDiscoveryEngine.ts` | Only accessible via TurnPlanner |
| Guardrails | `GuardrailEngine.ts` | Only on final input/output, not between steps |

A workflow task couldn't use capability discovery. A GMI node couldn't participate in a DAG. Guardrails couldn't run between workflow steps. Memory reads couldn't influence routing.

## Architecture

All three authoring APIs compile to the same `CompiledExecutionGraph` IR, which one `GraphRuntime` executes:

```
mission('goal')          workflow('name')         AgentGraph<S>()
  .goal(...)               .step().then()           .addNode()
  .returns(z)              .branch()                .addEdge()
  .anchor(...)             .parallel()              .addConditionalEdge()
       |                        |                        |
       +------------+-----------+------------------------+
                    |
                    v
          CompiledExecutionGraph (IR)
          +-------------------------------+
          | nodes: GraphNode[]            |  node types: gmi | tool | extension |
          | edges: GraphEdge[]            |  human | guardrail | router | subgraph
          | stateSchema: JSONSchema       |
          | checkpointPolicy: ...         |  edge types: static | conditional |
          | memoryPolicy: ...             |  discovery | personality
          | reducers: StateReducers       |
          +---------------+---------------+
                          |
                          v
                GraphRuntime (single executor)
                +-- LoopController
                +-- ICheckpointStore (persistent)
                +-- StreamingManager
                +-- ToolOrchestrator
                +-- GuardrailEngine
                +-- CapabilityDiscoveryEngine
                +-- CognitiveMemoryManager
```

## Three APIs at a Glance

### AgentGraph — Full Graph Control

Explicit nodes, edges, cycles, and subgraphs. Use this when you need the full graph model: conditional routing with arbitrary logic, agent loops that cycle back, memory-aware state machines, and personality-driven branching.

```typescript
import { AgentGraph, START, END, gmiNode, toolNode } from '@framers/agentos/orchestration';

const graph = new AgentGraph({ input: z.object({ topic: z.string() }), ... })
  .addNode('search', toolNode('web_search'))
  .addNode('summarize', gmiNode({ instructions: 'Summarize the results.' }))
  .addEdge(START, 'search')
  .addEdge('search', 'summarize')
  .addEdge('summarize', END)
  .compile();

const result = await graph.invoke({ topic: 'quantum computing' });
```

**When to use**: Custom agent architectures, cyclic agent loops, subgraph composition, discovery-based routing.

### workflow() — Deterministic DAG

Fluent DSL for sequential pipelines with branching and parallelism. Every workflow is a strict DAG — cycles are caught at compile time. All GMI steps default to `single_turn` to keep execution deterministic and cost-bounded.

```typescript
import { workflow } from '@framers/agentos/orchestration';

const wf = workflow('onboarding')
  .input(z.object({ userId: z.string() }))
  .returns(z.object({ welcomed: z.boolean() }))
  .step('fetch-user', { tool: 'get_user' })
  .step('send-email', { tool: 'send_email', effectClass: 'external' })
  .compile();
```

**When to use**: ETL pipelines, multi-step processing, onboarding flows, anything with a clear start-to-end shape.

### mission() — Intent-Driven Orchestration

Describe what you want to achieve and let the mission compiler generate the current stub graph shape for you. Today that means a fixed phase-ordered mission skeleton with your goal preserved in generated reasoning nodes, plus any anchors and mission-level policies you attach.

```typescript
import { mission } from '@framers/agentos/orchestration';

const m = mission('deep-research')
  .input(z.object({ topic: z.string() }))
  .goal('Research {{topic}} and produce a structured report')
  .returns(z.object({ report: z.string() }))
  .planner({ strategy: 'linear', maxSteps: 8 })
  .compile();
```

**When to use**: Goal-first authoring, rapid prototyping around anchors and policies, and cases where you want a forward-compatible mission API even though planner-driven graph shaping is still partial.

### Decision Guide

| Situation | Use |
|---|---|
| Exact steps known upfront | `workflow()` |
| Steps known but complex branching needed | `AgentGraph` |
| Goal-first authoring with a fixed mission skeleton today | `mission()` |
| Need agent loops / cycles | `AgentGraph` |
| Cost-bounded, deterministic | `workflow()` |
| Prototype quickly, then reuse the generated IR directly | `mission()` → `toWorkflow()` |

## Five Differentiators

These capabilities are not available in LangGraph or Mastra:

### 1. Memory-Aware State

Cognitive memory (episodic, semantic, procedural, prospective) is a first-class graph citizen. Nodes declare `MemoryPolicy` to read traces before execution and write traces after:

```typescript
gmiNode(
  { instructions: 'Answer based on past interactions.' },
  {
    memory: {
      consistency: 'snapshot',
      read: { types: ['episodic'], semanticQuery: '{input.topic}', maxTraces: 5 },
      write: { autoEncode: true, type: 'episodic', scope: 'session' },
    },
  }
)
```

### 2. Capability Discovery Routing

Edges can declare discovery intent and route via semantic search over the capability registry:

```typescript
graph.addDiscoveryEdge('router', {
  query: 'find a tool that can search the web',
  kind: 'tool',
  fallbackTarget: 'default-search',
});
```

### 3. Personality-Driven Routing

Agent HEXACO/PAD personality traits can influence routing decisions without any conditional logic in your code:

```typescript
graph.addPersonalityEdge('draft', {
  trait: 'conscientiousness',
  threshold: 0.7,
  above: 'human-review',  // careful agents request review
  below: END,             // relaxed agents ship directly
});
```

### 4. Inter-Step Guardrails

Guardrails run on node inputs, node outputs, and on edges between steps — not just on final output:

```typescript
toolNode('web_search', {}, {
  guardrails: {
    output: ['pii-redaction', 'content-safety'],
    onViolation: 'sanitize',
  },
})
```

### 5. Checkpointing and Time-Travel

Every run can be checkpointed, resumed after failure, and forked to explore alternative execution paths:

```typescript
const graph = new AgentGraph(...)
  .compile({ checkpointStore: new SqliteCheckpointStore('./runs.db') });

// Resume after crash
const result = await graph.resume(checkpointId);

// Fork from a past checkpoint with patched state
const newRunId = await store.fork(checkpointId, { scratch: { confidence: 0.9 } });
```

## Detailed Guides

- [AgentGraph](./agent-graph.md) — Full API reference, node builders, edge types, subgraph composition
- [workflow() DSL](./workflow-dsl.md) — Sequential pipelines, branching, parallel execution
- [mission() API](./mission-api.md) — Intent-driven orchestration, planners, anchors
- [Checkpointing](./checkpointing.md) — ICheckpointStore, resume semantics, time-travel
