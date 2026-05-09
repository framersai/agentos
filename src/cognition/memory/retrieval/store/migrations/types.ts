/**
 * @fileoverview Migration interface and shared types for MigrationRunner.
 *
 * @module memory/retrieval/store/migrations/types
 */

import type { StorageAdapter, StorageFeatures } from '@framers/sql-storage-adapter';

/**
 * A single schema migration. The runner handles transaction wrapping, advisory
 * locking, and the schema_version bump. The migration's `up` function only
 * needs to apply the schema diff (DDL + data backfill) for its target version.
 *
 * Migrations MUST NOT manage their own transactions. The adapter passed into
 * `up` is the runner's transactional adapter; calling BEGIN/COMMIT inside `up`
 * breaks the runner's transaction model on both Postgres and SQLite.
 */
export interface Migration {
  /** Target schema version this migration upgrades the database to. */
  version: number;
  /**
   * Apply the schema diff for this migration's target version.
   *
   * @param adapter - Transactional storage adapter (do NOT BEGIN/COMMIT inside).
   * @param features - Platform-aware feature bundle.
   * @param brainId - The brain identifier to scope writes to.
   */
  up(adapter: StorageAdapter, features: StorageFeatures, brainId: string): Promise<void>;
}
