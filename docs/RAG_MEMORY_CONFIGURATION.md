# RAG and Memory Configuration

AgentOS supports two complementary ways to add long-term context to a model call:

1. **Prompt-injected long-term memory** via `longTermMemoryRetriever` (returns pre-formatted text).
2. **Embedding-based RAG** via `IRetrievalAugmentor` (retrieves context from vector stores and can ingest new memories).

This document focuses on the embedding-based path (RetrievalAugmentor), and how it interacts with persona `memoryConfig.ragConfig`.

## What Exists Today (API Reality)

- `AgentOS` does **not** currently expose convenience methods like `agent.memory.ingest()` or `agent.memory.search()`.
- The concrete RAG APIs live under `@framers/agentos/rag`:
  - `EmbeddingManager`
  - `VectorStoreManager`
  - `RetrievalAugmentor`
  - Optional: `GraphRAGEngine` (TypeScript-native)

If you want a high-level “memory service” API, implement it as a thin wrapper around `IRetrievalAugmentor` (or expose it as a tool).

## Enabling RAG In AgentOS

There are two supported ways to provide an augmentor to GMIs.

### Option A: Provide a ready `retrievalAugmentor` instance

You construct and initialize the augmentor yourself, then pass it into `AgentOS.initialize()`:

```ts
import { AgentOS } from '@framers/agentos';
import { EmbeddingManager, VectorStoreManager, RetrievalAugmentor } from '@framers/agentos/rag';
import { AIModelProviderManager } from '@framers/agentos/core/llm/providers/AIModelProviderManager';

// 1) Provider manager (must support embeddings for your chosen embedding model)
const providers = new AIModelProviderManager();
await providers.initialize({
  providers: [
    {
      providerId: 'openai',
      enabled: true,
      isDefault: true,
      config: { apiKey: process.env.OPENAI_API_KEY },
    },
  ],
});

// 2) Embeddings
const embeddingManager = new EmbeddingManager();
await embeddingManager.initialize(
  {
    embeddingModels: [
      { modelId: 'text-embedding-3-small', providerId: 'openai', dimension: 1536, isDefault: true },
    ],
  },
  providers,
);

// 3) Vector stores + data sources
const vectorStoreManager = new VectorStoreManager();
await vectorStoreManager.initialize(
  {
    managerId: 'rag-vsm',
    providers: [
      {
        id: 'sql-store',
        type: 'sql',
        storage: { filePath: './data/agentos_vectors.db', priority: ['better-sqlite3', 'sqljs'] },
      },
    ],
    defaultProviderId: 'sql-store',
    defaultEmbeddingDimension: 1536,
  },
  [
    {
      dataSourceId: 'voice_conversation_summaries',
      displayName: 'Conversation Summaries',
      vectorStoreProviderId: 'sql-store',
      actualNameInProvider: 'voice_conversation_summaries',
      embeddingDimension: 1536,
      isDefaultIngestionSource: true,
      isDefaultQuerySource: true,
    },
  ],
);

// 4) Retrieval augmentor
const rag = new RetrievalAugmentor();
await rag.initialize(
  {
    defaultDataSourceId: 'voice_conversation_summaries',
    categoryBehaviors: [],
  },
  embeddingManager,
  vectorStoreManager,
);

// 5) Pass into AgentOS
const agentos = new AgentOS();
await agentos.initialize({
  // ...your normal AgentOSConfig...
  retrievalAugmentor: rag,
  manageRetrievalAugmentorLifecycle: true,
});
```

### Option B: Let AgentOS create the RAG subsystem (`ragConfig`)

If you don’t want to manage instantiation, use `AgentOSConfig.ragConfig`. AgentOS will create:
`EmbeddingManager` → `VectorStoreManager` → `RetrievalAugmentor`, and pass the augmentor into GMIs.

```ts
import { AgentOS } from '@framers/agentos';

const agentos = new AgentOS();
await agentos.initialize({
  // ...your normal AgentOSConfig...
  ragConfig: {
    embeddingManagerConfig: {
      embeddingModels: [
        { modelId: 'text-embedding-3-small', providerId: 'openai', dimension: 1536, isDefault: true },
      ],
    },
    vectorStoreManagerConfig: {
      managerId: 'rag-vsm',
      providers: [
        { id: 'sql-store', type: 'sql', storage: { filePath: './data/agentos_vectors.db' } },
      ],
      defaultProviderId: 'sql-store',
      defaultEmbeddingDimension: 1536,
    },
    dataSourceConfigs: [
      {
        dataSourceId: 'voice_conversation_summaries',
        displayName: 'Conversation Summaries',
        vectorStoreProviderId: 'sql-store',
        actualNameInProvider: 'voice_conversation_summaries',
        embeddingDimension: 1536,
        isDefaultIngestionSource: true,
        isDefaultQuerySource: true,
      },
    ],
    retrievalAugmentorConfig: {
      defaultDataSourceId: 'voice_conversation_summaries',
      categoryBehaviors: [],
    },
  },
});
```

