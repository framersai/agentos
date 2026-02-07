# RAG & Memory Configuration

## Overview

AgentOS provides a flexible memory system combining:

- **Working Memory** — Short-term context within a conversation
- **Vector Store** — Semantic search over documents and history
- **Persistent Storage** — SQLite, PostgreSQL, or IndexedDB backends

## Quick Start

### Basic RAG Setup

```typescript
import { AgentOS } from '@framers/agentos';
import { EmbeddingManager } from '@framers/agentos/rag';

const agent = new AgentOS();
await agent.initialize({
  llmProvider: {
    provider: 'openai',
    apiKey: process.env.OPENAI_API_KEY,
    model: 'gpt-4o'
  },
  memory: {
    vectorStore: 'memory',  // In-memory for dev
    embeddingModel: 'text-embedding-3-small',
    chunkSize: 512,
    chunkOverlap: 50
  }
});
```

### Ingest Documents

```typescript
// Ingest text content
await agent.memory.ingest([
  { content: 'AgentOS is a TypeScript runtime for AI agents...', metadata: { source: 'docs', topic: 'intro' } },
  { content: 'GMIs maintain persistent identity across sessions...', metadata: { source: 'docs', topic: 'gmi' } }
]);

// Ingest from files
await agent.memory.ingestFile('./knowledge-base.pdf');
await agent.memory.ingestFile('./api-reference.md');

// Ingest from URLs
await agent.memory.ingestUrl('https://docs.example.com/guide');
```

### Query with Context

```typescript
// RAG context is automatically injected into prompts
for await (const chunk of agent.processRequest({
  message: 'How do GMIs work?',
  retrievalOptions: {
    topK: 5,
    minScore: 0.7
  }
})) {
  process.stdout.write(chunk.content);
}

// Manual retrieval
const results = await agent.memory.search('streaming responses', { topK: 3 });
console.log(results.map(r => r.content));
```

## Vector Store Options

| Store | Use Case | Persistence |
|-------|----------|-------------|
| `memory` | Development, testing | None (RAM only) |
| `sqlite` | Desktop apps, local dev | File-based |
| `postgres` | Production deployments | Database |
| `supabase` | Edge/serverless | Cloud |

### SQLite Vector Store

```typescript
await agent.initialize({
  memory: {
    vectorStore: 'sqlite',
    sqlitePath: './vectors.db',
    embeddingModel: 'text-embedding-3-small'
  }
});
```

### PostgreSQL with pgvector

```typescript
await agent.initialize({
  memory: {
    vectorStore: 'postgres',
    connectionString: process.env.DATABASE_URL,
    tableName: 'embeddings',
    embeddingModel: 'text-embedding-3-small',
    dimensions: 1536
  }
});
```

## Embedding Models

| Model | Provider | Dimensions | Best For |
|-------|----------|------------|----------|
| `text-embedding-3-small` | OpenAI | 1536 | General purpose |
| `text-embedding-3-large` | OpenAI | 3072 | Higher accuracy |
| `nomic-embed-text` | Ollama | 768 | Local/private |
| `mxbai-embed-large` | Ollama | 1024 | Local high-quality |

### Custom Embedding Provider

```typescript
import { EmbeddingManager, IEmbeddingProvider } from '@framers/agentos/rag';

const customProvider: IEmbeddingProvider = {
  embed: async (text: string) => {
    const response = await myEmbeddingAPI(text);
    return response.embedding;
  },
  dimensions: 768
};

const embeddingManager = new EmbeddingManager({
  provider: customProvider
});
```

## Chunking Strategies

```typescript
await agent.initialize({
  memory: {
    chunking: {
      strategy: 'recursive',  // 'fixed', 'sentence', 'recursive', 'semantic'
      chunkSize: 512,
      chunkOverlap: 50,
      separators: ['\n\n', '\n', '. ', ' ']
    }
  }
});
```

| Strategy | Description | Best For |
|----------|-------------|----------|
| `fixed` | Split at exact character count | Uniform chunks |
| `sentence` | Split at sentence boundaries | Natural text |
| `recursive` | Split hierarchically by separators | Structured docs |
| `semantic` | Split by topic/meaning | Long documents |

## Context Window Management

AgentOS automatically manages context to fit model limits:

```typescript
await agent.initialize({
  memory: {
    contextWindow: {
      maxTokens: 8000,        // Reserve for RAG context
      reserveForResponse: 2000,
      overflowStrategy: 'truncate_oldest'  // or 'summarize'
    }
  }
});
```

### Summarization on Overflow

```typescript
// When context exceeds limits, older content is summarized
await agent.initialize({
  memory: {
    contextWindow: {
      maxTokens: 8000,
      overflowStrategy: 'summarize',
      summarizationModel: 'gpt-4o-mini'
    }
  }
});
```

