/**
 * @fileoverview Integration tests for the Memory facade.
 *
 * Tests cover:
 * 1. remember + recall: store a trace and retrieve it by query
 * 2. forget: soft-delete a trace so recall no longer returns it
 * 3. ingest file: load a .txt file, verify chunks created
 * 4. ingest directory: load a dir with 2 .md files, verify both processed
 * 5. export JSON + import JSON: round-trip 3 facts through JSON
 * 6. export Markdown: verify .md file(s) created with front-matter
 * 7. consolidate: run consolidation on 5 traces, verify result shape
 * 8. health: verify correct counts after remembering traces
 * 9. close: create Memory, close, verify no errors
 *
 * All tests use temp directories/files and clean up in afterEach.
 *
 * @module memory/facade/__tests__/Memory.test
 */

import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Memory } from '../Memory.js';

// ---------------------------------------------------------------------------
// Test infrastructure
// ---------------------------------------------------------------------------

/** All temp paths created during a test, cleaned up in afterEach. */
const cleanupPaths: string[] = [];

/** All Memory instances opened during a test, closed in afterEach. */
const openMemories: Memory[] = [];

/**
 * Create a unique temp directory for the current test.
 */
function tempDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-mem-facade-'));
  cleanupPaths.push(d);
  return d;
}

/**
 * Return a unique temp .sqlite path (file not yet created).
 */
function tempDb(): string {
  const p = path.join(
    os.tmpdir(),
    `agentos-facade-brain-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`,
  );
  cleanupPaths.push(p);
  return p;
}

/**
 * Create a Memory instance and register it for cleanup.
 */
function createMemory(overrides?: Record<string, unknown>): Memory {
  const dbPath = tempDb();
  const mem = new Memory({
    store: 'sqlite',
    path: dbPath,
    graph: true,
    selfImprove: true,
    decay: true,
    ...overrides,
  });
  openMemories.push(mem);
  return mem;
}

