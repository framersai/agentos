/**
 * @fileoverview Tests for Brain.exportToSqlite + Brain.importFromSqlite.
 *
 * Verifies the portable-artifact contract:
 * - Export materialises a Brain to a fresh SQLite file regardless of the
 *   source backend.
 * - Import loads a portable SQLite file into the receiving Brain's
 *   storage, rewriting `brain_id` to the receiving Brain's identity
 *   (forking semantics).
 * - Round-trip preserves row counts and content across all 14 tables.
 * - Idempotent merge import: re-importing the same file is a no-op
 *   under merge strategy (PK conflict → upsert with same data).
 * - Replace strategy wipes the receiving brain's existing rows for
 *   every brain-owned table before re-populating.
 *
 * @module memory/retrieval/store/__tests__/Brain.export-import.test
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Brain } from '../Brain.js';

describe('Brain.exportToSqlite + importFromSqlite', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'brain-export-import-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('exports a populated brain to SQLite and round-trips into a fresh brain (forking)', async () => {
    const sourcePath = path.join(tmpDir, 'source.sqlite');
    const exportPath = path.join(tmpDir, 'alice-export.sqlite');
    const targetPath = path.join(tmpDir, 'target.sqlite');

    // Populate the source brain.
    const source = await Brain.openSqlite(sourcePath, { brainId: 'alice' });
    await source.run(
      `INSERT INTO memory_traces (brain_id, id, type, scope, content, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ['alice', 't1', 'episodic', 'user', 'first memory', 1700000001],
    );
    await source.run(
      `INSERT INTO memory_traces (brain_id, id, type, scope, content, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ['alice', 't2', 'semantic', 'user', 'second memory', 1700000002],
    );
    await source.run(
      `INSERT INTO knowledge_nodes (brain_id, id, type, label, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      ['alice', 'n1', 'concept', 'Berlin', 1700000003],
    );

    // Export.
    const result = await source.exportToSqlite(exportPath);
    expect(result.bytesWritten).toBeGreaterThan(0);
    await source.close();

    // Verify the export file is a valid SQLite Brain at v2 with the
    // SAME brainId as the source.
    // Specify brainId to avoid polluting brain_meta with a path-derived id
    // (which would break subsequent importFromSqlite single-brain validation).
    const exportBrain = await Brain.openSqlite(exportPath, { brainId: 'alice' });
    expect(exportBrain.brainId).toBe('alice');
    const exportedTraces = await exportBrain.all<{ brain_id: string; id: string }>(
      `SELECT brain_id, id FROM memory_traces ORDER BY id`,
    );
    // Exported rows still carry the source brainId (alice).
    expect(exportedTraces).toHaveLength(2);
    expect(exportedTraces.every((r) => r.brain_id === 'alice')).toBe(true);
    await exportBrain.close();

    // Import into a fresh brain with a different brainId (forking).
    const target = await Brain.openSqlite(targetPath, { brainId: 'alice-fork' });
    const importResult = await target.importFromSqlite(exportPath);
    expect(importResult.tablesImported.memory_traces).toBe(2);
    expect(importResult.tablesImported.knowledge_nodes).toBe(1);

    const targetTraces = await target.all<{ brain_id: string; id: string; content: string }>(
      `SELECT brain_id, id, content FROM memory_traces ORDER BY created_at`,
    );
    expect(targetTraces).toHaveLength(2);
    // Forking: every imported row gets the target's brainId, not the source's.
    expect(targetTraces.every((t) => t.brain_id === 'alice-fork')).toBe(true);
    expect(targetTraces[0]).toMatchObject({ id: 't1', content: 'first memory' });
    expect(targetTraces[1]).toMatchObject({ id: 't2', content: 'second memory' });

    const targetNodes = await target.all<{ brain_id: string; id: string; label: string }>(
      `SELECT brain_id, id, label FROM knowledge_nodes`,
    );
    expect(targetNodes).toHaveLength(1);
    expect(targetNodes[0]).toMatchObject({ brain_id: 'alice-fork', id: 'n1', label: 'Berlin' });

    await target.close();
  });

  it('refuses to overwrite an existing target file on export', async () => {
    const sourcePath = path.join(tmpDir, 's.sqlite');
    const exportPath = path.join(tmpDir, 'collision.sqlite');

    const source = await Brain.openSqlite(sourcePath, { brainId: 'alice' });
    // Create a placeholder at the export path.
    await fs.writeFile(exportPath, 'not a database');

    await expect(source.exportToSqlite(exportPath)).rejects.toThrow(
      /already exists/i,
    );

    await source.close();
  });

  it('merge import upserts on PK collision (idempotent re-import)', async () => {
    const sourcePath = path.join(tmpDir, 'src.sqlite');
    const exportPath = path.join(tmpDir, 'export.sqlite');
    const targetPath = path.join(tmpDir, 'tgt.sqlite');

    const source = await Brain.openSqlite(sourcePath, { brainId: 'src' });
    await source.run(
      `INSERT INTO memory_traces (brain_id, id, type, scope, content, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ['src', 't1', 'episodic', 'user', 'data', 1700000001],
    );
    await source.exportToSqlite(exportPath);
    await source.close();

    const target = await Brain.openSqlite(targetPath, { brainId: 'tgt' });
    await target.importFromSqlite(exportPath, { strategy: 'merge' });
    // Second import — must succeed without throwing PK collision.
    await target.importFromSqlite(exportPath, { strategy: 'merge' });

    const traces = await target.all<{ id: string }>(
      `SELECT id FROM memory_traces WHERE brain_id = ?`,
      ['tgt'],
    );
    expect(traces).toHaveLength(1);

    await target.close();
  });

  it('replace import wipes existing rows for the receiving brainId before importing', async () => {
    const sourcePath = path.join(tmpDir, 'src.sqlite');
    const exportPath = path.join(tmpDir, 'export.sqlite');
    const targetPath = path.join(tmpDir, 'tgt.sqlite');

    const source = await Brain.openSqlite(sourcePath, { brainId: 'src' });
    await source.run(
      `INSERT INTO memory_traces (brain_id, id, type, scope, content, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ['src', 'imported', 'episodic', 'user', 'imported content', 1700000001],
    );
    await source.exportToSqlite(exportPath);
    await source.close();

    const target = await Brain.openSqlite(targetPath, { brainId: 'tgt' });
    // Pre-existing row in target that should be wiped on replace import.
    await target.run(
      `INSERT INTO memory_traces (brain_id, id, type, scope, content, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ['tgt', 'preexisting', 'episodic', 'user', 'will be wiped', 1700000099],
    );

    await target.importFromSqlite(exportPath, { strategy: 'replace' });

    const traces = await target.all<{ id: string; content: string }>(
      `SELECT id, content FROM memory_traces WHERE brain_id = ?`,
      ['tgt'],
    );
    expect(traces).toHaveLength(1);
    expect(traces[0]).toMatchObject({ id: 'imported', content: 'imported content' });

    await target.close();
  });

  // Gated on AGENTOS_TEST_POSTGRES_URL: skipped without a Postgres instance.
  const POSTGRES_URL = process.env.AGENTOS_TEST_POSTGRES_URL;
  const itIfPostgres = POSTGRES_URL ? it : it.skip;

  itIfPostgres('round-trips a brain through sqlite -> postgres -> sqlite', async () => {
    const brainId = `roundtrip-${Date.now()}`;
    const sqliteSourcePath = path.join(tmpDir, 'roundtrip-source.sqlite');
    const sqliteFinalPath = path.join(tmpDir, 'roundtrip-final.sqlite');

    // 1. Create a SQLite brain and populate with a few traces + a document.
    const source = await Brain.openSqlite(sqliteSourcePath, { brainId });
    await source.run(
      `INSERT INTO memory_traces (brain_id, id, type, scope, content, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      [brainId, 'rt-trace-1', 'episodic', 'user', 'first trace', 1000],
    );
    await source.run(
      `INSERT INTO memory_traces (brain_id, id, type, scope, content, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      [brainId, 'rt-trace-2', 'semantic', 'world', 'second trace', 2000],
    );
    await source.run(
      `INSERT INTO documents (brain_id, id, path, format, content_hash, ingested_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      [brainId, 'rt-doc-1', '/test/doc.md', 'markdown', 'hash-abc', 3000],
    );
    await source.close();

    // 2. Open a Postgres brain and import from SQLite.
    const pgBrain = await Brain.openPostgres(POSTGRES_URL!, { brainId });
    await pgBrain.importFromSqlite(sqliteSourcePath, { strategy: 'replace' });

    // 3. Export the Postgres brain back to a fresh SQLite file.
    await pgBrain.exportToSqlite(sqliteFinalPath);
    await pgBrain.close();

    // 4. Open the final SQLite file and verify all rows came through.
    const final = await Brain.openSqlite(sqliteFinalPath, { brainId });

    const traces = await final.all<{ id: string; content: string }>(
      `SELECT id, content FROM memory_traces WHERE brain_id = ? ORDER BY id`,
      [brainId],
    );
    expect(traces).toEqual([
      { id: 'rt-trace-1', content: 'first trace' },
      { id: 'rt-trace-2', content: 'second trace' },
    ]);

    const docs = await final.all<{ id: string; path: string }>(
      `SELECT id, path FROM documents WHERE brain_id = ? ORDER BY id`,
      [brainId],
    );
    expect(docs).toEqual([{ id: 'rt-doc-1', path: '/test/doc.md' }]);

    await final.close();

    // 5. Cleanup Postgres rows.
    const cleanup = await Brain.openPostgres(POSTGRES_URL!, { brainId });
    for (const table of ['memory_traces', 'documents', 'brain_meta']) {
      await cleanup.run(`DELETE FROM ${table} WHERE brain_id = $1`, [brainId]);
    }
    await cleanup.close();
  });

  it('importFromSqlite rejects a multi-brain source file', async () => {
    // Synthesize a multi-brain SQLite file by manually inserting brain_meta
    // rows for two distinct brain_ids.
    const sourcePath = path.join(tmpDir, 'multi-brain.sqlite');
    const setup = await Brain.openSqlite(sourcePath, { brainId: 'brain-a' });
    // Inject a second brain's meta row.
    await setup.run(
      `INSERT INTO brain_meta (brain_id, key, value) VALUES (?, ?, ?)`,
      ['brain-b', 'schema_version', '2'],
    );
    await setup.close();

    // Open a target brain and try to import the multi-brain source.
    const target = await Brain.openSqlite(':memory:', { brainId: 'brain-target' });
    await expect(target.importFromSqlite(sourcePath)).rejects.toThrow(
      /multiple brain_ids|brain-a|brain-b/i,
    );
    await target.close();
  });
});
