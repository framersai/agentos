# HyDE (Hypothetical Document Embedding) Retrieval

HyDE improves RAG and memory retrieval by generating a hypothetical answer before
embedding. Instead of embedding the raw user query, HyDE first asks an LLM to
produce a plausible answer, then embeds *that* answer for vector search. The
hypothesis is semantically closer to actual stored documents than a question is,
yielding better recall.

Based on:
- Gao et al. 2023 "Precise Zero-Shot Dense Retrieval without Relevance Labels"
- Lei et al. 2025 "Never Come Up Empty: Adaptive HyDE Retrieval for Improving
  LLM Developer Support"

## How It Works

```
Standard:  Query --> Embed(query)       --> Vector Search --> Results
HyDE:     Query --> LLM(hypothesis)    --> Embed(hypothesis) --> Vector Search --> Results
                    ^                         ^
                    Extra LLM call            Better semantic match
```

The key insight: questions and answers live in different regions of embedding
space. A question like "What causes memory leaks in Node?" is far from the
answer text "Memory leaks in Node.js are caused by...". But a hypothetical
answer *generated from the question* is much closer to the stored answer,
producing higher cosine similarity scores.

## When to Use HyDE

**Good candidates:**
- Knowledge base queries where the question phrasing differs from document style
- Vague or exploratory queries ("that thing about deployment")
- Memory recall where stored traces are statement-form, not question-form
- Background/batch processing where latency is less critical

**Avoid when:**
- Real-time chat with tight latency budgets (adds one LLM call per query)
- Simple keyword-style lookups where direct embedding already works well
- The query is already in statement/answer form

## Configuration

### agent.config.json

HyDE is configured per-request, not globally. The `HydeRetriever` class and
its config types are exported from `@framers/agentos/rag`.

```json
{
  "rag": {
    "hyde": {
      "enabled": true,
      "initialThreshold": 0.7,
      "minThreshold": 0.3,
      "thresholdStep": 0.1,
      "adaptiveThreshold": true,
      "maxHypothesisTokens": 200,
      "fullAnswerGranularity": true
    }
  }
}
```

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | `boolean` | `false` | Master switch for HyDE |
| `initialThreshold` | `number` | `0.7` | Starting similarity threshold |
| `minThreshold` | `number` | `0.3` | Lowest threshold before giving up |
| `thresholdStep` | `number` | `0.1` | How much to reduce threshold per step |
| `adaptiveThreshold` | `boolean` | `true` | Enable step-down when no results found |
| `maxHypothesisTokens` | `number` | `200` | Max tokens for hypothesis generation |
| `fullAnswerGranularity` | `boolean` | `true` | Generate full prose answers vs keywords |

## Programmatic API

### 1. RetrievalAugmentor (main RAG pipeline)

```typescript
import { RetrievalAugmentor } from '@framers/agentos/rag';

// Stand-ins. Replace with your real EmbeddingManager / VectorStoreManager
// instances and a RetrievalAugmentorConfig your runtime provides.
declare const config: any;
declare const embeddingManager: any;
declare const vectorStoreManager: any;
declare const openai: any;

const augmentor = new RetrievalAugmentor();
await augmentor.initialize(config, embeddingManager, vectorStoreManager);

// Register an LLM caller for hypothesis generation
augmentor.setHydeLlmCaller(async (systemPrompt, userPrompt) => {
  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    max_tokens: 200,
  });
  return response.choices[0].message.content ?? '';
});

// Enable HyDE per-request
const result = await augmentor.retrieveContext('What causes memory leaks?', {
  hyde: {
    enabled: true,
    // Optional: pre-supply a hypothesis to skip the LLM call
    // hypothesis: 'Memory leaks are caused by...',
    // Optional: tune thresholds for this request
    // initialThreshold: 0.8,
    // minThreshold: 0.4,
  },
});

// HyDE diagnostics are in the result
console.log(result.diagnostics?.hyde);
// {
//   hypothesis: 'Memory leaks in Node.js are typically caused by...',
//   hypothesisLatencyMs: 342,
//   effectiveThreshold: 0.7,
//   thresholdSteps: 0,
// }
```

### 2. MultimodalIndexer (cross-modal search)

