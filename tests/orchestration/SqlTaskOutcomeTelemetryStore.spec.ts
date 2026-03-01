import { beforeEach, describe, expect, it, vi } from 'vitest';

const { resolveStorageAdapterMock } = vi.hoisted(() => ({
  resolveStorageAdapterMock: vi.fn(),
}));

vi.mock('@framers/sql-storage-adapter', () => ({
  resolveStorageAdapter: resolveStorageAdapterMock,
}));

import { SqlTaskOutcomeTelemetryStore } from '../../src/core/orchestration/SqlTaskOutcomeTelemetryStore';

type PersistedRow = {
  entriesJson: string;
  updatedAt: number;
};

function createMockAdapter(kind: 'better-sqlite3' | 'postgres' = 'better-sqlite3') {
  const rows = new Map<string, PersistedRow>();

  const adapter: any = {
    kind,
    capabilities: {},
    open: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    exec: vi.fn().mockResolvedValue(undefined),
    all: vi.fn().mockImplementation(async () =>
      Array.from(rows.entries()).map(([scope_key, row]) => ({
        scope_key,
        entries_json: row.entriesJson,
        updated_at: row.updatedAt,
      })),
    ),
    get: vi.fn().mockImplementation(async (_statement: string, parameters?: unknown[]) => {
      const key = String(parameters?.[0] ?? '');
      return rows.has(key) ? { scope_key: key } : null;
    }),
    run: vi.fn().mockImplementation(async (statement: string, parameters?: unknown[]) => {
      const values = Array.isArray(parameters) ? parameters : [];
      if (/INSERT OR REPLACE/i.test(statement)) {
        const [scopeKey, entriesJson, updatedAt] = values;
        rows.set(String(scopeKey), {
          entriesJson: String(entriesJson ?? '[]'),
          updatedAt: Number(updatedAt ?? Date.now()),
        });
      } else if (/UPDATE/i.test(statement)) {
        const [entriesJson, updatedAt, scopeKey] = values;
        rows.set(String(scopeKey), {
          entriesJson: String(entriesJson ?? '[]'),
          updatedAt: Number(updatedAt ?? Date.now()),
        });
      } else if (/INSERT INTO/i.test(statement)) {
        const [scopeKey, entriesJson, updatedAt] = values;
        rows.set(String(scopeKey), {
          entriesJson: String(entriesJson ?? '[]'),
          updatedAt: Number(updatedAt ?? Date.now()),
        });
      }
      return { changes: 1, lastInsertRowid: null };
    }),
    transaction: vi.fn().mockImplementation(async (fn: any) => fn(adapter)),
  };

  return { adapter, rows };
}

describe('SqlTaskOutcomeTelemetryStore', () => {
  beforeEach(() => {
    resolveStorageAdapterMock.mockReset();
  });

  it('writes and reads sanitized KPI windows for sqlite-like adapters', async () => {
    const { adapter } = createMockAdapter('better-sqlite3');
    resolveStorageAdapterMock.mockResolvedValue(adapter);
    const store = new SqlTaskOutcomeTelemetryStore();

    await store.saveWindow(' global ', [
      { status: 'failed', score: -4, timestamp: 42.7 },
      { status: 'unknown', score: 0.5, timestamp: 50 } as any,
    ]);

    expect(adapter.run).toHaveBeenCalledWith(
      expect.stringContaining('INSERT OR REPLACE'),
      expect.any(Array),
    );

    const windows = await store.loadWindows();
    expect(windows.global).toBeDefined();
    expect(windows.global).toHaveLength(1);
    expect(windows.global[0]).toEqual({
      status: 'failed',
      score: 0,
      timestamp: 42,
    });
  });

  it('uses update path for postgres when scope already exists', async () => {
    const { adapter, rows } = createMockAdapter('postgres');
    rows.set('global', {
      entriesJson: '[]',
      updatedAt: Date.now(),
    });
    resolveStorageAdapterMock.mockResolvedValue(adapter);
    const store = new SqlTaskOutcomeTelemetryStore();

    await store.saveWindow('global', [{ status: 'success', score: 1, timestamp: 10 }]);

    expect(adapter.get).toHaveBeenCalled();
    expect(
      adapter.run.mock.calls.some((call: unknown[]) => String(call[0]).includes('UPDATE')),
    ).toBe(true);
  });

  it('ignores malformed persisted rows during load', async () => {
    const { adapter, rows } = createMockAdapter('better-sqlite3');
    rows.set('broken', {
      entriesJson: '{not json',
      updatedAt: Date.now(),
    });
    rows.set('good', {
      entriesJson: JSON.stringify([
        { status: 'success', score: 1, timestamp: 1 },
        { status: 'nope', score: 0.5, timestamp: 2 },
      ]),
      updatedAt: Date.now(),
    });
    resolveStorageAdapterMock.mockResolvedValue(adapter);
    const store = new SqlTaskOutcomeTelemetryStore();

    const windows = await store.loadWindows();
    expect(windows.good).toHaveLength(1);
    expect(windows.broken).toBeUndefined();
  });

  it('rejects unsafe table names', () => {
    expect(() => new SqlTaskOutcomeTelemetryStore({ tableName: 'bad-name;' as any })).toThrow(
      /Invalid tableName/i,
    );
  });
});