Notes:
- If `retrievalAugmentor` is provided, it takes precedence over `ragConfig`.
- `ragConfig.manageLifecycle` defaults to `true`.
- `ragConfig.bindToStorageAdapter` defaults to `true` and will inject AgentOS’ `storageAdapter` into **SQL vector store providers that did not specify `adapter` or `storage`**.

## Persona `memoryConfig.ragConfig` (Triggers and Data Sources)

RAG retrieval/ingestion in the GMI is driven by persona configuration. At minimum:

- `memoryConfig.ragConfig.enabled = true`
- `retrievalTriggers.onUserQuery = true` to retrieve on user turns
- `ingestionTriggers.onTurnSummary = true` to ingest post-turn summaries
- `defaultIngestionDataSourceId` set to a data source you configured in the RAG subsystem

Minimal example (persona JSON):

```json
{
  "memoryConfig": {
    "enabled": true,
    "ragConfig": {
      "enabled": true,
      "retrievalTriggers": { "onUserQuery": true },
      "ingestionTriggers": { "onTurnSummary": true },
      "defaultRetrievalTopK": 5,
      "defaultIngestionDataSourceId": "voice_conversation_summaries",
      "dataSources": [
        {
          "id": "voice_conversation_summaries",
          "dataSourceNameOrId": "voice_conversation_summaries",
          "isEnabled": true,
          "displayName": "Conversation Summaries"
        }
      ]
    }
  }
}
```

### Ingestion summarization is opt-in

Turn-summary ingestion can be cheap by storing raw text. Summarization is enabled only when:

```json
{
  "memoryConfig": {
    "ragConfig": {
      "ingestionProcessing": {
        "summarization": { "enabled": true }
      }
    }
  }
}
```

## Manual Ingest and Retrieve

You can use the augmentor directly (useful for knowledge-base ingestion pipelines):

```ts
await rag.ingestDocuments(
  [
    { id: 'doc-1', content: 'AgentOS is a TypeScript runtime for AI agents.' },
    { id: 'doc-2', content: 'GMIs maintain persistent identity across sessions.' },
  ],
  { targetDataSourceId: 'voice_conversation_summaries' },
);

const result = await rag.retrieveContext('How do GMIs work?', { topK: 5 });
console.log(result.augmentedContext);
```

## Vector Store Providers In This Repo

AgentOS currently ships these vector-store implementations:

- `InMemoryVectorStore` (ephemeral, dev/testing)
- `SqlVectorStore` (persistent via `@framers/sql-storage-adapter`; embeddings stored as JSON blobs; optional SQLite FTS for hybrid)
- `HnswlibVectorStore` (ANN search via `hnswlib-node`, optional peer dependency; optional file persistence via `persistDirectory`)
- `QdrantVectorStore` (remote/self-hosted Qdrant via HTTP; optional BM25 sparse vectors + hybrid fusion)

If you want “true” large-scale vector DB behavior (tens of millions of vectors, filtered search at scale, etc.), add a provider implementation and wire it into `VectorStoreManager`.

### Qdrant Provider (Remote or Self-Hosted)

`QdrantVectorStore` lets you point AgentOS at a Qdrant instance (local Docker or managed cloud) without changing any higher-level RAG code.

Example `VectorStoreManager` provider config:

```ts
import type { VectorStoreManagerConfig } from '@framers/agentos/config/VectorStoreConfiguration';

const vsmConfig: VectorStoreManagerConfig = {
  managerId: 'rag-vsm',
  providers: [
    {
      id: 'qdrant-main',
      type: 'qdrant',
      url: process.env.QDRANT_URL!,
      apiKey: process.env.QDRANT_API_KEY,
      enableBm25: true,
    },
  ],
  defaultProviderId: 'qdrant-main',
  defaultEmbeddingDimension: 1536,
};
```