```typescript
import { MultimodalIndexer, HydeRetriever } from '@framers/agentos/rag';

// Stand-ins for the host-supplied dependencies.
declare const embeddingManager: any;
declare const vectorStore: any;
declare const visionProvider: any;
declare const myLlmCaller: any;

const indexer = new MultimodalIndexer({
  embeddingManager,
  vectorStore,
  visionProvider,
});

// Attach a HyDE retriever
indexer.setHydeRetriever(new HydeRetriever({
  llmCaller: myLlmCaller,
  embeddingManager,
  config: { enabled: true },
}));

// Search with HyDE
const results = await indexer.search('architecture diagram', {
  modalities: ['image'],
  hyde: { enabled: true },
});
```

### 3. CognitiveMemoryManager (memory recall)

```typescript
import { CognitiveMemoryManager, HydeRetriever } from '@framers/agentos';

// Stand-ins for the host-supplied dependencies.
declare const config: any;
declare const myLlmCaller: any;
declare const embeddingManager: any;
declare const currentMood: any;

const memoryManager = new CognitiveMemoryManager();
await memoryManager.initialize(config);

// Attach a HyDE retriever
memoryManager.setHydeRetriever(new HydeRetriever({
  llmCaller: myLlmCaller,
  embeddingManager,
  config: { enabled: true },
}));

// Retrieve memories with HyDE
const result = await memoryManager.retrieve(
  'that deployment discussion',
  currentMood,
  { hyde: true },
);
```

### 4. Standalone HydeRetriever

```typescript
import { HydeRetriever } from '@framers/agentos/rag';

const retriever = new HydeRetriever({
  llmCaller: async (system, user) => {
    // Your LLM call here
    return hypotheticalAnswer;
  },
  embeddingManager,
  config: {
    enabled: true,
    adaptiveThreshold: true,
    initialThreshold: 0.7,
    minThreshold: 0.3,
  },
});

// Generate hypothesis only
const { hypothesis, latencyMs } = await retriever.generateHypothesis(
  'What is retrieval augmented generation?',
);

// Full retrieve cycle with adaptive thresholding
const result = await retriever.retrieve({
  query: 'What is RAG?',
  vectorStore: myVectorStore,
  collectionName: 'knowledge-base',
});
```

## Adaptive Thresholding

HyDE supports adaptive threshold stepping: if no results are found at the
initial similarity threshold, it steps down until content is found or the
minimum threshold is reached. This ensures HyDE never "comes up empty."

```
Initial threshold: 0.7  -->  No results
Step down to:      0.6  -->  No results
Step down to:      0.5  -->  Found 3 results!  (stop here)
```

The `thresholdSteps` diagnostic tells you how many steps were needed.

## Audit Trail

When `includeAudit: true` is passed to `retrieveContext()`, HyDE operations
appear in the audit trail with operation type `'hyde'`:

```typescript
const result = await augmentor.retrieveContext(query, {
  hyde: { enabled: true },
  includeAudit: true,
});

const hydeOp = result.auditTrail?.operations.find(
  (op) => op.operationType === 'hyde',
);
// hydeOp.hydeDetails.hypothesis
// hydeOp.hydeDetails.effectiveThreshold
// hydeOp.hydeDetails.thresholdSteps
// hydeOp.tokenUsage (embedding + LLM tokens)
```

## Performance Implications

| Metric | Without HyDE | With HyDE |
|--------|-------------|-----------|
| LLM calls per query | 0 | 1 |
| Embedding calls | 1 | 1 (hypothesis instead of query) |
| Vector searches | 1 | 1-N (N = adaptive steps) |
| Typical added latency | 0 | 200-500ms (LLM generation) |
| Recall improvement | baseline | +10-30% on vague queries |

The LLM call uses a small, fast model by default (configured via the caller).
Using `gpt-4o-mini` or similar keeps latency under 300ms for most queries.

## Graceful Degradation

HyDE degrades gracefully in all failure scenarios:

1. **No LLM caller registered**: Falls back to direct query embedding with a
   diagnostic message.
2. **LLM call fails**: Falls back to direct query embedding.
3. **Hypothesis embedding fails**: Falls back to direct query embedding.
4. **No results at any threshold**: Returns empty results (same as without HyDE).

The system never throws due to HyDE failures -- it always falls back to the
standard retrieval path.
