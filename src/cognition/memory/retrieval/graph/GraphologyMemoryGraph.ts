/**
 * @fileoverview In-memory graphology-based memory graph (dev/testing).
 *
 * Follows the CapabilityGraph pattern: lazy-loaded graphology,
 * O(1) neighbor lookups, sub-ms traversal for typical memory counts.
 *
 * @module agentos/memory/graph/GraphologyMemoryGraph
 */

import type {
  IMemoryGraph,
  MemoryGraphNodeMeta,
  MemoryEdge,
  MemoryEdgeType,
  SpreadingActivationConfig,
  ActivatedNode,
  MemoryCluster,
} from './IMemoryGraph.js';
import { spreadActivation } from './SpreadingActivation.js';

// ---------------------------------------------------------------------------
// Lazy-loaded graphology (optional peer dependency)
// ---------------------------------------------------------------------------

type GraphClass = import('graphology').default;
let _GraphCtor: (new (opts?: Record<string, unknown>) => GraphClass) | undefined;

async function resolveGraphology(): Promise<new (opts?: Record<string, unknown>) => GraphClass> {
  if (_GraphCtor) return _GraphCtor;
  try {
    const mod = await import('graphology');
    _GraphCtor = (mod.default ?? mod) as unknown as typeof _GraphCtor;
    return _GraphCtor!;
  } catch {
    throw new Error(
      'graphology is required for GraphologyMemoryGraph but was not found. ' +
        'Install it: npm install graphology graphology-types',
    );
  }
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class GraphologyMemoryGraph implements IMemoryGraph {
  private graph: GraphClass | null = null;

  async initialize(): Promise<void> {
    const GraphCtor = await resolveGraphology();
    this.graph = new GraphCtor({ multi: false, type: 'undirected' });
  }

  private ensureGraph(): GraphClass {
    if (!this.graph) throw new Error('GraphologyMemoryGraph not initialized.');
    return this.graph;
  }

  // --- Node operations ---

  async addNode(memoryId: string, metadata: MemoryGraphNodeMeta): Promise<void> {
    const g = this.ensureGraph();
    if (g.hasNode(memoryId)) {
      g.replaceNodeAttributes(memoryId, metadata);
    } else {
      g.addNode(memoryId, metadata);
    }
  }

  async removeNode(memoryId: string): Promise<void> {
    const g = this.ensureGraph();
    if (g.hasNode(memoryId)) {
      g.dropNode(memoryId);
    }
  }

  hasNode(memoryId: string): boolean {
    return this.graph?.hasNode(memoryId) ?? false;
  }

  // --- Edge operations ---

  async addEdge(edge: MemoryEdge): Promise<void> {
    const g = this.ensureGraph();
    if (!g.hasNode(edge.sourceId) || !g.hasNode(edge.targetId)) return;
    if (edge.sourceId === edge.targetId) return;

    try {
      const existing = g.edge(edge.sourceId, edge.targetId);
      if (existing) {
        const attrs = g.getEdgeAttributes(existing) as { weight: number };
        if (edge.weight > attrs.weight) {
          g.setEdgeAttribute(existing, 'weight', edge.weight);
          g.setEdgeAttribute(existing, 'type', edge.type);
        }
      } else {
        g.addEdge(edge.sourceId, edge.targetId, {
          type: edge.type,
          weight: edge.weight,
          createdAt: edge.createdAt,
        });
      }
    } catch {
      // Edge already exists in other direction (undirected)
    }
  }

  getEdges(memoryId: string, type?: MemoryEdgeType): MemoryEdge[] {
    const g = this.ensureGraph();
    if (!g.hasNode(memoryId)) return [];

    const edges: MemoryEdge[] = [];
    g.forEachEdge(memoryId, (_edge: string, attrs: Record<string, unknown>, source: string, target: string) => {
      const edgeType = attrs.type as MemoryEdgeType;
      if (!type || edgeType === type) {
        edges.push({
          sourceId: source,
          targetId: target,
          type: edgeType,
          weight: attrs.weight as number,
          createdAt: attrs.createdAt as number,
        });
      }
    });
    return edges;
  }

  async removeEdge(sourceId: string, targetId: string): Promise<void> {
    const g = this.ensureGraph();
    try {
      const edge = g.edge(sourceId, targetId);
      if (edge) g.dropEdge(edge);
    } catch { /* no-op */ }
  }

  // --- Spreading activation ---

  async spreadingActivation(
    seedIds: string[],
    config?: SpreadingActivationConfig,
  ): Promise<ActivatedNode[]> {
    const g = this.ensureGraph();

    // Delegate to pure-function implementation
    return spreadActivation({
      seedIds,
      getNeighbors: (nodeId) => {
        if (!g.hasNode(nodeId)) return [];
        const neighbors: Array<{ id: string; weight: number }> = [];
        g.forEachEdge(nodeId, (_edge: string, attrs: Record<string, unknown>, source: string, target: string) => {
          const neighborId = source === nodeId ? target : source;
          neighbors.push({ id: neighborId, weight: attrs.weight as number });
        });
        return neighbors;
      },
      config,
    });
  }

  // --- Co-activation (Hebbian learning) ---

  async recordCoActivation(memoryIds: string[], learningRate: number = 0.1): Promise<void> {
    const g = this.ensureGraph();
    const validIds = memoryIds.filter((id) => g.hasNode(id));
    const now = Date.now();

    for (let i = 0; i < validIds.length; i++) {
      for (let j = i + 1; j < validIds.length; j++) {
        try {
          const existing = g.edge(validIds[i], validIds[j]);
          if (existing) {
            const attrs = g.getEdgeAttributes(existing) as { weight: number };
            // Hebbian: strengthen existing connection
            g.setEdgeAttribute(existing, 'weight', Math.min(1.0, attrs.weight + learningRate));
          } else {
            g.addEdge(validIds[i], validIds[j], {
              type: 'CO_ACTIVATED',
              weight: learningRate,
              createdAt: now,
            });
          }
        } catch { /* edge already exists */ }
      }
    }
  }

  // --- Conflict detection ---

  getConflicts(memoryId: string): MemoryEdge[] {
    return this.getEdges(memoryId, 'CONTRADICTS');
  }

  // --- Clustering ---

  async detectClusters(minSize: number = 3): Promise<MemoryCluster[]> {
    const g = this.ensureGraph();
    if (g.order < minSize) return [];

    // Simple connected-component clustering (upgrade to Louvain when graphology-communities is available)
    const visited = new Set<string>();
    const clusters: MemoryCluster[] = [];
    let clusterIdx = 0;

    g.forEachNode((nodeId: string) => {
      if (visited.has(nodeId)) return;

      // BFS from this node
      const component: string[] = [];
      const queue = [nodeId];
      visited.add(nodeId);

      while (queue.length > 0) {
        const current = queue.shift()!;
        component.push(current);

        g.forEachEdge(current, (_edge: string, _attrs: Record<string, unknown>, source: string, target: string) => {
          const neighbor = source === current ? target : source;
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            queue.push(neighbor);
          }
        });
      }

      if (component.length >= minSize) {
        // Density = actual edges / possible edges
        let edgeCount = 0;
        for (const id of component) {
          const nodeEdges = this.getEdges(id);
          edgeCount += nodeEdges.filter((e) =>
            component.includes(e.sourceId === id ? e.targetId : e.sourceId),
          ).length;
        }
        edgeCount /= 2; // undirected
        const possibleEdges = (component.length * (component.length - 1)) / 2;

        clusters.push({
          clusterId: `cluster_${clusterIdx++}`,
          memberIds: component,
          density: possibleEdges > 0 ? edgeCount / possibleEdges : 0,
        });
      }
    });

    return clusters;
  }

  // --- Lifecycle ---

  nodeCount(): number {
    return this.graph?.order ?? 0;
  }

  edgeCount(): number {
    return this.graph?.size ?? 0;
  }

  clear(): void {
    this.graph?.clear();
  }

  async shutdown(): Promise<void> {
    this.graph?.clear();
    this.graph = null;
  }
}
