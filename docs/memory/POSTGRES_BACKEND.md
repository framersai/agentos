# Postgres + pgvector Backend

The Postgres backend stores embeddings, metadata, and full-text content in a single relational database using the [pgvector](https://github.com/pgvector/pgvector) extension. This gives you ACID transactions, hybrid search (dense vectors + BM25 in one query), and JSONB metadata filtering — all without a separate vector service.

## Prerequisites

| Requirement | Minimum version |
|---|---|
| PostgreSQL | 14+ (15+ recommended for `HNSW` index type) |
| pgvector extension | 0.5.0+ (`CREATE EXTENSION vector`) |
| Node.js | 18+ (uses the `pg` npm package) |

## Quick start — Docker

```bash
docker run -d \
  --name agentos-pgvector \
  -e POSTGRES_PASSWORD=wunderland \
  -p 5432:5432 \
  pgvector/pgvector:pg16

# Verify
psql postgresql://postgres:wunderland@localhost:5432/postgres \
  -c "CREATE EXTENSION IF NOT EXISTS vector; SELECT extversion FROM pg_extension WHERE extname='vector';"
```

The `pgvector/pgvector` image ships with the extension pre-installed. No manual compilation needed.

## Manual setup

If you are using an existing Postgres instance (self-hosted or managed), install pgvector manually:

```sql
-- Run as a superuser or a user with CREATE EXTENSION privilege.
CREATE EXTENSION IF NOT EXISTS vector;
```

AgentOS creates its own tables on first use. The schema looks like:

```sql
CREATE TABLE IF NOT EXISTS "<prefix>my_collection" (
  id            TEXT PRIMARY KEY,
  embedding     vector(1536),          -- pgvector column
  metadata_json JSONB,                 -- GIN-indexed for filtering
  text_content  TEXT,                  -- raw text for hybrid search
  tsv           tsvector GENERATED ALWAYS AS (to_tsvector('english', COALESCE(text_content, ''))) STORED,
  created_at    BIGINT NOT NULL,
  updated_at    BIGINT
);

-- Indexes created automatically:
-- 1. HNSW index for approximate nearest neighbor search
-- 2. GIN index on metadata_json for JSONB filtering
-- 3. GIN index on tsv for full-text search
```

## Configuration

```typescript
import { PostgresVectorStore } from '@framers/agentos/rag/implementations/vector_stores/PostgresVectorStore';

const store = new PostgresVectorStore({
  id: 'my-pg-store',
  type: 'postgres',
  connectionString: 'postgresql://postgres:wunderland@localhost:5432/agent_memory',
  poolSize: 10,              // Connection pool size (default: 10)
  defaultDimension: 1536,    // Default embedding dimensions (default: 1536)
  similarityMetric: 'cosine', // 'cosine' | 'euclidean' | 'dotproduct'
  tablePrefix: 'agent1_',    // Optional prefix for multi-tenancy
});

await store.initialize();
```

### Configuration options

| Option | Type | Default | Description |
|---|---|---|---|
| `connectionString` | `string` | **required** | Standard Postgres connection URI |
| `poolSize` | `number` | `10` | Max concurrent connections in the pool |
| `defaultDimension` | `number` | `1536` | Embedding vector dimensions for new collections |
| `similarityMetric` | `string` | `'cosine'` | Distance function: `cosine`, `euclidean`, or `dotproduct` |
| `tablePrefix` | `string` | `''` | Table name prefix for multi-tenant deployments |

## Hybrid search

The Postgres backend is the only backend that supports true **single-query hybrid search**: pgvector HNSW for dense vectors and PostgreSQL tsvector for BM25 lexical matching, fused with Reciprocal Rank Fusion (RRF) in a single SQL statement.

```typescript
const results = await store.hybridSearch(
  'my_collection',
  queryEmbedding,
  'natural language query text',
  {
    topK: 10,
    rrfK: 60,  // RRF constant (default: 60)
  },
);
```

How it works internally:

1. **Dense CTE**: Finds top candidates by pgvector HNSW distance (`<=>` for cosine).
2. **Lexical CTE**: Finds top candidates by `ts_rank()` against the `tsvector` column.
3. **Fusion CTE**: Merges both result sets with `1/(k + rank_dense) + 1/(k + rank_lexical)`.
4. **Final join**: Fetches full documents for the top fused results.

This avoids two separate queries and application-level fusion.

## Multi-tenancy via schema isolation

For SaaS deployments where each tenant needs isolated data:

```typescript
// Tenant A
const storeA = new PostgresVectorStore({
  // ...
  tablePrefix: 'tenant_a_',
});

// Tenant B
const storeB = new PostgresVectorStore({
  // ...
  tablePrefix: 'tenant_b_',
});
```

Each prefix creates a separate set of tables: `"tenant_a_my_collection"`, `"tenant_a__collections"`, etc. Alternatively, use Postgres schemas (`SET search_path`) for stronger isolation.

## Cloud providers

Any managed Postgres with pgvector works. Just set the connection string:

| Provider | Connection string example |
|---|---|
| **Neon** | `postgresql://user:pass@ep-cool-grass-123456.us-east-2.aws.neon.tech/neondb?sslmode=require` |
| **Supabase** | `postgresql://postgres:pass@db.xyzabc.supabase.co:5432/postgres` |
| **AWS RDS** | `postgresql://postgres:pass@mydb.cluster-xyz.us-east-1.rds.amazonaws.com:5432/mydb` |
| **Google Cloud SQL** | `postgresql://postgres:pass@/mydb?host=/cloudsql/project:region:instance` |
| **Azure Flexible Server** | `postgresql://postgres:pass@myserver.postgres.database.azure.com:5432/mydb?sslmode=require` |

All of these support pgvector. Neon and Supabase have it pre-installed. For RDS, enable the `pgvector` extension in the parameter group.

## Troubleshooting

### `ERROR: could not open extension control file "vector"`

pgvector is not installed. On managed services, check that the extension is enabled in your database configuration. For self-hosted:

```bash
# Ubuntu/Debian
sudo apt install postgresql-16-pgvector

# macOS (Homebrew)
brew install pgvector
```

Then run `CREATE EXTENSION vector;` as a superuser.

### `ERROR: different vector dimensions`

You changed `defaultDimension` after creating a collection. pgvector enforces dimension constraints at the column level. Drop and recreate the collection, or create a new collection with the correct dimension.

### Connection refused / timeout

- Verify the connection string host, port, and credentials.
- Check that `pg_hba.conf` allows connections from your IP.
- For Docker: ensure `-p 5432:5432` is set and the container is running.
- For cloud: check firewall / security group rules.

### Pool exhaustion (`too many clients already`)

Increase `poolSize` in the config, or reduce concurrent usage. The default of 10 is usually sufficient for single-agent deployments. Multi-agent setups may need 20-50.
