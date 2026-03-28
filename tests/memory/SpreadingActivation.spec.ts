/**
 * @fileoverview Unit tests for Anderson's spreading activation algorithm.
 */

import { describe, it, expect } from 'vitest';
import { spreadActivation } from '../../src/memory/retrieval/graph/SpreadingActivation';

describe('SpreadingActivation', () => {
  // Simple graph: A -> B (0.8), A -> C (0.5), B -> D (0.6)
  const graph: Record<string, Array<{ id: string; weight: number }>> = {
    A: [{ id: 'B', weight: 0.8 }, { id: 'C', weight: 0.5 }],
    B: [{ id: 'A', weight: 0.8 }, { id: 'D', weight: 0.6 }],
    C: [{ id: 'A', weight: 0.5 }],
    D: [{ id: 'B', weight: 0.6 }],
  };

  const getNeighbors = (nodeId: string) => graph[nodeId] ?? [];

  it('activates direct neighbors of seed nodes', async () => {
    const result = await spreadActivation({
      seedIds: ['A'],
      getNeighbors,
    });

    const ids = result.map((n) => n.memoryId);
    expect(ids).toContain('B');
    expect(ids).toContain('C');
  });

  it('excludes seed nodes from results', async () => {
    const result = await spreadActivation({
      seedIds: ['A'],
      getNeighbors,
    });

    const ids = result.map((n) => n.memoryId);
    expect(ids).not.toContain('A');
  });

  it('higher weight edges produce higher activation', async () => {
    const result = await spreadActivation({
      seedIds: ['A'],
      getNeighbors,
    });

    const B = result.find((n) => n.memoryId === 'B');
    const C = result.find((n) => n.memoryId === 'C');
    expect(B!.activation).toBeGreaterThan(C!.activation);
  });

  it('reaches 2-hop neighbors (D from A via B)', async () => {
    const result = await spreadActivation({
      seedIds: ['A'],
      getNeighbors,
      config: { maxDepth: 3 },
    });

    const ids = result.map((n) => n.memoryId);
    expect(ids).toContain('D');
  });

  it('activation decays with each hop', async () => {
    const result = await spreadActivation({
      seedIds: ['A'],
      getNeighbors,
      config: { maxDepth: 3 },
    });

    const B = result.find((n) => n.memoryId === 'B');
    const D = result.find((n) => n.memoryId === 'D');
    if (B && D) {
      expect(B.activation).toBeGreaterThan(D.activation);
    }
  });

  it('respects maxDepth limit', async () => {
    const result = await spreadActivation({
      seedIds: ['A'],
      getNeighbors,
      config: { maxDepth: 1 },
    });

    const ids = result.map((n) => n.memoryId);
    expect(ids).not.toContain('D'); // D is 2 hops away
  });

  it('respects activationThreshold (filters weak activations)', async () => {
    const result = await spreadActivation({
      seedIds: ['A'],
      getNeighbors,
      config: { activationThreshold: 0.5, maxDepth: 3 },
    });

    // All results should have activation >= threshold
    for (const node of result) {
      expect(node.activation).toBeGreaterThanOrEqual(0.5);
    }
  });

  it('respects maxResults limit', async () => {
    const result = await spreadActivation({
      seedIds: ['A'],
      getNeighbors,
      config: { maxResults: 1, maxDepth: 3 },
    });

    expect(result.length).toBeLessThanOrEqual(1);
  });

  it('supports multi-path summation (capped at 1.0)', async () => {
    // Node X has two paths to it with high weights
    const multiPathGraph: Record<string, Array<{ id: string; weight: number }>> = {
      S1: [{ id: 'X', weight: 0.9 }],
      S2: [{ id: 'X', weight: 0.9 }],
      X: [{ id: 'S1', weight: 0.9 }, { id: 'S2', weight: 0.9 }],
    };

    const result = await spreadActivation({
      seedIds: ['S1', 'S2'],
      getNeighbors: (id) => multiPathGraph[id] ?? [],
      config: { maxDepth: 1 },
    });

    const X = result.find((n) => n.memoryId === 'X');
    expect(X).toBeDefined();
    expect(X!.activation).toBeLessThanOrEqual(1.0);
  });

  it('returns empty array for empty graph', async () => {
    const result = await spreadActivation({
      seedIds: ['nonexistent'],
      getNeighbors: () => [],
    });
    expect(result).toHaveLength(0);
  });

  it('sorts results by activation descending', async () => {
    const result = await spreadActivation({
      seedIds: ['A'],
      getNeighbors,
      config: { maxDepth: 3 },
    });

    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1].activation).toBeGreaterThanOrEqual(result[i].activation);
    }
  });

  it('tracks activatedBy (which seeds contributed)', async () => {
    const result = await spreadActivation({
      seedIds: ['A'],
      getNeighbors,
    });

    for (const node of result) {
      expect(node.activatedBy).toContain('A');
    }
  });
});
