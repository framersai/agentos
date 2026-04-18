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
import type { IMemoryArchive, ArchivedTrace, RehydratedTrace, ArchiveWriteResult, ArchiveListEntry } from './IMemoryArchive.js';
/**
 * DDL for the archived_traces table.
 * @internal
 */
export declare const DDL_ARCHIVED_TRACES = "\nCREATE TABLE IF NOT EXISTS archived_traces (\n  trace_id         TEXT    PRIMARY KEY,\n  agent_id         TEXT    NOT NULL,\n  verbatim_content TEXT    NOT NULL,\n  content_hash     TEXT    NOT NULL,\n  trace_type       TEXT    NOT NULL,\n  emotional_context TEXT   NOT NULL DEFAULT '{}',\n  entities         TEXT    NOT NULL DEFAULT '[]',\n  tags             TEXT    NOT NULL DEFAULT '[]',\n  created_at       INTEGER NOT NULL,\n  archived_at      INTEGER NOT NULL,\n  archive_reason   TEXT    NOT NULL,\n  byte_size        INTEGER NOT NULL DEFAULT 0\n);\n";
/**
 * Index on agent_id + archived_at for retention sweeps.
 * @internal
 */
export declare const DDL_ARCHIVED_TRACES_IDX_AGENT_TIME = "\nCREATE INDEX IF NOT EXISTS idx_archived_traces_agent_time\n  ON archived_traces (agent_id, archived_at);\n";
/**
 * Index on archive_reason for analytics queries.
 * @internal
 */
export declare const DDL_ARCHIVED_TRACES_IDX_REASON = "\nCREATE INDEX IF NOT EXISTS idx_archived_traces_reason\n  ON archived_traces (archive_reason);\n";
/**
 * DDL for the archive_access_log table (rehydration tracking).
 * @internal
 */
export declare const DDL_ARCHIVE_ACCESS_LOG = "\nCREATE TABLE IF NOT EXISTS archive_access_log (\n  trace_id        TEXT    NOT NULL,\n  accessed_at     INTEGER NOT NULL,\n  request_context TEXT,\n  PRIMARY KEY (trace_id, accessed_at)\n);\n";
/**
 * Index for recency queries on the access log.
 * @internal
 */
export declare const DDL_ARCHIVE_ACCESS_LOG_IDX = "\nCREATE INDEX IF NOT EXISTS idx_archive_access_recency\n  ON archive_access_log (trace_id, accessed_at DESC);\n";
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
export declare class SqlStorageMemoryArchive implements IMemoryArchive {
    private readonly adapter;
    private readonly features;
    /**
     * Create an archive backed by the given storage adapter.
     *
     * @param adapter - An initialized `StorageAdapter` instance. Can be shared
     *   with `SqliteBrain` (same DB) or standalone (own DB).
     * @param features - Platform-aware feature bundle for dialect-portable SQL.
     */
    constructor(adapter: StorageAdapter, features: StorageFeatures);
    /**
     * Create the `archived_traces` and `archive_access_log` tables.
     * Uses `CREATE TABLE/INDEX IF NOT EXISTS` — safe to call repeatedly.
     */
    initialize(): Promise<void>;
    /**
     * Persist the verbatim trace content and identifying metadata.
     *
     * Idempotent: a second `store()` call with the same `traceId` is a no-op
     * and returns `{ success: true, bytesWritten: 0 }`.
     *
     * @param trace - The archived trace record to persist.
     * @returns Write result with success flag and bytes written.
     */
    store(trace: ArchivedTrace): Promise<ArchiveWriteResult>;
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
    rehydrate(traceId: string, requestContext?: string): Promise<RehydratedTrace | null>;
    /**
     * Remove archived content and its access log entries for a trace id.
     * No-op if the trace id is not found.
     *
     * @param traceId - The trace id to remove from the archive.
     */
    drop(traceId: string): Promise<void>;
    /**
     * Return archived trace metadata matching optional filters.
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
     * Return the most recent access timestamp for a trace id.
     *
     * @param traceId - The trace id to check.
     * @returns Unix ms of the most recent rehydration, or `null` if never rehydrated.
     */
    lastAccessedAt(traceId: string): Promise<number | null>;
}
//# sourceMappingURL=SqlStorageMemoryArchive.d.ts.map