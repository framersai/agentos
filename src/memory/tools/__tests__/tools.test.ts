/**
 * @fileoverview Integration tests for the 6 agent memory editor tools.
 *
 * Each test uses a real {@link SqliteBrain} backed by a temp SQLite file
 * so that all SQL interactions are exercised end-to-end. The
 * {@link ConsolidationLoop} is mocked for {@link MemoryReflectTool} tests
 * to avoid pulling in the full graphology dependency tree.
 *
 * Test coverage:
 * 1. MemoryAddTool     — add a trace, verify it exists in DB
 * 2. MemoryUpdateTool  — add then update content, verify content changed
 * 3. MemoryDeleteTool  — add then delete, verify deleted = 1
 * 4. MemoryMergeTool   — add 3 traces, merge 2, verify survivor has merged content
 * 5. MemorySearchTool  — add traces with different topics, search, verify relevant results
 * 6. MemoryReflectTool — mock ConsolidationLoop.run(), verify it is called
 *
 * @module memory/tools/__tests__/tools.test
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { SqliteBrain } from '../../store/SqliteBrain.js';
import { ConsolidationLoop } from '../../consolidation/ConsolidationLoop.js';

import { MemoryAddTool } from '../MemoryAddTool.js';
import { MemoryUpdateTool } from '../MemoryUpdateTool.js';
import { MemoryDeleteTool } from '../MemoryDeleteTool.js';
import { MemoryMergeTool } from '../MemoryMergeTool.js';
import { MemorySearchTool } from '../MemorySearchTool.js';
import { MemoryReflectTool } from '../MemoryReflectTool.js';

import type { ToolExecutionContext } from '../../../core/tools/ITool.js';
import type { ConsolidationResult } from '../../facade/types.js';

// ---------------------------------------------------------------------------
// Test infrastructure
// ---------------------------------------------------------------------------

/** Registered temp DB paths cleaned up after each test. */
const cleanupPaths: string[] = [];

/** All SqliteBrain instances opened during the test run. */
const openBrains: SqliteBrain[] = [];

/**
 * Return a unique temp `.sqlite` path (file not yet created).
 */
function tempDbPath(): string {
  const p = path.join(
    os.tmpdir(),
    `agentos-tools-test-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`,
  );
  cleanupPaths.push(p);
  return p;
}

/**
 * Open a fresh {@link SqliteBrain} backed by a temp file and register it
 * for cleanup after the test.
 */
function openBrain(): SqliteBrain {
  const brain = new SqliteBrain(tempDbPath());
  openBrains.push(brain);
  return brain;
}

/**
 * Minimal {@link ToolExecutionContext} for tests.
 * All three required fields are populated; optional fields are omitted.
 */
const testContext: ToolExecutionContext = {
  gmiId: 'test-gmi',
  personaId: 'test-persona',
  userContext: {} as any,
};

afterEach(() => {
  // Close all open brain connections.
  while (openBrains.length > 0) {
    const b = openBrains.pop()!;
    try { b.close(); } catch { /* already closed */ }
  }

  // Remove temp SQLite files (including WAL + SHM sidecar files).
  while (cleanupPaths.length > 0) {
    const p = cleanupPaths.pop()!;
    for (const suffix of ['', '-wal', '-shm']) {
      const f = p + suffix;
      try {
        if (fs.existsSync(f)) fs.unlinkSync(f);
      } catch { /* best-effort */ }
    }
  }
});

// ---------------------------------------------------------------------------
// 1. MemoryAddTool
// ---------------------------------------------------------------------------

