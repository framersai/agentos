# Memory Archive & Rehydration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add lossless cold storage for verbatim memory content before `TemporalGist` and `MemoryLifecycleManager` compress/destroy it, with an on-demand `rehydrate(traceId)` path and usage-aware retention.

**Architecture:** Single `IMemoryArchive` contract implemented by `SqlStorageMemoryArchive`, which wraps `@framers/sql-storage-adapter`'s `StorageAdapter` — the same contract `SqliteBrain` uses. Two SQL tables (`archived_traces`, `archive_access_log`) added to the brain schema. `TemporalGist` becomes write-ahead (archive before overwriting). `ConsolidationPipeline` gains a step 7 (`prune_archive`) with access-log-aware retention.

**Tech Stack:** TypeScript, `@framers/sql-storage-adapter` (`StorageAdapter`, `StorageFeatures`, `SqlDialect`), vitest, `@framers/agentos` memory subsystem.

**Spec:** [`packages/agentos/docs/superpowers/specs/2026-04-10-memory-archive-rehydration-design.md`](../specs/2026-04-10-memory-archive-rehydration-design.md)

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `src/memory/archive/IMemoryArchive.ts` | Contract interface + all archive types |
| Create | `src/memory/archive/SqlStorageMemoryArchive.ts` | Default implementation wrapping `StorageAdapter` |
| Create | `src/memory/archive/index.ts` | Barrel exports |
| Create | `src/memory/archive/__tests__/IMemoryArchive.contract.test.ts` | Shared contract suite |
| Create | `src/memory/archive/__tests__/SqlStorageMemoryArchive.test.ts` | Implementation-specific tests |
| Create | `src/memory/io/tools/RehydrateMemoryTool.ts` | LLM-facing rehydrate tool |
| Create | `src/memory/io/tools/__tests__/RehydrateMemoryTool.test.ts` | Tool unit tests |
| Modify | `src/memory/retrieval/store/SqliteBrain.ts` | Add DDL for `archived_traces` + `archive_access_log` |
| Modify | `src/memory/mechanisms/types.ts` | Add `archive?` to `ResolvedTemporalGistConfig` |
| Modify | `src/memory/mechanisms/consolidation/TemporalGist.ts` | Write-ahead archive before content overwrite |
| Modify | `src/memory/mechanisms/__tests__/consolidation.test.ts` | New gist+archive test cases |
| Modify | `src/memory/CognitiveMemoryManager.ts` | Add `rehydrate()` method |
| Modify | `src/memory/pipeline/consolidation/ConsolidationPipeline.ts` | Step 7: prune_archive |
| Modify | `src/memory/io/tools/index.ts` | Export `RehydrateMemoryTool` |
| Modify | `src/memory/io/extension/MemoryToolsExtension.ts` | Opt-in `includeRehydrate` flag |

All paths relative to `packages/agentos/`.

---

### Task 1: IMemoryArchive Contract & Types

**Files:**
- Create: `src/memory/archive/IMemoryArchive.ts`

- [ ] **Step 1: Create the contract file with all types**

```ts
// src/memory/archive/IMemoryArchive.ts

/**
 * @fileoverview Cold storage contract for verbatim memory content.
 *
 * The archive preserves original trace content before consolidation mechanisms
 * (temporal gist, lifecycle archival) overwrite or delete it. This enables
 * on-demand rehydration: lossy summaries in working context, lossless content
 * in cold storage, inflation driven by the LLM's own retrieval decisions.
 *
 * The archive is strictly write-ahead: any mechanism that would lose verbatim
 * content MUST call `store()` and await success before mutating the trace.
 * Archive writes that fail MUST abort the destructive operation.
 *
 * @module agentos/memory/archive/IMemoryArchive
 * @see {@link SqlStorageMemoryArchive} for the default implementation.
 * @see {@link ../../mechanisms/consolidation/TemporalGist} for the primary consumer.
 */

import type { MemoryType, EmotionalContext } from '../core/types.js';

// ---------------------------------------------------------------------------
// Archive reason
// ---------------------------------------------------------------------------

/**
 * Why a trace was archived. Enables per-mechanism analytics and filtering.
 */
export type ArchiveReason = 'temporal_gist' | 'lifecycle_archive' | 'manual_compaction';

// ---------------------------------------------------------------------------
// Archive data shapes
// ---------------------------------------------------------------------------

/**
 * Full archived trace record, written to cold storage.
 *
 * Contains the verbatim content and all identifying metadata needed to
 * verify integrity on rehydration.
 */
export interface ArchivedTrace {
  /** ID of the source `MemoryTrace`. */
  traceId: string;
  /** Agent that owns this trace. */
  agentId: string;
  /** Original verbatim content before consolidation overwrote it. */
  verbatimContent: string;
  /** SHA-256 of `verbatimContent` for integrity verification. */
  contentHash: string;
  /** Tulving type of the original trace. */
  traceType: MemoryType;
  /** PAD snapshot at encoding time. */
  emotionalContext: EmotionalContext;
  /** Entity names extracted at encoding time. */
  entities: readonly string[];
  /** Tags on the original trace. */
  tags: readonly string[];
  /** When the original trace was created (Unix ms). */
  createdAt: number;
  /** When this archive record was written (Unix ms). */
  archivedAt: number;
  /** Why this trace was archived. */
  archiveReason: ArchiveReason;
}

/**
 * Returned by {@link IMemoryArchive.rehydrate}.
 * Contains only the fields needed for transient inflation.
 */
export interface RehydratedTrace {
  traceId: string;
  verbatimContent: string;
  contentHash: string;
  archivedAt: number;
  archiveReason: ArchiveReason;
}

/**
 * Result of an {@link IMemoryArchive.store} call.
 */
export interface ArchiveWriteResult {
  success: boolean;
  traceId: string;
  bytesWritten: number;
  error?: string;
}

/**
 * Entry returned by {@link IMemoryArchive.list}.
 */
export interface ArchiveListEntry {
  traceId: string;
  agentId: string;
  archivedAt: number;
  archiveReason: ArchiveReason;
  byteSize: number;
}

/**
 * Retention configuration for archive sweeps.
 */
export interface MemoryArchiveRetentionConfig {
  /** Hard-drop archived content older than this. @default 365 * 86_400_000 (365 days) */
  maxAgeMs?: number;
  /** Hard-drop when total archive size exceeds this in bytes. @default Infinity */
  maxTotalBytes?: number;
  /** Per-agent byte cap. @default Infinity */
  maxAgentBytes?: number;
}

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

/**
 * Cold storage for verbatim memory content that would otherwise be destroyed
 * by consolidation (temporal gist, lifecycle archival, manual compaction).
 *
 * Implementations use `@framers/sql-storage-adapter`'s `StorageAdapter` for
 * cross-platform persistence (SQLite, Postgres, IndexedDB, Capacitor).
 *
 * @example Shared adapter with SqliteBrain
 * ```ts
 * const brain = await SqliteBrain.open('/path/to/brain.sqlite');
 * const archive = new SqlStorageMemoryArchive(brain.adapter, brain.features);
 * ```
 *
 * @example Standalone Postgres adapter
 * ```ts
 * const pgAdapter = await resolveStorageAdapter({
 *   postgres: { connectionString: process.env.DATABASE_URL },
 * });
 * const features = createStorageFeatures(pgAdapter);
 * const archive = new SqlStorageMemoryArchive(pgAdapter, features);
 * ```
 */
export interface IMemoryArchive {
  /**
   * Persist the verbatim trace content and identifying metadata.
   *
   * Idempotent on `trace.traceId`: calling `store()` twice with the same
   * trace id is a no-op on the second call. Implementations SHOULD verify
   * that the stored `contentHash` matches the incoming content and reject
   * mismatches as integrity violations.
   *
   * @param trace - The archived trace record to persist.
   * @returns Write result with success flag and bytes written.
   */
  store(trace: ArchivedTrace): Promise<ArchiveWriteResult>;

  /**
   * Return the verbatim content for a trace id, or `null` if not archived.
   *
   * MUST NOT mutate the source trace. Rehydration is a transient read; it
   * does not boost encoding strength, does not reset retrieval counts, and
   * does not generate a `retrievalFeedback` signal.
   *
   * Writes a row to `archive_access_log` so the retention sweep can
   * distinguish frequently-rehydrated traces from abandoned ones.
   *
   * @param traceId - The trace id to rehydrate.
   * @param requestContext - Optional caller hint for audit (e.g. 'narrator_turn_42').
   * @returns The rehydrated trace data, or `null` if not found or integrity check fails.
   */
  rehydrate(traceId: string, requestContext?: string): Promise<RehydratedTrace | null>;

  /**
   * Remove archived content for a trace id. Called when the trace itself
   * is hard-deleted (lifecycle policy, user deletion, retention expiry).
   * No-op if the trace id is not found.
   *
   * @param traceId - The trace id to remove from the archive.
   */
  drop(traceId: string): Promise<void>;

  /**
   * Return archived trace metadata matching optional filters.
   * Used by retention sweeps and integrity audits; not a retrieval path for agents.
   *
   * @param options - Optional filters for agent, age, and result limit.
   * @returns Array of archive list entries (metadata only, no content).
   */
  list(options?: {
    agentId?: string;
    olderThanMs?: number;
    limit?: number;
  }): Promise<ArchiveListEntry[]>;

  /**
   * Return the most recent access timestamp for a trace id from the access log.
   * Returns `null` if the trace has never been rehydrated.
   *
   * @param traceId - The trace id to check.
   * @returns Unix ms of the most recent rehydration, or `null`.
   */
  lastAccessedAt(traceId: string): Promise<number | null>;

  /**
   * Initialize the archive schema (CREATE TABLE IF NOT EXISTS).
   * Called once during setup. Idempotent.
   */
  initialize(): Promise<void>;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/memory/archive/IMemoryArchive.ts
git commit -m "feat(memory): add IMemoryArchive contract and archive types"
```

