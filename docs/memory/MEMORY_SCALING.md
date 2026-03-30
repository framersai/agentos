# Memory Scaling Guide

> How to scale AgentOS retrieval from a single-agent SQLite file to billions of vectors across Postgres and Qdrant.

`Memory.create()` currently opens the SQLite-backed standalone memory facade. The Postgres, Qdrant, and Pinecone material below applies to the lower-level RAG/vector-store layer and migration tooling while the high-level memory facade remains SQLite-backed.

---

## The Four-Tier Scaling Path

```
SQLite brute-force (0 → 1K vectors)
  │  Zero config, automatic
  │  HNSW index auto-builds at 1K vectors
  ▼
SQLite + HNSW sidecar (1K → 500K vectors)
  │  Still zero infra — brain.sqlite + brain.hnsw
  │  O(log n) ANN search via hnswlib
  │  $ agentos-cli memory migrate --to postgres
  ▼
Postgres + pgvector (500K → 10M vectors)
  │  Multi-tenant, managed DB, native HNSW indexes
  │  RRF hybrid search in single SQL query
  │  $ agentos-cli memory migrate --to qdrant
  ▼
Qdrant (10M → 1B+ vectors)
     Dedicated vector infra, sharding, quantization
```

The first transition (brute-force → HNSW sidecar) is **automatic** — no user action needed. Each subsequent step is a **one-command migration**.

---

## Tier 1: SQLite (Default)

Every agent starts here. Zero infrastructure, zero configuration.

```typescript
const mem = await Memory.create(); // Defaults to SQLite at tmpdir
// or
const mem = await Memory.create({
  path: './brain.sqlite',
  embed: async (text) => yourEmbeddingFunction(text),
});
```

**What you get:**
- Single `brain.sqlite` file — copy it anywhere, agent has all its memories
- FTS5 hybrid search (BM25 + vector similarity with RRF fusion)
- Knowledge graph via recursive CTEs
- Binary blob embeddings (~50% smaller than JSON)
- SQL-level metadata filtering via `json_extract()`
- HNSW sidecar auto-builds when trace count exceeds 1,000

**When to scale up:**
- Query latency exceeds 200ms (typically at 100K+ vectors)
- Need multi-tenant isolation (multiple agents sharing a DB)
- Need concurrent write access (SQLite is single-writer)

---

## Tier 2: Postgres + pgvector

For Postgres-backed retrieval today, use the lower-level vector-store path.

```typescript
import { PostgresVectorStore } from '@framers/agentos';

const store = new PostgresVectorStore({
  id: 'agent-memory',
  type: 'postgres',
  connectionString: 'postgresql://postgres:password@localhost:5432/agent_memory',
});

await store.initialize();
await store.createCollection('agent_memory', 1536);
```

The standalone `Memory` facade does not yet open a Postgres brain directly.

### Auto-Setup

```bash
# Auto-provisions Docker Postgres + pgvector
agentos-cli memory migrate --to postgres --auto-setup
```

This will:
1. Check if Docker is running
2. Pull `postgres:16` image
3. Run container with pgvector extension
4. Create database and install pgvector
5. Migrate all data from SQLite
6. Save config to `~/.agentos/vector-store.json`

### Manual Setup

```bash
# If you already have Postgres running:
agentos-cli memory migrate --to postgres --connection "postgresql://user:pass@host:5432/db"
```

### What you get:
- Native HNSW indexes via pgvector (sub-10ms ANN at 1M+ vectors)
- RRF hybrid search in a single SQL CTE (vector + tsvector BM25)
- JSONB metadata filtering with GIN indexes
- Multi-tenant schema isolation (`agent_{id}` schemas)
- Connection pooling via `pg.Pool`
- Works with any managed Postgres (Neon, Supabase, RDS, Aiven)

---

## Tier 3: Qdrant

Purpose-built for extreme vector scale.

```bash
# Auto-provisions Docker Qdrant
agentos-cli memory migrate --to qdrant --auto-setup

# Or connect to existing Qdrant
agentos-cli memory migrate --to qdrant --url http://localhost:6333

# Or Qdrant Cloud
export QDRANT_URL=https://abc123.us-east4-0.gcp.cloud.qdrant.io:6333
export QDRANT_API_KEY=your-api-key
agentos-cli memory migrate --to qdrant
```