afterEach(async () => {
  // Close all Memory instances.
  for (const mem of openMemories) {
    try {
      await mem.close();
    } catch {
      // Already closed -- ignore.
    }
  }
  openMemories.length = 0;

  // Clean up temp files and directories.
  for (const p of cleanupPaths) {
    try {
      const stat = fs.statSync(p);
      if (stat.isDirectory()) {
        fs.rmSync(p, { recursive: true, force: true });
      } else {
        fs.unlinkSync(p);
      }
    } catch {
      // Missing or already deleted -- ignore.
    }
    // Also clean up WAL/SHM sidecar files for SQLite.
    for (const suffix of ['-wal', '-shm']) {
      try { fs.unlinkSync(p + suffix); } catch { /* ignore */ }
    }
  }
  cleanupPaths.length = 0;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Memory facade', () => {
  // -----------------------------------------------------------------------
  // 1. remember + recall
  // -----------------------------------------------------------------------
  it('should remember and recall a memory trace', async () => {
    const mem = createMemory();

    const trace = await mem.remember('cats are great pets', { tags: ['animals'] });

    expect(trace).toBeDefined();
    expect(trace.id).toMatch(/^mt_/);
    expect(trace.content).toBe('cats are great pets');
    expect(trace.tags).toContain('animals');

    const results = await mem.recall('cats');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].trace.content).toContain('cats');
    expect(results[0].score).toBeGreaterThan(0);
  });

  // -----------------------------------------------------------------------
  // 2. forget
  // -----------------------------------------------------------------------
  it('should forget a trace so recall returns empty', async () => {
    const mem = createMemory();

    const trace = await mem.remember('dogs love walks');
    await mem.forget(trace.id);

    const results = await mem.recall('dogs love walks');
    // All returned traces should NOT include the forgotten one.
    const found = results.find((r) => r.trace.id === trace.id);
    expect(found).toBeUndefined();
  });

  // -----------------------------------------------------------------------
  // 3. ingest file
  // -----------------------------------------------------------------------
  it('should ingest a .txt file and create chunks', async () => {
    const mem = createMemory();
    const dir = tempDir();
    const filePath = path.join(dir, 'notes.txt');

    // Write a file with enough content to produce at least one chunk.
    const content = 'The quick brown fox jumps over the lazy dog. '.repeat(30);
    await fsp.writeFile(filePath, content, 'utf8');

    const result = await mem.ingest(filePath);

    expect(result.succeeded).toContain(filePath);
    expect(result.failed).toHaveLength(0);
    expect(result.chunksCreated).toBeGreaterThanOrEqual(1);
    expect(result.tracesCreated).toBeGreaterThanOrEqual(1);
  });

  // -----------------------------------------------------------------------
  // 4. ingest directory
  // -----------------------------------------------------------------------
  it('should ingest a directory with 2 .md files', async () => {
    const mem = createMemory();
    const dir = tempDir();

    await fsp.writeFile(
      path.join(dir, 'alpha.md'),
      '# Alpha\n\nThis is the alpha document with some unique content about alpacas.',
      'utf8',
    );
    await fsp.writeFile(
      path.join(dir, 'beta.md'),
      '# Beta\n\nThis is the beta document with some unique content about butterflies.',
      'utf8',
    );

    const result = await mem.ingest(dir);

    expect(result.succeeded.length).toBe(2);
    expect(result.failed).toHaveLength(0);
    expect(result.chunksCreated).toBeGreaterThanOrEqual(2);
    expect(result.tracesCreated).toBeGreaterThanOrEqual(2);
  });

  // -----------------------------------------------------------------------
  // 5. export JSON + import JSON round-trip
  // -----------------------------------------------------------------------
  it('should export to JSON and import into a fresh Memory', async () => {
    const mem1 = createMemory();

    await mem1.remember('fact one: water boils at 100C');
    await mem1.remember('fact two: the sky is blue');
    await mem1.remember('fact three: gravity is 9.8 m/s^2');

    const dir = tempDir();
    const jsonPath = path.join(dir, 'export.json');
    await mem1.export(jsonPath, { format: 'json' });

    // Verify the JSON file was created.
    expect(fs.existsSync(jsonPath)).toBe(true);

    // Import into a fresh Memory.
    const mem2 = createMemory();
    const result = await mem2.importFrom(jsonPath, { format: 'json' });

    expect(result.imported).toBeGreaterThanOrEqual(3);
    expect(result.errors).toHaveLength(0);
  });

  // -----------------------------------------------------------------------
  // 6. export Markdown
  // -----------------------------------------------------------------------
  it('should export to Markdown directory with .md files', async () => {
    const mem = createMemory();

    await mem.remember('Markdown export test content', {
      type: 'semantic',
      scope: 'user',
    });

    const dir = tempDir();
    const mdDir = path.join(dir, 'vault');
    await mem.export(mdDir, { format: 'markdown' });

    // The markdown exporter creates {scope}/{type}/{id}.md files.
    // Verify at least one .md file exists somewhere in the output directory.
    const allFiles = fs.readdirSync(mdDir, { recursive: true }) as string[];
    const mdFiles = allFiles.filter((f) => f.toString().endsWith('.md'));
    expect(mdFiles.length).toBeGreaterThanOrEqual(1);
  });

  // -----------------------------------------------------------------------
  // 7. consolidate
  // -----------------------------------------------------------------------
  it('should consolidate 5 traces and return a ConsolidationResult', async () => {
    const mem = createMemory({ selfImprove: true });

    for (let i = 0; i < 5; i++) {
      await mem.remember(`consolidation test trace number ${i}`);
    }

    const result = await mem.consolidate();

    // The result should have the expected shape with numeric fields.
    expect(result).toBeDefined();
    expect(typeof result.pruned).toBe('number');
    expect(typeof result.merged).toBe('number');
    expect(typeof result.derived).toBe('number');
    expect(typeof result.compacted).toBe('number');
    expect(typeof result.durationMs).toBe('number');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  // -----------------------------------------------------------------------
  // 7b. consolidate throws when disabled
  // -----------------------------------------------------------------------
  it('should throw when consolidate is called with selfImprove disabled', async () => {
    const mem = createMemory({ selfImprove: false });

    await expect(mem.consolidate()).rejects.toThrow('self-improvement is disabled');
  });

  // -----------------------------------------------------------------------
  // 8. health
  // -----------------------------------------------------------------------
  it('should return correct health counts', async () => {
    const mem = createMemory();

    await mem.remember('health check trace A');
    await mem.remember('health check trace B');
    await mem.remember('health check trace C');

    const h = await mem.health();

    expect(h.totalTraces).toBe(3);
    expect(h.activeTraces).toBe(3);
    expect(h.avgStrength).toBeGreaterThan(0);
    expect(h.weakestTraceStrength).toBeGreaterThan(0);
    expect(typeof h.graphNodes).toBe('number');
    expect(typeof h.graphEdges).toBe('number');
    expect(h.tracesPerType).toBeDefined();
    expect(h.tracesPerScope).toBeDefined();
    expect(h.tracesPerScope['user']).toBe(3);
  });

  // -----------------------------------------------------------------------
  // 9. close
  // -----------------------------------------------------------------------
  it('should close without errors', async () => {
    const mem = createMemory();
    await mem.remember('close test trace');

    // close() should resolve without throwing.
    await expect(mem.close()).resolves.toBeUndefined();
  });

  // -----------------------------------------------------------------------
  // Bonus: feedback does not throw
  // -----------------------------------------------------------------------
  it('should record feedback without throwing', async () => {
    const mem = createMemory();
    const trace = await mem.remember('feedback test content');

    // feedback() is fire-and-forget -- should not throw.
    expect(() => mem.feedback(trace.id, 'used')).not.toThrow();
    expect(() => mem.feedback(trace.id, 'ignored')).not.toThrow();
  });

  // -----------------------------------------------------------------------
  // Bonus: addEntity and addRelation
  // -----------------------------------------------------------------------
  it('should add entities and relations to the knowledge graph', async () => {
    const mem = createMemory();

    const entity1 = await mem.addEntity({
      type: 'person',
      label: 'Alice',
      properties: { role: 'engineer' },
    });

    const entity2 = await mem.addEntity({
      type: 'organization',
      label: 'Acme Corp',
    });

    expect(entity1.id).toBeDefined();
    expect(entity1.label).toBe('Alice');
    expect(entity2.label).toBe('Acme Corp');

    const relation = await mem.addRelation({
      sourceId: entity1.id,
      targetId: entity2.id,
      type: 'related_to',
      label: 'works_at',
      weight: 0.9,
    });

    expect(relation.id).toBeDefined();
    expect(relation.sourceId).toBe(entity1.id);
    expect(relation.targetId).toBe(entity2.id);

    // Access graph directly.
    expect(mem.graph).toBeDefined();
  });
});