---

### Task 2: SqlStorageMemoryArchive Implementation

**Files:**
- Create: `src/memory/archive/SqlStorageMemoryArchive.ts`

- [ ] **Step 1: Write the failing contract test**

Create `src/memory/archive/__tests__/IMemoryArchive.contract.test.ts`:

```ts
// src/memory/archive/__tests__/IMemoryArchive.contract.test.ts

/**
 * @fileoverview Shared contract test suite for IMemoryArchive implementations.
 *
 * Run against both shared-adapter and standalone-adapter modes of
 * SqlStorageMemoryArchive. Future backends inherit this suite.
 *
 * @module agentos/memory/archive/__tests__/IMemoryArchive.contract.test
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveStorageAdapter, createStorageFeatures } from '@framers/sql-storage-adapter';
import type { StorageAdapter, StorageFeatures } from '@framers/sql-storage-adapter';
import { SqlStorageMemoryArchive } from '../SqlStorageMemoryArchive.js';
import type { IMemoryArchive, ArchivedTrace } from '../IMemoryArchive.js';
import { sha256 } from '../../core/util/crossPlatformCrypto.js';

function makeTrace(overrides: Partial<ArchivedTrace> = {}): ArchivedTrace {
  return {
    traceId: overrides.traceId ?? 'trace_001',
    agentId: overrides.agentId ?? 'agent_test',
    verbatimContent: overrides.verbatimContent ?? 'The dragon attacked the village at dawn.',
    contentHash: overrides.contentHash ?? '',
    traceType: overrides.traceType ?? 'episodic',
    emotionalContext: overrides.emotionalContext ?? {
      valence: -0.5, arousal: 0.8, dominance: -0.3, intensity: 0.4, gmiMood: 'anxious',
    },
    entities: overrides.entities ?? ['dragon', 'village'],
    tags: overrides.tags ?? ['combat', 'world_event'],
    createdAt: overrides.createdAt ?? Date.now() - 86_400_000 * 90,
    archivedAt: overrides.archivedAt ?? Date.now(),
    archiveReason: overrides.archiveReason ?? 'temporal_gist',
  };
}

/**
 * Run the full IMemoryArchive contract suite against a given archive instance.
 * Call this function from implementation-specific test files.
 */
export function runArchiveContractSuite(
  createArchive: () => Promise<{ archive: IMemoryArchive; cleanup: () => Promise<void> }>,
) {
  let archive: IMemoryArchive;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const result = await createArchive();
    archive = result.archive;
    cleanup = result.cleanup;
  });

  afterEach(async () => {
    await cleanup();
  });

  it('store-then-rehydrate round trip preserves verbatim content', async () => {
    const trace = makeTrace();
    trace.contentHash = await sha256(trace.verbatimContent);

    const writeResult = await archive.store(trace);
    expect(writeResult.success).toBe(true);
    expect(writeResult.traceId).toBe('trace_001');
    expect(writeResult.bytesWritten).toBeGreaterThan(0);

    const rehydrated = await archive.rehydrate('trace_001');
    expect(rehydrated).not.toBeNull();
    expect(rehydrated!.verbatimContent).toBe(trace.verbatimContent);
    expect(rehydrated!.contentHash).toBe(trace.contentHash);
    expect(rehydrated!.archiveReason).toBe('temporal_gist');
  });

  it('store is idempotent on same trace id', async () => {
    const trace = makeTrace();
    trace.contentHash = await sha256(trace.verbatimContent);

    await archive.store(trace);
    const second = await archive.store(trace);
    expect(second.success).toBe(true);

    const list = await archive.list({ agentId: 'agent_test' });
    expect(list).toHaveLength(1);
  });

  it('rehydrate returns null for unknown trace id', async () => {
    const result = await archive.rehydrate('nonexistent_trace');
    expect(result).toBeNull();
  });

  it('rehydrate returns null on content hash mismatch', async () => {
    const trace = makeTrace({ contentHash: 'wrong_hash_on_purpose' });
    await archive.store(trace);

    const result = await archive.rehydrate('trace_001');
    expect(result).toBeNull();
  });

  it('drop removes archived content', async () => {
    const trace = makeTrace();
    trace.contentHash = await sha256(trace.verbatimContent);
    await archive.store(trace);

    await archive.drop('trace_001');
    const result = await archive.rehydrate('trace_001');
    expect(result).toBeNull();
  });

  it('drop is no-op for unknown trace id', async () => {
    await expect(archive.drop('nonexistent')).resolves.not.toThrow();
  });

  it('list filters by agentId', async () => {
    const t1 = makeTrace({ traceId: 't1', agentId: 'agent_a' });
    t1.contentHash = await sha256(t1.verbatimContent);
    const t2 = makeTrace({ traceId: 't2', agentId: 'agent_b' });
    t2.contentHash = await sha256(t2.verbatimContent);

    await archive.store(t1);
    await archive.store(t2);

    const listA = await archive.list({ agentId: 'agent_a' });
    expect(listA).toHaveLength(1);
    expect(listA[0].traceId).toBe('t1');
  });

  it('list filters by olderThanMs', async () => {
    const old = makeTrace({ traceId: 'old', archivedAt: Date.now() - 86_400_000 * 400 });
    old.contentHash = await sha256(old.verbatimContent);
    const recent = makeTrace({ traceId: 'recent', archivedAt: Date.now() - 1000 });
    recent.contentHash = await sha256(recent.verbatimContent);

    await archive.store(old);
    await archive.store(recent);

    const staleList = await archive.list({ olderThanMs: 86_400_000 * 365 });
    expect(staleList).toHaveLength(1);
    expect(staleList[0].traceId).toBe('old');
  });

  it('list respects limit', async () => {
    for (let i = 0; i < 5; i++) {
      const t = makeTrace({ traceId: `t${i}` });
      t.contentHash = await sha256(t.verbatimContent);
      await archive.store(t);
    }
    const limited = await archive.list({ limit: 2 });
    expect(limited).toHaveLength(2);
  });

  it('rehydrate writes access log entry', async () => {
    const trace = makeTrace();
    trace.contentHash = await sha256(trace.verbatimContent);
    await archive.store(trace);

    const beforeAccess = await archive.lastAccessedAt('trace_001');
    expect(beforeAccess).toBeNull();

    await archive.rehydrate('trace_001', 'test_context');

    const afterAccess = await archive.lastAccessedAt('trace_001');
    expect(afterAccess).not.toBeNull();
    expect(afterAccess).toBeGreaterThan(0);
  });
}
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd packages/agentos && npx vitest run src/memory/archive/__tests__/IMemoryArchive.contract.test.ts
```

