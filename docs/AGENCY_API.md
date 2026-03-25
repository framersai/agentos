# Agency API

`agency()` is the high-level multi-agent factory in AgentOS.  It coordinates a
named roster of sub-agents under a chosen orchestration strategy and returns a
single `Agent`-compatible interface so callers can swap a single agent for an
entire team without changing call sites.

---

## Table of Contents

1. [API Hierarchy](#api-hierarchy)
2. [Minimal Example](#minimal-example)
3. [Orchestration Strategies](#orchestration-strategies)
4. [Adaptive Mode](#adaptive-mode)
5. [Emergent Agent Creation](#emergent-agent-creation)
6. [Human-in-the-Loop (HITL)](#human-in-the-loop-hitl)
7. [Memory and RAG](#memory-and-rag)
8. [Voice and Channels](#voice-and-channels)
9. [Guardrails and Security](#guardrails-and-security)
10. [Permissions](#permissions)
11. [Resource Controls](#resource-controls)
12. [Observability and Callbacks](#observability-and-callbacks)
13. [Structured Output with Zod](#structured-output-with-zod)
14. [Nested Agencies](#nested-agencies)
15. [Full-Featured Example](#full-featured-example)

---

## API Hierarchy

AgentOS exposes a layered public API.  Each layer adds coordination features
on top of the one below it.

```
generateText()     — single stateless LLM call, no history
  └── agent()      — stateful multi-turn session, optional tools
        └── agency()   — multi-agent team with orchestration strategy
              └── workflow()   — imperative DAG of agency runs
                    └── AgentGraph  — programmatic graph builder (advanced)
```

Use the lowest layer that satisfies your requirements:

| Entry point | Adds over previous | Best for |
|---|---|---|
| `generateText()` | Nothing — raw call | One-shot prompts, evals |
| `streamText()` | Streaming tokens | Chat UIs, long responses |
| `generateImage()` | Image generation | Visuals, multi-modal pipelines |
| `agent()` | Session history, tools | Single-agent assistants |
| `agency()` | Multi-agent orchestration, HITL, guardrails, controls | Research pipelines, content teams, autonomous workflows |
| `workflow()` | Imperative DAG sequencing of agencies | Multi-stage pipelines with branching logic |
| `AgentGraph` | Programmatic graph construction + edge callbacks | Custom topologies, dynamic routing |

---

## Minimal Example

Three lines to create and run a two-agent research pipeline:

```typescript
import { agency } from '@framers/agentos';

const team = agency({
  agents: {
    researcher: { instructions: 'Find relevant facts.' },
    writer:     { instructions: 'Write a clear, concise summary.' },
  },
  strategy: 'sequential',
});

const result = await team.generate('Summarise recent advances in fusion energy.');
console.log(result.text);
```

Set `OPENAI_API_KEY` (or another provider's key) and the agency auto-detects
the provider.  Pass `model: 'openai:gpt-4o'` or `provider: 'anthropic'` to
control the model explicitly.

---

## Orchestration Strategies

### sequential (default)

Agents run one after another.  Each agent receives the previous agent's output
as context, forming a progressive refinement chain.

```typescript
const pipeline = agency({
  model: 'openai:gpt-4o',
  agents: {
    researcher: { instructions: 'Gather facts on the topic.' },
    editor:     { instructions: 'Edit for clarity and concision.' },
    reviewer:   { instructions: 'Check tone and factual accuracy.' },
  },
  strategy: 'sequential',
});

const { text, agentCalls } = await pipeline.generate('Write about quantum computing.');
console.log(agentCalls.length); // 3 — one record per agent
```

### parallel

All agents run concurrently.  Their outputs are merged by a synthesis step that
uses the agency-level `model`.  Requires `model` or `provider` at the agency
level.

```typescript
const panel = agency({
  model: 'openai:gpt-4o',
  agents: {
    optimist:  { instructions: 'Argue in favour.' },
    pessimist: { instructions: 'Argue against.' },
    neutral:   { instructions: 'Give a balanced view.' },
  },
  strategy: 'parallel',
});

const { text } = await panel.generate('Should AI systems have legal rights?');
```

### debate

Agents argue and refine a shared answer over multiple rounds.  The number of
rounds is controlled by `maxRounds` (default: 3).  Requires an agency-level
`model` for the synthesis step.

```typescript
const debaters = agency({
  model: 'openai:gpt-4o',
  agents: {
    proponent: { instructions: 'Defend your position vigorously.' },
    critic:    { instructions: 'Challenge every claim you hear.' },
  },
  strategy: 'debate',
  maxRounds: 4,
});

const { text } = await debaters.generate('Is remote work better than in-office?');
```

### review-loop

One agent produces output; another reviews it and requests revisions.  The loop
continues until the reviewer is satisfied or `maxRounds` is reached.

```typescript
const loop = agency({
  model: 'openai:gpt-4o-mini',
  agents: {
    drafter:  { instructions: 'Draft a press release.' },
    reviewer: { instructions: 'Review for brand voice and accuracy. Request changes if needed.' },
  },
  strategy: 'review-loop',
  maxRounds: 3,
});

const { text } = await loop.generate('Announce our new product launch.');
```

### hierarchical

A coordinator agent dispatches sub-tasks to specialist agents via tool calls.
The coordinator decides which agents to invoke and in what order at runtime.
Required for emergent agent synthesis.

```typescript
const team = agency({
  model: 'openai:gpt-4o',
  agents: {
    researcher: { instructions: 'Find factual information.' },
    coder:      { instructions: 'Write and explain code.' },
    writer:     { instructions: 'Produce polished prose.' },
  },
  strategy: 'hierarchical',
});

const { text } = await team.generate('Explain and demonstrate the quicksort algorithm.');
```

---

## Adaptive Mode

Set `adaptive: true` to let the orchestrator choose the best strategy at
runtime based on task complexity signals.  The default strategy acts as a
hint; the coordinator may override it.

```typescript
const smart = agency({
  model: 'openai:gpt-4o',
  agents: {
    analyst:  { instructions: 'Analyse data and trends.' },
    reporter: { instructions: 'Write clear reports.' },
  },
  strategy: 'sequential', // default hint
  adaptive: true,          // may switch to hierarchical if the task is complex
});

const { text } = await smart.generate('Analyse this dataset and write a report.');
```

Adaptive mode is also the second way to unlock emergent agent synthesis (the
first is `strategy: 'hierarchical'`).

---

## Emergent Agent Creation

When enabled, the orchestrator may synthesise new specialist agents at runtime
to handle tasks not covered by the statically defined roster.  Emergent agents
are subject to HITL approval when `hitl.approvals.beforeEmergent` is set.

Emergent requires either `strategy: 'hierarchical'` or `adaptive: true`.

```typescript
const adaptive = agency({
  model: 'openai:gpt-4o',
  agents: {
    generalist: { instructions: 'Handle most tasks.' },
  },
  strategy: 'hierarchical',
  emergent: {
    enabled: true,
    tier: 'session',   // 'session' | 'agent' | 'shared'
    judge: true,       // a separate judge agent evaluates emergent agents before use
  },
});
```

| `tier` | Lifetime of synthesised agents |
|---|---|
| `"session"` | Discarded when the `generate()` call ends |
| `"agent"` | Persist for the lifetime of the agency instance |
| `"shared"` | Persist globally across all agency instances |

---

## Human-in-the-Loop (HITL)

Gate any lifecycle point behind an async approval handler.

### Built-in handlers

```typescript
import { hitl } from '@framers/agentos';

hitl.autoApprove()                      // always approve — use in tests / CI
hitl.autoReject('dry-run mode')         // always reject with an optional reason
hitl.cli()                              // interactive stdin/stdout prompt
hitl.webhook('https://my-service/ok')   // POST to an HTTP endpoint
hitl.slack({ channel: '#approvals', token: process.env.SLACK_BOT_TOKEN })
```

### Approval triggers

```typescript
const guarded = agency({
  model: 'openai:gpt-4o',
  agents: { worker: { instructions: 'Execute tasks.' } },
  hitl: {
    approvals: {
      beforeTool:             ['delete-record', 'send-email'],
      beforeAgent:            ['financial-agent'],
      beforeEmergent:         true,
      beforeReturn:           true,
      beforeStrategyOverride: true,
    },
    handler: hitl.autoApprove(), // replace with hitl.cli() in production
    timeoutMs:  30_000,
    onTimeout:  'reject',        // 'reject' | 'approve' | 'error'
  },
});
```

### Custom handler

```typescript
const custom = agency({
  agents: { worker: { instructions: 'Do work.' } },
  hitl: {
    approvals: { beforeReturn: true },
    handler: async (request) => {
      // request.type, request.agent, request.action, request.description
      const ok = await myApprovalDatabase.lookup(request.id);
      return {
        approved: ok,
        reason: ok ? 'Approved by policy' : 'Blocked by policy',
        modifications: ok ? undefined : { output: '[redacted]' },
      };
    },
  },
});
```

---

## Memory and RAG

### Shared conversation memory

```typescript
const remembering = agency({
  model: 'openai:gpt-4o',
  agents: {
    a: { instructions: 'Agent A.' },
    b: { instructions: 'Agent B.' },
  },
  strategy: 'sequential',
  memory: {
    shared: true,             // all agents share one memory store
    types: ['episodic', 'semantic'],
    working: { enabled: true, maxTokens: 4096, strategy: 'sliding-window' },
    consolidation: { enabled: true, interval: 'PT1H' },
  },
});
```

### RAG configuration

```typescript
const withRag = agency({
  model: 'openai:gpt-4o',
  agents: {
    retriever: { instructions: 'Find relevant context from the knowledge base.' },
    answerer:  { instructions: 'Answer based on retrieved context.' },
  },
  strategy: 'sequential',
  rag: {
    vectorStore: {
      provider: 'in-memory',
      embeddingModel: 'text-embedding-3-small',
    },
    documents: [
      { path: './docs/manual.pdf', loader: 'pdf' },
      { url: 'https://example.com/spec.html', loader: 'html' },
    ],
    topK: 5,
    minScore: 0.75,
    graphRag: { enabled: true },
    agentAccess: {
      answerer: { topK: 10, collections: ['manuals'] },
    },
  },
});
```

---

## Voice and Channels

### Voice pipeline

When `voice.enabled` is `true` the agency exposes a `listen()` method that
starts a local WebSocket server.  Callers receive the bound port and URL and can
connect any audio client.  The full STT → LLM → TTS pipeline is provided by
`src/voice-pipeline/`; the agency wires `generate()` as the LLM backend.

```typescript
const voiceAgent = agency({
  model: 'openai:gpt-4o',
  agents: { assistant: { instructions: 'You are a helpful voice assistant.' } },
  voice: {
    enabled:     true,
    transport:   'streaming',
    stt:         'deepgram',
    tts:         'elevenlabs',
    ttsVoice:    'rachel',
    endpointing: 'silero-vad',
    bargeIn:     'threshold',
    language:    'en-US',
  },
});

// Bind to an OS-assigned port; connect audio clients to the returned URL.
const server = await voiceAgent.listen();
console.log(`Voice WS server ready at ${server.url}`);
// ...
await server.close();
```

Requires the `ws` package (`npm install ws`).

### Channel adapters

When `channels` contains at least one entry the agency exposes a `connect()`
method.  Calling it logs each configured channel and defers real adapter
initialisation to the runtime.  Full adapter wiring (Discord, Telegram, Slack,
etc.) is handled by the channel adapter infrastructure in
`src/channels/`; `connect()` is the hook point for that wiring.

```typescript
const social = agency({
  model: 'openai:gpt-4o',
  agents: { community: { instructions: 'Engage helpfully with community messages.' } },
  channels: {
    discord:  { token: process.env.DISCORD_BOT_TOKEN, guildId: '...' },
    telegram: { token: process.env.TELEGRAM_BOT_TOKEN },
    slack:    { token: process.env.SLACK_BOT_TOKEN, signingSecret: '...' },
  },
});

await social.connect(); // logs each channel; real adapter connection is a follow-up
```

---

## Guardrails and Security

### Shorthand (applies to both input and output)

```typescript
const safe = agency({
  model: 'openai:gpt-4o',
  agents: { assistant: { instructions: 'Be helpful.' } },
  guardrails: ['pii-redaction', 'toxicity-filter', 'grounding-guard'],
});
```

### Structured guardrails config

```typescript
const audited = agency({
  model: 'openai:gpt-4o',
  agents: { assistant: { instructions: 'Be helpful.' } },
  guardrails: {
    input:  ['injection-shield', 'pii-redaction'],
    output: ['grounding-guard', 'code-safety'],
    tier:   'strict',
  },
  security: { tier: 'balanced' }, // 'dangerous'|'permissive'|'balanced'|'strict'|'paranoid'
});
```

### Security tiers

| Tier | Description |
|---|---|
| `"dangerous"` | No restrictions — internal trusted pipelines only |
| `"permissive"` | Most capabilities on; network + filesystem allowed |
| `"balanced"` | Sensible defaults; destructive actions require approval |
| `"strict"` | Read-only filesystem, no shell spawn, narrow tool allow-list |
| `"paranoid"` | Minimal surface; all side-effecting tools blocked |

---

## Permissions

```typescript
const restricted = agency({
  model: 'openai:gpt-4o',
  agents: { analyst: { instructions: 'Analyse data.' } },
  permissions: {
    tools:          ['read-file', 'query-db'],  // explicit allow-list
    network:        false,
    filesystem:     true,
    spawn:          false,
    requireApproval: ['delete-record'],          // these still need HITL
  },
});
```

---

## Resource Controls

Hard and soft limits on token spend, duration, and call counts.

```typescript
const budgeted = agency({
  model: 'openai:gpt-4o',
  agents: {
    a: { instructions: 'Step 1.' },
    b: { instructions: 'Step 2.' },
  },
  strategy: 'sequential',
  controls: {
    maxTotalTokens:   50_000,   // across all agents in the run
    maxCostUSD:       0.50,
    maxDurationMs:    30_000,
    maxAgentCalls:    20,
    maxStepsPerAgent: 5,
    maxEmergentAgents: 3,
    onLimitReached:   'warn',   // 'stop' | 'warn' | 'error'
  },
  on: {
    limitReached: (e) => {
      console.warn(`Limit breached: ${e.metric} = ${e.value} (limit ${e.limit})`);
    },
  },
});
```

---

## Observability and Callbacks

### Lifecycle callbacks

```typescript
const observed = agency({
  model: 'openai:gpt-4o',
  agents: {
    researcher: { instructions: 'Research.' },
    writer:     { instructions: 'Write.' },
  },
  strategy: 'sequential',
  observability: {
    logLevel:    'info',
    traceEvents: true,
    otel:        { enabled: true },
  },
  on: {
    agentStart:      (e) => console.log(`[START] ${e.agent} — ${e.input.slice(0, 60)}`),
    agentEnd:        (e) => console.log(`[END]   ${e.agent} — ${e.durationMs}ms`),
    handoff:         (e) => console.log(`[HANDOFF] ${e.fromAgent} -> ${e.toAgent}: ${e.reason}`),
    toolCall:        (e) => console.log(`[TOOL] ${e.agent} called ${e.toolName}`),
    guardrailResult: (e) => console.log(`[GUARD] ${e.guardrailId}: ${e.passed ? 'pass' : 'block'}`),
    emergentForge:   (e) => console.log(`[FORGE] ${e.agentName} approved=${e.approved}`),
    approvalRequested: (e) => console.log(`[HITL] ${e.type}: ${e.description}`),
    limitReached:    (e) => console.warn(`[LIMIT] ${e.metric}: ${e.value}/${e.limit}`),
    error:           (e) => console.error(`[ERROR] ${e.agent}: ${e.error.message}`),
  },
});
```

### Provenance / audit trail

```typescript
const auditable = agency({
  model: 'openai:gpt-4o',
  agents: { worker: { instructions: 'Do auditable work.' } },
  provenance: {
    enabled:   true,
    hashChain: true,
    record:    { toolCalls: true, agentOutputs: true },
    export:    'jsonl',  // 'jsonl' | 'otlp' | 'solana'
  },
});
```

---

## Structured Output with Zod

Pass a Zod schema to `output` and the final agent's response is validated and
parsed against it.  The result's `object` field carries the typed value.

```typescript
import { z } from 'zod';
import { agency } from '@framers/agentos';

const schema = z.object({
  title:    z.string(),
  summary:  z.string(),
  keyPoints: z.array(z.string()).min(3),
  sentiment: z.enum(['positive', 'neutral', 'negative']),
});

const extractor = agency({
  model: 'openai:gpt-4o',
  agents: {
    extractor: { instructions: 'Extract structured information from the text.' },
  },
  output: schema,
});

const result = await extractor.generate('...article text...');
const data = result.object as z.infer<typeof schema>;
console.log(data.title, data.keyPoints);
```

---

## Nested Agencies

An `agency()` instance satisfies the `Agent` interface and can be placed
directly in another agency's `agents` roster.  The outer strategy treats it
as a single opaque agent call.

```typescript
import { agency } from '@framers/agentos';

// Inner agency — dedicated research pipeline
const researchTeam = agency({
  model: 'openai:gpt-4o-mini',
  agents: {
    searcher: { instructions: 'Search for sources.' },
    analyst:  { instructions: 'Analyse and rank sources.' },
  },
  strategy: 'sequential',
});

// Outer agency — uses researchTeam as one of its agents
const publishingTeam = agency({
  model: 'openai:gpt-4o',
  agents: {
    researchTeam,                                         // nested agency
    writer:  { instructions: 'Write from research.' },
    editor:  { instructions: 'Polish and fact-check.' },
  },
  strategy: 'sequential',
});

const { text, agentCalls } = await publishingTeam.generate('Write about quantum computing.');
// agentCalls[0] represents the entire researchTeam run as a single call
```

Nesting can go arbitrarily deep.  `usage` and `agentCalls` are aggregated
through all layers.  `close()` propagates inward — the outer agency calls
`close()` on every nested agency in its roster.

---

## Full-Featured Example

The following example combines all major features in one agency configuration.

```typescript
import { z } from 'zod';
import { agency, hitl } from '@framers/agentos';

// Reusable inner team handling research
const researchTeam = agency({
  model: 'openai:gpt-4o-mini',
  agents: {
    searcher: { instructions: 'Search for authoritative sources on the topic.' },
    fact:     { instructions: 'Verify claims and flag unsupported assertions.' },
  },
  strategy: 'sequential',
  controls: { maxTotalTokens: 20_000 },
});

// Outer agency orchestrating the full content pipeline
const contentPipeline = agency({
  name: 'content-pipeline',
  model: 'openai:gpt-4o',

  agents: {
    research: researchTeam,    // nested agency
    writer: {
      instructions: 'Write a compelling, well-structured article.',
      maxSteps: 5,
    },
    editor: {
      instructions: 'Edit for clarity, grammar, and brand voice.',
    },
  },

  strategy: 'sequential',
  adaptive: true,

  emergent: {
    enabled: true,
    tier: 'session',
    judge: true,
  },

  memory: {
    shared: true,
    types: ['episodic', 'semantic'],
    working: { enabled: true, maxTokens: 8192 },
  },

  rag: {
    vectorStore: { provider: 'in-memory', embeddingModel: 'text-embedding-3-small' },
    topK: 5,
    minScore: 0.7,
  },

  guardrails: {
    input:  ['injection-shield'],
    output: ['grounding-guard', 'pii-redaction'],
    tier:   'balanced',
  },

  security: { tier: 'balanced' },

  permissions: {
    tools:      'all',
    network:    true,
    filesystem: false,
    spawn:      false,
  },

  hitl: {
    approvals: {
      beforeReturn:   true,
      beforeEmergent: true,
    },
    handler:   hitl.autoApprove(), // swap for hitl.cli() or hitl.webhook() in production
    timeoutMs: 60_000,
    onTimeout: 'reject',
  },

  controls: {
    maxTotalTokens:  100_000,
    maxCostUSD:      2.00,
    maxDurationMs:   120_000,
    maxAgentCalls:   50,
    onLimitReached:  'warn',
  },

  observability: {
    logLevel:    'info',
    traceEvents: true,
  },

  on: {
    agentStart:      (e) => console.log(`[>] ${e.agent}`),
    agentEnd:        (e) => console.log(`[<] ${e.agent} (${e.durationMs}ms)`),
    limitReached:    (e) => console.warn(`limit: ${e.metric} = ${e.value}`),
    error:           (e) => console.error(`error in ${e.agent}: ${e.error.message}`),
  },

  output: z.object({
    title:      z.string(),
    body:       z.string(),
    wordCount:  z.number(),
    readingTime: z.string(),
  }),
});

// Non-streaming call
const result = await contentPipeline.generate('Write an article about large language models.');
console.log(result.text);
console.log(result.agentCalls.length, 'agent calls');
console.log(result.usage.totalTokens, 'total tokens');

// Streaming call
const stream = contentPipeline.stream('Write about transformers.');
for await (const chunk of stream.textStream) {
  process.stdout.write(chunk);
}

// Multi-turn session
const session = contentPipeline.session('article-001');
await session.send('Outline the article.');
await session.send('Now write the introduction.');
const history = session.messages(); // [{role:'user',content:'...'}, ...]
console.log(history.length, 'messages in session');

// Cleanup
await contentPipeline.close();
```

---

## See Also

- [`docs/HIGH_LEVEL_API.md`](./HIGH_LEVEL_API.md) — `generateText()`, `streamText()`, `generateImage()`, single `agent()`
- [`docs/HUMAN_IN_THE_LOOP.md`](./HUMAN_IN_THE_LOOP.md) — HITL handler deep-dive
- [`docs/GUARDRAILS_USAGE.md`](./GUARDRAILS_USAGE.md) — guardrail policies and custom guardrail authoring
- [`docs/RAG_MEMORY_CONFIGURATION.md`](./RAG_MEMORY_CONFIGURATION.md) — RAG and memory configuration reference
- [`docs/OBSERVABILITY.md`](./OBSERVABILITY.md) — OTEL integration and trace event reference
- [`docs/STRUCTURED_OUTPUT.md`](./STRUCTURED_OUTPUT.md) — Zod schema output and extraction patterns
- [`docs/AGENT_GRAPH.md`](./AGENT_GRAPH.md) — `AgentGraph` programmatic graph builder (advanced)
- [`src/api/types.ts`](../src/api/types.ts) — canonical TypeScript type definitions
- [`src/api/agency.ts`](../src/api/agency.ts) — `agency()` implementation
- [`src/api/hitl.ts`](../src/api/hitl.ts) — HITL handler factories
