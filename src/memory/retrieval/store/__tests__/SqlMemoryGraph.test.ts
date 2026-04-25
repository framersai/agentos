/**
 * @fileoverview Tests for SqlMemoryGraph — IMemoryGraph backed by SQLite.
 *
 * Covers:
 * - Node CRUD (addNode, hasNode, removeNode)
 * - Edge CRUD (addEdge, getEdges by type, removeEdge)
 * - Spreading activation: decay across hops
 * - Hebbian co-activation: CO_ACTIVATED edge creation and weight growth
 * - Conflict detection: getConflicts returns only CONTRADICTS edges
 * - Cluster detection: Union-Find connected components
 * - nodeCount / edgeCount counters
 * - clear: wipes all nodes and edges
 *
 * @module memory/store/__tests__/SqlMemoryGraph.test
 */

import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Brain } from '../Brain.js';
import { SqlMemoryGraph } from '../SqlMemoryGraph.js';
import type { MemoryGraphNodeMeta } from '../../../retrieval/graph/IMemoryGraph.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generate a unique temp file path for each test. */
function tempDbPath(): string {
  return path.join(
    os.tmpdir(),
    `agentos-test-mg-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`,
  );
}

/** Build a minimal MemoryGraphNodeMeta for a given type. */
function nodeMeta(type = 'episodic'): MemoryGraphNodeMeta {
  return {
    type,
    scope: 'session',
    scopeId: 'test-session',
    strength: 1.0,
    createdAt: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Test-state tracking — cleaned up in afterEach
// ---------------------------------------------------------------------------

const openBrains: Array<{ brain: Brain; dbPath: string }> = [];

/**
 * Create a fresh Brain + SqlMemoryGraph pair backed by a temp file.
 * The pair is registered for afterEach cleanup automatically.
 */
async function createGraph(): Promise<{
  graph: SqlMemoryGraph;
  brain: Brain;
  dbPath: string;
}> {
  const dbPath = tempDbPath();
  const brain = await Brain.openSqlite(dbPath);
  openBrains.push({ brain, dbPath });
  const graph = new SqlMemoryGraph(brain);
  await graph.initialize();
  return { graph, brain, dbPath };
}

afterEach(async () => {
  while (openBrains.length > 0) {
    const entry = openBrains.pop()!;
    try {
      await entry.brain.close();
    } catch {
      /* ignore already-closed */
    }
    try {
      fs.unlinkSync(entry.dbPath);
      // Remove WAL / SHM files that SQLite leaves behind.
      fs.unlinkSync(`${entry.dbPath}-wal`);
      fs.unlinkSync(`${entry.dbPath}-shm`);
    } catch {
      /* ignore missing files */
    }
  }
});

// ---------------------------------------------------------------------------
// 1. Node CRUD
// ---------------------------------------------------------------------------

describe('SqlMemoryGraph — node CRUD', () => {
  it('addNode makes hasNode return true', async () => {
    const { graph } = await createGraph();
    expect(graph.hasNode('mem-1')).toBe(false);
    await graph.addNode('mem-1', nodeMeta());
    expect(graph.hasNode('mem-1')).toBe(true);
  });

  it('removeNode removes the node', async () => {
    const { graph } = await createGraph();
    await graph.addNode('mem-1', nodeMeta());
    await graph.removeNode('mem-1');
    expect(graph.hasNode('mem-1')).toBe(false);
  });

  it('removeNode also removes incident edges', async () => {
    const { graph } = await createGraph();
    await graph.addNode('mem-1', nodeMeta());
    await graph.addNode('mem-2', nodeMeta());
    await graph.addEdge({
      sourceId: 'mem-1',
      targetId: 'mem-2',
      type: 'SAME_TOPIC',
      weight: 0.8,
      createdAt: Date.now(),
    });
    expect(graph.edgeCount()).toBe(1);
    await graph.removeNode('mem-1');
    expect(graph.edgeCount()).toBe(0);
  });

  it('persists nodes across graph re-initialisation', async () => {
    const { graph, brain } = await createGraph();
    await graph.addNode('mem-persist', nodeMeta('semantic'));

    // Create a second graph instance over the same brain to simulate restart.
    const graph2 = new SqlMemoryGraph(brain);
    await graph2.initialize();

    expect(graph2.hasNode('mem-persist')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. Edge CRUD + getEdges
// ---------------------------------------------------------------------------

describe('SqlMemoryGraph — edge CRUD', () => {
  it('addEdge makes edge retrievable via getEdges', async () => {
    const { graph } = await createGraph();
    await graph.addNode('mem-a', nodeMeta());
    await graph.addNode('mem-b', nodeMeta());
    await graph.addEdge({
      sourceId: 'mem-a',
      targetId: 'mem-b',
      type: 'SHARED_ENTITY',
      weight: 0.9,
      createdAt: Date.now(),
    });

    const edges = graph.getEdges('mem-a');
    expect(edges).toHaveLength(1);
    expect(edges[0]!.type).toBe('SHARED_ENTITY');
    expect(edges[0]!.weight).toBeCloseTo(0.9);
  });

  it('getEdges filters by type correctly', async () => {
    const { graph } = await createGraph();
    await graph.addNode('mem-a', nodeMeta());
    await graph.addNode('mem-b', nodeMeta());
    await graph.addNode('mem-c', nodeMeta());

    await graph.addEdge({
      sourceId: 'mem-a',
      targetId: 'mem-b',
      type: 'SHARED_ENTITY',
      weight: 0.9,
      createdAt: Date.now(),
    });
    await graph.addEdge({
      sourceId: 'mem-a',
      targetId: 'mem-c',
      type: 'CONTRADICTS',
      weight: 0.7,
      createdAt: Date.now(),
    });

    const shared = graph.getEdges('mem-a', 'SHARED_ENTITY');
    const contradicts = graph.getEdges('mem-a', 'CONTRADICTS');
    const all = graph.getEdges('mem-a');

    expect(shared).toHaveLength(1);
    expect(contradicts).toHaveLength(1);
    expect(all).toHaveLength(2);
  });

  it('getEdges returns edges where node is target', async () => {
    const { graph } = await createGraph();
    await graph.addNode('mem-src', nodeMeta());
    await graph.addNode('mem-tgt', nodeMeta());
    await graph.addEdge({
      sourceId: 'mem-src',
      targetId: 'mem-tgt',
      type: 'CAUSED_BY',
      weight: 0.5,
      createdAt: Date.now(),
    });

    // Query from the target side.
    const edges = graph.getEdges('mem-tgt');
    expect(edges).toHaveLength(1);
    expect(edges[0]!.sourceId).toBe('mem-src');
  });

  it('removeEdge removes only the specified directed edge', async () => {
    const { graph } = await createGraph();
    await graph.addNode('mem-a', nodeMeta());
    await graph.addNode('mem-b', nodeMeta());
    await graph.addNode('mem-c', nodeMeta());

    await graph.addEdge({
      sourceId: 'mem-a',
      targetId: 'mem-b',
      type: 'SAME_TOPIC',
      weight: 0.8,
      createdAt: Date.now(),
    });
    await graph.addEdge({
      sourceId: 'mem-a',
      targetId: 'mem-c',
      type: 'SAME_TOPIC',
      weight: 0.6,
      createdAt: Date.now(),
    });

    await graph.removeEdge('mem-a', 'mem-b');

    expect(graph.edgeCount()).toBe(1);
    expect(graph.getEdges('mem-a')).toHaveLength(1);
    expect(graph.getEdges('mem-a')[0]!.targetId).toBe('mem-c');
  });
});

// ---------------------------------------------------------------------------
// 3. Spreading activation
// ---------------------------------------------------------------------------

describe('SqlMemoryGraph — spreadingActivation', () => {
  it('activates direct neighbours with decay applied', async () => {
    const { graph } = await createGraph();

    // Chain: A --0.8--> B --0.8--> C
    await graph.addNode('A', nodeMeta());
    await graph.addNode('B', nodeMeta());
    await graph.addNode('C', nodeMeta());

    await graph.addEdge({ sourceId: 'A', targetId: 'B', type: 'SAME_TOPIC', weight: 0.8, createdAt: Date.now() });
    await graph.addEdge({ sourceId: 'B', targetId: 'C', type: 'SAME_TOPIC', weight: 0.8, createdAt: Date.now() });

    const results = await graph.spreadingActivation(['A'], {
      maxDepth: 3,
      decayPerHop: 0.5,
      activationThreshold: 0.01,
      maxResults: 10,
    });

    const byId = Object.fromEntries(results.map((r) => [r.memoryId, r]));

    // B activation = 1.0 * (1 - 0.5) * 0.8 = 0.4
    expect(byId['B']?.activation).toBeCloseTo(0.4);
    // C activation = 0.4 * (1 - 0.5) * 0.8 = 0.16
    expect(byId['C']?.activation).toBeCloseTo(0.16);

    // Results should be sorted descending by activation.
    expect(results[0]!.activation).toBeGreaterThanOrEqual(results[1]!.activation);
  });

  it('seeds are excluded from results', async () => {
    const { graph } = await createGraph();
    await graph.addNode('seed', nodeMeta());
    await graph.addNode('other', nodeMeta());
    await graph.addEdge({ sourceId: 'seed', targetId: 'other', type: 'SAME_TOPIC', weight: 1.0, createdAt: Date.now() });

    const results = await graph.spreadingActivation(['seed']);
    const ids = results.map((r) => r.memoryId);
    expect(ids).not.toContain('seed');
    expect(ids).toContain('other');
  });

  it('respects maxDepth by not returning nodes beyond the depth limit', async () => {
    const { graph } = await createGraph();

    // Chain A→B→C→D (4 nodes)
    for (const id of ['A', 'B', 'C', 'D']) await graph.addNode(id, nodeMeta());
    await graph.addEdge({ sourceId: 'A', targetId: 'B', type: 'SAME_TOPIC', weight: 1.0, createdAt: Date.now() });
    await graph.addEdge({ sourceId: 'B', targetId: 'C', type: 'SAME_TOPIC', weight: 1.0, createdAt: Date.now() });
    await graph.addEdge({ sourceId: 'C', targetId: 'D', type: 'SAME_TOPIC', weight: 1.0, createdAt: Date.now() });

    const results = await graph.spreadingActivation(['A'], {
      maxDepth: 2,
      decayPerHop: 0,
      activationThreshold: 0.001,
    });

    const ids = results.map((r) => r.memoryId);
    expect(ids).toContain('B');
    expect(ids).toContain('C');
    expect(ids).not.toContain('D');
  });

  it('respects activationThreshold by pruning weak signals', async () => {
    const { graph } = await createGraph();

    // A --0.1--> B: activation at B = 1.0 * 0.5 * 0.1 = 0.05 < threshold 0.1
    await graph.addNode('A', nodeMeta());
    await graph.addNode('B', nodeMeta());
    await graph.addEdge({ sourceId: 'A', targetId: 'B', type: 'SAME_TOPIC', weight: 0.1, createdAt: Date.now() });

    const results = await graph.spreadingActivation(['A'], {
      decayPerHop: 0.5,
      activationThreshold: 0.1,
    });

    expect(results.find((r) => r.memoryId === 'B')).toBeUndefined();
  });

  it('depth field reflects hop count from seed', async () => {
    const { graph } = await createGraph();
    await graph.addNode('S', nodeMeta());
    await graph.addNode('H1', nodeMeta());
    await graph.addNode('H2', nodeMeta());
    await graph.addEdge({ sourceId: 'S', targetId: 'H1', type: 'SAME_TOPIC', weight: 1.0, createdAt: Date.now() });
    await graph.addEdge({ sourceId: 'H1', targetId: 'H2', type: 'SAME_TOPIC', weight: 1.0, createdAt: Date.now() });

    const results = await graph.spreadingActivation(['S'], {
      maxDepth: 3,
      decayPerHop: 0,
      activationThreshold: 0.001,
    });

    const byId = Object.fromEntries(results.map((r) => [r.memoryId, r]));
    expect(byId['H1']?.depth).toBe(1);
    expect(byId['H2']?.depth).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 4. recordCoActivation (Hebbian learning)
// ---------------------------------------------------------------------------

describe('SqlMemoryGraph — recordCoActivation', () => {
  it('creates CO_ACTIVATED edges for all pairs', async () => {
    const { graph } = await createGraph();
    await graph.addNode('X', nodeMeta());
    await graph.addNode('Y', nodeMeta());
    await graph.addNode('Z', nodeMeta());

    await graph.recordCoActivation(['X', 'Y', 'Z'], 0.1);

    // 3 nodes → 3 unordered pairs
    expect(graph.edgeCount()).toBe(3);
    expect(graph.getEdges('X', 'CO_ACTIVATED')).toHaveLength(2); // X-Y and X-Z
    expect(graph.getEdges('Y', 'CO_ACTIVATED')).toHaveLength(2); // X-Y and Y-Z
  });

  it('weight starts at learningRate on first co-activation', async () => {
    const { graph } = await createGraph();
    await graph.addNode('A', nodeMeta());
    await graph.addNode('B', nodeMeta());

    await graph.recordCoActivation(['A', 'B'], 0.2);

    const edges = graph.getEdges('A', 'CO_ACTIVATED');
    expect(edges).toHaveLength(1);
    expect(edges[0]!.weight).toBeCloseTo(0.2);
  });

  it('weight increases on repeated co-activation calls', async () => {
    const { graph } = await createGraph();
    await graph.addNode('A', nodeMeta());
    await graph.addNode('B', nodeMeta());

    await graph.recordCoActivation(['A', 'B'], 0.1);
    await graph.recordCoActivation(['A', 'B'], 0.1);
    await graph.recordCoActivation(['A', 'B'], 0.1);

    const edges = graph.getEdges('A', 'CO_ACTIVATED');
    // 0.1 + 0.1 + 0.1 = 0.3
    expect(edges[0]!.weight).toBeCloseTo(0.3);
    // Edge count should remain 1 (upsert, not duplicate).
    expect(graph.edgeCount()).toBe(1);
  });

  it('weight is capped at 1.0', async () => {
    const { graph } = await createGraph();
    await graph.addNode('A', nodeMeta());
    await graph.addNode('B', nodeMeta());

    // 20 co-activations at 0.1 would sum to 2.0 without a cap.
    for (let i = 0; i < 20; i++) {
      await graph.recordCoActivation(['A', 'B'], 0.1);
    }

    const edges = graph.getEdges('A', 'CO_ACTIVATED');
    expect(edges[0]!.weight).toBeLessThanOrEqual(1.0);
  });
});

// ---------------------------------------------------------------------------
// 5. getConflicts
// ---------------------------------------------------------------------------

describe('SqlMemoryGraph — getConflicts', () => {
  it('returns CONTRADICTS edges for the node', async () => {
    const { graph } = await createGraph();
    await graph.addNode('fact-1', nodeMeta('semantic'));
    await graph.addNode('fact-2', nodeMeta('semantic'));

    await graph.addEdge({
      sourceId: 'fact-1',
      targetId: 'fact-2',
      type: 'CONTRADICTS',
      weight: 1.0,
      createdAt: Date.now(),
    });

    const conflicts = graph.getConflicts('fact-1');
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.type).toBe('CONTRADICTS');
  });

  it('does not return non-CONTRADICTS edges', async () => {
    const { graph } = await createGraph();
    await graph.addNode('m1', nodeMeta());
    await graph.addNode('m2', nodeMeta());

    await graph.addEdge({
      sourceId: 'm1',
      targetId: 'm2',
      type: 'SAME_TOPIC',
      weight: 0.8,
      createdAt: Date.now(),
    });

    expect(graph.getConflicts('m1')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 6. detectClusters
// ---------------------------------------------------------------------------

describe('SqlMemoryGraph — detectClusters', () => {
  it('returns two separate clusters for two disconnected components', async () => {
    const { graph } = await createGraph();

    // Cluster 1: A - B - C (path graph → 2 edges)
    for (const id of ['A', 'B', 'C']) await graph.addNode(id, nodeMeta());
    await graph.addEdge({ sourceId: 'A', targetId: 'B', type: 'SAME_TOPIC', weight: 0.9, createdAt: Date.now() });
    await graph.addEdge({ sourceId: 'B', targetId: 'C', type: 'SAME_TOPIC', weight: 0.9, createdAt: Date.now() });

    // Cluster 2: D - E (single edge)
    for (const id of ['D', 'E']) await graph.addNode(id, nodeMeta());
    await graph.addEdge({ sourceId: 'D', targetId: 'E', type: 'SAME_TOPIC', weight: 0.7, createdAt: Date.now() });

    const clusters = await graph.detectClusters(2);

    expect(clusters).toHaveLength(2);

    // Each cluster should have the right membership.
    const sizes = clusters.map((c) => c.memberIds.length).sort();
    expect(sizes).toEqual([2, 3]);
  });

  it('excludes singletons when minSize=2', async () => {
    const { graph } = await createGraph();

    await graph.addNode('lone', nodeMeta());

    await graph.addNode('a', nodeMeta());
    await graph.addNode('b', nodeMeta());
    await graph.addEdge({ sourceId: 'a', targetId: 'b', type: 'SAME_TOPIC', weight: 1.0, createdAt: Date.now() });

    const clusters = await graph.detectClusters(2);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.memberIds).not.toContain('lone');
  });

  it('returns all nodes in one cluster when fully connected', async () => {
    const { graph } = await createGraph();

    for (const id of ['N1', 'N2', 'N3']) await graph.addNode(id, nodeMeta());
    await graph.addEdge({ sourceId: 'N1', targetId: 'N2', type: 'SAME_TOPIC', weight: 1.0, createdAt: Date.now() });
    await graph.addEdge({ sourceId: 'N2', targetId: 'N3', type: 'SAME_TOPIC', weight: 1.0, createdAt: Date.now() });
    await graph.addEdge({ sourceId: 'N1', targetId: 'N3', type: 'SAME_TOPIC', weight: 1.0, createdAt: Date.now() });

    const clusters = await graph.detectClusters(2);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.memberIds.sort()).toEqual(['N1', 'N2', 'N3'].sort());
  });

  it('returns empty array when graph is empty', async () => {
    const { graph } = await createGraph();
    const clusters = await graph.detectClusters();
    expect(clusters).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 7. nodeCount + edgeCount
// ---------------------------------------------------------------------------

describe('SqlMemoryGraph — nodeCount / edgeCount', () => {
  it('counts nodes accurately after add/remove', async () => {
    const { graph } = await createGraph();
    expect(graph.nodeCount()).toBe(0);

    await graph.addNode('n1', nodeMeta());
    await graph.addNode('n2', nodeMeta());
    expect(graph.nodeCount()).toBe(2);

    await graph.removeNode('n1');
    expect(graph.nodeCount()).toBe(1);
  });

  it('counts edges accurately after add/remove', async () => {
    const { graph } = await createGraph();
    await graph.addNode('a', nodeMeta());
    await graph.addNode('b', nodeMeta());
    await graph.addNode('c', nodeMeta());

    expect(graph.edgeCount()).toBe(0);

    await graph.addEdge({ sourceId: 'a', targetId: 'b', type: 'SAME_TOPIC', weight: 0.5, createdAt: Date.now() });
    await graph.addEdge({ sourceId: 'b', targetId: 'c', type: 'SAME_TOPIC', weight: 0.5, createdAt: Date.now() });
    expect(graph.edgeCount()).toBe(2);

    await graph.removeEdge('a', 'b');
    expect(graph.edgeCount()).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 8. clear
// ---------------------------------------------------------------------------

describe('SqlMemoryGraph — clear', () => {
  it('removes all nodes and edges', async () => {
    const { graph } = await createGraph();

    await graph.addNode('m1', nodeMeta());
    await graph.addNode('m2', nodeMeta());
    await graph.addEdge({ sourceId: 'm1', targetId: 'm2', type: 'SAME_TOPIC', weight: 0.8, createdAt: Date.now() });

    expect(graph.nodeCount()).toBe(2);
    expect(graph.edgeCount()).toBe(1);

    await graph.clear();

    expect(graph.nodeCount()).toBe(0);
    expect(graph.edgeCount()).toBe(0);
    expect(graph.hasNode('m1')).toBe(false);
    expect(graph.getEdges('m1')).toHaveLength(0);
  });

  it('clear persists to SQLite — re-initialised graph is empty', async () => {
    const { graph, brain } = await createGraph();

    await graph.addNode('m1', nodeMeta());
    await graph.addNode('m2', nodeMeta());
    await graph.addEdge({ sourceId: 'm1', targetId: 'm2', type: 'SAME_TOPIC', weight: 0.8, createdAt: Date.now() });

    await graph.clear();

    const graph2 = new SqlMemoryGraph(brain);
    await graph2.initialize();

    expect(graph2.nodeCount()).toBe(0);
    expect(graph2.edgeCount()).toBe(0);
  });
});
