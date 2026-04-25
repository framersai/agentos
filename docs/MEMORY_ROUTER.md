# Memory Router

Recall-stage smart orchestrator. Picks the best memory-recall architecture per query — classifier-driven dispatch across `canonical-hybrid`, `observational-memory-v10`, and `observational-memory-v11` backends. Validated on LongMemEval-S Phase B N=500: **76.6% [72.8, 80.2] at $0.058/correct**, Pareto-dominating four prior single-architecture tiers.

This is the recall stage of the [Cognitive Pipeline](./COGNITIVE_PIPELINE.md). Sibling primitives: [Ingest Router](./INGEST_ROUTER.md) (input stage), [Read Router](./READ_ROUTER.md) (read stage).

## What it actually does

Every memory-recall query goes through three steps:

1. A `gpt-5-mini`-style classifier reads the query and emits a `MemoryQueryCategory` (one of six: single-session-user, single-session-assistant, single-session-preference, knowledge-update, multi-session, temporal-reasoning).
2. The pure `selectBackend` function maps that category to a backend choice using the configured routing table (one of three shipping presets, or your own).
3. An optional dispatcher executes the backend against your `Memory` instance.

The classifier call is ~$0.0002 per query. The routing decision saves dollars by picking canonical-hybrid (cheap, accurate on most categories) instead of paying the OM premium on every query, while still routing multi-session synthesis questions to the OM backends where the architectural lift earns the cost.

## Why route at all

Per-category Phase B N=500 measurements show different memory architectures dominate different categories:

| Category | canonical-hybrid | OM-v10 | OM-v11 |
|---|---:|---:|---:|
| single-session-user | 97.1% / $0.019 | 97.1% / $0.021 | 98.6% / $0.021 |
| single-session-assistant | 89.3% / $0.018 | 83.9% / $0.020 | 83.9% / $0.019 |
| single-session-preference | 60.0% / $0.021 | 60.0% / $0.021 | 63.3% / $0.021 |
| knowledge-update | 86.8% / $0.019 | 85.9% / $0.031 | 87.2% / $0.031 |
| multi-session | 54.9% / $0.020 | 60.2% / $0.031 | **61.7% / $0.034** |
| temporal-reasoning | 70.2% / $0.020 | 71.0% / $0.021 | 69.2% / $0.021 |

Numbers above are accuracy / per-call USD. The flat "always canonical" pipeline costs accuracy on multi-session (-6.8pp). The flat "always OM-v11" pipeline costs accuracy on single-session-assistant (-5.4pp) and pays a 1.7-1.8x cost premium on every other category. Per-query routing extracts the best of both.

## Six query categories

```ts
type MemoryQueryCategory =
  | 'single-session-user'
  | 'single-session-assistant'
  | 'single-session-preference'
  | 'knowledge-update'
  | 'multi-session'
  | 'temporal-reasoning';
```

The taxonomy is calibrated from LongMemEval-S. Each category captures a distinct memory-recall pattern; the classifier is trained to discriminate between them via a discriminator prompt (with optional few-shot variant for harder cases like SSU-vs-SSA confusion).

## Three backend identifiers

```ts
type MemoryBackendId =
  | 'canonical-hybrid'              // BM25 + dense + Cohere rerank-v3.5
  | 'observational-memory-v10'      // synthesized observation log + dynamic OM router
  | 'observational-memory-v11';     // v10 + conditional verbatim citation rule
```

Backend execution itself lives in the dispatcher (consumer-supplied). MemoryRouter only DECIDES; it doesn't execute. This split lets you wire the dispatcher to your existing HybridRetriever / OM pipeline / custom retriever without touching this module.

## Three shipping presets

| Preset | Strategy | Phase B Result | When to use |
|---|---|---|---|
| `minimize-cost` (default) | Cheapest Pareto-dominant per category. Pay OM premium only on MS + SSP. | 76.6% [72.8, 80.2] at **$0.0580/correct**, 16s avg | Cost-sensitive workloads. The shipping default. |
| `balanced` | Trade 1.6x cost for 10x latency wins on KU/TR | 74.5% / $0.205/correct (sim) | Interactive UX where latency matters |
| `maximize-accuracy` | Highest-accuracy backend per category | 75.6% [71.8, 79.2] at $0.2434/correct, 66s avg | Accuracy-sensitive with moderate cost tolerance |

## Quickstart

```ts
import {
  LLMMemoryClassifier,
  MemoryRouter,
  FunctionMemoryDispatcher,
} from '@framers/agentos/memory-router';
import type { ScoredTrace } from '@framers/agentos/memory';

const router = new MemoryRouter({
  classifier: new LLMMemoryClassifier({ llm: openaiAdapter }),
  preset: 'minimize-cost',
  budget: { perQueryUsd: 0.05, mode: 'cheapest-fallback' },
  dispatcher: new FunctionMemoryDispatcher<ScoredTrace, { topK: number }>({
    'canonical-hybrid': async (q, { topK }) =>
      memory.recall(q, { limit: topK }),
    'observational-memory-v10': async (q, { topK }) =>
      omV10.recall(q, { limit: topK }),
    'observational-memory-v11': async (q, { topK }) =>
      omV11.recall(q, { limit: topK }),
  }),
});

const { decision, traces, backend } = await router.decideAndDispatch(
  query,
  { topK: 10 },
);
console.log(decision.classifier.category);          // 'multi-session'
console.log(backend);                               // 'observational-memory-v11'
console.log(decision.routing.estimatedCostUsd);     // 0.0336
console.log(decision.routing.chosenBackendReason);  // 'routing-table pick fits budget'
```

