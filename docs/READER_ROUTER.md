# Reader Router

Stage 3 of the [Classifier-Driven Memory Pipeline](./COGNITIVE_PIPELINE.md). Picks the best answer reader per query, dispatched per category, on top of whatever retrieval architecture [MemoryRouter](./MEMORY_ROUTER.md) chose.

This is the read-stage primitive. Sibling primitives: [Ingest Router](./INGEST_ROUTER.md), [Memory Router](./MEMORY_ROUTER.md), [Read Router](./READ_ROUTER.md).

Validated on LongMemEval-S Phase B N=500 alongside MemoryRouter: **85.6% [82.4%, 88.6%] at $0.0090/correct, 4 second avg latency**. Beats Mastra OM gpt-4o (84.2% published) on accuracy. Beats EmergenceMem Simple Fast (80.6% measured apples-to-apples in our harness) by +5.0 pp at 6.5× lower cost-per-correct.

## What it actually does

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

## Why route at all

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

## Calibration table

The shipped table is `MIN_COST_BEST_CAT_2026_04_28`, derived from the Phase B per-category data above. For each category, the table picks the reader that produces higher accuracy. When accuracies are within statistical noise (single-session-assistant, knowledge-update), the table picks the cheaper reader (gpt-5-mini at ~12× lower per-token cost than gpt-4o).

```ts
import { ReaderRouter } from '@framers/agentos/memory-router';

const router = new ReaderRouter({
  preset: 'min-cost-best-cat-2026-04-28',
  classifier: gpt5miniClassifier,  // reuses MemoryRouter's classifier output when available
  readers: {
    'gpt-4o': gpt4oReader,
    'gpt-5-mini': gpt5miniReader,
  },
});

const reader = router.dispatch(predictedCategory);
```

## Standalone-classifier mode

When ReaderRouter is the only classifier-firing primitive in the pipeline (no [MemoryRouter](./MEMORY_ROUTER.md), no [QueryClassifier T1+](./QUERY_ROUTER.md) producing a category), it fires its own gpt-5-mini few-shot classifier per query (~$0.0001 / query) so the dispatch still works.

When ReaderRouter runs alongside MemoryRouter (the typical config), it consumes the MemoryRouter classifier's output and adds zero LLM calls.

## Cost per case

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

## When to use ReaderRouter alone vs with MemoryRouter

| Scenario | Use ReaderRouter alone | Use ReaderRouter + MemoryRouter |
|---|---|---|
| Single retrieval architecture (canonical-hybrid only) | yes | |
| Need to dispatch between memory backends (canonical-hybrid vs observational-memory) | | yes |
| Question category breakdown matters but architecture doesn't | yes | |
| Long-haystack scenarios where OM compression helps | | yes |
| Sem-embed era LongMemEval-S (this benchmark's headline) | yes (canonical-hybrid for all categories) | (Tier 3 minimize-cost preset's MS+SSP → OM-v11 routing was calibrated on CharHash retrieval and is now stale; see [Memory Router](./MEMORY_ROUTER.md)) |

## Related

- [Cognitive Pipeline](./COGNITIVE_PIPELINE.md) - the three-stage classifier dispatch this fits inside
- [Query Router](./QUERY_ROUTER.md) - Stage 1, the memory-or-not gate
- [Memory Router](./MEMORY_ROUTER.md) - Stage 2, the architecture dispatch
- [Read Router](./READ_ROUTER.md) - read intent dispatch (composable sibling)
- [agentos-bench](https://github.com/framersai/agentos-bench) - reproducible run JSONs, full transparency stack