## Conversation Memory

Separate from RAG, conversation memory tracks dialog history:

```typescript
// Conversation history is automatically maintained
const response1 = await agent.processRequest({ 
  message: 'My name is Alice',
  conversationId: 'conv-123'
});

const response2 = await agent.processRequest({ 
  message: 'What is my name?',  // Agent remembers: "Alice"
  conversationId: 'conv-123'
});

// Access conversation history
const history = await agent.getConversationHistory('conv-123');
```

### Persistent Sessions

```typescript
// Sessions persist across restarts with SQL storage
await agent.initialize({
  memory: {
    persistence: {
      adapter: 'sqlite',
      path: './conversations.db'
    }
  }
});

// Resume previous conversation
const response = await agent.processRequest({
  message: 'Continue where we left off',
  conversationId: 'conv-123'  // Loads history from DB
});
```

## Hybrid Search

Combine vector similarity with keyword matching:

```typescript
const results = await agent.memory.search('TypeScript agent framework', {
  topK: 10,
  hybridSearch: {
    enabled: true,
    keywordWeight: 0.3,  // 30% BM25, 70% vector
    rerank: true
  }
});
```

## Cross-Encoder Reranking (Optional)

Reranking uses a cross-encoder model to re-score retrieved documents for higher relevance.
**Disabled by default** due to added latency (~100-500ms for 50 docs).

### When to Enable

| Use Case | Recommendation |
|----------|----------------|
| Real-time chat | **Disabled** — latency sensitive |
| Background analysis | **Enabled** — accuracy matters more |
| Batch processing | **Enabled** — no user waiting |
| Knowledge-intensive tasks | **Enabled** — reduces hallucination |

### Configuration

```typescript
await agent.initialize({
  memory: {
    // ... other config ...
    rerankerServiceConfig: {
      providers: [
        { providerId: 'cohere', apiKey: process.env.COHERE_API_KEY },
        { providerId: 'local', defaultModelId: 'cross-encoder/ms-marco-MiniLM-L-6-v2' }
      ],
      defaultProviderId: 'local'
    }
  }
});

// Register provider implementations after initialization
import { CohereReranker, LocalCrossEncoderReranker } from '@framers/agentos/rag/reranking';

agent.registerRerankerProvider(new CohereReranker({
  providerId: 'cohere',
  apiKey: process.env.COHERE_API_KEY!
}));

agent.registerRerankerProvider(new LocalCrossEncoderReranker({
  providerId: 'local',
  defaultModelId: 'cross-encoder/ms-marco-MiniLM-L-6-v2'
}));
```

### Per-Request Usage

```typescript
// Enable reranking for specific queries
const results = await agent.memory.search('complex technical question', {
  topK: 20,  // Retrieve more, reranker will filter
  rerankerConfig: {
    enabled: true,
    providerId: 'cohere',  // or 'local'
    modelId: 'rerank-english-v3.0',
    topN: 5  // Return top 5 after reranking
  }
});
```

### Global Default (for Analysis Personas)

```typescript
// Enable reranking by default for batch/analysis workloads
await agent.initialize({
  memory: {
    globalDefaultRetrievalOptions: {
      rerankerConfig: {
        enabled: true,
        topN: 5
      }
    }
  }
});
```

### Providers

| Provider | Model | Latency | Cost |
|----------|-------|---------|------|
| Cohere | `rerank-english-v3.0` | ~100ms/50 docs | $0.10/1K queries |
| Cohere | `rerank-multilingual-v3.0` | ~150ms/50 docs | $0.10/1K queries |
| Local | `cross-encoder/ms-marco-MiniLM-L-6-v2` | ~200ms/50 docs | Free (self-hosted) |
| Local | `BAAI/bge-reranker-base` | ~300ms/50 docs | Free (self-hosted) |

### How It Works

1. **Initial retrieval** — Fast bi-encoder vector search returns top-K candidates
2. **Reranking** — Cross-encoder scores each (query, document) pair
3. **Final selection** — Results sorted by cross-encoder score, top-N returned

Cross-encoders jointly encode the query and document together, enabling richer
semantic understanding than bi-encoder similarity. The trade-off is latency:
cross-encoders are ~10-100x slower than bi-encoders, hence their use as a
second-stage reranker rather than primary retrieval.

## Memory Lifecycle

```typescript
// Clear all memory
await agent.memory.clear();

// Delete specific documents
await agent.memory.delete({ source: 'outdated-docs' });

// Export for backup
const dump = await agent.memory.export();
await fs.writeFile('memory-backup.json', JSON.stringify(dump));

// Import from backup
const backup = JSON.parse(await fs.readFile('memory-backup.json'));
await agent.memory.import(backup);
```

## Performance Tips