describe('MemoryAddTool', () => {
  it('inserts a trace and returns a traceId', async () => {
    const brain = openBrain();
    const tool = new MemoryAddTool(brain);

    const result = await tool.execute(
      { content: 'The user prefers dark mode.', tags: ['preference', 'ui'] },
      testContext,
    );

    expect(result.success).toBe(true);
    expect(result.output?.traceId).toBeDefined();
    expect(result.output?.traceId).toMatch(/^mt_\d+_\d+$/);

    // Verify the row exists in the database.
    const row = brain.db
      .prepare<[string], { content: string; type: string; scope: string; deleted: number; tags: string }>(
        'SELECT content, type, scope, deleted, tags FROM memory_traces WHERE id = ?',
      )
      .get(result.output!.traceId);

    expect(row).toBeDefined();
    expect(row!.content).toBe('The user prefers dark mode.');
    expect(row!.type).toBe('episodic'); // default
    expect(row!.scope).toBe('user');    // default
    expect(row!.deleted).toBe(0);
    expect(JSON.parse(row!.tags)).toEqual(['preference', 'ui']);
  });

  it('respects explicit type and scope arguments', async () => {
    const brain = openBrain();
    const tool = new MemoryAddTool(brain);

    const result = await tool.execute(
      { content: 'Agent boot procedure.', type: 'procedural', scope: 'persona' },
      testContext,
    );

    expect(result.success).toBe(true);

    const row = brain.db
      .prepare<[string], { type: string; scope: string }>(
        'SELECT type, scope FROM memory_traces WHERE id = ?',
      )
      .get(result.output!.traceId);

    expect(row!.type).toBe('procedural');
    expect(row!.scope).toBe('persona');
  });

  it('generates unique IDs for rapid sequential inserts', async () => {
    const brain = openBrain();
    const tool = new MemoryAddTool(brain);

    const [r1, r2, r3] = await Promise.all([
      tool.execute({ content: 'Trace A' }, testContext),
      tool.execute({ content: 'Trace B' }, testContext),
      tool.execute({ content: 'Trace C' }, testContext),
    ]);

    const ids = [r1.output?.traceId, r2.output?.traceId, r3.output?.traceId];
    const unique = new Set(ids);
    expect(unique.size).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// 2. MemoryUpdateTool
// ---------------------------------------------------------------------------

describe('MemoryUpdateTool', () => {
  it('updates the content of an existing trace and clears the embedding', async () => {
    const brain = openBrain();
    const addTool = new MemoryAddTool(brain);
    const updateTool = new MemoryUpdateTool(brain);

    // Seed a trace with a fake embedding blob.
    const { output: added } = await addTool.execute(
      { content: 'Original content.' },
      testContext,
    );
    const traceId = added!.traceId;

    // Manually plant a fake embedding so we can confirm it gets cleared.
    brain.db
      .prepare('UPDATE memory_traces SET embedding = ? WHERE id = ?')
      .run(Buffer.alloc(8, 0x01), traceId);

    // Perform the update.
    const result = await updateTool.execute(
      { traceId, content: 'Updated content after reflection.' },
      testContext,
    );

    expect(result.success).toBe(true);
    expect(result.output?.updated).toBe(true);

    // Verify content changed and embedding was cleared.
    const row = brain.db
      .prepare<[string], { content: string; embedding: Buffer | null }>(
        'SELECT content, embedding FROM memory_traces WHERE id = ?',
      )
      .get(traceId);

    expect(row!.content).toBe('Updated content after reflection.');
    expect(row!.embedding).toBeNull();
  });

  it('updates tags without touching content', async () => {
    const brain = openBrain();
    const addTool = new MemoryAddTool(brain);
    const updateTool = new MemoryUpdateTool(brain);

    const { output: added } = await addTool.execute(
      { content: 'Stable content.', tags: ['original'] },
      testContext,
    );
    const traceId = added!.traceId;

    const result = await updateTool.execute(
      { traceId, tags: ['new-tag', 'another'] },
      testContext,
    );

    expect(result.success).toBe(true);
    expect(result.output?.updated).toBe(true);

    const row = brain.db
      .prepare<[string], { content: string; tags: string }>(
        'SELECT content, tags FROM memory_traces WHERE id = ?',
      )
      .get(traceId);

    // Content should be unchanged.
    expect(row!.content).toBe('Stable content.');
    // Tags should be replaced.
    expect(JSON.parse(row!.tags)).toEqual(['new-tag', 'another']);
  });

  it('returns updated=false for a non-existent trace', async () => {
    const brain = openBrain();
    const updateTool = new MemoryUpdateTool(brain);

    const result = await updateTool.execute(
      { traceId: 'mt_does_not_exist', content: 'New content' },
      testContext,
    );

    expect(result.success).toBe(true);
    expect(result.output?.updated).toBe(false);
  });

  it('returns updated=false when neither content nor tags is provided', async () => {
    const brain = openBrain();
    const addTool = new MemoryAddTool(brain);
    const updateTool = new MemoryUpdateTool(brain);

    const { output: added } = await addTool.execute({ content: 'Some trace.' }, testContext);

    const result = await updateTool.execute(
      { traceId: added!.traceId },
      testContext,
    );

    expect(result.success).toBe(true);
    expect(result.output?.updated).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. MemoryDeleteTool
// ---------------------------------------------------------------------------

describe('MemoryDeleteTool', () => {
  it('soft-deletes an existing trace (deleted = 1)', async () => {
    const brain = openBrain();
    const addTool = new MemoryAddTool(brain);
    const deleteTool = new MemoryDeleteTool(brain);

    const { output: added } = await addTool.execute(
      { content: 'Trace to delete.' },
      testContext,
    );
    const traceId = added!.traceId;

    const result = await deleteTool.execute(
      { traceId, reason: 'Test cleanup.' },
      testContext,
    );

    expect(result.success).toBe(true);
    expect(result.output?.deleted).toBe(true);

    // Verify the row still exists but is flagged as deleted.
    const row = brain.db
      .prepare<[string], { deleted: number }>(
        'SELECT deleted FROM memory_traces WHERE id = ?',
      )
      .get(traceId);

    expect(row).toBeDefined();
    expect(row!.deleted).toBe(1);
  });

  it('returns deleted=false for a non-existent trace', async () => {
    const brain = openBrain();
    const deleteTool = new MemoryDeleteTool(brain);

    const result = await deleteTool.execute(
      { traceId: 'mt_nonexistent_999' },
      testContext,
    );

    expect(result.success).toBe(true);
    expect(result.output?.deleted).toBe(false);
  });

  it('returns deleted=false when called twice on the same trace', async () => {
    const brain = openBrain();
    const addTool = new MemoryAddTool(brain);
    const deleteTool = new MemoryDeleteTool(brain);

    const { output: added } = await addTool.execute({ content: 'Trace.' }, testContext);
    const traceId = added!.traceId;

    const first = await deleteTool.execute({ traceId }, testContext);
    expect(first.output?.deleted).toBe(true);

    const second = await deleteTool.execute({ traceId }, testContext);
    expect(second.output?.deleted).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. MemoryMergeTool
// ---------------------------------------------------------------------------

describe('MemoryMergeTool', () => {
  it('merges 2 traces — survivor has merged content, other is soft-deleted', async () => {
    const brain = openBrain();
    const addTool = new MemoryAddTool(brain);
    const mergeTool = new MemoryMergeTool(brain);

    const { output: a } = await addTool.execute({ content: 'Fact A.' }, testContext);
    const { output: b } = await addTool.execute({ content: 'Fact B.' }, testContext);

    // Boost retrieval_count on trace B so it becomes the survivor.
    brain.db
      .prepare('UPDATE memory_traces SET retrieval_count = 5 WHERE id = ?')
      .run(b!.traceId);

    const result = await mergeTool.execute(
      {
        traceIds: [a!.traceId, b!.traceId],
        mergedContent: 'Combined fact A and B.',
      },
      testContext,
    );

    expect(result.success).toBe(true);
    expect(result.output?.survivorId).toBe(b!.traceId);
    expect(result.output?.deletedIds).toContain(a!.traceId);

    // Survivor has merged content.
    const survivor = brain.db
      .prepare<[string], { content: string; deleted: number }>(
        'SELECT content, deleted FROM memory_traces WHERE id = ?',
      )
      .get(b!.traceId);
    expect(survivor!.content).toBe('Combined fact A and B.');
    expect(survivor!.deleted).toBe(0);

    // Loser is soft-deleted.
    const loser = brain.db
      .prepare<[string], { deleted: number }>(
        'SELECT deleted FROM memory_traces WHERE id = ?',
      )
      .get(a!.traceId);
    expect(loser!.deleted).toBe(1);
  });

  it('concatenates contents when mergedContent is omitted', async () => {
    const brain = openBrain();
    const addTool = new MemoryAddTool(brain);
    const mergeTool = new MemoryMergeTool(brain);

    const { output: a } = await addTool.execute({ content: 'Alpha' }, testContext);
    const { output: b } = await addTool.execute({ content: 'Beta' }, testContext);

    // Give A higher retrieval count so it is the survivor.
    brain.db
      .prepare('UPDATE memory_traces SET retrieval_count = 10 WHERE id = ?')
      .run(a!.traceId);

    const result = await mergeTool.execute(
      { traceIds: [a!.traceId, b!.traceId] },
      testContext,
    );

    expect(result.success).toBe(true);
    expect(result.output?.survivorId).toBe(a!.traceId);

    const survivor = brain.db
      .prepare<[string], { content: string }>(
        'SELECT content FROM memory_traces WHERE id = ?',
      )
      .get(a!.traceId);
    // Content should be "Alpha | Beta" (survivor first, then loser).
    expect(survivor!.content).toContain('Alpha');
    expect(survivor!.content).toContain('Beta');
    expect(survivor!.content).toContain('|');
  });

  it('unions tags from all merged traces', async () => {
    const brain = openBrain();
    const addTool = new MemoryAddTool(brain);
    const mergeTool = new MemoryMergeTool(brain);

    const { output: a } = await addTool.execute(
      { content: 'Trace A', tags: ['tag-a', 'shared'] },
      testContext,
    );
    const { output: b } = await addTool.execute(
      { content: 'Trace B', tags: ['tag-b', 'shared'] },
      testContext,
    );

    await mergeTool.execute(
      { traceIds: [a!.traceId, b!.traceId] },
      testContext,
    );

    // Determine which trace survived (higher retrieval_count; both start at 0, so first wins).
    const survivor = brain.db
      .prepare<[], { tags: string }>(
        'SELECT tags FROM memory_traces WHERE deleted = 0 AND id IN (?, ?)',
      )
      .get(a!.traceId, b!.traceId);

    const tags = JSON.parse(survivor!.tags) as string[];
    expect(tags).toContain('tag-a');
    expect(tags).toContain('tag-b');
    expect(tags).toContain('shared');
    // Deduplicated — 'shared' appears only once.
    expect(tags.filter((t) => t === 'shared')).toHaveLength(1);
  });

  it('returns error when fewer than 2 trace IDs are provided', async () => {
    const brain = openBrain();
    const mergeTool = new MemoryMergeTool(brain);

    const result = await mergeTool.execute(
      { traceIds: ['mt_only_one'] },
      testContext,
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/at least 2/);
  });

  it('returns error when fewer than 2 active traces are found', async () => {
    const brain = openBrain();
    const addTool = new MemoryAddTool(brain);
    const deleteTool = new MemoryDeleteTool(brain);
    const mergeTool = new MemoryMergeTool(brain);

    const { output: a } = await addTool.execute({ content: 'A' }, testContext);
    const { output: b } = await addTool.execute({ content: 'B' }, testContext);

    // Delete trace B so only 1 active trace remains.
    await deleteTool.execute({ traceId: b!.traceId }, testContext);

    const result = await mergeTool.execute(
      { traceIds: [a!.traceId, b!.traceId] },
      testContext,
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Found only 1/);
  });
});

// ---------------------------------------------------------------------------
// 5. MemorySearchTool
// ---------------------------------------------------------------------------

describe('MemorySearchTool', () => {
  it('returns traces matching the query', async () => {
    const brain = openBrain();
    const addTool = new MemoryAddTool(brain);
    const searchTool = new MemorySearchTool(brain);

    const { output: r1 } = await addTool.execute(
      { content: 'TypeScript generics allow reusable type-safe code.' },
      testContext,
    );
    const { output: r2 } = await addTool.execute(
      { content: 'Python list comprehensions are concise.' },
      testContext,
    );

    // Rebuild FTS index after inserts (required for external-content FTS5).
    brain.db.exec(`INSERT INTO memory_traces_fts(memory_traces_fts) VALUES('rebuild')`);

    const result = await searchTool.execute(
      { query: 'TypeScript generics' },
      testContext,
    );

    expect(result.success).toBe(true);
    expect(result.output?.results).toBeDefined();

    const ids = result.output!.results.map((r) => r.id);
    expect(ids).toContain(r1!.traceId);
    // Python trace should not appear in TypeScript search.
    expect(ids).not.toContain(r2!.traceId);
  });

  it('filters results by type', async () => {
    const brain = openBrain();
    const addTool = new MemoryAddTool(brain);
    const searchTool = new MemorySearchTool(brain);

    await addTool.execute(
      { content: 'Database indexing improves query performance.', type: 'semantic' },
      testContext,
    );
    await addTool.execute(
      { content: 'I queried the database today.', type: 'episodic' },
      testContext,
    );

    brain.db.exec(`INSERT INTO memory_traces_fts(memory_traces_fts) VALUES('rebuild')`);

    const result = await searchTool.execute(
      { query: 'database', type: 'semantic' },
      testContext,
    );

    expect(result.success).toBe(true);
    for (const r of result.output!.results) {
      expect(r.type).toBe('semantic');
    }
  });

  it('filters results by scope', async () => {
    const brain = openBrain();
    const addTool = new MemoryAddTool(brain);
    const searchTool = new MemorySearchTool(brain);

    await addTool.execute(
      { content: 'Agent decision: deploy to production.', scope: 'persona' },
      testContext,
    );
    await addTool.execute(
      { content: 'User requested a production build.', scope: 'user' },
      testContext,
    );

    brain.db.exec(`INSERT INTO memory_traces_fts(memory_traces_fts) VALUES('rebuild')`);

    const result = await searchTool.execute(
      { query: 'production', scope: 'persona' },
      testContext,
    );

    expect(result.success).toBe(true);
    for (const r of result.output!.results) {
      expect(r.scope).toBe('persona');
    }
  });

  it('respects the limit argument', async () => {
    const brain = openBrain();
    const addTool = new MemoryAddTool(brain);
    const searchTool = new MemorySearchTool(brain);

    for (let i = 0; i < 5; i++) {
      await addTool.execute(
        { content: `Memory about elephants — item ${i}.` },
        testContext,
      );
    }

    brain.db.exec(`INSERT INTO memory_traces_fts(memory_traces_fts) VALUES('rebuild')`);

    const result = await searchTool.execute(
      { query: 'elephants', limit: 2 },
      testContext,
    );

    expect(result.success).toBe(true);
    expect(result.output!.results.length).toBeLessThanOrEqual(2);
  });

  it('returns empty results for a query with no matches', async () => {
    const brain = openBrain();
    const searchTool = new MemorySearchTool(brain);

    brain.db.exec(`INSERT INTO memory_traces_fts(memory_traces_fts) VALUES('rebuild')`);

    const result = await searchTool.execute(
      { query: 'xylophone_unique_term_that_never_appears' },
      testContext,
    );

    expect(result.success).toBe(true);
    expect(result.output!.results).toHaveLength(0);
  });

  it('excludes soft-deleted traces from results', async () => {
    const brain = openBrain();
    const addTool = new MemoryAddTool(brain);
    const deleteTool = new MemoryDeleteTool(brain);
    const searchTool = new MemorySearchTool(brain);

    const { output: added } = await addTool.execute(
      { content: 'This trace will be deleted.' },
      testContext,
    );
    await deleteTool.execute({ traceId: added!.traceId }, testContext);

    brain.db.exec(`INSERT INTO memory_traces_fts(memory_traces_fts) VALUES('rebuild')`);

    const result = await searchTool.execute(
      { query: 'deleted' },
      testContext,
    );

    expect(result.success).toBe(true);
    const ids = result.output!.results.map((r) => r.id);
    expect(ids).not.toContain(added!.traceId);
  });
});

// ---------------------------------------------------------------------------
// 6. MemoryReflectTool
// ---------------------------------------------------------------------------

describe('MemoryReflectTool', () => {
  it('calls ConsolidationLoop.run() and returns the result', async () => {
    const brain = openBrain();

    // Mock ConsolidationLoop — only `run()` is needed.
    const mockResult: ConsolidationResult = {
      pruned: 3,
      merged: 1,
      derived: 2,
      compacted: 0,
      durationMs: 42,
    };

    const mockLoop = {
      run: vi.fn().mockResolvedValue(mockResult),
      isRunning: false,
    } as unknown as ConsolidationLoop;

    const tool = new MemoryReflectTool(brain, mockLoop);
    const result = await tool.execute({}, testContext);

    expect(result.success).toBe(true);
    expect(result.output).toEqual(mockResult);
    expect(mockLoop.run).toHaveBeenCalledOnce();
  });

  it('passes an optional topic argument (currently reserved — run() is still called)', async () => {
    const brain = openBrain();

    const mockLoop = {
      run: vi.fn().mockResolvedValue({
        pruned: 0,
        merged: 0,
        derived: 0,
        compacted: 0,
        durationMs: 1,
      }),
      isRunning: false,
    } as unknown as ConsolidationLoop;

    const tool = new MemoryReflectTool(brain, mockLoop);
    const result = await tool.execute({ topic: 'TypeScript' }, testContext);

    expect(result.success).toBe(true);
    expect(mockLoop.run).toHaveBeenCalledOnce();
  });

  it('returns an error result when ConsolidationLoop.run() throws', async () => {
    const brain = openBrain();

    const mockLoop = {
      run: vi.fn().mockRejectedValue(new Error('Consolidation exploded')),
      isRunning: false,
    } as unknown as ConsolidationLoop;

    const tool = new MemoryReflectTool(brain, mockLoop);
    const result = await tool.execute({}, testContext);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Consolidation exploded');
  });

  it('surfaces zero-count result when loop is already running (mutex guard)', async () => {
    const brain = openBrain();

    // Simulate the mutex guard: run() returns zeros immediately.
    const mockLoop = {
      run: vi.fn().mockResolvedValue({
        pruned: 0,
        merged: 0,
        derived: 0,
        compacted: 0,
        durationMs: 0,
      }),
      isRunning: true,
    } as unknown as ConsolidationLoop;

    const tool = new MemoryReflectTool(brain, mockLoop);
    const result = await tool.execute({}, testContext);

    expect(result.success).toBe(true);
    expect(result.output).toMatchObject({
      pruned: 0,
      merged: 0,
      derived: 0,
      compacted: 0,
      durationMs: 0,
    });
  });
});