Expected: compilation error — `SqlStorageMemoryArchive` does not exist yet.

- [ ] **Step 3: Write SqlStorageMemoryArchive**

```ts
// src/memory/archive/SqlStorageMemoryArchive.ts

/**
 * @fileoverview Default IMemoryArchive implementation backed by StorageAdapter.
 *
 * Uses the same `@framers/sql-storage-adapter` contract as `SqliteBrain`,
 * `GraphRAGEngine`, and every other agentos persistence layer. Supports all
 * sql-storage-adapter backends: better-sqlite3, sql.js, IndexedDB, Capacitor
 * SQLite, and PostgreSQL.
 *
 * Two usage modes:
 * 1. **Shared adapter** — pass the brain's `StorageAdapter`. Archive tables
 *    live in the same database. Soul exports bundle one file.
 * 2. **Standalone adapter** — pass a separate adapter. Archive tables live
 *    in their own database or schema.
 *
 * @module agentos/memory/archive/SqlStorageMemoryArchive
 * @see {@link IMemoryArchive} for the contract definition.
 * @see {@link ../../retrieval/store/SqliteBrain} for the shared-adapter pattern.
 */

import type { StorageAdapter, StorageFeatures } from '@framers/sql-storage-adapter';
import { sha256 } from '../core/util/crossPlatformCrypto.js';
import type {
  IMemoryArchive,
  ArchivedTrace,
  RehydratedTrace,
  ArchiveWriteResult,
  ArchiveListEntry,
} from './IMemoryArchive.js';

// ---------------------------------------------------------------------------
// DDL
// ---------------------------------------------------------------------------

/** @internal */
export const DDL_ARCHIVED_TRACES = `
CREATE TABLE IF NOT EXISTS archived_traces (
  trace_id         TEXT    PRIMARY KEY,
  agent_id         TEXT    NOT NULL,
  verbatim_content TEXT    NOT NULL,
  content_hash     TEXT    NOT NULL,
  trace_type       TEXT    NOT NULL,
  emotional_context TEXT   NOT NULL DEFAULT '{}',
  entities         TEXT    NOT NULL DEFAULT '[]',
  tags             TEXT    NOT NULL DEFAULT '[]',
  created_at       INTEGER NOT NULL,
  archived_at      INTEGER NOT NULL,
  archive_reason   TEXT    NOT NULL,
  byte_size        INTEGER NOT NULL DEFAULT 0
);
`;

/** @internal */
export const DDL_ARCHIVED_TRACES_IDX_AGENT_TIME = `
CREATE INDEX IF NOT EXISTS idx_archived_traces_agent_time
  ON archived_traces (agent_id, archived_at);
`;

/** @internal */
export const DDL_ARCHIVED_TRACES_IDX_REASON = `
CREATE INDEX IF NOT EXISTS idx_archived_traces_reason
  ON archived_traces (archive_reason);
`;

/** @internal */
export const DDL_ARCHIVE_ACCESS_LOG = `
CREATE TABLE IF NOT EXISTS archive_access_log (
  trace_id        TEXT    NOT NULL,
  accessed_at     INTEGER NOT NULL,
  request_context TEXT,
  PRIMARY KEY (trace_id, accessed_at)
);
`;

/** @internal */
export const DDL_ARCHIVE_ACCESS_LOG_IDX = `
CREATE INDEX IF NOT EXISTS idx_archive_access_recency
  ON archive_access_log (trace_id, accessed_at DESC);
`;

// ---------------------------------------------------------------------------
// Row shape
// ---------------------------------------------------------------------------

interface ArchivedTraceRow {
  trace_id: string;
  agent_id: string;
  verbatim_content: string;
  content_hash: string;
  trace_type: string;
  emotional_context: string;
  entities: string;
  tags: string;
  created_at: number;
  archived_at: number;
  archive_reason: string;
  byte_size: number;
}

interface AccessLogRow {
  accessed_at: number;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Default `IMemoryArchive` implementation using `@framers/sql-storage-adapter`.
 *
 * @example Shared adapter with SqliteBrain
 * ```ts
 * const brain = await SqliteBrain.open('/path/to/brain.sqlite');
 * const archive = new SqlStorageMemoryArchive(brain.adapter, brain.features);
 * await archive.initialize();
 * ```
 */
export class SqlStorageMemoryArchive implements IMemoryArchive {
  /**
   * @param adapter - An initialized `StorageAdapter` instance. Can be shared
   *   with `SqliteBrain` (same DB) or standalone (own DB).
   * @param features - Platform-aware feature bundle for dialect-portable SQL.
   */
  constructor(
    private readonly adapter: StorageAdapter,
    private readonly features: StorageFeatures,
  ) {}

  /**
   * Create the `archived_traces` and `archive_access_log` tables.
   * Uses `CREATE TABLE/INDEX IF NOT EXISTS` — safe to call repeatedly.
   */
  async initialize(): Promise<void> {
    await this.adapter.exec(DDL_ARCHIVED_TRACES);
    await this.adapter.exec(DDL_ARCHIVED_TRACES_IDX_AGENT_TIME);
    await this.adapter.exec(DDL_ARCHIVED_TRACES_IDX_REASON);
    await this.adapter.exec(DDL_ARCHIVE_ACCESS_LOG);
    await this.adapter.exec(DDL_ARCHIVE_ACCESS_LOG_IDX);
  }

  /** @inheritdoc */
  async store(trace: ArchivedTrace): Promise<ArchiveWriteResult> {
    // Idempotent: check if already stored
    const existing = await this.adapter.get<{ trace_id: string }>(
      'SELECT trace_id FROM archived_traces WHERE trace_id = ?',
      [trace.traceId],
    );
    if (existing) {
      return { success: true, traceId: trace.traceId, bytesWritten: 0 };
    }

    const byteSize = new TextEncoder().encode(trace.verbatimContent).byteLength;

    await this.adapter.run(
      `INSERT INTO archived_traces
        (trace_id, agent_id, verbatim_content, content_hash, trace_type,
         emotional_context, entities, tags, created_at, archived_at,
         archive_reason, byte_size)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        trace.traceId,
        trace.agentId,
        trace.verbatimContent,
        trace.contentHash,
        trace.traceType,
        JSON.stringify(trace.emotionalContext),
        JSON.stringify(trace.entities),
        JSON.stringify(trace.tags),
        trace.createdAt,
        trace.archivedAt,
        trace.archiveReason,
        byteSize,
      ],
    );

    return { success: true, traceId: trace.traceId, bytesWritten: byteSize };
  }

  /** @inheritdoc */
  async rehydrate(traceId: string, requestContext?: string): Promise<RehydratedTrace | null> {
    const row = await this.adapter.get<ArchivedTraceRow>(
      'SELECT verbatim_content, content_hash, archived_at, archive_reason FROM archived_traces WHERE trace_id = ?',
      [traceId],
    );
    if (!row) return null;

    // Integrity check: verify hash matches stored content
    const computedHash = await sha256(row.verbatim_content);
    if (computedHash !== row.content_hash) {
      return null;
    }

    // Write access log entry
    await this.adapter.run(
      'INSERT INTO archive_access_log (trace_id, accessed_at, request_context) VALUES (?, ?, ?)',
      [traceId, Date.now(), requestContext ?? null],
    );

    return {
      traceId,
      verbatimContent: row.verbatim_content,
      contentHash: row.content_hash,
      archivedAt: row.archived_at,
      archiveReason: row.archive_reason as ArchivedTrace['archiveReason'],
    };
  }

  /** @inheritdoc */
  async drop(traceId: string): Promise<void> {
    await this.adapter.run('DELETE FROM archived_traces WHERE trace_id = ?', [traceId]);
    await this.adapter.run('DELETE FROM archive_access_log WHERE trace_id = ?', [traceId]);
  }

  /** @inheritdoc */
  async list(options?: {
    agentId?: string;
    olderThanMs?: number;
    limit?: number;
  }): Promise<ArchiveListEntry[]> {
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (options?.agentId) {
      conditions.push('agent_id = ?');
      params.push(options.agentId);
    }
    if (options?.olderThanMs) {
      const cutoff = Date.now() - options.olderThanMs;
      conditions.push('archived_at < ?');
      params.push(cutoff);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = options?.limit ? `LIMIT ${options.limit}` : '';

    const rows = await this.adapter.all<{
      trace_id: string;
      agent_id: string;
      archived_at: number;
      archive_reason: string;
      byte_size: number;
    }>(
      `SELECT trace_id, agent_id, archived_at, archive_reason, byte_size
       FROM archived_traces ${where}
       ORDER BY archived_at ASC ${limit}`,
      params,
    );

    return rows.map((r) => ({
      traceId: r.trace_id,
      agentId: r.agent_id,
      archivedAt: r.archived_at,
      archiveReason: r.archive_reason as ArchivedTrace['archiveReason'],
      byteSize: r.byte_size,
    }));
  }

  /** @inheritdoc */
  async lastAccessedAt(traceId: string): Promise<number | null> {
    const row = await this.adapter.get<AccessLogRow>(
      'SELECT accessed_at FROM archive_access_log WHERE trace_id = ? ORDER BY accessed_at DESC LIMIT 1',
      [traceId],
    );
    return row?.accessed_at ?? null;
  }
}
```

- [ ] **Step 4: Create barrel exports**

```ts
// src/memory/archive/index.ts

