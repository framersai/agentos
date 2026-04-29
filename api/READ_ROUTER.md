# Read Router

Read-stage smart orchestrator. Classifies a query+evidence pair and picks a reader strategy: `single-call`, `two-call-extract-answer`, `commit-vs-abstain`, `verbatim-citation`, or `scratchpad-then-answer`. The third stage of the [Cognitive Pipeline](./COGNITIVE_PIPELINE.md).

## What it actually does

After the recall stage produces evidence, the reader decides HOW to generate the answer. Different intents need different strategies:

- A precise-fact lookup with clear evidence works fine with one reader call.
- A multi-source synthesis question benefits from two-call extract-then-answer (the Emergence Simple pattern reduces distractor influence).
- A time-interval question needs an explicit scratchpad to reason about dates before committing.
- An adversarial question (likely unanswerable from evidence) needs commit-vs-abstain to avoid wrong commits on missing evidence.

Picking the wrong strategy costs accuracy or money — usually both. Read Router classifies the query+evidence and picks per-message.

## Five read intents

```ts
type ReadIntent =
  | 'precise-fact'
  | 'multi-source-synthesis'
  | 'time-interval'
  | 'preference-recommendation'
  | 'abstention-candidate';
```

| Intent | Examples |
|---|---|
| `precise-fact` | "What is X's email?", "When was the last release?" |
| `multi-source-synthesis` | "Summarize all topics", "Aggregate counts across sessions" |
| `time-interval` | "How many days since X?", "In what order did Y, Z, W happen?" |
| `preference-recommendation` | "Any tips for X?", "Can you suggest Y?" |
| `abstention-candidate` | likely unanswerable from evidence |

## Five reader strategies

```ts
type ReadStrategyId =
  | 'single-call'
  | 'two-call-extract-answer'
  | 'commit-vs-abstain'
  | 'verbatim-citation'
  | 'scratchpad-then-answer';
```

| Strategy | Calls | Cost (illustrative) | Description |
|---|---:|---:|---|
| `single-call` | 1 | $0.0150 | one reader.invoke call |
| `two-call-extract-answer` | 2 | $0.0280 | claim extraction + answer call |
| `commit-vs-abstain` | 2 | $0.0220 | binary commit/abstain + answer-or-refuse |
| `verbatim-citation` | 1 | $0.0170 | single call with verbatim-quote rule |
| `scratchpad-then-answer` | 1 | $0.0190 | single call with scratchpad scaffold |

## Three shipping presets

| Preset | Strategy mix | When to use |
|---|---|---|
| `precise-fact` (default) | single-call for facts, two-call for synthesis, scratchpad for time | balanced workloads with mixed intents |
| `synthesis` | two-call for synthesis + preferences, verbatim for facts | synthesis-heavy workloads (multi-doc Q&A, research) |
| `temporal` | scratchpad for facts/synthesis/time | time-heavy workloads (timelines, scheduling) |

## Quickstart

```ts
import {
  LLMReadIntentClassifier,
  ReadRouter,
  FunctionReadDispatcher,
} from '@framers/agentos/read-router';

type Answer = { text: string; citations: string[] };

const router = new ReadRouter({
  classifier: new LLMReadIntentClassifier({ llm: openaiAdapter }),
  preset: 'precise-fact',
  budget: { perReadUsd: 0.025, mode: 'cheapest-fallback' },
  dispatcher: new FunctionReadDispatcher<Answer>({
    'single-call': async (q, evidence) => mySingleCallReader(q, evidence),
    'two-call-extract-answer': async (q, evidence) => myTwoCallReader(q, evidence),
    'commit-vs-abstain': async (q, evidence) => myCommitOrAbstainReader(q, evidence),
    'verbatim-citation': async (q, evidence) => myVerbatimReader(q, evidence),
    'scratchpad-then-answer': async (q, evidence) => myScratchpadReader(q, evidence),
  }),
});

const { decision, outcome } = await router.decideAndDispatch(query, evidenceChunks);
console.log(decision.classifier.intent);          // 'multi-source-synthesis'
console.log(decision.routing.chosenStrategy);     // 'two-call-extract-answer'
console.log(decision.routing.estimatedCostUsd);   // 0.0280
console.log(outcome.text);                         // final answer
```

## Decision-only flow

```ts
const { classifier, routing } = await router.decide(query, evidence);

if (routing.chosenStrategy === 'commit-vs-abstain') {
  // your custom abstain-aware reader
}
```

## Manual intent override

```ts
const decision = await router.decide(query, evidence, {
  manualIntent: 'time-interval',  // skip classifier
});
```

## Few-shot classifier prompt

```ts
const router = new ReadRouter({
  classifier,
  preset: 'precise-fact',
  useFewShotPrompt: true,
});
```

## API surface

- `ReadIntent`, `ReadStrategyId`, `ReadRouterPreset`, `ReadRoutingTable`
- `READ_INTENTS`
- `PRECISE_FACT_TABLE`, `SYNTHESIS_TABLE`, `TEMPORAL_TABLE`, `PRESET_READ_TABLES`
- `ReadStrategyCostPoint`, `DEFAULT_READ_COSTS`, plus per-strategy constants
- `selectReadStrategy` (pure)
- `ReadRoutingDecision`, `ReadRouterConfig`, `ReadBudgetMode`
- `IReadIntentClassifier`, `IReadIntentClassifierLLM`, `LLMReadIntentClassifier`
- `READ_INTENT_CLASSIFIER_SYSTEM_PROMPT`, `READ_INTENT_CLASSIFIER_SYSTEM_PROMPT_FEWSHOT`
- `IReadDispatcher`, `FunctionReadDispatcher`
- `ReadRouter`, `ReadRouterOptions`, `ReadRouterDecideOptions`, `ReadRouterDispatchedResult`
- Errors: `ReadRouterUnknownIntentError`, `ReadRouterBudgetExceededError`, `UnsupportedReadStrategyError`, `ReadRouterDispatcherMissingError`

## Related

- [Cognitive Pipeline](./COGNITIVE_PIPELINE.md) — composition primitive
- [Ingest Router](./INGEST_ROUTER.md) — input stage sibling
- [Memory Router](./MEMORY_ROUTER.md) — recall stage sibling (produces the evidence the read stage consumes)
- [Citation Verification](./features/citation-verification.md) — output-stage validation that runs after the reader
