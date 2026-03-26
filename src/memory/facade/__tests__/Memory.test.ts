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

import { describe, it, expect, afterEach, vi } from 'vitest';
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

  it('should deduplicate repeated remember() calls by content hash within the same type and scope', async () => {
    const mem = createMemory();

    const first = await mem.remember('The user prefers keyboard shortcuts.', {
      type: 'semantic',
      scope: 'user',
      scopeId: 'user-1',
      tags: ['preferences'],
    });
    const second = await mem.remember('The user prefers keyboard shortcuts.', {
      type: 'semantic',
      scope: 'user',
      scopeId: 'user-1',
      tags: ['duplicate-attempt'],
    });

    expect(second.id).toBe(first.id);

    const health = await mem.health();
    expect(health.totalTraces).toBe(1);
  });

  it('should allow the same content to exist in different scopes', async () => {
    const mem = createMemory();

    const userTrace = await mem.remember('The user prefers keyboard shortcuts.', {
      type: 'semantic',
      scope: 'user',
      scopeId: 'user-1',
    });
    const personaTrace = await mem.remember('The user prefers keyboard shortcuts.', {
      type: 'semantic',
      scope: 'persona',
      scopeId: 'user-1::designer',
    });

    expect(personaTrace.id).not.toBe(userTrace.id);

    const userResults = await mem.recall('keyboard shortcuts', {
      scope: 'user',
      scopeId: 'user-1',
    });
    const personaResults = await mem.recall('keyboard shortcuts', {
      scope: 'persona',
      scopeId: 'user-1::designer',
    });

    expect(userResults).toHaveLength(1);
    expect(personaResults).toHaveLength(1);

    const health = await mem.health();
    expect(health.totalTraces).toBe(2);
  });

  it('should update retrieval metadata on recall and support scopeId filtering', async () => {
    const mem = createMemory();

    await mem.remember('Scoped trace for user alpha', {
      scope: 'user',
      scopeId: 'user-alpha',
    });
    await mem.remember('Scoped trace for user beta', {
      scope: 'user',
      scopeId: 'user-beta',
    });

    const firstRecall = await mem.recall('user alpha', {
      scope: 'user',
      scopeId: 'user-alpha',
    });
    expect(firstRecall).toHaveLength(1);
    expect(firstRecall[0]?.trace.scopeId).toBe('user-alpha');
    expect(firstRecall[0]?.trace.retrievalCount).toBe(1);

    const secondRecall = await mem.recall('user alpha', {
      scope: 'user',
      scopeId: 'user-alpha',
    });
    expect(secondRecall[0]?.trace.retrievalCount).toBe(2);
  });

  it('should sanitize natural-language recall queries before hitting FTS5', async () => {
    const mem = createMemory();

    await mem.remember('User preference: command palettes and keyboard shortcuts.', {
      type: 'semantic',
      scope: 'user',
      scopeId: 'user-1',
    });

    const results = await mem.recall(
      'What are my command palette preferences?',
      {
        scope: 'user',
        scopeId: 'user-1',
      },
    );

    expect(results).toHaveLength(1);
    expect(results[0]?.trace.content).toContain('command palettes');
  });

  it('should persist decay state across Memory restarts', async () => {
    const dbPath = tempDb();
    const first = createMemory({ path: dbPath });

    await first.remember('Persistent stability test trace');

    const firstRecall = await first.recall('persistent stability');
    expect(firstRecall).toHaveLength(1);
    expect(firstRecall[0]!.trace.stability).toBeGreaterThan(86_400_000);

    await first.close();

    const second = new Memory({
      store: 'sqlite',
      path: dbPath,
      graph: true,
      selfImprove: true,
      decay: true,
    });
    openMemories.push(second);

    const secondRecall = await second.recall('persistent stability');
    expect(secondRecall).toHaveLength(1);
    expect(secondRecall[0]!.trace.retrievalCount).toBe(2);
    expect(secondRecall[0]!.trace.stability).toBeGreaterThan(firstRecall[0]!.trace.stability);
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

  it('should ingest a URL using UrlLoader', async () => {
    const mem = createMemory();
    const mockFetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Map([['content-type', 'text/html; charset=utf-8']]),
      text: async () => '<html><head><title>Remote Notes</title></head><body><p>Memory ingestion over HTTP.</p></body></html>',
      arrayBuffer: async () => new ArrayBuffer(0),
    }));

    const originalFetch = global.fetch;
    global.fetch = mockFetch as unknown as typeof fetch;

    try {
      const result = await mem.ingest('https://example.com/notes');

      expect(result.succeeded).toContain('https://example.com/notes');
      expect(result.failed).toHaveLength(0);
      expect(result.tracesCreated).toBeGreaterThanOrEqual(1);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('should deduplicate repeated document ingestion by document content hash', async () => {
    const mem = createMemory();
    const dir = tempDir();
    const filePath = path.join(dir, 'dedup.txt');
    await fsp.writeFile(filePath, 'Repeated document content for dedup test. '.repeat(20), 'utf8');

    const first = await mem.ingest(filePath);
    const second = await mem.ingest(filePath);

    expect(first.tracesCreated).toBeGreaterThan(0);
    expect(second.tracesCreated).toBe(0);
    expect(second.chunksCreated).toBe(0);

    const health = await mem.health();
    expect(health.documentsIngested).toBe(1);
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

    const recalled = await mem2.recall('sky blue');
    expect(recalled.some((entry) => entry.trace.content.includes('the sky is blue'))).toBe(true);
  });

  it('should import CSV via the Memory facade', async () => {
    const mem = createMemory();
    const dir = tempDir();
    const csvPath = path.join(dir, 'memories.csv');

    await fsp.writeFile(
      csvPath,
      [
        'content,type,scope',
        '"Imported CSV fact about butterflies",semantic,user',
        '"Imported CSV fact about alpacas",episodic,user',
      ].join('\n'),
      'utf8',
    );

    const result = await mem.importFrom(csvPath, { format: 'csv' });

    expect(result.errors).toHaveLength(0);
    expect(result.imported).toBe(2);

    const recalled = await mem.recall('butterflies');
    expect(recalled.some((entry) => entry.trace.content.includes('butterflies'))).toBe(true);
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

  it('should create runtime memory tools including memory_reflect when self-improvement is enabled', () => {
    const mem = createMemory({ selfImprove: true });

    const names = mem.createTools().map((tool) => tool.name);

    expect(names).toEqual([
      'memory_add',
      'memory_update',
      'memory_delete',
      'memory_merge',
      'memory_search',
      'memory_reflect',
    ]);
  });

  it('should omit memory_reflect from runtime tools when self-improvement is disabled', () => {
    const mem = createMemory({ selfImprove: false });

    const names = mem.createTools().map((tool) => tool.name);

    expect(names).toEqual([
      'memory_add',
      'memory_update',
      'memory_delete',
      'memory_merge',
      'memory_search',
    ]);
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

  it('should throw for unsupported non-sqlite stores', async () => {
    expect(() => new Memory({ store: 'memory' })).toThrow(/only the SQLite-backed facade/i);
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
