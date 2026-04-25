# @framers/agentos/multi-stage-guardrails

Composition primitive that wires the four LLM-as-judge stages of agentos into a single orchestrator. Each stage is independent and shippable on its own; this module is what you use when you want all four (or any subset) to coordinate as one pipeline.

## The four stages

```
   Content              Query                Query
      │                   │                    │
      ▼                   ▼                    ▼
  ┌─────────┐       ┌─────────────┐     ┌─────────────┐
  │ Ingest  │       │   Recall    │     │    Read     │
  │ Stage   │       │   Stage     │     │   Stage     │
  └─────────┘       └─────────────┘     └─────────────┘
      │                   │                    │
      ▼                   ▼                    ▼
 Memory state       Retrieved traces      Final answer
                                                │
                                                ▼
                                     ┌────────────────────┐
                                     │  Output guardrails │
                                     │   (grounding,      │
                                     │   topicality, PII) │
                                     └────────────────────┘
```

Each stage is an LLM-as-judge that classifies its input and picks a strategy. The shipping primitives are:

- **Ingest stage:** [`@framers/agentos/ingest-router`](../ingest-router/README.md)
- **Recall stage:** [`@framers/agentos/memory-router`](../memory-router/README.md)
- **Read stage:** [`@framers/agentos/read-router`](../read-router/README.md)
- **Output guardrails:** `@framers/agentos/core/guardrails` + `agentos-ext-grounding-guard` + `agentos-ext-topicality` + `agentos-ext-pii-redaction`

This module's job is composition — it does NOT add new routing logic. The `MultiStageGuardrails` class is a thin facade over interfaces that any stage implementation can satisfy.

## Why one composition primitive

Without composition, every consumer has to wire the four stages independently — managing their lifecycles, normalizing telemetry across them, deciding what to do when a stage is missing. With composition, you wire each stage once at construction and the primitive coordinates them. Three benefits:

1. **Optional stages.** Wire only the stages you need. Don't have an ingest router? Skip it; recall and read still work.
2. **Uniform telemetry.** Each stage reports `decision` metadata in a consistent shape regardless of which router is wrapped.
3. **Custom implementations slot in cleanly.** The stage interfaces are the minimum each stage must satisfy. Wrap a custom rule-based router, an ML classifier, or a mock for tests with the same constructor.

## Installation

```ts
import {
  MultiStageGuardrails,
  ingestRouterAsStage,
  memoryRouterAsStage,
  readRouterAsStage,
} from '@framers/agentos/multi-stage-guardrails';
```

## Usage

### Wire all four stages

```ts
import { IngestRouter } from '@framers/agentos/ingest-router';
import { MemoryRouter } from '@framers/agentos/memory-router';
import { ReadRouter } from '@framers/agentos/read-router';

const ingestRouter = new IngestRouter({ /* ... */ });
const memoryRouter = new MemoryRouter({ /* ... */ });
const readRouter = new ReadRouter({ /* ... */ });

const guardrails = new MultiStageGuardrails({
  ingest: ingestRouterAsStage(ingestRouter),
  recall: memoryRouterAsStage(memoryRouter),
  read: readRouterAsStage(readRouter),
});
```

### Use the pipeline

```ts
// Independent stages:
await guardrails.ingest(newContent);                 // input stage
const recalled = await guardrails.recall(query);     // recall stage
const answer = await guardrails.read(query, recalled.traces);  // read stage

// End-to-end recall + read:
const result = await guardrails.recallAndRead(query);
console.log(result.outcome);                          // final answer
console.log(result.recallStage.backend);              // which memory backend ran
console.log(result.readStage.strategy);               // which reader strategy ran
console.log(result.recallStage.memoryRouterDecision); // full decision telemetry
```

### Wire only the stages you need

```ts
// Recall + read only (ingest is handled elsewhere):
const guardrails = new MultiStageGuardrails({
  recall: memoryRouterAsStage(memoryRouter),
  read: readRouterAsStage(readRouter),
});

await guardrails.recallAndRead(query);   // works
await guardrails.ingest(content);        // throws MissingStageError
```

### Custom stage implementations

You don't have to use the agentos routers. Implement the stage interfaces directly for rule-based, ML-based, or mock implementations:

```ts
const customIngest: IngestStage = {
  async ingest(content, payload) {
    // your logic
    return {
      writtenTraces: 1,
      strategy: 'custom-strategy',
      ingestRouterDecision: { /* whatever telemetry you want */ },
    };
  },
};

const guardrails = new MultiStageGuardrails({
  ingest: customIngest,
  // ...
});
```

## Stage interfaces

```ts
interface IngestStage {
  ingest(content: string, payload?: unknown): Promise<IngestStageResult>;
}

interface RecallStage<TTrace> {
  recall(query: string, payload?: unknown): Promise<RecallStageResult<TTrace>>;
}

interface ReadStage<TTrace, TOutcome> {
  read(query: string, traces: TTrace[], payload?: unknown): Promise<ReadStageResult<TOutcome>>;
}
```

Each result shape carries:
- the stage's primary output (`writtenTraces` / `traces` / `outcome`),
- the strategy that ran (string label for telemetry),
- the full router decision (opaque `unknown`; introspect when needed).

## API surface

- `MultiStageGuardrails<TTrace, TOutcome>` — orchestrator class
- `MultiStageGuardrailsOptions<TTrace, TOutcome>`
- `IngestStage`, `RecallStage<TTrace>`, `ReadStage<TTrace, TOutcome>` — pluggable interfaces
- `IngestStageResult`, `RecallStageResult<TTrace>`, `ReadStageResult<TOutcome>`, `RecallAndReadResult<TTrace, TOutcome>` — output shapes
- `ingestRouterAsStage(IngestRouter)` — adapter
- `memoryRouterAsStage(MemoryRouter)` — adapter
- `readRouterAsStage(ReadRouter, traceToString?)` — adapter
- `MissingStageError` — typed error when a method is called without its required stage

## Related

- [`@framers/agentos/ingest-router`](../ingest-router/README.md) — input stage
- [`@framers/agentos/memory-router`](../memory-router/README.md) — recall stage (with `AdaptiveMemoryRouter` for self-calibration)
- [`@framers/agentos/read-router`](../read-router/README.md) — read stage
- `@framers/agentos/query-router` — non-memory Q&A orchestrator (sibling to memory-router; coexistent)
- `@framers/agentos/core/guardrails` + `agentos-ext-grounding-guard` — output-stage guardrails
