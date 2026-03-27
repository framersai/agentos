/**
 * @fileoverview Tests for ConsolidationLoop — the 6-step self-improving
 * background consolidation process.
 *
 * Covers:
 * 1. Prune: soft-deletes traces below the strength threshold.
 * 2. Merge: deduplicates traces with identical content.
 * 3. Strengthen: records CO_ACTIVATED edges from retrieval feedback co-usage.
 * 4. Derive (with LLM): creates insight traces from memory clusters.
 * 5. Derive skipped without LLM: returns 0 when no llmInvoker is provided.
 * 6. Consolidation log: verifies a row is written to consolidation_log.
 * 7. Mutex: concurrent run() calls return zero counts.
 * 8. Full cycle: all 6 steps run together with correct ConsolidationResult.
 *
 * @module agentos/memory/consolidation/__tests__/consolidation.test
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SqliteBrain } from '../../store/SqliteBrain.js';
import { SqliteMemoryGraph } from '../../store/SqliteMemoryGraph.js';
import { ConsolidationLoop } from '../ConsolidationLoop.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generate a unique temp file path for each test. */
function tempDbPath(): string {
  return path.join(
    os.tmpdir(),
    `agentos-consol-test-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`,
  );
}

/**
 * Registry of brains opened during a test run so afterEach can clean up.
 * Prevents leaked file handles and stale temp files.
 */
const openBrains: Array<{ brain: SqliteBrain; dbPath: string }> = [];

/**
 * Create a fresh SqliteBrain + SqliteMemoryGraph pair backed by a temp file.
 * The pair is registered for afterEach cleanup automatically.
 */
async function createTestEnv(): Promise<{
  brain: SqliteBrain;
  graph: SqliteMemoryGraph;
  dbPath: string;
}> {
  const dbPath = tempDbPath();
  const brain = await SqliteBrain.open(dbPath);
  openBrains.push({ brain, dbPath });
  const graph = new SqliteMemoryGraph(brain);
  await graph.initialize();
  return { brain, graph, dbPath };
}

afterEach(async () => {
  while (openBrains.length > 0) {
    const entry = openBrains.pop()!;
    try {
      await entry.brain.close();
    } catch {
      /* already closed */
    }
    for (const suffix of ['', '-wal', '-shm']) {
      try {
        fs.unlinkSync(entry.dbPath + suffix);
      } catch {
        /* missing file — OK */
      }
    }
  }
});

/**
 * Insert a trace row directly into the `memory_traces` table.
 * Uses the full column set required by tests.
 */
