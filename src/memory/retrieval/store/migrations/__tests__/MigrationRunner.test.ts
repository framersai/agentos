/**
 * @fileoverview Unit tests for MigrationRunner using SQLite in-memory adapters.
 * Postgres-specific behavior is tested in `Brain.postgres.test.ts`.
 *
 * @module memory/retrieval/store/migrations/__tests__/MigrationRunner.test
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveStorageAdapter, createStorageFeatures } from '@framers/sql-storage-adapter';
import type { StorageAdapter, StorageFeatures } from '@framers/sql-storage-adapter';
import { MigrationRunner } from '../MigrationRunner.js';
import type { Migration } from '../types.js';

describe('MigrationRunner', () => {
  let adapter: StorageAdapter;
  let features: StorageFeatures;
  const brainId = 'test-brain';

  beforeEach(async () => {
    adapter = await resolveStorageAdapter({
      filePath: ':memory:',
      priority: ['better-sqlite3', 'sqljs'],
      quiet: true,
    });
    features = createStorageFeatures(adapter);
  });

  afterEach(async () => {
    if (adapter) await adapter.close();
  });

  it('returns empty applied list on a fresh database (no brain_meta yet)', async () => {
    const fakeMigration: Migration = {
      version: 1,
      up: async () => {
        throw new Error('should not run on fresh DB');
      },
    };
    const result = await MigrationRunner.runPending(adapter, features, brainId, [fakeMigration]);
    expect(result.applied).toEqual([]);
  });

  it('runs registered migrations in version order against a stale schema', async () => {
    await adapter.exec(`
      CREATE TABLE brain_meta (
        brain_id TEXT NOT NULL,
        key      TEXT NOT NULL,
        value    TEXT NOT NULL,
        PRIMARY KEY (brain_id, key)
      );
    `);
    await adapter.run(
      `INSERT INTO brain_meta (brain_id, key, value) VALUES (?, ?, ?)`,
      [brainId, 'schema_version', '0'],
    );

    const callOrder: number[] = [];
    const m1: Migration = {
      version: 1,
      up: async () => {
        callOrder.push(1);
      },
    };
    const m2: Migration = {
      version: 2,
      up: async () => {
        callOrder.push(2);
      },
    };

    // Register out of order to verify the runner sorts.
    const result = await MigrationRunner.runPending(adapter, features, brainId, [m2, m1]);

    expect(callOrder).toEqual([1, 2]);
    expect(result.applied).toEqual([1, 2]);
  });

  it('skips migrations where current >= target (idempotent re-run)', async () => {
    await adapter.exec(`
      CREATE TABLE brain_meta (
        brain_id TEXT NOT NULL,
        key      TEXT NOT NULL,
        value    TEXT NOT NULL,
        PRIMARY KEY (brain_id, key)
      );
    `);
    await adapter.run(
      `INSERT INTO brain_meta (brain_id, key, value) VALUES (?, ?, ?)`,
      [brainId, 'schema_version', '2'],
    );

    let runCount = 0;
    const m1: Migration = {
      version: 1,
      up: async () => {
        runCount++;
      },
    };
    const m2: Migration = {
      version: 2,
      up: async () => {
        runCount++;
      },
    };

    const result = await MigrationRunner.runPending(adapter, features, brainId, [m1, m2]);

    expect(runCount).toBe(0);
    expect(result.applied).toEqual([]);
  });

  it('rolls back on migration failure (data + schema_version unchanged)', async () => {
    await adapter.exec(`
      CREATE TABLE brain_meta (
        brain_id TEXT NOT NULL,
        key      TEXT NOT NULL,
        value    TEXT NOT NULL,
        PRIMARY KEY (brain_id, key)
      );
      CREATE TABLE marker (id INTEGER PRIMARY KEY, value TEXT);
    `);
    await adapter.run(
      `INSERT INTO brain_meta (brain_id, key, value) VALUES (?, ?, ?)`,
      [brainId, 'schema_version', '1'],
    );

    const failingMigration: Migration = {
      version: 2,
      up: async (a) => {
        // Insert a marker row, then throw. Both should roll back.
        await a.run(`INSERT INTO marker (id, value) VALUES (?, ?)`, [1, 'should-roll-back']);
        throw new Error('intentional failure mid-migration');
      },
    };

    await expect(
      MigrationRunner.runPending(adapter, features, brainId, [failingMigration]),
    ).rejects.toThrow(/intentional failure mid-migration/);

    // Verify schema_version is still '1' (not bumped to '2').
    const ver = await adapter.get<{ value: string }>(
      `SELECT value FROM brain_meta WHERE brain_id = ? AND key = ?`,
      [brainId, 'schema_version'],
    );
    expect(ver?.value).toBe('1');

    // Verify the marker row was rolled back.
    const marker = await adapter.get<{ value: string }>(`SELECT value FROM marker WHERE id = ?`, [
      1,
    ]);
    expect(marker).toBeNull();
  });

  it('bumps schema_version atomically inside the same transaction as up()', async () => {
    await adapter.exec(`
      CREATE TABLE brain_meta (
        brain_id TEXT NOT NULL,
        key      TEXT NOT NULL,
        value    TEXT NOT NULL,
        PRIMARY KEY (brain_id, key)
      );
    `);
    await adapter.run(
      `INSERT INTO brain_meta (brain_id, key, value) VALUES (?, ?, ?)`,
      [brainId, 'schema_version', '1'],
    );

    const m2: Migration = {
      version: 2,
      up: async () => {
        // Successful migration, no failure.
      },
    };

    await MigrationRunner.runPending(adapter, features, brainId, [m2]);

    const ver = await adapter.get<{ value: string }>(
      `SELECT value FROM brain_meta WHERE brain_id = ? AND key = ?`,
      [brainId, 'schema_version'],
    );
    expect(ver?.value).toBe('2');
  });

  it('runs a multi-version chain in order (v0 -> v1 -> v2 -> v3)', async () => {
    await adapter.exec(`
      CREATE TABLE brain_meta (
        brain_id TEXT NOT NULL,
        key      TEXT NOT NULL,
        value    TEXT NOT NULL,
        PRIMARY KEY (brain_id, key)
      );
    `);
    await adapter.run(
      `INSERT INTO brain_meta (brain_id, key, value) VALUES (?, ?, ?)`,
      [brainId, 'schema_version', '0'],
    );

    const callOrder: number[] = [];
    const migrations: Migration[] = [
      {
        version: 1,
        up: async () => {
          callOrder.push(1);
        },
      },
      {
        version: 2,
        up: async () => {
          callOrder.push(2);
        },
      },
      {
        version: 3,
        up: async () => {
          callOrder.push(3);
        },
      },
    ];

    const result = await MigrationRunner.runPending(adapter, features, brainId, migrations);

    expect(callOrder).toEqual([1, 2, 3]);
    expect(result.applied).toEqual([1, 2, 3]);

    // schema_version should be the highest applied.
    const ver = await adapter.get<{ value: string }>(
      `SELECT value FROM brain_meta WHERE brain_id = ? AND key = ?`,
      [brainId, 'schema_version'],
    );
    expect(ver?.value).toBe('3');
  });
});