## Decision-only flow

If you'd rather execute the backend yourself, use `decide()`:

```ts
const { classifier, routing } = await router.decide(query);

if (routing.chosenBackend === 'canonical-hybrid') {
  const traces = await memory.recall(query, { limit: 10 });
  // your custom logic
}
```

## Budget-aware dispatch

```ts
const router = new MemoryRouter({
  classifier,
  preset: 'maximize-accuracy',
  budget: {
    perQueryUsd: 0.025,
    mode: 'cheapest-fallback',
  },
});
```

Three modes:

- **hard**: throw `MemoryRouterBudgetExceededError` when the routing-table pick exceeds the ceiling. Production code catches and escalates.
- **soft**: keep the picked backend when it has better $/correct than the cheapest backend that fits, even if it exceeds the budget. Prefers accuracy-economical overruns.
- **cheapest-fallback** (default): silently downgrade to the cheapest backend that fits. If no backend fits, pick the globally cheapest and flag `budgetExceeded: true` in the decision.

## Custom routing table or per-category override

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
      'multi-session': 'canonical-hybrid',  // override: skip OM premium
      'temporal-reasoning': 'canonical-hybrid',
    },
  },
});

// Or patch a single category:
const router2 = new MemoryRouter({
  classifier,
  preset: 'maximize-accuracy',
  mapping: {
    'single-session-preference': 'canonical-hybrid',
  },
});
```

## Few-shot classifier prompt

For deployments where SSU-vs-SSA, SSP-vs-SSA, MS-vs-KU confusion costs accuracy, use the few-shot variant:

```ts
const router = new MemoryRouter({
  classifier,
  preset: 'minimize-cost',
  useFewShotPrompt: true,
});

// or per-call
await router.decide(query, { useFewShotPrompt: true });
```

## API surface

- `MemoryQueryCategory`, `MemoryBackendId`, `MemoryRouterPreset`, `RoutingTable`
- `MEMORY_QUERY_CATEGORIES` — the six-category tuple
- `MINIMIZE_COST_TABLE`, `BALANCED_TABLE`, `MAXIMIZE_ACCURACY_TABLE`, `PRESET_TABLES`
- `MemoryBackendCostPoint`, `DEFAULT_MEMORY_BACKEND_COSTS`, `TIER_1_CANONICAL_COSTS`, `TIER_2A_V10_COSTS`, `TIER_2B_V11_COSTS`
- `selectBackend` (pure function)
- `MemoryRoutingDecision`, `MemoryRouterConfig`, `MemoryBudgetMode`
- `IMemoryClassifier`, `IMemoryClassifierLLM`, `LLMMemoryClassifier`
- `CLASSIFIER_SYSTEM_PROMPT`, `CLASSIFIER_SYSTEM_PROMPT_FEWSHOT`, `SAFE_FALLBACK_CATEGORY`
- `IMemoryDispatcher`, `FunctionMemoryDispatcher`
- `MemoryRouter`, `MemoryRouterOptions`, `MemoryRouterDecideOptions`, `MemoryRouterDecision`, `MemoryRouterDispatchedDecision`
- Errors: `MemoryRouterUnknownCategoryError`, `MemoryRouterBudgetExceededError`, `MemoryRouterDispatcherMissingError`, `UnsupportedMemoryBackendError`

## Methodology + numbers

The shipping cost-points in `DEFAULT_MEMORY_BACKEND_COSTS` come from LongMemEval-S Phase B N=500 run JSONs in `packages/agentos-bench/results/runs/`. Each entry's per-category accuracy/cost/latency is from a real benchmark sweep at `gpt-4o` reader, `gpt-4o-2024-08-06` judge, `rubricVersion 2026-04-18.1`, seed=42, with bootstrap 95% CIs and a published 1% [0%, 3%] judge false-positive rate.

For workloads whose cost/accuracy profile diverges from LongMemEval-S, see [Adaptive Memory Router](./ADAPTIVE_MEMORY_ROUTER.md) — derives the routing table from your own calibration data instead of relying on Phase B presets.

## Related

- [Cognitive Pipeline](./COGNITIVE_PIPELINE.md) — composition primitive that ties this with Ingest Router + Read Router
- [Ingest Router](./INGEST_ROUTER.md) — input stage sibling
- [Read Router](./READ_ROUTER.md) — read stage sibling
- [Adaptive Memory Router](./ADAPTIVE_MEMORY_ROUTER.md) — self-calibrating extension
- [Query Router](./QUERY_ROUTER.md) — sibling primitive for general Q&A (different use case)
- [Cognitive Memory](./COGNITIVE_MEMORY.md) — the storage substrate canonical-hybrid retrieves from
- [HyDE Retrieval](./HYDE_RETRIEVAL.md) — alternate retrieval strategy MemoryRouter can dispatch to
