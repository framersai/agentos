# @framers/agentos/memory-router

LLM-as-judge orchestrator for memory recall. Picks the best retrieval architecture per query with budget-aware dispatch across `canonical-hybrid`, `observational-memory-v10`, and `observational-memory-v11` backends. Validated on LongMemEval-S Phase B (76.6% [72.8, 80.2] at $0.058/correct, Pareto-dominating four prior flat tiers).

## What this primitive does

```
Query
  │
  ▼
[Classifier]  ── LLM-as-judge, maps query → MemoryQueryCategory (6 categories)
  │
  ▼
[selectBackend]  ── pure function: category + routing table + budget → MemoryRoutingDecision
  │
  ▼
[Dispatcher]  ── optional: executes the chosen backend against your Memory state
  │
  ▼
Traces + decision telemetry
```

Three decisions in one orchestrator: what the query is about (classifier), which architecture should answer it (routing table), and how to run that architecture (dispatcher). The three stages are independent — use just the decision surface in dry-runs or compose with dispatch for production queries.

## Why route at all

On LongMemEval-S Phase B N=500 we measured per-category cost-accuracy points across three memory architectures. Canonical hybrid retrieval wins on single-session-user / single-session-assistant / temporal-reasoning / knowledge-update (it's cheaper AND accurate). Observational memory wins on multi-session (+6.8pp architectural lift) and single-session-preference (+3.3pp). The flat "always-canonical" and "always-OM" pipelines each leave accuracy or cost on the table. A per-query router dispatches to the backend that's actually Pareto-optimal for that question's category.

Tier 3 `minimize-cost` preset on LongMemEval-S Phase B: **76.6% accuracy at $0.0580/correct**, Pareto-dominating Tier 1 canonical (73.2%, $0.0213), Tier 2a v10 (74.6%, $0.3265), and Tier 2b v11 (75.4%, $0.4362). Same reader, same judge, 5.6× cheaper than the best single-backend run.

## Installation

Already part of `@framers/agentos`. Import from the subpath:

```ts
import {
  LLMMemoryClassifier,
  MemoryRouter,
  FunctionMemoryDispatcher,
} from '@framers/agentos/memory-router';
```

## Usage

### 1. Decision-only (simplest)

```ts
import {
  LLMMemoryClassifier,
  MemoryRouter,
} from '@framers/agentos/memory-router';

// The classifier LLM adapter is provider-agnostic — wire OpenAI,
// Anthropic, local, or a mock via the IMemoryClassifierLLM interface.
const classifier = new LLMMemoryClassifier({
  llm: {
    invoke: async (req) => {
      const res = await openai.chat.completions.create({
        model: 'gpt-5-mini',
        messages: [
          { role: 'system', content: req.system },
          { role: 'user', content: req.user },
        ],
        max_tokens: req.maxTokens,
        temperature: req.temperature,
      });
      return {
        text: res.choices[0]?.message.content ?? '',
        tokensIn: res.usage?.prompt_tokens ?? 0,
        tokensOut: res.usage?.completion_tokens ?? 0,
        model: res.model,
      };
    },
  },
});

const router = new MemoryRouter({
  classifier,
  preset: 'minimize-cost',
});

const { classifier: c, routing } = await router.decide(
  "What's my current job title?",
);
console.log(c.category);            // 'knowledge-update'
console.log(routing.chosenBackend); // 'canonical-hybrid'
console.log(routing.estimatedCostUsd);   // 0.0189
console.log(routing.chosenBackendReason); // 'routing-table pick, no budget'

// Execute the chosen backend yourself:
if (routing.chosenBackend === 'canonical-hybrid') {
  const traces = await memory.recall(query, { limit: 10 });
  // ...
}
```

### 2. Decide + dispatch

Wire a dispatcher and the router will classify + route + execute in one call.

```ts
import {
  LLMMemoryClassifier,
  MemoryRouter,
  FunctionMemoryDispatcher,
} from '@framers/agentos/memory-router';
import type { ScoredTrace } from '@framers/agentos/memory';

type RetrievalPayload = { topK: number };

const dispatcher = new FunctionMemoryDispatcher<ScoredTrace, RetrievalPayload>({
  'canonical-hybrid': async (q, { topK }) =>
    memory.recall(q, { limit: topK }),
  'observational-memory-v10': async (q, { topK }) =>
    omV10Pipeline.recall(q, { limit: topK }),
  'observational-memory-v11': async (q, { topK }) =>
    omV11Pipeline.recall(q, { limit: topK }),
});

const router = new MemoryRouter({
  classifier,
  preset: 'minimize-cost',
  dispatcher,
});

const { decision, traces, backend } = await router.decideAndDispatch(
  query,
  { topK: 10 },
);
```

### 3. Budget-aware dispatch

Pass a per-query USD ceiling and the router downgrades to the cheapest fitting backend rather than paying unbounded cost.

```ts
const router = new MemoryRouter({
  classifier,
  preset: 'maximize-accuracy',
  budget: {
    perQueryUsd: 0.025,
    mode: 'cheapest-fallback',  // silently downgrade
  },
  dispatcher,
});
```

Three modes:

| Mode | Behavior |
|---|---|
| `hard` | Throw `MemoryRouterBudgetExceededError` when the routing-table pick exceeds budget. Production code catches and escalates. |
| `soft` | Allow exceeding the ceiling only when the picked backend has better $/correct than the cheapest backend that fits. Prefers accuracy-economical overruns. |
| `cheapest-fallback` | Silently downgrade to the cheapest backend that fits. If none fits, pick the globally cheapest and set `budgetExceeded: true` in the decision for telemetry. |

### 4. Custom routing table / custom costs

Supply your own routing table or per-backend cost-points when your workload diverges from LongMemEval-S Phase B:

```ts
const router = new MemoryRouter({
  classifier,
  preset: 'balanced',
  routingTable: {
    preset: 'balanced',
    defaultMapping: {
      'single-session-assistant': 'canonical-hybrid',
      'single-session-user': 'canonical-hybrid',
      'single-session-preference': 'canonical-hybrid',
      'knowledge-update': 'canonical-hybrid',
      'multi-session': 'canonical-hybrid',       // override: skip OM premium
      'temporal-reasoning': 'canonical-hybrid',
    },
  },
  backendCosts: {
    // your own measured cost-points
    ...DEFAULT_MEMORY_BACKEND_COSTS,
    'canonical-hybrid': myCanonicalCostPoint,
  },
});
```

### 5. Partial mapping override

Patch a single category without rewriting the whole table:

```ts
const router = new MemoryRouter({
  classifier,
  preset: 'maximize-accuracy',
  mapping: {
    'single-session-preference': 'canonical-hybrid', // override just this
  },
});
```

### 6. Few-shot classifier prompt

For deployments where base-prompt classification confusion (SSU-vs-SSA, SSP-vs-SSA, MS-vs-KU) costs accuracy, enable the few-shot variant. Adds Question/Category pairs to the system prompt:

```ts
const router = new MemoryRouter({
  classifier,
  preset: 'minimize-cost',
  useFewShotPrompt: true,  // default for all decide() calls
});

// Or per-call:
await router.decide(query, { useFewShotPrompt: true });
```

## Presets summary

| Preset | Strategy | Phase B N=500 | When to use |
|---|---|---|---|
| `minimize-cost` | Cheapest Pareto-dominant per category. Pay OM premium only on MS + SSP. | 73.9% predicted / $0.092 per correct (simulation from single-tier Phase B data; live 76.6% [72.8, 80.2] with v10 classifier dispatch noise) | Default. Cost-sensitive workloads. |
| `balanced` | Trade 1.6× cost for 10× latency wins on KU/TR. | 74.5% / $0.205 per correct | Interactive UX where latency matters. |
| `maximize-accuracy` | Highest-accuracy backend per category; ties broken by cost. v2 routes TR to canonical-hybrid (post-Phase-B fix). | 75.6% [71.8, 79.2] / $0.2434 per correct | Accuracy-sensitive with moderate cost tolerance. |

## Telemetry

Every decision carries:

- `classifier.category` — predicted category
- `classifier.tokensIn / tokensOut / model` — for cost tracking
- `routing.chosenBackend` — which architecture was picked
- `routing.chosenBackendReason` — human-readable reason (table pick / budget fit / soft-keep / downgrade / no-fit)
- `routing.estimatedCostUsd` — projected per-query cost from the cost-points data
- `routing.budgetCeiling / budgetExceeded` — budget enforcement state
- `routing.preset` — for downstream telemetry labeling
- `routing.groundTruthCategory` — optional gold-label passthrough (null in production; used during benchmarking)

Decision shape is a pure function of inputs — safe to use in cache keys and for deterministic replay.

## Design constraints

1. **Provider-agnostic classifier.** No SDK imports inside this module. The classifier talks to `IMemoryClassifierLLM`; consumers adapt their provider.
2. **Dispatch is injected.** Backend execution depends on how callers wire memory state (OM backends need ingest-time setup). The router decides; the dispatcher executes.
3. **Pure `selectBackend`.** Deterministic, no I/O, no mutation. Safe for cache-key construction.
4. **Frozen defaults.** Preset routing tables and default cost-points are `Object.freeze`d — consumers cannot mutate the routing surface from outside the module.
5. **Typed errors.** `MemoryRouterUnknownCategoryError`, `MemoryRouterBudgetExceededError`, `MemoryRouterDispatcherMissingError`, `UnsupportedMemoryBackendError` — all caught at specific error classes so application-layer fallbacks are easy to write.

## Calibration

The shipping cost-points in `DEFAULT_MEMORY_BACKEND_COSTS` come from LongMemEval-S Phase B N=500 run JSONs. For workloads whose cost/accuracy profile diverges (different reader model, different question distribution, different ingest pipeline) supply a custom `backendCosts` map. The router's selection logic is content-addressed on the cost-points values — two deployments with different cost-points produce different routing decisions even with the same preset name.

Calibrating your own cost-points takes one sweep per backend across a representative N=100+ sample of your workload. See `packages/agentos-bench` for the benchmark harness that produced ours.

## Related primitives

- `@framers/agentos/query-router` — general Q&A routing (vector search / graph / keyword). Sibling primitive; different use case (ask-a-question vs recall-past-context).
- `@framers/agentos/memory` — the underlying Memory + HybridRetriever + SessionRetriever primitives the canonical-hybrid backend calls.
- `@framers/agentos/core/guardrails` — output-stage guardrails. MemoryRouter is the recall-stage orchestrator that picks architecture; core/guardrails validate the output.
- `@framers/agentos-ext-grounding-guard` — output-stage grounding judge for retrieved-evidence-backed answers.

Together, the router stages form the Cognitive Pipeline pattern: `ingest-router → memory-router → read-router`. The ingest, recall, and read stages are LLM-as-judge orchestration points with their own interfaces. In a full app, `core/guardrails` and `agentos-ext-grounding-guard` run downstream as safety/policy validators.