## GraphRAG (Optional)

`GraphRAGEngine` exists as a TypeScript-native implementation (graphology + Louvain community detection). It is not automatically used by GMIs by default; treat it as an advanced subsystem you opt into when your problem benefits from entity/relationship structure.

- If you use non-OpenAI embedding models (e.g., Ollama), set `GraphRAGConfig.embeddingDimension`, or provide an `embeddingManager` so the engine can probe the embedding dimension at runtime.
- `GraphRAGEngine` can run without embeddings and/or without an LLM:
  - No embeddings: falls back to text matching (lower quality; no vector search).
  - No LLM: falls back to pattern-based extraction (no model calls).
- `GraphRAGEngine.ingestDocuments()` supports update semantics when you re-ingest the same `documentId` with new content (it subtracts prior per-document contributions before applying the new extraction).
- To keep a GraphRAG index consistent with deletes or category/collection moves, call `GraphRAGEngine.removeDocuments([documentId, ...])`.

Minimal lifecycle example:

```ts
import { GraphRAGEngine } from '@framers/agentos/rag/graphrag';

const engine = new GraphRAGEngine({
  // Optional:
  // - vectorStore
  // - embeddingManager
  // - llmProvider
  // - persistenceAdapter
});

await engine.initialize({ engineId: 'graphrag-demo' });

// Ingest (or update) using a stable documentId.
await engine.ingestDocuments([{ id: 'doc-1', content: 'Alice founded Wonderland Inc.' }]);
await engine.ingestDocuments([{ id: 'doc-1', content: 'Bob founded Wonderland Inc.' }]); // update

// Delete or move out of GraphRAG policy scope.
await engine.removeDocuments(['doc-1']);
```

Troubleshooting updates:

- If you see warnings about missing previous contribution records, you upgraded from an older persistence format.
  - Fix: rebuild the GraphRAG index (clear its persisted state and re-ingest documents).

## Immutability Notes (Sealed Agents)

If you run with an append-only / sealed storage policy, avoid hard deletes of memory or history.
Prefer append-only tombstones/redactions so retrieval can ignore forgotten items while the audit trail remains verifiable.

## Practical Guidance

- Default recommendation: start with **vector (dense) retrieval**, then add **keyword (BM25/FTS)** for recall, then add a **reranker** only where it’s worth the latency/cost.
- GraphRAG tends to pay off when questions depend on multi-hop relationships and “global summaries” (org structures, timelines, dependency graphs), not for everyday chat retrieval.

## Retrieval Strategies (Implemented)

`RetrievalAugmentor.retrieveContext()` supports `RagRetrievalOptions.strategy`:

- `similarity`: Dense similarity search (bi-encoder) via `IVectorStore.query()`.
- `hybrid`: Dense + lexical fusion via `IVectorStore.hybridSearch()` when the store implements it.
  - `SqlVectorStore.hybridSearch()` performs BM25-style lexical scoring and fuses dense + lexical rankings (default: RRF).
- `mmr`: Maximal Marginal Relevance diversification. The augmentor requests embeddings for candidates and then selects a diverse top-K set using `strategyParams.mmrLambda` (0..1).

Notes:
- If a store does not implement `hybridSearch()`, AgentOS falls back to dense `query()`.
- For `mmr`, embeddings are used internally even if `includeEmbeddings=false`; embeddings are stripped from the output unless explicitly requested.

## Reranking (Cross-Encoder)

If `RetrievalAugmentorServiceConfig.rerankerServiceConfig` is provided, AgentOS will:

- Initialize `RerankerService`
- Auto-register built-in reranker providers declared in config:
  - `cohere` (requires `apiKey`)
  - `local` (offline cross-encoder, requires installing Transformers.js: `@huggingface/transformers` preferred, or `@xenova/transformers`)

Reranking is **still opt-in per request** via `RagRetrievalOptions.rerankerConfig.enabled=true`.

## Multimodal RAG (Image + Audio)

AgentOS’ core RAG APIs are text-first. The recommended multimodal pattern is:

- Persist asset metadata (and optionally bytes).
- Derive a **text representation** (caption/transcript/OCR/etc).
- Index that text as a normal RAG document (so the same vector/BM25/rerank pipeline applies).
- Optionally add modality embeddings (image-to-image / audio-to-audio) as an acceleration path.

See [MULTIMODAL_RAG.md](./MULTIMODAL_RAG.md) for the reference implementation and HTTP API.
