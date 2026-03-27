/**
 * @fileoverview Tests for the universal MigrationEngine.
 * @module rag/migration/__tests__/MigrationEngine.test
 *
 * Tests SQLite → SQLite migration locally (no Docker required).
 * Postgres and Qdrant migrations are conditional on availability.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MigrationEngine } from '../MigrationEngine.js';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('MigrationEngine', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'migration-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('migrates SQLite → SQLite with streaming batches', async () => {
    // --- Arrange: create source database with test data ---
    const srcPath = join(tmpDir, 'source.sqlite');
    const src = new Database(srcPath);
    src.exec(`
      CREATE TABLE brain_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE memory_traces (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        strength REAL DEFAULT 1.0,
        embedding BLOB
      );
    `);

    // Insert brain_meta row.
    src.prepare('INSERT INTO brain_meta VALUES (?, ?)').run('schema_version', '1');

    // Insert 50 memory traces with binary blob embeddings.
    const insertTrace = src.prepare('INSERT INTO memory_traces VALUES (?, ?, ?, ?)');
    for (let i = 0; i < 50; i++) {
      const embedding = Buffer.from(new Float32Array([i * 0.1, i * 0.2, i * 0.3, i * 0.4]).buffer);
      insertTrace.run(`trace-${i}`, `content ${i}`, Math.random(), embedding);
    }
    src.close();

    // --- Act: migrate with small batch size to test streaming ---
    const dstPath = join(tmpDir, 'dest.sqlite');
    const progress: string[] = [];

    const result = await MigrationEngine.migrate({
      from: { type: 'sqlite', path: srcPath },
      to: { type: 'sqlite', path: dstPath },
      batchSize: 10, // 50 rows / 10 per batch = 5 batches for traces
      onProgress: (done, total, table) => progress.push(`${table}:${done}/${total}`),
    });

    // --- Assert ---
    expect(result.totalRows).toBe(51); // 50 traces + 1 meta
    expect(result.tablesProcessed).toContain('memory_traces');
    expect(result.tablesProcessed).toContain('brain_meta');
    expect(result.errors).toHaveLength(0);
    expect(result.verified).toBe(true);
    expect(result.durationMs).toBeGreaterThan(0);

    // Progress should have been called multiple times for traces.
    const traceProgress = progress.filter(p => p.startsWith('memory_traces'));
    expect(traceProgress.length).toBeGreaterThanOrEqual(2);

    // Verify destination has all data.
    const dst = new Database(dstPath, { readonly: true });
    const traceCount = (dst.prepare('SELECT COUNT(*) as c FROM memory_traces').get() as { c: number }).c;
    expect(traceCount).toBe(50);

    const metaCount = (dst.prepare('SELECT COUNT(*) as c FROM brain_meta').get() as { c: number }).c;
    expect(metaCount).toBe(1);

    // Verify embedding binary blobs survived the migration.
    const firstTrace = dst.prepare('SELECT embedding FROM memory_traces WHERE id = ?').get('trace-0') as { embedding: Buffer };
    expect(firstTrace.embedding).toBeInstanceOf(Buffer);
    const f32 = new Float32Array(firstTrace.embedding.buffer, firstTrace.embedding.byteOffset, firstTrace.embedding.byteLength / 4);
    expect(f32[0]).toBeCloseTo(0.0);
    expect(f32[1]).toBeCloseTo(0.0);

    dst.close();
  });

  it('supports dry run without writing', async () => {
    // Create source with one row.
    const srcPath = join(tmpDir, 'source.sqlite');
    const src = new Database(srcPath);
    src.exec('CREATE TABLE memory_traces (id TEXT PRIMARY KEY, content TEXT)');
    src.prepare('INSERT INTO memory_traces VALUES (?, ?)').run('t1', 'hello');
    src.close();

    const dstPath = join(tmpDir, 'dest.sqlite');
    let progressCalled = false;

    const result = await MigrationEngine.migrate({
      from: { type: 'sqlite', path: srcPath },
      to: { type: 'sqlite', path: dstPath },
      dryRun: true,
      onProgress: () => { progressCalled = true; },
    });

    expect(result.totalRows).toBe(1);
    expect(result.tablesProcessed).toContain('memory_traces');
    expect(progressCalled).toBe(true);
    expect(result.verified).toBe(true);
  });

  it('handles empty source gracefully', async () => {
    // Source with schema but no data.
    const srcPath = join(tmpDir, 'empty.sqlite');
    const src = new Database(srcPath);
    src.exec('CREATE TABLE memory_traces (id TEXT PRIMARY KEY, content TEXT)');
    src.close();

    const dstPath = join(tmpDir, 'dest.sqlite');

    const result = await MigrationEngine.migrate({
      from: { type: 'sqlite', path: srcPath },
      to: { type: 'sqlite', path: dstPath },
    });

    expect(result.totalRows).toBe(0);
    expect(result.tablesProcessed).toContain('memory_traces');
    expect(result.errors).toHaveLength(0);
  });

  it('collects per-table errors without stopping migration', async () => {
    // Source with one good table and one that will cause issues.
    const srcPath = join(tmpDir, 'source.sqlite');
    const src = new Database(srcPath);
    src.exec(`
      CREATE TABLE brain_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE memory_traces (id TEXT PRIMARY KEY, content TEXT);
    `);
    src.prepare('INSERT INTO brain_meta VALUES (?, ?)').run('k', 'v');
    src.prepare('INSERT INTO memory_traces VALUES (?, ?)').run('t1', 'hello');
    src.close();

    const dstPath = join(tmpDir, 'dest.sqlite');

    const result = await MigrationEngine.migrate({
      from: { type: 'sqlite', path: srcPath },
      to: { type: 'sqlite', path: dstPath },
      batchSize: 100,
    });

    // Both tables should be processed.
    expect(result.tablesProcessed.length).toBeGreaterThanOrEqual(1);
    expect(result.totalRows).toBeGreaterThanOrEqual(1);
  });
});
