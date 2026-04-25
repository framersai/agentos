# @framers/agentos/ingest-router

Input-stage LLM-as-judge orchestrator. Classifies incoming content and picks an ingest strategy: `raw-chunks`, `summarized`, `observational`, `fact-graph`, `hybrid`, or `skip`. Sibling of `@framers/agentos/memory-router` (recall-stage) and `@framers/agentos/read-router` (read-stage).

## Why route at ingest

Different content benefits from different storage. A 3-turn chat snippet doesn't justify the LLM cost of observation extraction; a 50-turn customer-support thread does. A long-form article benefits from session-summarized contextual retrieval; structured CSV data doesn't. The router takes the content (plus an optional manual override), classifies it, and picks the storage strategy that the downstream MemoryRouter can recall against effectively.

## Six content kinds

| Kind | Examples |
|---|---|
| `short-conversation` | 1-3 turn chats, brief Q&A |
| `long-conversation` | extended chat sessions, support threads |
| `long-article` | blog posts, paper sections, long emails |
| `code` | source files, configs, schemas |
| `structured-data` | CSV, JSON record lists, table dumps |
| `multimodal` | content with images, video frames, audio |

## Six ingest strategies

| Strategy | What it writes | Cost |
|---|---|---|
| `raw-chunks` | turn/chunk traces with embeddings | $0.0001/ingest |
| `summarized` | session/document summary prefixed to every chunk | $0.005/ingest |
| `observational` | structured observation log replacing raw turns | $0.020/ingest |
| `fact-graph` | extracted fact triples + entity-relation graph | $0.015/ingest |
| `hybrid` | parallel raw + summarized + observational | $0.030/ingest |
| `skip` | content discarded; nothing written | $0 |

## Four shipping presets

| Preset | Strategy | When to use |
|---|---|---|
| `raw-chunks` (default) | every kind → raw-chunks | high-volume / cost-sensitive workloads where retrieval does the work |
| `summarized` | long-* and code → summarized; short stays raw | documents/conversations with global context that aids recall |
| `observational` | long-conversation → observational; long-article → summarized | conversational workloads with multi-session synthesis questions |
| `hybrid` | long-* → hybrid; short stays raw | cost-tolerant workloads with heterogeneous retrieval needs |

## Installation

Already part of `@framers/agentos`. Import from the subpath:

```ts
import {
  LLMIngestClassifier,
  IngestRouter,
  FunctionIngestDispatcher,
} from '@framers/agentos/ingest-router';
```

## Usage

### Decide-only

```ts
const router = new IngestRouter({
  classifier: new LLMIngestClassifier({ llm: openaiAdapter }),
  preset: 'summarized',
});

const { classifier, routing } = await router.decide(content);
console.log(classifier.kind);            // 'long-conversation'
console.log(routing.chosenStrategy);     // 'observational'
console.log(routing.estimatedCostUsd);   // 0.020
```

### Decide + dispatch

```ts
type Outcome = { writtenTraces: number };

const router = new IngestRouter({
  classifier: new LLMIngestClassifier({ llm: openaiAdapter }),
  preset: 'observational',
  dispatcher: new FunctionIngestDispatcher<Outcome>({
    'raw-chunks': async (content) => ({ writtenTraces: await rawIngest(content) }),
    summarized: async (content) => ({ writtenTraces: await summarizedIngest(content) }),
    observational: async (content) => ({ writtenTraces: await omIngest(content) }),
  }),
});

const { decision, outcome } = await router.decideAndDispatch(content);
```

### Manual kind override

When the caller already knows the content kind (e.g., file extension determines code), skip the LLM classifier:

```ts
const decision = await router.decide(content, {
  manualKind: 'code',
});
// classifier is not invoked; routing table consulted with 'code' directly.
```

### Budget-aware

```ts
const router = new IngestRouter({
  classifier,
  preset: 'observational',
  budget: {
    perIngestUsd: 0.005,           // tight per-ingest ceiling
    mode: 'cheapest-fallback',     // silently downgrade to a fitting strategy
  },
});
```

## API surface

- `IngestContentKind`, `IngestStrategyId`, `IngestRouterPreset`, `IngestRoutingTable`
- `INGEST_CONTENT_KINDS` — the six-kind tuple
- `RAW_CHUNKS_TABLE`, `SUMMARIZED_TABLE`, `OBSERVATIONAL_TABLE`, `HYBRID_TABLE`, `PRESET_INGEST_TABLES`
- `IngestStrategyCostPoint`, `DEFAULT_INGEST_COSTS`
- `selectIngestStrategy` (pure function)
- `IngestRoutingDecision`, `IngestRouterConfig`, `IngestBudgetMode`
- `IIngestClassifier`, `IIngestClassifierLLM`, `LLMIngestClassifier`
- `INGEST_CLASSIFIER_SYSTEM_PROMPT`, `INGEST_CLASSIFIER_SYSTEM_PROMPT_FEWSHOT`
- `IIngestDispatcher`, `FunctionIngestDispatcher`
- `IngestRouter`, `IngestRouterOptions`, `IngestRouterDecideOptions`, `IngestRouterDispatchedResult`
- Errors: `IngestRouterUnknownKindError`, `IngestRouterBudgetExceededError`, `UnsupportedIngestStrategyError`, `IngestRouterDispatcherMissingError`

## Related

- `@framers/agentos/memory-router` — recall-stage sibling
- `@framers/agentos/read-router` — read-stage sibling
- `@framers/agentos/multi-stage-guardrails` — composition primitive that wires the three stages together
- `@framers/agentos/core/guardrails` + `agentos-ext-grounding-guard` — output-stage validation
