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
export type ArchiveReason = 'temporal_gist' | 'lifecycle_archive' | 'manual_compaction' | 'perspective_source';

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