/**
 * @fileoverview Memory archive module — cold storage for verbatim memory content.
 *
 * @module agentos/memory/archive
 */

export type {
  IMemoryArchive,
  ArchivedTrace,
  RehydratedTrace,
  ArchiveWriteResult,
  ArchiveListEntry,
  ArchiveReason,
  MemoryArchiveRetentionConfig,
} from './IMemoryArchive.js';

export { SqlStorageMemoryArchive } from './SqlStorageMemoryArchive.js';
```

- [ ] **Step 5: Write the implementation-specific test file that runs the contract suite**

```ts
// src/memory/archive/__tests__/SqlStorageMemoryArchive.test.ts

import { describe } from 'vitest';
import { resolveStorageAdapter, createStorageFeatures } from '@framers/sql-storage-adapter';
import { SqlStorageMemoryArchive } from '../SqlStorageMemoryArchive.js';
import { runArchiveContractSuite } from './IMemoryArchive.contract.test.js';

describe('SqlStorageMemoryArchive (in-memory SQLite)', () => {
  runArchiveContractSuite(async () => {
    const adapter = await resolveStorageAdapter({
      filePath: ':memory:',
      priority: ['better-sqlite3', 'sqljs'],
      quiet: true,
    });
    const features = createStorageFeatures(adapter);
    const archive = new SqlStorageMemoryArchive(adapter, features);
    await archive.initialize();
    return {
      archive,
      cleanup: async () => adapter.close(),
    };
  });
});
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd packages/agentos && npx vitest run src/memory/archive/__tests__/SqlStorageMemoryArchive.test.ts
```

Expected: all contract tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/memory/archive/
git commit -m "feat(memory): add SqlStorageMemoryArchive with contract test suite"
```

---

### Task 3: Add Archive DDL to SqliteBrain

**Files:**
- Modify: `src/memory/retrieval/store/SqliteBrain.ts`

- [ ] **Step 1: Import the DDL constants from SqlStorageMemoryArchive**

At the top of `SqliteBrain.ts`, after the existing imports:

```ts
import {
  DDL_ARCHIVED_TRACES,
  DDL_ARCHIVED_TRACES_IDX_AGENT_TIME,
  DDL_ARCHIVED_TRACES_IDX_REASON,
  DDL_ARCHIVE_ACCESS_LOG,
  DDL_ARCHIVE_ACCESS_LOG_IDX,
} from '../../archive/SqlStorageMemoryArchive.js';
```

- [ ] **Step 2: Add the DDL statements to `_initSchema()`**

In the `_initSchema()` method (around line 496), add the archive DDL to the `ddlStatements` array:

```ts
  private async _initSchema(): Promise<void> {
    const ddlStatements = [
      DDL_BRAIN_META,
      DDL_MEMORY_TRACES,
      DDL_KNOWLEDGE_NODES,
      DDL_KNOWLEDGE_EDGES,
      DDL_DOCUMENTS,
      DDL_DOCUMENT_CHUNKS,
      DDL_DOCUMENT_IMAGES,
      DDL_CONSOLIDATION_LOG,
      DDL_RETRIEVAL_FEEDBACK,
      DDL_CONVERSATIONS,
      DDL_MESSAGES,
      DDL_PROSPECTIVE_ITEMS,
      // Memory archive tables (write-ahead cold storage for verbatim content)
      DDL_ARCHIVED_TRACES,
      DDL_ARCHIVED_TRACES_IDX_AGENT_TIME,
      DDL_ARCHIVED_TRACES_IDX_REASON,
      DDL_ARCHIVE_ACCESS_LOG,
      DDL_ARCHIVE_ACCESS_LOG_IDX,
    ];
```

- [ ] **Step 3: Verify existing SqliteBrain tests still pass**

```bash
cd packages/agentos && npx vitest run src/memory/retrieval/store/__tests__/SqliteBrain.test.ts
```

Expected: all existing tests pass (additive schema, `CREATE TABLE IF NOT EXISTS`).

- [ ] **Step 4: Commit**

```bash
git add src/memory/retrieval/store/SqliteBrain.ts
git commit -m "feat(memory): add archived_traces + archive_access_log DDL to SqliteBrain schema"
```

---

### Task 4: Wire TemporalGist to Archive

**Files:**
- Modify: `src/memory/mechanisms/types.ts`
- Modify: `src/memory/mechanisms/consolidation/TemporalGist.ts`
- Modify: `src/memory/mechanisms/__tests__/consolidation.test.ts`

- [ ] **Step 1: Add archive field to ResolvedTemporalGistConfig**

In `src/memory/mechanisms/types.ts`, find `ResolvedTemporalGistConfig` (line ~212) and add:

