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
// DDL — exported for SqliteBrain to include in _initSchema()
// ---------------------------------------------------------------------------

/**
 * DDL for the archived_traces table.
 * @internal
 */
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

/**
 * Index on agent_id + archived_at for retention sweeps.
 * @internal
 */
export const DDL_ARCHIVED_TRACES_IDX_AGENT_TIME = `
CREATE INDEX IF NOT EXISTS idx_archived_traces_agent_time
  ON archived_traces (agent_id, archived_at);
`;

/**
 * Index on archive_reason for analytics queries.
 * @internal
 */
export const DDL_ARCHIVED_TRACES_IDX_REASON = `
CREATE INDEX IF NOT EXISTS idx_archived_traces_reason
  ON archived_traces (archive_reason);
`;

/**
 * DDL for the archive_access_log table (rehydration tracking).
 * @internal
 */
export const DDL_ARCHIVE_ACCESS_LOG = `
CREATE TABLE IF NOT EXISTS archive_access_log (
  trace_id        TEXT    NOT NULL,
  accessed_at     INTEGER NOT NULL,
  request_context TEXT,
  PRIMARY KEY (trace_id, accessed_at)
);
`;

/**
 * Index for recency queries on the access log.
 * @internal
 */
export const DDL_ARCHIVE_ACCESS_LOG_IDX = `
CREATE INDEX IF NOT EXISTS idx_archive_access_recency
  ON archive_access_log (trace_id, accessed_at DESC);
`;

// ---------------------------------------------------------------------------
// Row shapes
// ---------------------------------------------------------------------------

/** @internal */
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

/** @internal */
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
 *
 * @example Standalone Postgres adapter
 * ```ts
 * const pgAdapter = await resolveStorageAdapter({
 *   postgres: { connectionString: process.env.DATABASE_URL },
 * });
 * const features = createStorageFeatures(pgAdapter);
 * const archive = new SqlStorageMemoryArchive(pgAdapter, features);
 * await archive.initialize();
 * ```
 */
export class SqlStorageMemoryArchive implements IMemoryArchive {
  /**
   * Create an archive backed by the given storage adapter.
   *
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

  /**
   * Persist the verbatim trace content and identifying metadata.
   *
   * Idempotent: a second `store()` call with the same `traceId` is a no-op
   * and returns `{ success: true, bytesWritten: 0 }`.
   *
   * @param trace - The archived trace record to persist.
   * @returns Write result with success flag and bytes written.
   */
  async store(trace: ArchivedTrace): Promise<ArchiveWriteResult> {
    // Idempotent: skip if already stored
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

  /**
   * Return the verbatim content for a trace id, or `null` if not archived.
   *
   * Verifies content integrity via SHA-256 hash comparison. Returns `null`
   * (rather than throwing) on hash mismatch. Writes a row to the access log
   * on successful rehydration.
   *
   * @param traceId - The trace id to rehydrate.
   * @param requestContext - Optional caller hint for audit.
   * @returns The rehydrated trace data, or `null`.
   */
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

    // Write access log entry for retention awareness
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

  /**
   * Remove archived content and its access log entries for a trace id.
   * No-op if the trace id is not found.
   *
   * @param traceId - The trace id to remove from the archive.
   */
  async drop(traceId: string): Promise<void> {
    await this.adapter.run('DELETE FROM archived_traces WHERE trace_id = ?', [traceId]);
    await this.adapter.run('DELETE FROM archive_access_log WHERE trace_id = ?', [traceId]);
  }

  /**
   * Return archived trace metadata matching optional filters.
   *
   * @param options - Optional filters for agent, age, and result limit.
   * @returns Array of archive list entries (metadata only, no content).
   */
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

  /**
   * Return the most recent access timestamp for a trace id.
   *
   * @param traceId - The trace id to check.
   * @returns Unix ms of the most recent rehydration, or `null` if never rehydrated.
   */
  async lastAccessedAt(traceId: string): Promise<number | null> {
    const row = await this.adapter.get<AccessLogRow>(
      'SELECT accessed_at FROM archive_access_log WHERE trace_id = ? ORDER BY accessed_at DESC LIMIT 1',
      [traceId],
    );
    return row?.accessed_at ?? null;
  }
}
