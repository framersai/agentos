---
title: Memory Archive & Rehydration
date: 2026-04-10
status: draft
scope: agentos
depends_on: []
enables:
  - 2026-04-XX-agentos-perspective-observer-design
  - 2026-04-XX-wilds-end-of-session-memory-pipeline-design
---

# Memory Archive & Rehydration

## Problem Statement

`CognitiveMemoryManager` has two compaction paths that silently destroy verbatim memory:

1. **`TemporalGist`** ([`mechanisms/consolidation/TemporalGist.ts:124`](../../../src/memory/mechanisms/consolidation/TemporalGist.ts#L124)) overwrites `trace.content` with an LLM-extracted gist and stores only a `sha256` of the original in `structuredData.mechanismMetadata.originalContentHash`. The hash is an audit artifact, not an archive. Once gisted, the verbatim content is unrecoverable.

2. **`MemoryLifecycleManager`** ([`pipeline/lifecycle/MemoryLifecycleManager.ts:508-516`](../../../src/memory/pipeline/lifecycle/MemoryLifecycleManager.ts#L508-L516)) declares `archive` and `summarize_and_archive` action types with `archiveTargetId` / `defaultArchiveStoreId` configuration, but the execution branch is documented as *conceptual*: it logs an intent and then calls `vectorStoreRef.delete()`. No cross-store migration happens.

Agents using the full cognitive pipeline therefore lose memory past the gist threshold with no path to recover it. Long-running deployments — multi-session RPGs, persistent companions, agentic research loops — hit this wall within weeks of production use. There is no inverse of temporal gist anywhere in the codebase (verified: zero matches for `rehydrate|inflate|restore.*trace|verbatim.*restore` across `packages/agentos/src/memory`).

This design adds a first-class **`IMemoryArchive`** contract, a default implementation that completes the lifecycle-manager migration, a SQLite sibling for portable brains, and a `rehydrate(traceId)` API exposed both as a direct method and as an LLM tool. `TemporalGist` becomes write-ahead: archive the verbatim trace before overwriting.

The outcome: lossy summaries in working context, lossless content in cold storage, on-demand inflation driven by the LLM's own retrieval decisions. Fixed-budget working context, unbounded factual recall.

---

## Non-Goals

- **Not** inventing a new storage backend. The default archive implementation reuses the existing `VectorStoreManager` target pattern that `MemoryLifecycleManager` already references.
- **Not** changing the semantics of `Reconsolidation`, `RetrievalInducedForgetting`, `TemporalGist`'s *decision* logic, or any other cognitive mechanism. This spec adds a pre-hook to gist and finishes a stubbed archive path. Nothing else.
- **Not** introducing a tiered storage hierarchy (hot/warm/cold) in this spec. A flat retention policy is enough to ship. Tiering can follow in a later spec if growth requires it.
- **Not** archiving across agent boundaries. Each `CognitiveMemoryManager` owns its own archive. Shared/world-level archives are a separate concern and belong to GraphRAG, not this contract.
- **Not** shipping a `rehydrate_memory` tool in the default `MemoryToolsExtension` unless the consumer opts in. Tool surface is off by default — agents explicitly register it.

---

## Architecture

### Contract

```ts
// packages/agentos/src/memory/archive/IMemoryArchive.ts

/**
 * Cold storage for verbatim memory content that would otherwise be destroyed
 * by consolidation (temporal gist, lifecycle archival, manual compaction).
 *
 * The archive is strictly write-ahead: any mechanism that would lose verbatim
 * content MUST call `store()` and await success before mutating the trace.
 * Archive writes that fail MUST abort the destructive operation.
 */
export interface IMemoryArchive {
  /**
   * Persist the verbatim trace content and identifying metadata.
   *
   * Idempotent on `trace.id`: calling `store()` twice with the same trace id
   * is a no-op on the second call. Implementations SHOULD verify that the
   * stored `contentHash` matches the incoming content and reject mismatches
   * as integrity violations.
   */
  store(trace: ArchivedTrace): Promise<ArchiveWriteResult>;

  /**
   * Return the verbatim content for a trace id, or `null` if not archived.
   *
   * MUST NOT mutate the source trace. Rehydration is a transient read; it
   * does not boost encoding strength, does not reset retrieval counts, and
   * does not generate a `retrievalFeedback` signal.
   */
  rehydrate(traceId: string): Promise<RehydratedTrace | null>;

  /**
   * Remove archived content for a trace id. Called when the trace itself
   * is hard-deleted (lifecycle policy, user deletion, retention expiry).
   */
  drop(traceId: string): Promise<void>;

  /**
   * Return archived trace ids matching optional filters. Used by retention
   * sweeps and integrity audits; not a retrieval path for agents.
   */
  list(options?: {
    agentId?: string;
    olderThanMs?: number;
    limit?: number;
  }): Promise<ArchiveListEntry[]>;
}

export interface ArchivedTrace {
  traceId: string;
  agentId: string;
  verbatimContent: string;
  contentHash: string; // sha256 of verbatimContent, for integrity checking
  traceType: MemoryType;
  emotionalContext: EmotionalContext;
  entities: readonly string[];
  tags: readonly string[];
  createdAt: number;
  archivedAt: number;
  // Reason this trace was archived — enables per-mechanism analytics.
  archiveReason: 'temporal_gist' | 'lifecycle_archive' | 'manual_compaction';
}

export interface RehydratedTrace {
  traceId: string;
  verbatimContent: string;
  contentHash: string;
  archivedAt: number;
  archiveReason: ArchivedTrace['archiveReason'];
}

export interface ArchiveWriteResult {
  success: boolean;
  traceId: string;
  bytesWritten: number;
  error?: string;
}

export interface ArchiveListEntry {
  traceId: string;
  agentId: string;
  archivedAt: number;
  archiveReason: ArchivedTrace['archiveReason'];
  byteSize: number;
}
```

### Default Implementation: `SqlStorageMemoryArchive`

A single implementation backed by `@framers/sql-storage-adapter`'s `StorageAdapter` interface — the same contract that `SqliteBrain`, `GraphRAGEngine`, and every other agentos persistence layer uses. This gives cross-platform support for free: better-sqlite3 (Node), sql.js (browser/WASM), IndexedDB (browser fallback), Capacitor SQLite (mobile), and PostgreSQL (production) — all behind one async API.

**Two usage modes, same class:**

1. **Shared adapter (recommended for portable brains):** Pass the brain's existing adapter. Archive table lives in the same database file as `memory_traces`, `knowledge_nodes`, etc. Soul export bundles one file. No cross-file transaction edge cases.

```ts
const brain = await SqliteBrain.open('/path/to/brain.sqlite');
const archive = new SqlStorageMemoryArchive(brain.adapter, brain.features);
// archived_traces table is created in brain.sqlite alongside memory_traces
```

2. **Standalone adapter (recommended for production Postgres or dedicated archive stores):** Pass a separate adapter. Archive table lives in its own database/schema.

```ts
const pgAdapter = await resolveStorageAdapter({
  postgres: { connectionString: process.env.DATABASE_URL },
});
const features = createStorageFeatures(pgAdapter);
const archive = new SqlStorageMemoryArchive(pgAdapter, features);
```

**DDL (dialect-aware via `StorageFeatures`):**

```sql
CREATE TABLE IF NOT EXISTS archived_traces (
  trace_id        TEXT    PRIMARY KEY,
  agent_id        TEXT    NOT NULL,
  verbatim_content TEXT   NOT NULL,
  content_hash    TEXT    NOT NULL,
  trace_type      TEXT    NOT NULL,
  emotional_context TEXT  NOT NULL DEFAULT '{}',   -- JSON
  entities        TEXT    NOT NULL DEFAULT '[]',    -- JSON
  tags            TEXT    NOT NULL DEFAULT '[]',    -- JSON
  created_at      INTEGER NOT NULL,                -- original trace creation (Unix ms)
  archived_at     INTEGER NOT NULL,                -- when archived (Unix ms)
  archive_reason  TEXT    NOT NULL,                -- 'temporal_gist' | 'lifecycle_archive' | 'manual_compaction'
  byte_size       INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_archived_traces_agent_time
  ON archived_traces (agent_id, archived_at);

CREATE INDEX IF NOT EXISTS idx_archived_traces_reason
  ON archived_traces (archive_reason);
```

JSON columns use `TEXT` (same pattern as `SqliteBrain.memory_traces.tags/emotions/metadata`). No embeddings — archives are keyed by id, not similarity-searched. Embeddings would be storage dead weight with no query benefit.

**Rehydration access log** (for usage-aware retention):

```sql
CREATE TABLE IF NOT EXISTS archive_access_log (
  trace_id       TEXT    NOT NULL,
  accessed_at    INTEGER NOT NULL,
  request_context TEXT,                            -- optional caller hint
  PRIMARY KEY (trace_id, accessed_at)
);

CREATE INDEX IF NOT EXISTS idx_archive_access_recency
  ON archive_access_log (trace_id, accessed_at DESC);
```

Each `rehydrate()` call writes a row to the access log. The retention sweep checks `archive_access_log` before dropping: if a trace has been rehydrated within its retention window, it's kept regardless of age. This prevents the worst outcome — dropping an archived trace that the agent is actively re-accessing. The access log is lightweight (one row per rehydration, no content, sweepable) and strictly append-only.

**Why no `VectorStoreMemoryArchive`:**

The original design proposed a VectorStore-backed implementation. After verifying the codebase, this is wrong. `SqliteBrain` and every other agentos persistence layer uses `StorageAdapter`, not `VectorStoreManager`. Archives store structured rows keyed by id — that's a SQL operation, not a vector search. `VectorStoreManager` is the wrong tool. Using `StorageAdapter` keeps the archive consistent with the existing persistence architecture and inherits cross-platform support without any new machinery.

The `MemoryLifecycleManager`'s existing `archiveTargetId` / `defaultArchiveStoreId` config fields referenced a VectorStore target that never existed. The wiring update (see below) replaces this with `archiveImpl: IMemoryArchive` which accepts a `SqlStorageMemoryArchive`. The old config fields are deprecated but kept as no-ops for backward compatibility.

**Contract test suite:** Both usage modes (shared adapter, standalone adapter) run the same `IMemoryArchive` contract test suite. Future backends inherit the suite.

### Wiring `TemporalGist` to the Archive

`applyTemporalGist()` currently hashes the original then overwrites `trace.content`. New flow, in strict order:

```ts
// 1. Hash original (existing behavior, kept for integrity)
const originalHash = await sha256(trace.content);

// 2. NEW: write-ahead archive. Abort gist on failure.
if (config.archive) {
  const writeResult = await config.archive.store({
    traceId: trace.id,
    agentId: resolvedAgentId,
    verbatimContent: trace.content,
    contentHash: originalHash,
    // ... other fields
    archiveReason: 'temporal_gist',
  });
  if (!writeResult.success) {
    // Archive failure is fatal for this trace's gist cycle.
    // The trace keeps its verbatim content; next cycle retries.
    continue;
  }
}

// 3. Existing: extract gist, overwrite content, weaken encoding strength
trace.content = gist;
trace.encodingStrength *= 0.8;
meta.gisted = true;
meta.originalContentHash = originalHash;
```

The `config.archive` field is new on `ResolvedTemporalGistConfig`. When absent, `TemporalGist` behaves identically to today — no regression for consumers that haven't adopted the archive yet.

### Wiring `MemoryLifecycleManager` to the Archive

`executeLifecycleAction()`'s archive branch stops being conceptual. New behavior:

1. Resolve the archive via the manager's new `archive: IMemoryArchive` field (injected at construction).
2. Build an `ArchivedTrace` from the `LifecycleCandidateItem`. Content is resolved via the vector store's `fetch()` path or from `candidate.textContent` when available.
3. `await archive.store(archived)` — abort the delete on failure, log as `ARCHIVAL_FAILED`.
4. Only after a successful archive write, perform the `vectorStoreRef.delete()`.
5. Report lifecycle action as `ARCHIVED` (new code in `MLM_ACTION_REPORT_CODES`) instead of the current conceptual `ARCHIVAL_PROPOSED`.

The config shape grows by one optional field: `archiveImpl?: IMemoryArchive`. When absent, the existing "fall back to delete" behavior is preserved — no regression. The old `archiveTargetId` / `defaultArchiveStoreId` fields are deprecated but preserved as no-ops to avoid breaking existing config objects.

### Rehydration Surface

**Direct API on `CognitiveMemoryManager`:**

```ts
/**
 * Return the verbatim content that was archived when this trace was
 * consolidated, or `null` if the trace is not gisted/archived or the
 * archive is unreachable.
 *
 * Rehydration is a transient read: the returned content is not
 * substituted into the live trace, retrieval counts are not
 * incremented, and no reconsolidation or feedback signal fires.
 *
 * A lightweight access-log entry IS written so that the retention
 * sweep can distinguish frequently-rehydrated traces from abandoned
 * ones. This does not affect encoding strength or retrieval priority.
 *
 * @param traceId - The trace id to rehydrate.
 * @param requestContext - Optional caller hint for audit (e.g. 'narrator_turn_42').
 * @returns The original verbatim content, or `null` if not archived.
 *
 * @see {@link IMemoryArchive.rehydrate} for the underlying archive contract.
 * @see {@link SqlStorageMemoryArchive} for the default implementation.
 *
 * @example
 * ```ts
 * const verbatim = await manager.rehydrate('trace_abc123');
 * if (verbatim) {
 *   // Inject the full original content into context for this turn only
 *   contextBuilder.appendTransient(verbatim);
 * }
 * ```
 */
async rehydrate(traceId: string, requestContext?: string): Promise<string | null>;
```

**Optional LLM tool** — `packages/agentos/src/memory/io/tools/RehydrateMemoryTool.ts`:

```ts
{
  name: 'rehydrate_memory',
  description:
    "Look up the full original content of a memory whose summary you've seen. " +
    'Use this when a gisted memory is relevant and the summary lacks detail.',
  input: { traceId: 'string' },
  output: { verbatimContent: 'string | null', archivedAt: 'number' },
}
```

Registered via `MemoryToolsExtension` only when the consumer passes `{ rehydration: true }`. Opt-in keeps the default tool surface unchanged for existing agents.

### Failure Modes

| Failure | Behavior |
|---|---|
| Archive write fails in `TemporalGist` | Trace keeps verbatim content, retried next cycle. Logged at `warn`. |
| Archive write fails in `MemoryLifecycleManager` | Deletion aborted, reported as `ARCHIVAL_FAILED`, item retained in place. |
| `rehydrate()` called on non-archived trace | Returns `null`. Not an error. |
| `rehydrate()` called on archived trace whose hash mismatches | Returns `null`, emits `archive_integrity_violation` metric, logs at `error`. Does not throw (an agent tool call should never crash the request). |
| Archive backing store unavailable at startup | `CognitiveMemoryManager.initialize()` warns but does not throw. `gist` and `archive` lifecycle actions fall back to pre-spec behavior. |
| `drop()` on unknown trace id | No-op, returns successfully. |

### Retention Policy

Configuration on the archive:

```ts
export interface MemoryArchiveConfig {
  /** Hard drop archived content older than this. Default: 365 days. */
  maxAgeMs?: number;
  /** Hard drop when total archive size exceeds this. Default: unbounded. */
  maxTotalBytes?: number;
  /** Per-agent byte cap. Default: unbounded. */
  maxAgentBytes?: number;
}
```

Retention sweep runs inside `ConsolidationLoop` as a new step 7 (`prune_archive`), after the existing 6 steps. Sweep algorithm:

1. `archive.list({ olderThanMs: maxAgeMs })` — get candidates past the age threshold.
2. For each candidate, query `archive_access_log` for the most recent rehydration. If `lastRehydratedAt > (now - maxAgeMs)`, the trace is still in active use — skip it.
3. Drop remaining candidates via `archive.drop(traceId)` in batches.
4. Sweep the access log itself: delete rows whose `trace_id` no longer exists in `archived_traces`.

Sweep is idempotent and safe to run on every consolidation cycle. The access-log check prevents the worst retention failure: dropping an archived trace that the agent is actively and repeatedly rehydrating.

---

## Documentation Plan

This spec treats docs as first-class deliverables, not a post-hoc task.

### TSDoc / JSDoc discipline

Every new public symbol — interfaces, classes, methods, functions, exported types — ships with full TSDoc at the same time as the code. The existing `typedoc` → `agentos-live-docs` pipeline converts TSDoc into the public API reference at `docs.agentos.sh` automatically, so thorough docstrings pay for themselves without any manual docs-site work.

Minimum bar per symbol:
- One-sentence description (imperative mood, present tense).
- `@param` for every parameter with purpose, not just type.
- `@returns` for non-void returns, describing the returned shape and what `null` / errors mean.
- `@throws` for any thrown error.
- `@see` cross-references to related cognitive mechanisms (`TemporalGist`, `MemoryLifecycleManager`) and to the design spec file itself.
- `@example` on the top-level `IMemoryArchive` contract and on `CognitiveMemoryManager.rehydrate()`.

Inline comments on non-obvious logic inside function bodies — especially the strict ordering in the rewired `TemporalGist` (hash → archive → overwrite) and the `MemoryLifecycleManager` archive-before-delete sequence. The ordering is load-bearing; comments must say so.

### Docs files to update in `packages/agentos/docs/memory/`

| File | Update |
|---|---|
| [`MEMORY_ARCHITECTURE.md`](../memory/MEMORY_ARCHITECTURE.md) | New section "Memory Archive" describing the two-tier working/cold model and the write-ahead invariant. Architecture diagram updated to show archive sitting beside `CognitiveMemoryManager`. |
| [`MEMORY_CONSOLIDATION.md`](../memory/MEMORY_CONSOLIDATION.md) | Rewrite the "Step 7 / prune_archive" subsection. Update the `TemporalGist` description to state that gist is now write-ahead. |
| [`COGNITIVE_MECHANISMS.md`](../memory/COGNITIVE_MECHANISMS.md) | Add a "Rehydration" row noting that gisted/archived content can be inflated on demand and does not decay while archived. |
| [`MEMORY_STORAGE.md`](../memory/MEMORY_STORAGE.md) | Document `SqlStorageMemoryArchive` — how it wraps `StorageAdapter`, shared-adapter vs standalone modes, cross-platform support matrix (better-sqlite3, sql.js, IndexedDB, Capacitor, Postgres). Archive DDL, access-log DDL, and how the archive table co-locates with `SqliteBrain` when sharing an adapter. |
| [`MEMORY_TOOLS.md`](../memory/MEMORY_TOOLS.md) | Document the opt-in `rehydrate_memory` tool — when to register it, prompt guidance for agents, failure semantics. |
| [`COGNITIVE_MEMORY_GUIDE.md`](../memory/COGNITIVE_MEMORY_GUIDE.md) | New "Long-running agents" section walking through the archive + rehydrate loop with a worked example. |

### `agentos-live-docs` site updates

- Verify the new `memory/archive/` module is picked up by `docusaurus-plugin-typedoc`. Expected path: `docs.agentos.sh/api/memory/archive/`.
- Add a new guide page under `docs/guides/long-running-memory.md` in `apps/agentos-live-docs/docs/` that renders alongside the existing memory guides. Cross-link to the `MEMORY_CONSOLIDATION.md` and `COGNITIVE_MEMORY_GUIDE.md` updates above.
- Update the memory sidebar section in [`apps/agentos-live-docs/sidebars.js`](../../../../../apps/agentos-live-docs/sidebars.js) to include the new guide.

### Wilds-side downstream docs

- [`apps/wilds-ai/docs/guides/MEMORY_SYSTEM_GUIDE.md`](../../../../../apps/wilds-ai/docs/guides/MEMORY_SYSTEM_GUIDE.md): add a short section noting that per-entity brains now preserve verbatim content past the gist threshold, and that soul exports should include the companion's archive sqlite alongside the brain sqlite.

---

## Testing Plan

Tests live next to source following the existing agentos convention (`__tests__/` sibling folders). All three test layers ship with the spec; no layer is deferred.

### Unit tests

`packages/agentos/src/memory/archive/__tests__/`:

- **`IMemoryArchive.contract.test.ts`** — shared contract suite run against both adapter modes (shared with brain, standalone). Covers: store-then-rehydrate round trip, idempotent store, hash integrity violation detection, `null` on unknown id, `list()` filtering, `drop()` removing content, access-log row written on rehydrate, retention sweep skips recently-rehydrated traces, retention sweep drops old un-rehydrated traces.
- **`SqlStorageMemoryArchive.test.ts`** — implementation-specific: DDL creation on both SQLite and Postgres adapters via `resolveStorageAdapter()`, byte-size accounting, concurrent store/rehydrate safety, shared-adapter mode (archive table co-exists with `memory_traces` in same DB), standalone-adapter mode (archive table in its own DB), access-log pruning.

`packages/agentos/src/memory/mechanisms/__tests__/consolidation.test.ts` (extend existing):

- New cases: `applyTemporalGist` with archive configured stores verbatim before overwriting; archive write failure aborts the gist for that trace; trace content remains unchanged on abort; `originalContentHash` still matches archived `contentHash`.

`packages/agentos/src/memory/pipeline/lifecycle/__tests__/MemoryLifecycleManager.test.ts` (extend existing):

- New cases: archive action performs a real store-then-delete; archive failure aborts deletion and reports `ARCHIVAL_FAILED`; config without `archiveImpl` falls back to pre-spec behavior without regression.

`packages/agentos/src/memory/io/tools/__tests__/RehydrateMemoryTool.test.ts`:

- Tool invocation returns archived content; returns `null` for non-archived traces; opt-in registration works; default registration does not expose the tool.

### Integration tests

`packages/agentos/tests/integration/memory/archive-rehydrate-roundtrip.test.ts`:

- Full loop: instantiate a `CognitiveMemoryManager` with a real `SqliteBrain` + `SqliteMemoryArchive`, ingest 100 traces, force a gist cycle on half of them, verify working content is gisted, call `manager.rehydrate(traceId)` on each gisted trace, verify verbatim content matches the pre-gist values. Run against both archive implementations.

`packages/agentos/tests/integration/memory/consolidation-loop-with-archive.test.ts`:

- Run the full `ConsolidationLoop` (all 7 steps including the new `prune_archive`) over a simulated long-running agent: 1000 traces across 400 simulated days, retention set to 180 days, verify archive size bounded and rehydration still works for all non-expired traces.

`packages/agentos/tests/integration/memory/lifecycle-archive-action.test.ts`:

- Exercise `MemoryLifecycleManager.executeLifecycleAction()` with an `archive` policy on a real vector store, verify item appears in the archive target and is deleted from the source.

### Parity tests

`packages/agentos/tests/parity/`:

- Confirm existing memory tests continue to pass with `archive` configured AND with it unset. The "archive absent" parity run is the regression gate for consumers who don't adopt the new contract.

### Manual QA checklist

- Run a wilds-ai session end-to-end with a cognitive companion, verify gist cycle produces archived rows in the companion's brain sqlite (`archived_traces` table), verify `rehydrate_memory` tool is callable from the narrator prompt, verify access-log rows appear after rehydration.
- Soul export/import round trip: the brain sqlite now includes `archived_traces` and `archive_access_log` tables — verify export bundles them and import restores them.

---

## Rollout

1. **Land the `IMemoryArchive` contract and `SqlStorageMemoryArchive` implementation** with the full test matrix (contract suite against both SQLite and Postgres adapters). No consumer wiring yet. Ships as a new module that's safe to ignore.
2. **Add `archived_traces` + `archive_access_log` DDL to `SqliteBrain._initSchema()`** — additive migration, `CREATE TABLE IF NOT EXISTS`. Existing brain databases gain the tables on next open. No data loss, no schema version bump needed.
3. **Wire `TemporalGist`** to the optional `archive` config field. Default unchanged; opt-in consumers start preserving verbatim content.
4. **Wire `MemoryLifecycleManager`** to the optional `archiveImpl` field. Deprecate `archiveTargetId` / `defaultArchiveStoreId` as no-ops. Default unchanged.
5. **Add `rehydrate()` to `CognitiveMemoryManager`** with access-log write, and register the opt-in `rehydrate_memory` tool.
6. **Ship the consolidation-loop retention sweep (`prune_archive`)** with access-log-aware skip logic.
7. **Update agentos docs + agentos-live-docs + wilds-ai guide.** TSDoc on every new public symbol feeds the live docs site automatically.
8. **Flip wilds-ai to adopt the archive** in `WildsMemoryFacade.createCognitive()` for both companion and NPC brains — pass the brain's own adapter to `SqlStorageMemoryArchive` (shared-adapter mode). Verify in staging, then production.

Each step is independently mergeable and reversible.

---

## Resolved Design Decisions

These were originally open questions. Resolved during spec revision after verifying the `sql-storage-adapter` and `SqliteBrain` architecture.

### 1. Shared adapter vs separate files → **Shared adapter (same DB file)**

`SqlStorageMemoryArchive` accepts any `StorageAdapter`. When passed the brain's adapter, the `archived_traces` table lives in the same SQLite file as `memory_traces`. This means:
- Soul export bundles one file, not two.
- No cross-file transaction edge cases.
- The archive table is created alongside the brain schema during `SqliteBrain._initSchema()`.

For Postgres production, the archive table lives in the same foundation database. Same shared-adapter pattern, different backend.

### 2. Embeddings in the archive → **No**

Archives are keyed by trace id and never similarity-searched. Storing embeddings wastes ~1.5KB per trace (384-dim float32) with zero query benefit. If a future spec needs semantic search over cold storage, it adds an embedding column at that point — not preemptively.

### 3. Rehydration auditing → **Yes, lightweight access log**

Rehydration does NOT produce a `retrievalFeedback` signal (which would trigger Hebbian co-activation edges and interact with `Reconsolidation`). Instead, it writes a minimal row to `archive_access_log(trace_id, accessed_at, request_context)`. This gives the retention sweep one signal: "was this trace rehydrated recently?" If yes, don't drop it regardless of age. The access log is append-only, sweepable, and adds negligible overhead (one row per rehydration, no content, no embeddings).

The alternative (audit-silent rehydration) would mean a 365-day-old trace that gets rehydrated weekly is dropped anyway. That's the wrong behavior — if the agent is actively re-accessing it, the retention policy should notice.

## Remaining Open Questions

1. **Schema migration path for existing `SqliteBrain` databases:** When a brain database opened by a previous version of AgentOS is opened by a version that includes the archive DDL, the `archived_traces` and `archive_access_log` tables need to be created. `SqliteBrain._initSchema()` uses `CREATE TABLE IF NOT EXISTS`, so this is a no-op for new databases and an additive migration for existing ones. Verify that all adapter backends handle `CREATE TABLE IF NOT EXISTS` without errors on an already-initialized brain. (Expected: yes, but verify in the parity test suite.)

2. **Maximum access log growth:** The access log grows by one row per rehydration. For a heavily-used companion rehydrating ~10 traces per turn over 500 sessions, that's ~50K rows. The sweep cleans up rows for dropped traces, but live traces accumulate. Should the sweep also prune access-log rows older than `maxAgeMs` for still-live traces? Proposed: yes, keep only the most recent 100 rows per trace_id. Resolve during implementation.