1. **Batch ingestion** — Use `ingest([...])` not multiple `ingest()` calls
2. **Appropriate chunk size** — 256-1024 tokens works best for most cases
3. **Filter before search** — Use metadata filters to narrow scope
4. **Cache embeddings** — Enable caching for repeated queries

```typescript
await agent.initialize({
  memory: {
    caching: {
      enabled: true,
      maxSize: 10000,  // Cache up to 10k embeddings
      ttlMs: 3600000   // 1 hour TTL
    }
  }
});
```

## HNSW Vector Store (hnswlib-node)

For high-performance approximate nearest neighbor search, AgentOS provides an HNSW-based vector store
powered by `hnswlib-node` (native C++ bindings). This replaces the default linear-scan approach
with O(log n) queries.

### When to Use

| Scenario | Recommendation |
|----------|----------------|
| < 10K documents | InMemory or SQL (linear scan is fast enough) |
| 10K - 1M documents | **HnswlibVectorStore** (2-10ms queries) |
| > 1M documents, cloud | Pinecone, Qdrant, or pgvector |
| Offline / edge / local | **HnswlibVectorStore** |

### Setup

```typescript
import { VectorStoreManager } from '@framers/agentos/rag';

const vsm = new VectorStoreManager();
await vsm.initialize(
  {
    managerId: 'main-vsm',
    providers: [{
      id: 'hnsw-store',
      type: 'hnswlib',
      defaultEmbeddingDimension: 1536,
      similarityMetric: 'cosine',  // 'cosine' | 'euclidean' | 'dotproduct'
      hnswM: 16,                   // Max connections per node (default: 16)
      hnswEfConstruction: 200,     // Construction quality (default: 200)
      hnswEfSearch: 100,           // Search quality (default: 100)
    }],
    defaultProviderId: 'hnsw-store',
  },
  [{ dataSourceId: 'docs', vectorStoreProviderId: 'hnsw-store', actualNameInProvider: 'documents' }]
);
```

### Standalone Usage

```typescript
import { HnswlibVectorStore } from '@framers/agentos/rag';

const store = new HnswlibVectorStore();
await store.initialize({
  id: 'my-store',
  type: 'hnswlib',
  similarityMetric: 'cosine',
  defaultEmbeddingDimension: 1536,
});

await store.createCollection('documents', 1536);

await store.upsert('documents', [
  { id: 'doc-1', embedding: [...], textContent: 'Hello world', metadata: { source: 'test' } },
]);

const results = await store.query('documents', queryEmbedding, {
  topK: 10,
  minSimilarityScore: 0.7,
  includeMetadata: true,
  includeTextContent: true,
  filter: { source: 'test' },
});
```

### HNSW Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `hnswM` | 16 | Max connections per node. Higher = better recall, more memory |
| `hnswEfConstruction` | 200 | Build-time quality. Higher = better index, slower build |
| `hnswEfSearch` | 100 | Query-time quality. Higher = better recall, slower query |
| `similarityMetric` | `cosine` | Distance function: `cosine`, `euclidean`, `dotproduct` |

### Performance Characteristics

| Documents | Query Latency | Memory | Build Time |
|-----------|--------------|--------|------------|
| 10K | 1-2ms | ~100MB | ~1s |
| 100K | 2-10ms | ~1GB | ~10s |
| 1M | 10-50ms | ~8GB | ~100s |

### Dependencies

`hnswlib-node` is an **optional peer dependency**. Install it only if using the HNSW store:

```bash
pnpm add hnswlib-node
```

### Metadata Filtering

HnswlibVectorStore supports rich metadata filters applied post-retrieval:

```typescript
const results = await store.query('col', embedding, {
  filter: {
    category: 'docs',                    // exact match (shorthand for $eq)
    score: { $gt: 80 },                  // numeric comparison ($gt, $gte, $lt, $lte)
    status: { $ne: 'archived' },         // not equal
    tags: { $contains: 'important' },    // array contains
    name: { $in: ['Alice', 'Bob'] },     // in set
    title: { $textSearch: 'guide' },     // case-insensitive substring
  },
});
```

---

## GraphRAG (Graph-Based Retrieval Augmented Generation)

AgentOS includes a TypeScript-native GraphRAG engine inspired by Microsoft's GraphRAG research.
It combines entity extraction, graph-based community detection (Louvain algorithm), hierarchical
summarization, and dual search modes (global + local) — all without Python dependencies.

### Architecture

```
Documents  ──►  Entity Extraction  ──►  Graph Construction  ──►  Community Detection
                (LLM or pattern)         (graphology)             (Louvain algorithm)
                                                                        │
                                                                        ▼
Query  ──►  Global Search (community summaries)         Community Summarization
       ──►  Local Search  (entity + graph traversal)         (LLM-generated)
```

### When to Use