```ts
export interface ResolvedTemporalGistConfig {
  enabled: boolean;
  ageThresholdDays: number;
  minRetrievalCount: number;
  preserveEntities: boolean;
  preserveEmotionalContext: boolean;
  /** Optional archive for write-ahead verbatim preservation before gisting. */
  archive?: import('../archive/IMemoryArchive.js').IMemoryArchive;
  /** Agent ID for archive records. Required when archive is set. */
  archiveAgentId?: string;
}
```

- [ ] **Step 2: Write failing tests for archive-aware gisting**

Add to `src/memory/mechanisms/__tests__/consolidation.test.ts`:

```ts
import type { IMemoryArchive, ArchivedTrace } from '../../archive/IMemoryArchive.js';

// Minimal mock archive for testing
function createMockArchive(): IMemoryArchive & { stored: ArchivedTrace[] } {
  const stored: ArchivedTrace[] = [];
  return {
    stored,
    async store(trace: ArchivedTrace) {
      stored.push(trace);
      return { success: true, traceId: trace.traceId, bytesWritten: trace.verbatimContent.length };
    },
    async rehydrate() { return null; },
    async drop() {},
    async list() { return []; },
    async lastAccessedAt() { return null; },
    async initialize() {},
  };
}

function createFailingArchive(): IMemoryArchive {
  return {
    async store() { return { success: false, traceId: '', bytesWritten: 0, error: 'disk full' }; },
    async rehydrate() { return null; },
    async drop() {},
    async list() { return []; },
    async lastAccessedAt() { return null; },
    async initialize() {},
  };
}

describe('applyTemporalGist with archive', () => {
  it('archives verbatim content before overwriting', async () => {
    const trace = makeEpisodicTrace('trace_archive_1', 'The dragon burned the village.', 100);
    const mockArchive = createMockArchive();
    const config: ResolvedTemporalGistConfig = {
      ...defaultGistConfig,
      archive: mockArchive,
      archiveAgentId: 'test_agent',
    };

    const count = await applyTemporalGist([trace], config, async () => 'Dragon attack. [anxious]');
    expect(count).toBe(1);
    expect(trace.content).not.toBe('The dragon burned the village.');
    expect(mockArchive.stored).toHaveLength(1);
    expect(mockArchive.stored[0].verbatimContent).toBe('The dragon burned the village.');
    expect(mockArchive.stored[0].archiveReason).toBe('temporal_gist');
  });

  it('aborts gist when archive write fails', async () => {
    const originalContent = 'The dragon burned the village.';
    const trace = makeEpisodicTrace('trace_fail_1', originalContent, 100);
    const failArchive = createFailingArchive();
    const config: ResolvedTemporalGistConfig = {
      ...defaultGistConfig,
      archive: failArchive,
      archiveAgentId: 'test_agent',
    };

    const count = await applyTemporalGist([trace], config, async () => 'Dragon attack.');
    expect(count).toBe(0);
    expect(trace.content).toBe(originalContent);
  });

  it('gists normally when no archive is configured', async () => {
    const trace = makeEpisodicTrace('trace_noarch', 'Some memory content.', 100);
    const config: ResolvedTemporalGistConfig = { ...defaultGistConfig };

    const count = await applyTemporalGist([trace], config, async () => 'Compressed.');
    expect(count).toBe(1);
    expect(trace.content).toBe('Compressed.');
  });
});
```

Note: `makeEpisodicTrace` and `defaultGistConfig` are test helpers that should already exist in the consolidation test file. If not, define them following the existing pattern in that file.

- [ ] **Step 3: Run the tests to verify they fail**

```bash
cd packages/agentos && npx vitest run src/memory/mechanisms/__tests__/consolidation.test.ts -t "archive"
```

Expected: FAIL — `TemporalGist` doesn't read `config.archive` yet.

- [ ] **Step 4: Update TemporalGist to use archive**

In `src/memory/mechanisms/consolidation/TemporalGist.ts`, modify `applyTemporalGist()`. Replace the block starting at the `// Store original content hash for audit` comment (around line 97):

```ts
    // Store original content hash for audit
    const originalHash = await sha256(trace.content);

    // Write-ahead archive: preserve verbatim content before gist overwrites it.
    // Archive failure is fatal for this trace's gist cycle — the trace keeps
    // its verbatim content and the next cycle will retry.
    if (config.archive) {
      const writeResult = await config.archive.store({
        traceId: trace.id,
        agentId: config.archiveAgentId ?? 'unknown',
        verbatimContent: trace.content,
        contentHash: originalHash,
        traceType: trace.type,
        emotionalContext: trace.emotionalContext,
        entities: trace.entities,
        tags: trace.tags,
        createdAt: trace.createdAt,
        archivedAt: Date.now(),
        archiveReason: 'temporal_gist',
      });
      if (!writeResult.success) {
        continue;
      }
    }

    // Extract gist
```

Also add the import at the top of the file:

```ts
import type { ArchivedTrace } from '../../archive/IMemoryArchive.js';
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd packages/agentos && npx vitest run src/memory/mechanisms/__tests__/consolidation.test.ts
```

Expected: all tests pass, including the new archive tests and all existing gist tests.

- [ ] **Step 6: Commit**

```bash
git add src/memory/mechanisms/types.ts src/memory/mechanisms/consolidation/TemporalGist.ts src/memory/mechanisms/__tests__/consolidation.test.ts
git commit -m "feat(memory): wire TemporalGist to IMemoryArchive with write-ahead preservation"
```

---

### Task 5: Wire MemoryLifecycleManager to Archive

**Files:**
- Modify: `src/memory/pipeline/lifecycle/MemoryLifecycleManager.ts`

- [ ] **Step 1: Add archive field to the constructor config**

Add to the config interface (or constructor parameters):

```ts
  /** Optional memory archive. When set, the 'archive' action stores content before deleting. */
  archive?: import('../../archive/IMemoryArchive.js').IMemoryArchive;
```

- [ ] **Step 2: Replace the conceptual archive branch with a real one**

In `executeLifecycleAction()`, find the `archive` / `summarize_and_archive` branch (around line 508). Replace the conceptual log + delete with:

```ts
      } else if (effectiveConfigActionType === 'archive' || (effectiveConfigActionType === 'summarize_and_archive' && (configuredActionDetails.deleteOriginalAfterSummary !== false || summaryText !== undefined))) {
        if (this.archive) {
          // Real archive: preserve content, then delete original.
          const content = candidate.textContent ?? candidate.contentSummary ?? '';
          const { sha256 } = await import('../../core/util/crossPlatformCrypto.js');
          const contentHash = await sha256(content);
          const writeResult = await this.archive.store({
            traceId: candidate.id,
            agentId: candidate.gmiOwnerId ?? this.managerId,
            verbatimContent: content,
            contentHash,
            traceType: (candidate.category as any) ?? 'episodic',
            emotionalContext: { valence: 0, arousal: 0, dominance: 0, intensity: 0, gmiMood: 'neutral' },
            entities: [],
            tags: [],
            createdAt: candidate.timestamp?.getTime() ?? Date.now(),
            archivedAt: Date.now(),
            archiveReason: 'lifecycle_archive',
          });
          if (!writeResult.success) {
            this.addTraceToReport(report, candidate.id, policyId, determinedAction,
              `ARCHIVAL_FAILED: ${writeResult.error}. Original retained.`);
            return; // Abort delete on archive failure
          }
          this.addTraceToReport(report, candidate.id, policyId, determinedAction,
            `Archived (${writeResult.bytesWritten} bytes). Deleting original.`);
        } else {
          this.addTraceToReport(report, candidate.id, policyId, determinedAction,
            `No archive configured. Falling back to delete.`);
        }
        // Delete original (same as before — only reached after successful archive or no-archive fallback)
        if (configuredActionDetails.deleteOriginalAfterSummary !== false || effectiveConfigActionType === 'archive') {
          await candidate.vectorStoreRef.delete(candidate.collectionName, [candidate.id]);
        }
```