### What you get:
- On-disk HNSW with sharding (billions of vectors)
- Scalar/binary quantization for memory efficiency
- Server-side RRF hybrid search (dense + sparse vectors)
- Collection-per-agent isolation
- Horizontal scaling across nodes

---

## Tier 4: Pinecone (Cloud)

For teams that want fully managed infrastructure.

```typescript
import { PineconeVectorStore } from '@framers/agentos';

const store = new PineconeVectorStore({
  id: 'pinecone-prod',
  type: 'pinecone',
  apiKey: process.env.PINECONE_API_KEY!,
  indexHost: 'https://my-index-abc123.svc.aped-1234.pinecone.io',
  namespace: 'agent-memory',
});
```

**Pros:** Zero ops, SSO + SOC 2, scales to billions, generous free tier.
**Cons:** Not open source, not self-hostable, data leaves your infra.

Migration from Pinecone to self-hosted:
```bash
agentos-cli memory migrate --from pinecone --to qdrant
```

---

## Migration

### CLI

```bash
# SQLite → Postgres (most common)
agentos-cli memory migrate --to postgres

# SQLite → Qdrant
agentos-cli memory migrate --to qdrant --auto-setup

# Postgres → Qdrant (scale-up)
agentos-cli memory migrate --from postgres --to qdrant

# Pinecone → SQLite (bring data home)
agentos-cli memory migrate --from pinecone --to sqlite --path ./brain.sqlite

# Dry run (count rows, don't write)
agentos-cli memory migrate --to postgres --dry-run
```

### Programmatic

```typescript
import { MigrationEngine } from '@framers/agentos';

const result = await MigrationEngine.migrate({
  from: { type: 'sqlite', path: './brain.sqlite' },
  to: { type: 'postgres', connectionString: 'postgresql://...' },
  batchSize: 1000,
  onProgress: (done, total, table) => {
    console.log(`${table}: ${done}/${total}`);
  },
});

console.log(`Migrated ${result.totalRows} rows in ${result.durationMs}ms`);
```

### What gets migrated:
- Memory traces (with embeddings)
- Knowledge graph nodes + edges
- Documents + chunks
- Consolidation history
- Retrieval feedback signals

---

## Backend Comparison

| Feature | SQLite | Postgres | Qdrant | Pinecone |
|---------|--------|----------|--------|----------|
| **Scale** | 0–500K vectors | 500K–10M | 10M–1B+ | 10M–1B+ |
| **Setup** | Zero | Docker or managed | Docker or managed | Cloud only |
| **Self-hosted** | Yes (file) | Yes | Yes | No |
| **Open source** | Yes | Yes | Yes (Apache 2.0) | No |
| **HNSW ANN** | Via sidecar | Native pgvector | Native | Native |
| **Hybrid search** | FTS5 + RRF | tsvector + RRF | Sparse + RRF | Dense only* |
| **Knowledge graph** | Recursive CTEs | Recursive CTEs | Sidecar SQLite | Not supported |
| **Metadata filtering** | json_extract() | JSONB GIN | Payload filters | Metadata filters |
| **Multi-tenant** | One file per agent | Schema isolation | Collection isolation | Namespace isolation |
| **Offline** | Yes | If self-hosted | If self-hosted | No |
| **Cost** | Free | Free (self) / $25+ | Free (self) / $25+ | Free tier / $70+ |

*Pinecone supports sparse vectors for hybrid search but requires a separate sparse encoder.

---

## Docker Auto-Setup Details

The `--auto-setup` flag handles everything:

1. **Checks if backend is already running** (health check endpoint)
2. **Checks environment variables** (`QDRANT_URL`, `DATABASE_URL`)
3. **Checks Docker** (`docker info`)
4. **Checks for existing container** (`docker inspect agentos-qdrant`)
5. **Starts stopped container** or **pulls and runs new one**
6. **Waits for health check** (polls every 500ms, 15s timeout)
7. **Saves config** to `~/.agentos/vector-store.json`

If Docker isn't installed, you get a clear error with install instructions.

For cloud deployments, just set environment variables — Docker is skipped entirely:

```bash
# Qdrant Cloud
export QDRANT_URL=https://abc123.cloud.qdrant.io:6333
export QDRANT_API_KEY=your-key

# Managed Postgres (Neon, Supabase, etc.)
export DATABASE_URL=postgresql://user:pass@host:5432/db
```
