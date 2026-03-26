# Orchestration — Graphs, Workflows, and Missions

> One runtime, three authoring APIs. Pick the level of control you need.

---

## Table of Contents

1. [Overview](#overview)
2. [AgentGraph — Full Graph Builder](#agentgraph--full-graph-builder)
3. [WorkflowBuilder — Sequential Pipelines](#workflowbuilder--sequential-pipelines)
4. [MissionBuilder — Goal-Oriented Execution](#missionbuilder--goal-oriented-execution)
5. [Voice Nodes in Graphs](#voice-nodes-in-graphs)
6. [Checkpointing and Resume](#checkpointing-and-resume)
7. [GraphEvent Streaming](#graphevent-streaming)
8. [YAML Workflow Authoring](#yaml-workflow-authoring)
9. [Choosing the Right API](#choosing-the-right-api)

---

## Overview

All three authoring APIs compile to the same `CompiledExecutionGraph` IR and
run on the same `GraphRuntime`. You can compose them freely — a mission can
embed a workflow as a subgraph step; a graph can call a compiled workflow node.

```
AgentGraph   — explicit nodes + edges, supports cycles
workflow()   — strict DAG with sequential steps and parallel joins
mission()    — goal-first, planner-controlled step generation
     ↓ compile()
CompiledExecutionGraph (IR)
     ↓
GraphRuntime.invoke() / .stream() / .resume()
```

**Node types available in all three APIs:**

| Builder | Purpose |
|---------|---------|
| `gmiNode()` | LLM call (ReAct loop, single-turn, or planner-controlled) |
| `toolNode()` | Invoke a registered `ITool` by name |
| `humanNode()` | Suspend and wait for a human operator |
| `voiceNode()` | Voice pipeline (STT → LLM → TTS) |

---

## AgentGraph — Full Graph Builder

Use `AgentGraph` when you need cycles, complex conditional routing, or
full control over graph topology.

### Minimal Example

```typescript
import { AgentGraph, START, END, gmiNode, toolNode } from '@framers/agentos/orchestration';
import { z } from 'zod';

const graph = new AgentGraph(
  {
    input:     z.object({ topic: z.string() }),
    scratch:   z.object({ sources: z.array(z.string()).default([]) }),
    artifacts: z.object({ summary: z.string().default('') }),
  },
  { reducers: { 'scratch.sources': 'concat' } },
)
  .addNode('search',    toolNode('web_search'))
  .addNode('summarize', gmiNode({ instructions: 'Summarize the search results in 3 sentences.' }))
  .addEdge(START, 'search')
  .addEdge('search', 'summarize')
  .addEdge('summarize', END)
  .compile();

const result = await graph.invoke({ topic: 'quantum computing' });
console.log(result.artifacts.summary);
```

### Conditional Routing

```typescript
import { AgentGraph, START, END, gmiNode, toolNode, routerNode } from '@framers/agentos/orchestration';
import { z } from 'zod';

const graph = new AgentGraph({
  input:     z.object({ query: z.string() }),
  scratch:   z.object({ intent: z.string().default('') }),
  artifacts: z.object({ answer: z.string().default('') }),
})
  .addNode('classify', gmiNode({
    instructions: 'Classify the query as "factual", "creative", or "code". Reply with only the label.',
  }))
  .addNode('factual',  toolNode('web_search'))
  .addNode('creative', gmiNode({ instructions: 'Write a creative response.' }))
  .addNode('code',     gmiNode({ instructions: 'Write and explain code.' }))
  .addEdge(START, 'classify')
  .addConditionalEdge('classify', (state) => state.scratch.intent, {
    factual:  'factual',
    creative: 'creative',
    code:     'code',
  })
  .addEdge('factual',  END)
  .addEdge('creative', END)
  .addEdge('code',     END)
  .compile();
```

### Agent Loop with Cycle

```typescript
// Research loop: search → evaluate → (done | search again)
const graph = new AgentGraph({
  input:     z.object({ question: z.string() }),
  scratch:   z.object({ iterations: z.number().default(0), found: z.boolean().default(false) }),
  artifacts: z.object({ answer: z.string().default('') }),
})
  .addNode('search',   toolNode('web_search'))
  .addNode('evaluate', gmiNode({ instructions: 'Is this enough to answer the question? Respond "yes" or "no".' }))
  .addEdge(START, 'search')
  .addEdge('search', 'evaluate')
  .addConditionalEdge('evaluate', (state) => {
    if (state.scratch.found || state.scratch.iterations >= 3) return 'done';
    return 'continue';
  }, {
    done:     END,
    continue: 'search',   // cycles back
  })
  .compile();
```

### Node Configuration

Every node builder accepts an optional `policies` object:

```typescript
gmiNode(
  {
    instructions: 'Summarize the document.',
    executionMode: 'react_bounded',   // default
    maxInternalIterations: 5,
    maxTokens: 2048,
    temperature: 0.3,
  },
  {
    memory: {
      consistency: 'snapshot',
      read:  { types: ['semantic'], semanticQuery: '{input.topic}', maxTraces: 10 },
      write: { autoEncode: true, type: 'episodic', scope: 'session' },
    },
    guardrails: { output: ['content-safety'], onViolation: 'block' },
    checkpoint: 'after',
  }
)
```

**Execution modes for `gmiNode`:**

| Mode | Description |
|------|-------------|
| `single_turn` | One LLM call, no internal tool loop. Used in `workflow()` |
| `react_bounded` | ReAct loop up to `maxInternalIterations` (default, `AgentGraph`) |
| `planner_controlled` | PlanningEngine drives the loop (`mission()`) |

---

## WorkflowBuilder — Sequential Pipelines

Use `workflow()` for deterministic pipelines where steps are known upfront.
Cycles are rejected at compile time.

### Quick Start

```typescript
import { workflow } from '@framers/agentos/orchestration';
import { z } from 'zod';

const pipeline = workflow('content-pipeline')
  .input(z.object({ url: z.string() }))
  .returns(z.object({ summary: z.string(), tags: z.array(z.string()) }))
  .step('fetch',     { tool: 'web_fetch', effectClass: 'external' })
  .step('summarize', { gmi: { instructions: 'Summarize in 3 sentences.' } })
  .step('tag',       { gmi: { instructions: 'Extract 5 topic tags as a JSON array.' } })
  .compile();

const result = await pipeline.invoke({ url: 'https://example.com/article' });
console.log(result.summary);
console.log(result.tags);
```

### Branching

```typescript
workflow('triage')
  .input(z.object({ ticket: z.string() }))
  .returns(z.object({ response: z.string() }))
  .step('classify', { gmi: { instructions: 'Classify as "billing", "technical", or "general".' } })
  .branch(
    (state) => state.scratch.classification,
    {
      billing:   (wf) => wf.step('billing-agent',   { gmi: { instructions: 'Handle billing issue.' } }),
      technical: (wf) => wf.step('technical-agent', { gmi: { instructions: 'Solve technical issue.' } }),
      general:   (wf) => wf.step('general-agent',   { gmi: { instructions: 'Handle general inquiry.' } }),
    }
  )
  .compile();
```

### Parallel Steps

```typescript
workflow('multi-source-research')
  .input(z.object({ query: z.string() }))
  .returns(z.object({ report: z.string() }))
  .parallel(
    { reducers: { 'scratch.results': 'concat' } },
    (wf) => wf.step('web',    { tool: 'web_search' }),
    (wf) => wf.step('news',   { tool: 'news_search' }),
    (wf) => wf.step('papers', { tool: 'arxiv_search' }),
  )
  .step('synthesize', { gmi: { instructions: 'Synthesize all sources into a report.' } })
  .compile();
```

### Human-in-the-Loop Step

```typescript
workflow('content-approval')
  .input(z.object({ brief: z.string() }))
  .returns(z.object({ publishedPost: z.string() }))
  .step('draft',   { gmi: { instructions: 'Write a blog post draft.' } })
  .step('approve', { human: { prompt: 'Review the draft. Approve or request changes.' } })
  .step('publish', { tool: 'cms_publish' })
  .compile();
```

---

## MissionBuilder — Goal-Oriented Execution

Use `mission()` when the execution path should emerge from a goal, not be
declared upfront. The PlanningEngine decomposes the goal into steps at runtime.

### Quick Start

```typescript
import { mission } from '@framers/agentos/orchestration';
import { z } from 'zod';

const researchMission = mission('research')
  .input(z.object({ topic: z.string() }))
  .goal('Research {{topic}} and produce a concise 3-paragraph summary with citations.')
  .returns(z.object({ summary: z.string(), citations: z.array(z.string()) }))
  .planner({ strategy: 'linear', maxSteps: 8 })
  .policy({ guardrails: ['content-safety'] })
  .compile();

const result = await researchMission.invoke({ topic: 'quantum error correction' });
console.log(result.summary);
```

### Planner Strategies

```typescript
.planner({
  strategy: 'linear',   // 'linear' | 'tree' | 'react'
  maxSteps: 10,
  maxIterations: 3,     // retry budget per step
})
```

| Strategy | Description |
|----------|-------------|
| `linear` | Sequential plan — each step feeds the next |
| `tree` | Tree-of-thought — explores multiple paths |
| `react` | ReAct-style — observe-think-act loop |

### Anchor Nodes

Inject fixed logic at specific positions in the planner's output:

```typescript
mission('audited-research')
  .input(z.object({ topic: z.string() }))
  .goal('Research {{topic}} thoroughly.')
  .returns(z.object({ report: z.string() }))
  .anchor({ position: 'before_first', node: humanNode({ prompt: 'Approve the research topic?' }) })
  .anchor({ position: 'after_last',   node: toolNode('report_publisher') })
  .compile();
```

---

## Voice Nodes in Graphs

Embed full voice pipeline turns directly in a graph:

```typescript
import { AgentGraph, START, END, voiceNode, gmiNode } from '@framers/agentos/orchestration';
import { z } from 'zod';

const callGraph = new AgentGraph({
  input:     z.object({ callerId: z.string() }),
  scratch:   z.object({ transcript: z.string().default('') }),
  artifacts: z.object({ resolution: z.string().default('') }),
})
  .addNode(
    'listen',
    voiceNode('listen', {
      mode: 'conversation',
      maxTurns: 10,
      sttProvider: 'deepgram',
      ttsProvider: 'elevenlabs',
    })
      .on('completed',   'resolve')
      .on('interrupted', 'listen')   // barge-in restarts the node
      .on('hangup',      'cleanup')
      .build()
  )
  .addNode('resolve',  gmiNode({ instructions: 'Determine the resolution based on the transcript.' }))
  .addNode('cleanup',  toolNode('close_ticket'))
  .addEdge(START, 'listen')
  .addEdge('resolve', END)
  .addEdge('cleanup', END)
  .compile();
```

**Voice node options:**

| Option | Type | Description |
|--------|------|-------------|
| `mode` | `'single_turn' \| 'conversation'` | One exchange vs. multi-turn dialogue |
| `maxTurns` | `number` | Hard cap on dialogue turns |
| `sttProvider` | `string` | Override global STT provider for this node |
| `ttsProvider` | `string` | Override global TTS provider for this node |
| `bargeIn` | `boolean` | Allow user to interrupt TTS playback |

---

## Checkpointing and Resume

Any compiled graph supports durable checkpoints. The default store is
in-memory; swap in a persistent store for production.

```typescript
import { InMemoryCheckpointStore } from '@framers/agentos/orchestration/checkpoint';

const store = new InMemoryCheckpointStore();

const graph = new AgentGraph({ ... })
  .addNode(...)
  .compile({ checkpointStore: store, checkpointPolicy: 'every_node' });

// First run — save a run ID
const runId = 'run-abc-123';
try {
  await graph.invoke({ topic: 'fusion energy' }, { runId });
} catch (err) {
  console.error('Run failed mid-way, will resume later.');
}

// Resume from the last saved checkpoint
const resumed = await graph.resume(runId);
console.log(resumed.artifacts);
```

**Checkpoint policies:**

| Policy | Description |
|--------|-------------|
| `'none'` | No checkpoints (default) |
| `'every_node'` | Checkpoint after each node completes |
| `'explicit'` | Checkpoint only at nodes with `checkpoint: 'after'` in their policy |

**Time-travel / fork:**

```typescript
// Fork from a historical checkpoint, patching state
const forkedRunId = await store.fork(checkpointId, {
  scratch: { iterations: 0 },
});
const result = await graph.resume(forkedRunId);
```

---

## GraphEvent Streaming

Stream events as the graph executes — useful for real-time UI updates,
logging, and debugging:

```typescript
const stream = graph.stream({ topic: 'AI safety' });

for await (const event of stream) {
  switch (event.type) {
    case 'node_started':
      console.log(`→ ${event.nodeId} started`);
      break;
    case 'node_completed':
      console.log(`✓ ${event.nodeId} completed in ${event.durationMs}ms`);
      break;
    case 'text_delta':
      process.stdout.write(event.delta);
      break;
    case 'tool_call':
      console.log(`  tool: ${event.toolName}(${JSON.stringify(event.args)})`);
      break;
    case 'graph_completed':
      console.log('\nFinal artifacts:', event.artifacts);
      break;
    case 'graph_error':
      console.error('Graph failed:', event.error);
      break;
  }
}
```

**Event types:**

| Event | Payload |
|-------|---------|
| `node_started` | `{ nodeId, nodeType }` |
| `node_completed` | `{ nodeId, durationMs, output }` |
| `text_delta` | `{ delta, nodeId }` |
| `tool_call` | `{ toolName, args, nodeId }` |
| `tool_result` | `{ toolName, result, nodeId }` |
| `checkpoint_saved` | `{ checkpointId, runId, nodeId }` |
| `graph_completed` | `{ artifacts, durationMs }` |
| `graph_error` | `{ error, nodeId? }` |

---

## YAML Workflow Authoring

For non-TypeScript environments, workflows can be declared as YAML and
compiled at load time:

```yaml
# workflows/summarize.yaml
name: summarize-article
input:
  schema:
    type: object
    properties:
      url: { type: string }
    required: [url]
returns:
  schema:
    type: object
    properties:
      summary: { type: string }
      tags: { type: array, items: { type: string } }

steps:
  - id: fetch
    tool: web_fetch
    effectClass: external

  - id: summarize
    gmi:
      instructions: Summarize the article in 3 sentences.
    memory:
      read:
        types: [semantic]
        maxTraces: 5

  - id: tag
    gmi:
      instructions: Extract 5 topic tags as a JSON array.
```

Load and run:

```typescript
import { loadWorkflowFromYaml } from '@framers/agentos/orchestration';
import { readFileSync } from 'fs';

const yaml = readFileSync('./workflows/summarize.yaml', 'utf8');
const wf = await loadWorkflowFromYaml(yaml);

const result = await wf.invoke({ url: 'https://example.com/article' });
```

---

## Choosing the Right API

| If you need... | Use |
|----------------|-----|
| Known steps in a fixed order | `workflow()` |
| Conditional branching or cycles | `AgentGraph` |
| The agent to figure out its own steps | `mission()` |
| Multiple specialized agents | `agency()` |
| One-off LLM call | `generateText()` / `streamText()` |

---

## Related Guides

- [AGENT_GRAPH.md](./AGENT_GRAPH.md) — complete `AgentGraph` reference
- [WORKFLOW_DSL.md](./WORKFLOW_DSL.md) — complete `workflow()` reference
- [MISSION_API.md](./MISSION_API.md) — complete `mission()` reference
- [CHECKPOINTING.md](./CHECKPOINTING.md) — checkpointing internals and custom stores
- [UNIFIED_ORCHESTRATION.md](./UNIFIED_ORCHESTRATION.md) — shared IR and runtime details
- [HUMAN_IN_THE_LOOP.md](./HUMAN_IN_THE_LOOP.md) — HITL patterns and approval workflows