- [ ] **Step 3: Store the archive reference**

In the constructor or initialization, store the archive:

```ts
  private readonly archive: import('../../archive/IMemoryArchive.js').IMemoryArchive | null;

  // In constructor:
  this.archive = config.archive ?? null;
```

- [ ] **Step 4: Run existing lifecycle tests**

```bash
cd packages/agentos && npx vitest run src/memory/pipeline/lifecycle/
```

Expected: all existing tests pass (archive is optional, default behavior unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/memory/pipeline/lifecycle/MemoryLifecycleManager.ts
git commit -m "feat(memory): complete MemoryLifecycleManager archive branch with real store-then-delete"
```

---

### Task 6: CognitiveMemoryManager.rehydrate()

**Files:**
- Modify: `src/memory/CognitiveMemoryManager.ts`

- [ ] **Step 1: Add the archive field and rehydrate() to ICognitiveMemoryManager**

In `src/memory/CognitiveMemoryManager.ts`, find the `ICognitiveMemoryManager` interface (around line 72) and add:

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
   * sweep can distinguish frequently-rehydrated traces from abandoned ones.
   *
   * @param traceId - The trace id to rehydrate.
   * @param requestContext - Optional caller hint for audit.
   * @returns The original verbatim content, or `null` if not archived.
   *
   * @see {@link IMemoryArchive.rehydrate}
   */
  rehydrate?(traceId: string, requestContext?: string): Promise<string | null>;
```

- [ ] **Step 2: Add the archive property and implement rehydrate()**

In the `CognitiveMemoryManager` class, add a private field:

```ts
  private archive: import('./archive/IMemoryArchive.js').IMemoryArchive | null = null;
```

In the `initialize()` method, after the existing setup, add archive wiring:

```ts
    // Archive: if the config provides an archive, store it and wire it into
    // the temporal gist mechanism config.
    if (config.archive) {
      this.archive = config.archive;
    }
```

Also add `archive?` to the `CognitiveMemoryConfig` type (in `src/memory/core/config.ts`) — find the interface and add:

```ts
  /** Optional memory archive for write-ahead verbatim preservation. */
  archive?: import('../archive/IMemoryArchive.js').IMemoryArchive;
```

Then implement the method in `CognitiveMemoryManager`:

```ts
  /**
   * Rehydrate a gisted/archived trace to its original verbatim content.
   *
   * @param traceId - The trace id to rehydrate.
   * @param requestContext - Optional caller hint for audit.
   * @returns The original verbatim content, or `null`.
   */
  async rehydrate(traceId: string, requestContext?: string): Promise<string | null> {
    if (!this.archive) return null;
    const result = await this.archive.rehydrate(traceId, requestContext);
    return result?.verbatimContent ?? null;
  }
```

- [ ] **Step 3: Commit**

```bash
git add src/memory/CognitiveMemoryManager.ts src/memory/core/config.ts
git commit -m "feat(memory): add CognitiveMemoryManager.rehydrate() with archive delegation"
```

---

### Task 7: RehydrateMemoryTool

**Files:**
- Create: `src/memory/io/tools/RehydrateMemoryTool.ts`
- Create: `src/memory/io/tools/__tests__/RehydrateMemoryTool.test.ts`
- Modify: `src/memory/io/tools/index.ts`
- Modify: `src/memory/io/extension/MemoryToolsExtension.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/memory/io/tools/__tests__/RehydrateMemoryTool.test.ts

import { describe, it, expect } from 'vitest';
import { RehydrateMemoryTool } from '../RehydrateMemoryTool.js';
import type { IMemoryArchive, ArchivedTrace, RehydratedTrace } from '../../../archive/IMemoryArchive.js';

function createTestArchive(stored: Map<string, RehydratedTrace>): IMemoryArchive {
  return {
    async store() { return { success: true, traceId: '', bytesWritten: 0 }; },
    async rehydrate(traceId: string) { return stored.get(traceId) ?? null; },
    async drop() {},
    async list() { return []; },
    async lastAccessedAt() { return null; },
    async initialize() {},
  };
}

describe('RehydrateMemoryTool', () => {
  it('returns verbatim content for archived trace', async () => {
    const stored = new Map<string, RehydratedTrace>();
    stored.set('trace_123', {
      traceId: 'trace_123',
      verbatimContent: 'The dragon attacked the village at dawn.',
      contentHash: 'abc',
      archivedAt: Date.now(),
      archiveReason: 'temporal_gist',
    });

    const tool = new RehydrateMemoryTool(createTestArchive(stored));
    const result = await tool.execute({ traceId: 'trace_123' });

    expect(result.verbatimContent).toBe('The dragon attacked the village at dawn.');
    expect(result.archivedAt).toBeGreaterThan(0);
  });

  it('returns null for non-archived trace', async () => {
    const tool = new RehydrateMemoryTool(createTestArchive(new Map()));
    const result = await tool.execute({ traceId: 'nonexistent' });

    expect(result.verbatimContent).toBeNull();
  });

  it('has correct tool metadata', () => {
    const tool = new RehydrateMemoryTool(createTestArchive(new Map()));
    expect(tool.name).toBe('rehydrate_memory');
    expect(tool.description).toContain('original content');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/agentos && npx vitest run src/memory/io/tools/__tests__/RehydrateMemoryTool.test.ts
```

Expected: FAIL — `RehydrateMemoryTool` does not exist.

- [ ] **Step 3: Write the tool**

```ts
// src/memory/io/tools/RehydrateMemoryTool.ts

/**
 * @fileoverview LLM-facing tool that rehydrates gisted/archived memory traces.
 *
 * Exposes `rehydrate_memory` as an opt-in agent tool. When a gisted memory
 * appears in the assembled context and the summary lacks detail, the LLM can
 * call this tool to retrieve the original verbatim content.
 *
 * Registration is opt-in: consumers pass `{ includeRehydrate: true }` to the
 * `MemoryToolsExtension`. The default tool surface is unchanged for agents
 * that don't adopt the archive.
 *
 * @module agentos/memory/io/tools/RehydrateMemoryTool
 * @see {@link IMemoryArchive} for the underlying archive contract.
 */

import type { ITool, ToolParameter } from '../../../core/tools/ITool.js';
import type { IMemoryArchive } from '../../archive/IMemoryArchive.js';

/** Input shape for the rehydrate_memory tool. */
interface RehydrateInput {
  traceId: string;
}

/** Output shape for the rehydrate_memory tool. */
interface RehydrateOutput {
  verbatimContent: string | null;
  archivedAt: number | null;
}

/**
 * LLM-facing tool that retrieves the original verbatim content of a
 * gisted or archived memory trace.
 */
export class RehydrateMemoryTool implements ITool<RehydrateInput, RehydrateOutput> {
  readonly id = 'rehydrate_memory';
  readonly name = 'rehydrate_memory';
  readonly description =
    "Look up the full original content of a memory whose summary you've seen. " +
    'Use this when a gisted memory is relevant and the summary lacks detail.';
  readonly category = 'memory';

  readonly parameters: ToolParameter[] = [
    {
      name: 'traceId',
      type: 'string',
      description: 'The ID of the memory trace to rehydrate.',
      required: true,
    },
  ];

  constructor(private readonly archive: IMemoryArchive) {}

  async execute(input: RehydrateInput): Promise<RehydrateOutput> {
    const result = await this.archive.rehydrate(input.traceId, 'rehydrate_memory_tool');
    return {
      verbatimContent: result?.verbatimContent ?? null,
      archivedAt: result?.archivedAt ?? null,
    };
  }
}
```

- [ ] **Step 4: Add to barrel exports**

In `src/memory/io/tools/index.ts`, add:

```ts
/** Opt-in tool for rehydrating gisted/archived memory traces. */
export { RehydrateMemoryTool } from './RehydrateMemoryTool.js';
```

- [ ] **Step 5: Add opt-in to MemoryToolsExtension**

In `src/memory/io/extension/MemoryToolsExtension.ts`, add to `MemoryToolsExtensionOptions`:

```ts
  /**
   * Include the `rehydrate_memory` tool for inflating gisted/archived traces.
   * Requires an `IMemoryArchive` to be provided.
   * Defaults to `false`.
   */
  includeRehydrate?: boolean;
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd packages/agentos && npx vitest run src/memory/io/tools/__tests__/RehydrateMemoryTool.test.ts
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/memory/io/tools/RehydrateMemoryTool.ts src/memory/io/tools/__tests__/RehydrateMemoryTool.test.ts src/memory/io/tools/index.ts src/memory/io/extension/MemoryToolsExtension.ts
git commit -m "feat(memory): add opt-in RehydrateMemoryTool for LLM-driven verbatim inflation"
```

---

### Task 8: ConsolidationPipeline Step 7 — prune_archive

**Files:**
- Modify: `src/memory/pipeline/consolidation/ConsolidationPipeline.ts`

- [ ] **Step 1: Add archive and retention config to ConsolidationPipelineConfig**

```ts
  /** Optional memory archive for retention sweep. */
  archive?: import('../../archive/IMemoryArchive.js').IMemoryArchive;
  /** Retention configuration for the archive sweep. */
  archiveRetention?: import('../../archive/IMemoryArchive.js').MemoryArchiveRetentionConfig;
```

- [ ] **Step 2: Add prune_archive counts to ConsolidationResult**

```ts
export interface ConsolidationResult {
  // ... existing fields ...
  /** Archived traces dropped by retention sweep. */
  archivedPruned: number;
}
```

- [ ] **Step 3: Implement step 7 in the pipeline's `run()` method**

After the existing step 6, add:

```ts
    // Step 7: Prune archive (retention sweep with access-log awareness)
    let archivedPruned = 0;
    if (this.config.archive) {
      const maxAgeMs = this.config.archiveRetention?.maxAgeMs ?? 365 * 86_400_000;
      const candidates = await this.config.archive.list({ olderThanMs: maxAgeMs });

      for (const candidate of candidates) {
        // Check if this trace was recently rehydrated — skip if so
        const lastAccess = await this.config.archive.lastAccessedAt(candidate.traceId);
        if (lastAccess !== null && (Date.now() - lastAccess) < maxAgeMs) {
          continue;
        }
        await this.config.archive.drop(candidate.traceId);
        archivedPruned++;
      }
    }
```

Initialize `archivedPruned: 0` in the result object and include it in the return value.

- [ ] **Step 4: Run existing consolidation tests**

```bash
cd packages/agentos && npx vitest run src/memory/pipeline/consolidation/
```

Expected: all existing tests pass (archive is optional, defaults to no-op).

- [ ] **Step 5: Commit**

```bash
git add src/memory/pipeline/consolidation/ConsolidationPipeline.ts
git commit -m "feat(memory): add step 7 prune_archive to ConsolidationPipeline with access-log-aware retention"
```

---

### Task 9: Documentation Updates

**Files:**
- Modify: `docs/memory/MEMORY_ARCHITECTURE.md`
- Modify: `docs/memory/MEMORY_CONSOLIDATION.md`
- Modify: `docs/memory/COGNITIVE_MECHANISMS.md`
- Modify: `docs/memory/MEMORY_STORAGE.md`
- Modify: `docs/memory/MEMORY_TOOLS.md`
- Modify: `docs/memory/COGNITIVE_MEMORY_GUIDE.md`

- [ ] **Step 1: Update MEMORY_ARCHITECTURE.md**

Add a new section "Memory Archive" after the existing storage section:

```markdown
## Memory Archive

The archive provides lossless cold storage for verbatim memory content that
consolidation mechanisms (temporal gist, lifecycle archival) would otherwise
destroy. The relationship between working memory traces and the archive follows
a two-tier model:

| Tier | Content | Decay? | Searchable? |
|------|---------|--------|-------------|
| Working (MemoryStore) | Gisted summaries after consolidation | Yes | Yes (vector + FTS) |
| Archive (IMemoryArchive) | Original verbatim content | No (age-based retention only) | By ID only |

The archive is strictly **write-ahead**: any mechanism that would lose verbatim
content calls `archive.store()` and awaits success before mutating the trace.
If the archive write fails, the destructive operation is aborted.

Rehydration (`archive.rehydrate(traceId)`) returns the original content on
demand. It is a transient read — no encoding strength boost, no retrieval count
increment, no reconsolidation or feedback signal. A lightweight access log
tracks which traces are actively rehydrated so the retention sweep doesn't
drop them.

### Cross-Platform Support

`SqlStorageMemoryArchive` wraps `@framers/sql-storage-adapter`'s `StorageAdapter`
interface — the same contract used by `SqliteBrain` and `GraphRAGEngine`.
Supported backends: better-sqlite3, sql.js, IndexedDB, Capacitor SQLite,
PostgreSQL.
```

- [ ] **Step 2: Update MEMORY_CONSOLIDATION.md**

Add a Step 7 subsection:

```markdown
### Step 7: Prune Archive

Sweep archived traces past their retention age. For each candidate:
1. Check the `archive_access_log` for the most recent rehydration.
2. If the trace was rehydrated within the retention window, skip it.
3. Otherwise, drop it via `archive.drop(traceId)`.
4. Clean up orphaned access-log rows.

Default retention: 365 days. Configurable via `MemoryArchiveRetentionConfig`.
```

Update the existing TemporalGist section to mention write-ahead archival:

```markdown
When an `IMemoryArchive` is configured, `applyTemporalGist()` preserves the
original verbatim content in cold storage before overwriting `trace.content`
with the gist. If the archive write fails, the trace keeps its verbatim
content and retries on the next consolidation cycle.
```

- [ ] **Step 3: Update COGNITIVE_MECHANISMS.md**

Add a row to the mechanisms table:

```markdown
| Rehydration | Gisted/archived content can be inflated on demand via `rehydrate(traceId)`. Content does not decay while archived; age-based retention applies instead. |
```

- [ ] **Step 4: Update MEMORY_STORAGE.md**

Add a section documenting the archive tables and their cross-platform behavior.

- [ ] **Step 5: Update MEMORY_TOOLS.md**

Document `rehydrate_memory` tool:

```markdown
### rehydrate_memory (opt-in)

Retrieves the original verbatim content of a memory trace whose content has
been compressed by temporal gist. Register by passing `{ includeRehydrate: true }`
to `MemoryToolsExtension`. Requires an `IMemoryArchive` to be configured.

**Input:** `{ traceId: string }`
**Output:** `{ verbatimContent: string | null, archivedAt: number | null }`
```

- [ ] **Step 6: Update COGNITIVE_MEMORY_GUIDE.md**

Add a "Long-running agents" section with a worked example showing the archive → gist → rehydrate loop.

- [ ] **Step 7: Commit**

```bash
git add docs/memory/
git commit -m "docs(memory): document archive, rehydration, prune_archive step, and rehydrate_memory tool"
```

---

### Task 10: Wilds-AI Adoption

**Files:**
- Modify: `../../apps/wilds-ai/packages/wilds-memory/src/WildsMemoryFacade.ts`
- Modify: `../../apps/wilds-ai/docs/guides/MEMORY_SYSTEM_GUIDE.md`

- [ ] **Step 1: Wire archive into WildsMemoryFacade.createCognitive()**

In `WildsMemoryFacade.createCognitive()`, after `SqliteBrain` is opened (around line 158), create a shared-adapter archive:

```ts
      // Memory archive: write-ahead cold storage for verbatim content.
      // Uses the brain's own adapter so archive tables live in the same
      // SQLite file — soul exports bundle one file.
      const { SqlStorageMemoryArchive } = await import('@framers/agentos/memory/archive');
      const archive = new SqlStorageMemoryArchive(brain.adapter, brain.features);
      await archive.initialize();
```

Then pass `archive` into the `CognitiveMemoryManager.initialize()` config and into the `TemporalGist` resolved config.

- [ ] **Step 2: Update MEMORY_SYSTEM_GUIDE.md**

Add a brief section under "Cognitive Mechanisms":

```markdown
### Memory Archive

Per-entity brains preserve verbatim memory content past the gist threshold
via `SqlStorageMemoryArchive`. The archive tables (`archived_traces`,
`archive_access_log`) live in the same SQLite file as the brain. Soul exports
include archived content automatically.

The `rehydrate_memory` tool is available to the narrator and companion chat
when the archive is configured, enabling on-demand inflation of gisted memories.
```

- [ ] **Step 3: Commit**

```bash
cd /Users/johnn/Documents/git/voice-chat-assistant/apps/wilds-ai
git add packages/wilds-memory/src/WildsMemoryFacade.ts docs/guides/MEMORY_SYSTEM_GUIDE.md
git commit -m "feat(wilds-memory): adopt SqlStorageMemoryArchive in WildsMemoryFacade"
```

---

### Task 11: Integration Tests

**Files:**
- Create: `tests/integration/memory/archive-rehydrate-roundtrip.test.ts`

- [ ] **Step 1: Write the round-trip integration test**

```ts
// tests/integration/memory/archive-rehydrate-roundtrip.test.ts

/**
 * @fileoverview Integration test: full encode → gist → rehydrate loop.
 *
 * Creates a CognitiveMemoryManager with SqliteBrain + SqlStorageMemoryArchive,
 * ingests traces, forces a gist cycle, and verifies rehydration returns
 * the original verbatim content.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { SqliteBrain } from '../../src/memory/retrieval/store/SqliteBrain.js';
import { SqlStorageMemoryArchive } from '../../src/memory/archive/SqlStorageMemoryArchive.js';
import { applyTemporalGist } from '../../src/memory/mechanisms/consolidation/TemporalGist.js';
import { sha256 } from '../../src/memory/core/util/crossPlatformCrypto.js';
import type { MemoryTrace } from '../../src/memory/core/types.js';
import type { ResolvedTemporalGistConfig } from '../../src/memory/mechanisms/types.js';

function makeTrace(id: string, content: string, ageDays: number): MemoryTrace {
  return {
    id,
    type: 'episodic',
    scope: 'user',
    scopeId: 'test',
    content,
    entities: ['test_entity'],
    tags: ['test'],
    provenance: {
      sourceType: 'observation',
      sourceTimestamp: Date.now(),
      confidence: 1,
      verificationCount: 0,
    },
    emotionalContext: {
      valence: 0, arousal: 0.5, dominance: 0, intensity: 0, gmiMood: 'neutral',
    },
    encodingStrength: 0.5,
    stability: 86_400_000,
    retrievalCount: 0,
    lastAccessedAt: Date.now() - ageDays * 86_400_000,
    accessCount: 0,
    reinforcementInterval: 86_400_000,
    associatedTraceIds: [],
    createdAt: Date.now() - ageDays * 86_400_000,
    updatedAt: Date.now() - ageDays * 86_400_000,
    isActive: true,
    structuredData: {},
  };
}

describe('Archive → Gist → Rehydrate round trip', () => {
  let brain: SqliteBrain;

  afterEach(async () => {
    await brain?.close();
  });

  it('preserves verbatim content through gist cycle', async () => {
    brain = await SqliteBrain.open(':memory:');
    const archive = new SqlStorageMemoryArchive(brain.adapter, brain.features);
    await archive.initialize();

    const originalContent = 'The ancient dragon Vex attacked the village of Millhaven at dawn, destroying the granary and the blacksmith forge.';
    const trace = makeTrace('trace_roundtrip_1', originalContent, 90);

    const config: ResolvedTemporalGistConfig = {
      enabled: true,
      ageThresholdDays: 60,
      minRetrievalCount: 2,
      preserveEntities: true,
      preserveEmotionalContext: true,
      archive,
      archiveAgentId: 'test_agent',
    };

    // Gist should archive then overwrite
    const gisted = await applyTemporalGist(
      [trace],
      config,
      async () => 'Dragon Vex attacked Millhaven. [neutral]',
    );
    expect(gisted).toBe(1);
    expect(trace.content).not.toBe(originalContent);
    expect(trace.content).toContain('Vex');

    // Rehydrate should return original
    const rehydrated = await archive.rehydrate('trace_roundtrip_1');
    expect(rehydrated).not.toBeNull();
    expect(rehydrated!.verbatimContent).toBe(originalContent);

    // Access log should have an entry
    const lastAccess = await archive.lastAccessedAt('trace_roundtrip_1');
    expect(lastAccess).not.toBeNull();
  });

  it('handles 50 traces with mixed gist eligibility', async () => {
    brain = await SqliteBrain.open(':memory:');
    const archive = new SqlStorageMemoryArchive(brain.adapter, brain.features);
    await archive.initialize();

    const traces: MemoryTrace[] = [];
    for (let i = 0; i < 50; i++) {
      // Even indices: old enough to gist. Odd indices: too recent.
      const ageDays = i % 2 === 0 ? 90 : 10;
      traces.push(makeTrace(`trace_batch_${i}`, `Memory content number ${i}`, ageDays));
    }

    const config: ResolvedTemporalGistConfig = {
      enabled: true,
      ageThresholdDays: 60,
      minRetrievalCount: 2,
      preserveEntities: true,
      preserveEmotionalContext: true,
      archive,
      archiveAgentId: 'test_agent',
    };

    const gisted = await applyTemporalGist(
      traces,
      config,
      async () => 'Gist summary.',
    );

    // Only the 20 oldest eligible traces should be gisted (MAX_GISTS_PER_CYCLE = 20)
    expect(gisted).toBe(20);

    // All 20 gisted traces should have archives
    const archived = await archive.list({ agentId: 'test_agent' });
    expect(archived).toHaveLength(20);

    // Each archived trace should rehydrate correctly
    for (const entry of archived) {
      const rehydrated = await archive.rehydrate(entry.traceId);
      expect(rehydrated).not.toBeNull();
      expect(rehydrated!.verbatimContent).toContain('Memory content number');
    }
  });
});
```

- [ ] **Step 2: Run the integration test**

```bash
cd packages/agentos && npx vitest run tests/integration/memory/archive-rehydrate-roundtrip.test.ts
```

Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/memory/archive-rehydrate-roundtrip.test.ts
git commit -m "test(memory): add archive → gist → rehydrate integration tests"
```

---

## Post-Implementation Checklist

- [ ] Run the full targeted test suite to confirm no regressions:
  ```bash
  cd packages/agentos && npx vitest run src/memory/archive/ src/memory/mechanisms/__tests__/consolidation.test.ts src/memory/io/tools/__tests__/RehydrateMemoryTool.test.ts tests/integration/memory/
  ```
- [ ] Verify `typedoc` picks up the new `memory/archive/` module for agentos-live-docs:
  ```bash
  cd packages/agentos && npx typedoc --options typedoc.json 2>&1 | grep -i archive
  ```
- [ ] Review all new public symbols have `@param`, `@returns`, `@see`, and `@example` TSDoc tags.
