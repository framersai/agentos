# @framers/agentos/read-router

Read-stage LLM-as-judge orchestrator. Classifies a query+evidence pair and picks a reader strategy: `single-call`, `two-call-extract-answer`, `commit-vs-abstain`, `verbatim-citation`, or `scratchpad-then-answer`. Sibling of `@framers/agentos/ingest-router` (input) and `@framers/agentos/memory-router` (recall).

## Why route at read time

A precise-fact lookup with clear evidence works fine with a single reader call. A multi-source synthesis question benefits from two-call extract-then-answer (Emergence Simple pattern). A time-interval question needs an explicit scratchpad to reason about dates. An adversarial question needs commit-vs-abstain to avoid wrong commits on missing evidence. Picking the wrong strategy costs accuracy or money — usually both.

## Five read intents

| Intent | Examples |
|---|---|
| `precise-fact` | "What is X's email?", "When was the last release?" |
| `multi-source-synthesis` | "Summarize all topics", "Aggregate counts across sessions" |
| `time-interval` | "How many days since X?", "In what order did Y, Z, W happen?" |
| `preference-recommendation` | "Any tips for X?", "Can you suggest Y?" |
| `abstention-candidate` | likely unanswerable from evidence |

## Five reader strategies

| Strategy | Calls | Cost | Description |
|---|---:|---:|---|
| `single-call` | 1 | $0.0150 | one reader.invoke call |
| `two-call-extract-answer` | 2 | $0.0280 | claim extraction + answer call |
| `commit-vs-abstain` | 2 | $0.0220 | binary commit/abstain + answer-or-refuse |
| `verbatim-citation` | 1 | $0.0170 | single call with verbatim-quote rule |
| `scratchpad-then-answer` | 1 | $0.0190 | single call with scratchpad scaffold |

## Three shipping presets

| Preset | Strategy mix | When to use |
|---|---|---|
| `precise-fact` (default) | single-call for facts; two-call for synthesis; scratchpad for time | balanced workloads with mixed intents |
| `synthesis` | two-call for synthesis + preferences; verbatim for facts | synthesis-heavy workloads (multi-doc Q&A, research) |
| `temporal` | scratchpad for facts/synthesis/time | time-heavy workloads (event timelines, scheduling) |

## Installation

```ts
import {
  LLMReadIntentClassifier,
  ReadRouter,
  FunctionReadDispatcher,
} from '@framers/agentos/read-router';
```

## Usage

### Decide-only

```ts
const router = new ReadRouter({
  classifier: new LLMReadIntentClassifier({ llm: openaiAdapter }),
  preset: 'precise-fact',
});

const { classifier, routing } = await router.decide(query, evidenceChunks);
console.log(classifier.intent);          // 'multi-source-synthesis'
console.log(routing.chosenStrategy);     // 'two-call-extract-answer'
console.log(routing.estimatedCostUsd);   // 0.0280
```

### Decide + dispatch

```ts
type Answer = { text: string; citations: string[] };

const router = new ReadRouter({
  classifier: new LLMReadIntentClassifier({ llm: openaiAdapter }),
  preset: 'precise-fact',
  dispatcher: new FunctionReadDispatcher<Answer>({
    'single-call': async (q, evidence) => singleCallReader(q, evidence),
    'two-call-extract-answer': async (q, evidence) => twoCallReader(q, evidence),
    'commit-vs-abstain': async (q, evidence) => commitOrAbstainReader(q, evidence),
    'verbatim-citation': async (q, evidence) => verbatimReader(q, evidence),
    'scratchpad-then-answer': async (q, evidence) => scratchpadReader(q, evidence),
  }),
});

const { decision, outcome } = await router.decideAndDispatch(query, evidenceChunks);
```

### Manual intent override

```ts
const decision = await router.decide(query, evidence, {
  manualIntent: 'time-interval',  // skip classifier
});
```

## API surface

- `ReadIntent`, `ReadStrategyId`, `ReadRouterPreset`, `ReadRoutingTable`
- `READ_INTENTS`
- `PRECISE_FACT_TABLE`, `SYNTHESIS_TABLE`, `TEMPORAL_TABLE`, `PRESET_READ_TABLES`
- `ReadStrategyCostPoint`, `DEFAULT_READ_COSTS`
- `selectReadStrategy` (pure)
- `ReadRoutingDecision`, `ReadRouterConfig`, `ReadBudgetMode`
- `IReadIntentClassifier`, `LLMReadIntentClassifier`
- `READ_INTENT_CLASSIFIER_SYSTEM_PROMPT`, `READ_INTENT_CLASSIFIER_SYSTEM_PROMPT_FEWSHOT`
- `IReadDispatcher`, `FunctionReadDispatcher`
- `ReadRouter`, `ReadRouterOptions`, `ReadRouterDecideOptions`, `ReadRouterDispatchedResult`
- Errors: `ReadRouterUnknownIntentError`, `ReadRouterBudgetExceededError`, `UnsupportedReadStrategyError`, `ReadRouterDispatcherMissingError`

## Related

- `@framers/agentos/ingest-router` — input-stage sibling
- `@framers/agentos/memory-router` — recall-stage sibling
- `@framers/agentos/cognitive-pipeline` — composition primitive
- `@framers/agentos/core/guardrails` + `agentos-ext-grounding-guard` — output-stage validation
