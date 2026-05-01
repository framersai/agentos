# Read Stage Routing

Stage 3 of the [Cognitive Pipeline](./COGNITIVE_PIPELINE.md). Two sibling primitives, both at the read stage, both classifier-driven, both orthogonal:

- **[Read Router](#read-router--read-strategy-selection)** picks the reader **strategy** (`single-call`, `two-call-extract-answer`, `commit-vs-abstain`, `verbatim-citation`, `scratchpad-then-answer`) based on a classified read **intent**. It controls *how* the reader generates the answer.
- **[Reader Router](#reader-router--reader-model-selection)** picks the reader **model** (`gpt-4o` vs `gpt-5-mini`) based on the query **category** (single-session-user, multi-session, temporal-reasoning, etc.). It controls *which model* generates the answer.

The two primitives compose. A typical Phase B configuration runs both: Reader Router decides the model, Read Router decides the strategy that model follows.

Sibling stage primitives: [Ingest Router](./INGEST_ROUTER.md) (input), [Memory Router](./MEMORY_ROUTER.md) (recall).

---

## Read Router — read-strategy selection

Classifies a query+evidence pair and picks a reader strategy. Different intents need different strategies:

- A precise-fact lookup with clear evidence works fine with one reader call.
- A multi-source synthesis question benefits from two-call extract-then-answer (the Emergence Simple pattern reduces distractor influence).
- A time-interval question needs an explicit scratchpad to reason about dates before committing.
- An adversarial question (likely unanswerable from evidence) needs commit-vs-abstain to avoid wrong commits on missing evidence.

Picking the wrong strategy costs accuracy or money — usually both. Read Router classifies the query+evidence and picks per-message.

### Five read intents

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

### Five reader strategies

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

### Three shipping presets

| Preset | Strategy mix | When to use |
|---|---|---|
| `precise-fact` (default) | single-call for facts, two-call for synthesis, scratchpad for time | balanced workloads with mixed intents |
| `synthesis` | two-call for synthesis + preferences, verbatim for facts | synthesis-heavy workloads (multi-doc Q&A, research) |
| `temporal` | scratchpad for facts/synthesis/time | time-heavy workloads (timelines, scheduling) |

### Quickstart

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

### Decision-only flow

```ts
const { classifier, routing } = await router.decide(query, evidence);

if (routing.chosenStrategy === 'commit-vs-abstain') {
  // your custom abstain-aware reader
}
```

### Manual intent override

```ts
const decision = await router.decide(query, evidence, {
  manualIntent: 'time-interval',  // skip classifier
});
```

### Few-shot classifier prompt

```ts
const router = new ReadRouter({
  classifier,
  preset: 'precise-fact',
  useFewShotPrompt: true,
});
```

### API surface

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

---

## Reader Router — reader-model selection

Picks the best answer reader per query, dispatched per category, on top of whatever retrieval architecture [MemoryRouter](./MEMORY_ROUTER.md) chose.

Validated on LongMemEval-S Phase B N=500 alongside MemoryRouter: **85.6% [82.4%, 88.6%] at $0.0090/correct, 4 second avg latency**. Beats Mastra OM gpt-4o (84.2% published) on accuracy. Beats EmergenceMem Simple Fast (80.6% measured apples-to-apples in our harness) by +5.0 pp at 6.5× lower cost-per-correct.

### What it actually does

When a query arrives, the [QueryClassifier](./QUERY_ROUTER.md) at Stage 1 already produced a category prediction (one of six: single-session-user, single-session-assistant, single-session-preference, knowledge-update, multi-session, temporal-reasoning). ReaderRouter consumes that prediction at Stage 3 and dispatches the answer call to the reader tier best-suited to that category:

```
predicted_category ──► reader_tier
  temporal-reasoning ──► gpt-4o     (long-context arithmetic + ordering)
  single-session-user ──► gpt-4o    (exact recall of user statements)
  single-session-assistant ──► gpt-5-mini  (shorter answers from assistant outputs)
  single-session-preference ──► gpt-5-mini (preference questions structure well in scratchpad)
  knowledge-update ──► gpt-5-mini   (current-state lookup)
  multi-session ──► gpt-5-mini      (cross-session synthesis from chunks)
```

Each reader gets the retrieved context from Stage 2 plus the question. The router itself adds zero LLM calls because it reuses Stage 1's classification output.

### Why route at all

Two readers behave very differently on the same retrieved evidence. Per-category Phase B at full N=500 on the same retrieval stack (canonical-hybrid + sem-embed):

| Category | gpt-4o reader | gpt-5-mini reader | Best pick |
|---|---:|---:|---|
| temporal-reasoning (n=133) | **84.7%** | 72.9% | gpt-4o (+11.8 pp) |
| single-session-user (n=70) | **94.3%** | 90.0% | gpt-4o (+4.3 pp) |
| single-session-preference (n=30) | 63.3% | **86.7%** | gpt-5-mini (+23.4 pp) |
| single-session-assistant (n=56) | 98.2% | **100.0%** | gpt-5-mini (cheaper, ties or wins) |
| knowledge-update (n=78) | 85.7% | **87.2%** | gpt-5-mini (cheaper, ties or wins) |
| multi-session (n=133) | 76.2% | **79.7%** | gpt-5-mini (+3.5 pp) |
| **Aggregate** | **83.2%** | **83.2%** | **tied** |

At a fixed reader, aggregate accuracy is the same. The two readers tie at 83.2% on aggregate, but their per-category profiles are mirror images. Routing per category produces a Pareto improvement over either reader alone: **+1.4 pp aggregate, dominated by the +10 pp lift on single-session-preference (76.7% gpt-4o → 86.7% gpt-5-mini at the same retrieval).** Plus 47% of cases now route to the cheaper gpt-5-mini reader, dropping cost-per-correct.

### Calibration table

The shipped table is `MIN_COST_BEST_CAT_2026_04_28`, derived from the Phase B per-category data above. For each category, the table picks the reader that produces higher accuracy. When accuracies are within statistical noise (single-session-assistant, knowledge-update), the table picks the cheaper reader (gpt-5-mini at ~12× lower per-token cost than gpt-4o).

```ts
import { selectReader } from '@framers/agentos/memory-router';

// `selectReader(category, preset)` looks up the right reader tier in the
// shipped calibration table and returns the model identifier ('gpt-4o' or
// 'gpt-5-mini'). The caller dispatches to the configured reader for that
// tier — typically the same reader instance the rest of the pipeline uses.
const tier = selectReader(predictedCategory, 'min-cost-best-cat-2026-04-28');
const reader = tier === 'gpt-4o' ? gpt4oReader : gpt5miniReader;
```

When the predicted category is missing or the preset name is unknown, the
function throws `ReaderRouterUnknownCategoryError` /
`ReaderRouterUnknownPresetError` (both exported from the same module).
Use them to surface clear diagnostics in the calling pipeline.

### Standalone-classifier mode

When ReaderRouter is the only classifier-firing primitive in the pipeline (no [MemoryRouter](./MEMORY_ROUTER.md), no [QueryClassifier T1+](./QUERY_ROUTER.md) producing a category), it fires its own gpt-5-mini few-shot classifier per query (~$0.0001 / query) so the dispatch still works.

When ReaderRouter runs alongside MemoryRouter (the typical config), it consumes the MemoryRouter classifier's output and adds zero LLM calls.

### Why the default classifier is gpt-5-mini and not gpt-4o

Two independent Phase B measurements at full N=500 on LongMemEval-S confirm that upgrading the classifier from `gpt-5-mini` to `gpt-4o` does NOT lift aggregate accuracy on this benchmark, while costing ~12× more per query:

| Configuration | gpt-5-mini classifier | gpt-4o classifier | Δ |
|---|---:|---:|---|
| Tier 3 + reader router | 84.8% [81.6%, 87.8%] | 84.4% [81.2%, 87.6%] | tied, gpt-4o classifier 87% more expensive |
| Canonical-hybrid + reader router (the 85.6% headline base) | 85.6% [82.4%, 88.6%] | 84.0% [80.6%, 87.0%] | gpt-4o classifier −1.6 pp at +44% cost-per-correct |

In both runs, the gpt-4o classifier reclassifies edge cases more aggressively, gaining marginally on SSU/SSA/SSP (always within CI) but losing meaningfully on KU (-3.9 to -5.1 pp) and MS (-5.2 pp on the second measurement) as edge cases get routed away from their gpt-5-mini-best dispatch tier.

The `--om-classifier-model gpt-4o` flag remains wired in for per-workload empirical testing — workloads with very different category distributions from LongMemEval-S may see a meaningful lift — but on this benchmark's category mix the recommended default is unambiguously `gpt-5-mini`.

### Cost per case

```
1. Classifier:     ~660 input + 10 output tokens   ~$0.000138/case
2. Dispatched reader (per case):
     ~47% gpt-4o   ~5K-8K in + 20 out                ~$0.0125
     ~53% gpt-5-mini ~5K-8K in + 20 out              ~$0.0010
   Average reader cost: 0.47 × $0.0125 + 0.53 × $0.0010   ~$0.0064/case
3. (Judge call out-of-band)

Per-case AgentOS LLM cost: ~$0.00768/case (measured: $3.84 / 500 = $0.00768)
```

vs the prior 84.8% Tier 3 + ReaderRouter headline at $0.0410/correct, dropping the policy router's MS/SSP → OM-v11 routing (which imposed 60-120 sec observer pipelines per OM-routed case) is **4.6× cheaper per correct, 5.3× faster avg latency, 15× faster on the p95 tail**.

### When to use ReaderRouter alone vs with MemoryRouter

| Scenario | Use ReaderRouter alone | Use ReaderRouter + MemoryRouter |
|---|---|---|
| Single retrieval architecture (canonical-hybrid only) | yes | |
| Need to dispatch between memory backends (canonical-hybrid vs observational-memory) | | yes |
| Question category breakdown matters but architecture doesn't | yes | |
| Long-haystack scenarios where OM compression helps | | yes |
| Sem-embed era LongMemEval-S (this benchmark's headline) | yes (canonical-hybrid for all categories) | (Tier 3 minimize-cost preset's MS+SSP → OM-v11 routing was calibrated on CharHash retrieval and is now stale; see [Memory Router](./MEMORY_ROUTER.md)) |

---

## Related

- [Cognitive Pipeline](./COGNITIVE_PIPELINE.md) — composition primitive that wires Read Router + Reader Router into a single pipeline
- [Ingest Router](./INGEST_ROUTER.md) — input stage sibling
- [Memory Router](./MEMORY_ROUTER.md) — recall stage sibling (produces the evidence the read stage consumes)
- [Query Router](./QUERY_ROUTER.md) — Stage 1, the memory-or-not gate (also produces the category that Reader Router consumes)
- [Citation Verification](./features/citation-verification.md) — output-stage validation that runs after the reader
- [agentos-bench](https://github.com/framersai/agentos-bench) — reproducible run JSONs, full transparency stack
