import { describe, expect, it } from 'vitest';
import type {
  StorageAdapter,
  StorageParameters,
  StorageRunResult,
} from '@framers/sql-storage-adapter';
import { Brain } from '../Brain.js';

class RecordingPostgresAdapter implements StorageAdapter {
  readonly kind = 'postgres' as const;
  readonly execStatements: string[] = [];

  async open(): Promise<void> {}

  async close(): Promise<void> {}

  async run(_sql: string, _params?: StorageParameters): Promise<StorageRunResult> {
    return { changes: 1 };
  }

  async get<T = unknown>(sql: string, _params?: StorageParameters): Promise<T | null> {
    if (sql.includes('information_schema.tables') || sql.includes('information_schema.columns')) {
      return { exists: false } as T;
    }
    return null;
  }

  async all<T = unknown>(_sql: string, _params?: StorageParameters): Promise<T[]> {
    return [];
  }

  async exec(sql: string): Promise<void> {
    this.execStatements.push(sql);
  }

  async transaction<T>(fn: (trx: StorageAdapter) => Promise<T>): Promise<T> {
    return fn(this);
  }
}

describe('Brain Postgres schema initialization', () => {
  it('emits Postgres-compatible DDL for fresh brain schemas', async () => {
    const adapter = new RecordingPostgresAdapter();

    await Brain.openWithAdapter(adapter, { brainId: 'pg-brain' });

    const ddl = adapter.execStatements.join('\n');
    expect(ddl).not.toContain('AUTOINCREMENT');
    expect(ddl).not.toMatch(/\bBLOB\b/);
    expect(ddl).toContain('GENERATED ALWAYS AS IDENTITY PRIMARY KEY');
    expect(ddl).toContain('BYTEA');
  });
});
