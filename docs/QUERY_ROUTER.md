# Query Router

AgentOS includes a `QueryRouter` that turns one user question into a three-stage pipeline:

1. classify the query into tier `0` through `3`
2. retrieve the right amount of context
3. generate a grounded answer from that context

## What Is Live Today

- Tier classification uses an LLM prompt with corpus topics, recent conversation history, and optional tool names.
- The router embeds local markdown docs into an in-memory vector store when an embedding provider is available.
- If embeddings are unavailable or vector search fails, the router falls back to keyword search automatically.
- Result metadata includes `tiersUsed` and `fallbacksUsed`.
- Lifecycle events cover classification, retrieval, research, generation, and route completion.

## Current Limitations

The QueryRouter scaffold is ahead of the wired runtime in a few places:

- `graphExpand()` is still a placeholder, so tier 2 is currently vector-first retrieval plus rerank fallback behavior.
- `rerank()` is still a placeholder and currently returns the first `topN` chunks.
- `deepResearch()` is still a placeholder, so tier 3 currently behaves like tier 2 unless you replace that path in a downstream integration.
- The router is useful today for query classification, vector retrieval, keyword fallback, and grounded answer generation, but it is not yet a full GraphRAG or web-research runtime.

## Example

```ts
import { QueryRouter } from '@framers/agentos';

const router = new QueryRouter({
  knowledgeCorpus: ['./docs', './packages/agentos/docs'],
  availableTools: ['web_search', 'deep_research'],
});

await router.init();

const result = await router.route('How does memory retrieval work?');

console.log(result.answer);
console.log(result.classification.tier);
console.log(result.tiersUsed);
console.log(result.fallbacksUsed);
console.log(result.sources);

await router.close();
```

## Config Notes

- `knowledgeCorpus` is required.
- `availableTools` is optional and is only used to help the classifier reason about what the runtime can do.
- `deepResearchEnabled` controls whether the tier-3 research branch is attempted, but the default core implementation is still placeholder-only.
- `onClassification` and `onRetrieval` are hooks for consumers that want lightweight runtime integration without reading the full event stream.

## Result Metadata

`QueryResult` includes:

- `classification`: the final classification result
- `sources`: citations built from retrieved chunks
- `tiersUsed`: the tiers actually exercised after fallbacks
- `fallbacksUsed`: retrieval/classification fallback strategy names such as `keyword-fallback` or `research-skip`

## Events

The router records typed events for:

- `classify:start`
- `classify:complete`
- `classify:error`
- `retrieve:*`
- `research:*`
- `generate:*`
- `route:complete`

These events are intended for observability, audit trails, and future workbench/runtime inspection surfaces.
