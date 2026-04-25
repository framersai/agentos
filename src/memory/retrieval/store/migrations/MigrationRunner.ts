/**
 * @fileoverview MigrationRunner: centralized owner of "how schema migrations
 * run safely." Each registered Migration object knows only its target version
 * and schema-diff logic; the runner handles transaction wrapping, advisory
 * locking (per-brain), and atomic schema_version bumps.
 *
 * Two distinct dialect paths because connection-pooling and transaction
 * semantics differ enough that a unified path obscures correctness:
 *
 * - Postgres: uses `adapter.transaction()` to keep all queries on one pooled
 *   connection. Acquires a transaction-scoped advisory lock with
 *   `pg_advisory_xact_lock`, which auto-releases on COMMIT/ROLLBACK.
 * - SQLite: uses explicit `BEGIN IMMEDIATE` via `adapter.exec`. Single
 *   connection per file, so the connection-pool concern doesn't apply.
 *   IMMEDIATE acquires the reserved write lock immediately, eliminating the
 *   race window in default DEFERRED mode.
 *
 * @module memory/retrieval/store/migrations/MigrationRunner
 */

import type { StorageAdapter, StorageFeatures } from '@framers/sql-storage-adapter';
import type { Migration } from './types.js';

export class MigrationRunner {
  /**
   * Run all pending migrations against the adapter, scoped by brainId.
   *
   * @returns The list of migration versions that were applied.
   */
  static async runPending(
    adapter: StorageAdapter,
    features: StorageFeatures,
    brainId: string,
    migrations: Migration[],
  ): Promise<{ applied: number[] }> {
    const isPostgres = adapter.kind.includes('postgres');

    if (isPostgres) {
      return adapter.transaction(async (trx) => {
        await trx.run(
          `SELECT pg_advisory_xact_lock(hashtext($1))`,
          [`agentos_brain:${brainId}`],
        );
        return MigrationRunner._runMigrations(trx, features, brainId, migrations);
      });
    }

    // SQLite path: explicit BEGIN IMMEDIATE for single-connection serialization.
    await adapter.exec('BEGIN IMMEDIATE');
    try {
      const result = await MigrationRunner._runMigrations(adapter, features, brainId, migrations);
      await adapter.exec('COMMIT');
      return result;
    } catch (err) {
      await adapter.exec('ROLLBACK');
      throw err;
    }
  }

  /**
   * Inner migration loop, called once the lock + transaction are established.
   * Reads the current schema_version, filters pending migrations, applies each
   * one, and bumps schema_version inside the same transaction.
   */
  private static async _runMigrations(
    adapter: StorageAdapter,
    features: StorageFeatures,
    brainId: string,
    migrations: Migration[],
  ): Promise<{ applied: number[] }> {
    const current = await MigrationRunner._readSchemaVersion(adapter, brainId);

    // Fresh database: brain_meta does not exist yet. Skip migrations entirely;
    // the upcoming _initSchema call creates the latest schema directly.
    if (current === null) return { applied: [] };

    const sorted = [...migrations].sort((a, b) => a.version - b.version);
    const pending = sorted.filter((m) => m.version > current);
    const applied: number[] = [];

    for (const migration of pending) {
      await migration.up(adapter, features, brainId);
      await MigrationRunner._writeSchemaVersion(adapter, features, brainId, migration.version);
      applied.push(migration.version);
    }
    return { applied };
  }

  /**
   * Read the current schema_version from brain_meta. Returns null when
   * brain_meta does not exist (fresh database).
   */
  private static async _readSchemaVersion(
    adapter: StorageAdapter,
    brainId: string,
  ): Promise<number | null> {
    const isPostgres = adapter.kind.includes('postgres');
    const brainMetaExists = isPostgres
      ? await MigrationRunner._postgresTableExists(adapter, 'brain_meta')
      : await MigrationRunner._sqliteTableExists(adapter, 'brain_meta');
    if (!brainMetaExists) return null;

    const row = await adapter.get<{ value: string }>(
      `SELECT value FROM brain_meta WHERE brain_id = ? AND key = ?`,
      [brainId, 'schema_version'],
    );
    return row ? parseInt(row.value, 10) : null;
  }

  /**
   * Upsert schema_version in brain_meta inside the current transaction.
   * Uses dialect-aware INSERT OR REPLACE.
   */
  private static async _writeSchemaVersion(
    adapter: StorageAdapter,
    features: StorageFeatures,
    brainId: string,
    version: number,
  ): Promise<void> {
    await adapter.run(
      features.dialect.insertOrReplace(
        'brain_meta',
        ['brain_id', 'key', 'value'],
        ['?', '?', '?'],
        'brain_id, key',
      ),
      [brainId, 'schema_version', String(version)],
    );
  }

  private static async _sqliteTableExists(
    adapter: StorageAdapter,
    table: string,
  ): Promise<boolean> {
    const row = await adapter.get<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
      [table],
    );
    return Boolean(row);
  }

  private static async _postgresTableExists(
    adapter: StorageAdapter,
    table: string,
  ): Promise<boolean> {
    const row = await adapter.get<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables
          WHERE table_schema = current_schema() AND table_name = $1
       ) AS exists`,
      [table],
    );
    return row?.exists ?? false;
  }
}