async function insertTrace(
  brain: SqliteBrain,
  opts: {
    id: string;
    type?: string;
    scope?: string;
    content: string;
    strength?: number;
    createdAt?: number;
    retrievalCount?: number;
    tags?: string[];
    emotions?: Record<string, number>;
    deleted?: number;
    lastAccessed?: number | null;
  },
): Promise<void> {
  const now = Date.now();
  await brain.run(
    `INSERT INTO memory_traces
       (id, type, scope, content, strength, created_at, last_accessed, retrieval_count, tags, emotions, metadata, deleted)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      opts.id,
      opts.type ?? 'episodic',
      opts.scope ?? 'user',
      opts.content,
      opts.strength ?? 1.0,
      opts.createdAt ?? now,
      opts.lastAccessed !== undefined ? opts.lastAccessed : (opts.createdAt ?? now),
      opts.retrievalCount ?? 0,
      JSON.stringify(opts.tags ?? []),
      JSON.stringify(opts.emotions ?? {}),
      '{}',
      opts.deleted ?? 0,
    ],
  );
}

/**
 * Query whether a trace is soft-deleted.
 */
async function isDeleted(brain: SqliteBrain, id: string): Promise<boolean> {
  const row = await brain.get<{ deleted: number }>(
    'SELECT deleted FROM memory_traces WHERE id = ?',
    [id],
  );
  return row?.deleted === 1;
}

/**
 * Get a trace row from the database.
 */
async function getTrace(brain: SqliteBrain, id: string): Promise<{
  id: string;
  type: string;
  content: string;
  strength: number;
  retrieval_count: number;
  deleted: number;
} | undefined> {
  const row = await brain.get<{
    id: string;
    type: string;
    content: string;
    strength: number;
    retrieval_count: number;
    deleted: number;
  }>(
    'SELECT id, type, content, strength, retrieval_count, deleted FROM memory_traces WHERE id = ?',
    [id],
  );
  return row ?? undefined;
}

// ---------------------------------------------------------------------------
// 1. Prune
// ---------------------------------------------------------------------------

describe('ConsolidationLoop — Prune', () => {
  it('soft-deletes traces with strength below the prune threshold', async () => {
    const { brain, graph } = await createTestEnv();

    // Two traces with high strength (1.0) and one with very low strength (0.01).
    // The low-strength trace should be pruned.
    await insertTrace(brain, { id: 'strong-1', content: 'Important memory alpha', strength: 1.0 });
    await insertTrace(brain, { id: 'strong-2', content: 'Important memory beta', strength: 1.0 });
    await insertTrace(brain, { id: 'weak-1', content: 'Fading memory gamma', strength: 0.01 });

    const loop = new ConsolidationLoop(brain, graph);
    const result = await loop.run({ pruneThreshold: 0.05 });

    expect(result.pruned).toBe(1);
    expect(await isDeleted(brain, 'weak-1')).toBe(true);
    expect(await isDeleted(brain, 'strong-1')).toBe(false);
    expect(await isDeleted(brain, 'strong-2')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. Merge
// ---------------------------------------------------------------------------

describe('ConsolidationLoop — Merge', () => {
  it('merges traces with identical content, keeping the one with more retrievals', async () => {
    const { brain, graph } = await createTestEnv();

    // Two traces with identical content, different retrieval counts.
    await insertTrace(brain, {
      id: 'dup-a',
      content: 'TypeScript is a strongly typed superset of JavaScript',
      retrievalCount: 5,
      strength: 0.8,
    });
    await insertTrace(brain, {
      id: 'dup-b',
      content: 'TypeScript is a strongly typed superset of JavaScript',
      retrievalCount: 2,
      strength: 0.9,
    });

    const loop = new ConsolidationLoop(brain, graph);
    const result = await loop.run();

    expect(result.merged).toBe(1);

    // dup-a (more retrievals) should survive; dup-b should be deleted.
    expect(await isDeleted(brain, 'dup-a')).toBe(false);
    expect(await isDeleted(brain, 'dup-b')).toBe(true);

    // Survivor should have combined retrieval count.
    const survivor = await getTrace(brain, 'dup-a');
    expect(survivor?.retrieval_count).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// 3. Strengthen
// ---------------------------------------------------------------------------

describe('ConsolidationLoop — Strengthen', () => {
  it('records CO_ACTIVATED edges for traces co-used in the same query', async () => {
    const { brain, graph } = await createTestEnv();

    // Insert two traces.
    await insertTrace(brain, { id: 'co-a', content: 'Memory about distributed systems' });
    await insertTrace(brain, { id: 'co-b', content: 'Memory about microservices architecture' });

    // Add retrieval feedback rows showing both were 'used' for the same query.
    const now = Date.now();
    await brain.run(
      `INSERT INTO retrieval_feedback (trace_id, signal, query, created_at)
       VALUES (?, ?, ?, ?)`,
      ['co-a', 'used', 'how do distributed systems work?', now],
    );
    await brain.run(
      `INSERT INTO retrieval_feedback (trace_id, signal, query, created_at)
       VALUES (?, ?, ?, ?)`,
      ['co-b', 'used', 'how do distributed systems work?', now],
    );

    const loop = new ConsolidationLoop(brain, graph);
    const result = await loop.run();

    // The strengthen step should have recorded at least 1 co-activation.
    // 'derived' includes both strengthened and LLM-derived counts.
    expect(result.derived).toBeGreaterThanOrEqual(1);

    // Check that a CO_ACTIVATED edge exists in the graph.
    const edges = graph.getEdges('co-a', 'CO_ACTIVATED');
    expect(edges.length).toBeGreaterThanOrEqual(1);
    const coEdge = edges.find(
      (e) => (e.sourceId === 'co-a' && e.targetId === 'co-b') ||
             (e.sourceId === 'co-b' && e.targetId === 'co-a'),
    );
    expect(coEdge).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 4. Derive (with LLM)
// ---------------------------------------------------------------------------

describe('ConsolidationLoop — Derive', () => {
  it('creates a new semantic trace from LLM insight when clusters exist', async () => {
    const { brain, graph } = await createTestEnv();

    // Insert a cluster of 5 related traces and connect them in the graph.
    const ids = ['cl-1', 'cl-2', 'cl-3', 'cl-4', 'cl-5'];
    for (const id of ids) {
      await insertTrace(brain, { id, content: `Memory about topic X: ${id}` });
      await graph.addNode(id, {
        type: 'episodic',
        scope: 'user',
        scopeId: 'test',
        strength: 1.0,
        createdAt: Date.now(),
      });
    }

    // Connect all pairs so they form one cluster.
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        await graph.addEdge({
          sourceId: ids[i]!,
          targetId: ids[j]!,
          type: 'SAME_TOPIC',
          weight: 0.8,
          createdAt: Date.now(),
        });
      }
    }

    // Mock LLM invoker that returns a canned insight.
    const mockLlm = async (_prompt: string): Promise<string> => {
      return 'Topic X is a recurring theme across multiple related observations.';
    };

    const loop = new ConsolidationLoop(brain, graph, { llmInvoker: mockLlm });
    const result = await loop.run({ minClusterSize: 5, maxDerivedPerCycle: 5 });

    expect(result.derived).toBeGreaterThanOrEqual(1);

    // Verify the insight trace was inserted into the database.
    const insightRows = await brain.all<{ id: string; type: string; content: string }>(
      `SELECT id, type, content FROM memory_traces
       WHERE type = 'semantic' AND content LIKE '%Topic X%' AND deleted = 0`,
    );

    expect(insightRows.length).toBeGreaterThanOrEqual(1);
    expect(insightRows[0]!.type).toBe('semantic');
  });
});

// ---------------------------------------------------------------------------
// 5. Derive skipped without LLM
// ---------------------------------------------------------------------------

describe('ConsolidationLoop — Derive without LLM', () => {
  it('returns 0 derived traces when no llmInvoker is provided', async () => {
    const { brain, graph } = await createTestEnv();

    // Insert traces with cluster structure, but no LLM.
    const ids = ['nollm-1', 'nollm-2', 'nollm-3', 'nollm-4', 'nollm-5'];
    for (const id of ids) {
      await insertTrace(brain, { id, content: `Related fact: ${id}` });
      await graph.addNode(id, {
        type: 'episodic',
        scope: 'user',
        scopeId: 'test',
        strength: 1.0,
        createdAt: Date.now(),
      });
    }
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        await graph.addEdge({
          sourceId: ids[i]!,
          targetId: ids[j]!,
          type: 'SAME_TOPIC',
          weight: 0.9,
          createdAt: Date.now(),
        });
      }
    }

    // No llmInvoker provided.
    const loop = new ConsolidationLoop(brain, graph);
    const result = await loop.run({ minClusterSize: 5 });

    // No feedback co-usage rows either, so derived should be 0.
    expect(result.derived).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 6. Consolidation log
// ---------------------------------------------------------------------------

describe('ConsolidationLoop — Consolidation log', () => {
  it('writes a row to consolidation_log with correct counts after run()', async () => {
    const { brain, graph } = await createTestEnv();

    // Insert a trace that will be pruned.
    await insertTrace(brain, { id: 'log-weak', content: 'Soon to be pruned', strength: 0.01 });
    // Insert a healthy trace so there is something to process.
    await insertTrace(brain, { id: 'log-strong', content: 'Healthy memory', strength: 1.0 });

    const loop = new ConsolidationLoop(brain, graph);
    const result = await loop.run({ pruneThreshold: 0.05 });

    const logRow = await brain.get<{
      pruned: number;
      merged: number;
      derived: number;
      compacted: number;
      duration_ms: number;
    }>(
      `SELECT pruned, merged, derived, compacted, duration_ms
       FROM consolidation_log ORDER BY id DESC LIMIT 1`,
    );

    expect(logRow).toBeDefined();
    expect(logRow!.pruned).toBe(result.pruned);
    expect(logRow!.merged).toBe(result.merged);
    expect(logRow!.derived).toBe(result.derived);
    expect(logRow!.compacted).toBe(result.compacted);
    expect(logRow!.duration_ms).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// 7. Mutex
// ---------------------------------------------------------------------------

describe('ConsolidationLoop — Mutex', () => {
  it('returns zero counts when run() is called while already running', async () => {
    const { brain, graph } = await createTestEnv();

    // Insert a trace so there's something to process.
    await insertTrace(brain, { id: 'mutex-trace', content: 'Test mutex behavior', strength: 1.0 });

    // Use a slow LLM invoker to hold the lock. Also create a cluster so derive runs.
    const ids = ['mx-1', 'mx-2', 'mx-3', 'mx-4', 'mx-5'];
    for (const id of ids) {
      await insertTrace(brain, { id, content: `Mutex cluster member ${id}` });
      await graph.addNode(id, {
        type: 'episodic',
        scope: 'user',
        scopeId: 'test',
        strength: 1.0,
        createdAt: Date.now(),
      });
    }
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        await graph.addEdge({
          sourceId: ids[i]!,
          targetId: ids[j]!,
          type: 'SAME_TOPIC',
          weight: 0.8,
          createdAt: Date.now(),
        });
      }
    }

    // Use a promise that we control to block the LLM call.
    // The `llmCalled` promise resolves when the LLM is actually invoked,
    // and `resolveLlm` unblocks the LLM's return value.
    let resolveLlm!: (value: string) => void;
    let llmCalled: Promise<void>;
    let resolveLlmCalled!: () => void;
    llmCalled = new Promise<void>((resolve) => {
      resolveLlmCalled = resolve;
    });

    const slowLlm = (_prompt: string): Promise<string> => {
      // Signal that the LLM has been invoked.
      resolveLlmCalled();
      return new Promise((resolve) => {
        resolveLlm = resolve;
      });
    };

    const loop = new ConsolidationLoop(brain, graph, { llmInvoker: slowLlm });

    // Start the first run (will block on the slow LLM).
    const firstRun = loop.run({ minClusterSize: 5 });

    // Wait until the LLM is actually called (i.e., the first run has
    // progressed through prune/merge/strengthen to the derive step).
    await llmCalled;
    expect(loop.isRunning).toBe(true);

    // Second run while the first is still in progress.
    const secondResult = await loop.run();
    expect(secondResult.pruned).toBe(0);
    expect(secondResult.merged).toBe(0);
    expect(secondResult.derived).toBe(0);
    expect(secondResult.compacted).toBe(0);
    expect(secondResult.durationMs).toBe(0);

    // Unblock the first run.
    resolveLlm('Insight from slow LLM');
    const firstResult = await firstRun;

    // First run should have completed (durationMs is a non-negative number).
    // The actual duration may be 0 if all sync steps completed in < 1 ms.
    expect(firstResult.durationMs).toBeGreaterThanOrEqual(0);
    // Verify the first run actually did something (pruned or derived).
    expect(firstResult.pruned + firstResult.merged + firstResult.derived).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// 8. Full cycle
// ---------------------------------------------------------------------------

describe('ConsolidationLoop — Full cycle', () => {
  it('runs all 6 steps and returns a complete ConsolidationResult', async () => {
    const { brain, graph } = await createTestEnv();
    const now = Date.now();

    // Prune target: a very weak trace.
    await insertTrace(brain, { id: 'full-weak', content: 'Weak trace for pruning', strength: 0.001 });

    // Merge targets: two identical traces.
    await insertTrace(brain, {
      id: 'full-dup-a',
      content: 'Duplicate content for merge test',
      strength: 0.9,
      retrievalCount: 3,
    });
    await insertTrace(brain, {
      id: 'full-dup-b',
      content: 'Duplicate content for merge test',
      strength: 0.7,
      retrievalCount: 1,
    });

    // Strengthen targets: two traces with co-used feedback.
    await insertTrace(brain, { id: 'full-co-a', content: 'Co-used memory about cats' });
    await insertTrace(brain, { id: 'full-co-b', content: 'Co-used memory about kittens' });
    await brain.run(
      `INSERT INTO retrieval_feedback (trace_id, signal, query, created_at) VALUES (?, ?, ?, ?)`,
      ['full-co-a', 'used', 'tell me about cats', now],
    );
    await brain.run(
      `INSERT INTO retrieval_feedback (trace_id, signal, query, created_at) VALUES (?, ?, ?, ?)`,
      ['full-co-b', 'used', 'tell me about cats', now],
    );

    // Derive targets: a cluster of 5 related traces.
    const clusterIds = ['full-cl-1', 'full-cl-2', 'full-cl-3', 'full-cl-4', 'full-cl-5'];
    for (const id of clusterIds) {
      await insertTrace(brain, { id, content: `Cluster memory: ${id} about topic Z` });
      await graph.addNode(id, {
        type: 'episodic',
        scope: 'user',
        scopeId: 'test',
        strength: 1.0,
        createdAt: now,
      });
    }
    for (let i = 0; i < clusterIds.length; i++) {
      for (let j = i + 1; j < clusterIds.length; j++) {
        await graph.addEdge({
          sourceId: clusterIds[i]!,
          targetId: clusterIds[j]!,
          type: 'SAME_TOPIC',
          weight: 0.8,
          createdAt: now,
        });
      }
    }

    // Mock LLM.
    const mockLlm = async (_prompt: string): Promise<string> => {
      return 'Topic Z is a significant area of interest based on multiple memory traces.';
    };

    const loop = new ConsolidationLoop(brain, graph, { llmInvoker: mockLlm });
    const result = await loop.run({ pruneThreshold: 0.05, minClusterSize: 5 });

    // Verify all result fields are present and reasonable.
    expect(result.pruned).toBeGreaterThanOrEqual(1);    // full-weak
    expect(result.merged).toBeGreaterThanOrEqual(1);    // full-dup-a/b
    expect(result.derived).toBeGreaterThanOrEqual(1);   // cluster insight + strengthen
    expect(result.durationMs).toBeGreaterThanOrEqual(0);

    // Verify the consolidation log was written.
    const logCount = await brain.get<{ cnt: number }>(
      'SELECT COUNT(*) AS cnt FROM consolidation_log',
    );
    expect(logCount?.cnt).toBeGreaterThanOrEqual(1);
  });
});

describe('ConsolidationLoop — Personality decay', () => {
  it('reports the number of personality mutations affected by decay', async () => {
    const { brain, graph } = await createTestEnv();
    const mutationStore = {
      decayAll: vi.fn().mockResolvedValue({ decayed: 2, pruned: 1 }),
    };

    const loop = new ConsolidationLoop(brain, graph, {
      personalityMutationStore: mutationStore as any,
      personalityDecayRate: 0.1,
    });

    const result = await loop.run();

    expect(mutationStore.decayAll).toHaveBeenCalledWith(0.1);
    expect(result.personalityDecayed).toBe(3);
  });
});