| Question Type | Best RAG Mode |
|---------------|---------------|
| "What is X?" (specific fact) | Standard vector RAG |
| "Tell me about X" (entity context) | **GraphRAG Local Search** |
| "What are the main themes?" (broad) | **GraphRAG Global Search** |
| "How does X relate to Y?" (multi-hop) | **GraphRAG Local Search** |

### Setup

```typescript
import { GraphRAGEngine } from '@framers/agentos/rag';
import { HnswlibVectorStore } from '@framers/agentos/rag';
import { EmbeddingManager } from '@framers/agentos/rag';

// Initialize dependencies
const vectorStore = new HnswlibVectorStore();
await vectorStore.initialize({ id: 'graphrag-vs', type: 'hnswlib' });

const embeddingManager = new EmbeddingManager();
await embeddingManager.initialize(embeddingConfig, aiProviderManager);

// Initialize GraphRAG engine
const graphRAG = new GraphRAGEngine({
  vectorStore,
  embeddingManager,
  llmProvider: {
    generateText: async (prompt, opts) => {
      // Route to your LLM provider
      return await myLLM.generate(prompt, opts);
    },
  },
  persistenceAdapter: sqlAdapter, // @framers/sql-storage-adapter instance
});

await graphRAG.initialize({
  engineId: 'my-graphrag',
  entityTypes: ['person', 'organization', 'location', 'concept', 'technology'],
  maxCommunityLevels: 3,
  minCommunitySize: 2,
  communityResolution: 1.0,
  generateEntityEmbeddings: true,
});
```

### Ingesting Documents

```typescript
const result = await graphRAG.ingestDocuments([
  { id: 'doc-1', content: 'Alice is a researcher at MIT...', metadata: { source: 'bio' } },
  { id: 'doc-2', content: 'Bob collaborates with Alice on NLP projects...' },
]);

console.log(result);
// {
//   entitiesExtracted: 5,
//   relationshipsExtracted: 3,
//   communitiesDetected: 2,
//   documentsProcessed: 2,
// }
```

### Global Search

Best for broad questions where the answer spans many documents:

```typescript
const result = await graphRAG.globalSearch('What are the main research themes?', {
  topK: 5,
  communityLevels: [0, 1],
  minRelevance: 0.5,
});

console.log(result.answer);           // LLM-synthesized answer from community summaries
console.log(result.communitySummaries); // Matched community summaries with relevance scores
```

### Local Search

Best for specific entity questions with relationship context:

```typescript
const result = await graphRAG.localSearch('Tell me about Alice', {
  topK: 10,
  includeEntities: true,
  includeRelationships: true,
});

console.log(result.entities);        // Matched entities with relevance scores
console.log(result.relationships);   // Related relationships (1-hop graph expansion)
console.log(result.communityContext); // Community context for matched entities
console.log(result.augmentedContext); // Pre-built context string for LLM consumption
```

### Inspecting the Graph

```typescript
// Get all entities
const entities = await graphRAG.getEntities({ type: 'person', limit: 50 });

// Get relationships for an entity
const rels = await graphRAG.getRelationships(entities[0].id);

// Get community hierarchy
const communities = await graphRAG.getCommunities(0); // Level 0 = most granular

// Get statistics
const stats = await graphRAG.getStats();
// { totalEntities, totalRelationships, totalCommunities, communityLevels, documentsIngested }
```

### Persistence

GraphRAG persists its graph to SQL via `@framers/sql-storage-adapter`:

| Table | Contents |
|-------|----------|
| `graphrag_entities` | Extracted entities with embeddings |
| `graphrag_relationships` | Entity relationships with weights |
| `graphrag_communities` | Community hierarchy with summaries |
| `graphrag_ingested_documents` | Track of processed documents |

Data is loaded on `initialize()` and persisted on `shutdown()`. Use a custom `tablePrefix`
in the config to namespace multiple GraphRAG instances.

### Dependencies

GraphRAG requires these **optional peer dependencies**:

```bash
pnpm add graphology graphology-communities-louvain graphology-types
# Optional: for HNSW-backed entity search
pnpm add hnswlib-node
```

### Entity Extraction Modes

| Mode | Trigger | Quality | Cost |
|------|---------|---------|------|
| **LLM-driven** | `llmProvider` injected | High (structured extraction) | LLM API calls |
| **Pattern-based** | No `llmProvider` | Medium (proper noun regex) | Free |

The engine falls back to pattern-based extraction automatically if the LLM call fails.

---

## See Also

- [Architecture Overview](./ARCHITECTURE.md)
- [Client-Side Storage](./CLIENT_SIDE_STORAGE.md)
- [SQL Storage Quickstart](./SQL_STORAGE_QUICKSTART.md)
- [Cost Optimization](./COST_OPTIMIZATION.md) — Tips for managing reranker API costs
