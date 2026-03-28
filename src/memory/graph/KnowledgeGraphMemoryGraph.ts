/**
 * @fileoverview Production memory graph backend wrapping IKnowledgeGraph.
 *
 * Maps memory graph operations to the existing IKnowledgeGraph interface:
 * - Nodes = KnowledgeEntity of type 'memory'
 * - Edges = KnowledgeRelation with memory-specific labels
 * - Uses traverse() and getNeighborhood() for spreading activation
 * - Leverages existing Neo4j backend at scale
 *
 * @module agentos/memory/graph/KnowledgeGraphMemoryGraph
 */

import type { IKnowledgeGraph, KnowledgeEntity, KnowledgeRelation } from '../graph/knowledge/IKnowledgeGraph.js';
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
// Edge type mapping
// ---------------------------------------------------------------------------

const EDGE_TYPE_TO_LABEL: Record<MemoryEdgeType, string> = {
  SHARED_ENTITY: 'related_to',
  TEMPORAL_SEQUENCE: 'precedes',
  SAME_TOPIC: 'similar_to',
  CONTRADICTS: 'opposite_of',
  SUPERSEDES: 'related_to',
  CAUSED_BY: 'causes',
  CO_ACTIVATED: 'related_to',
  SCHEMA_INSTANCE: 'is_a',
};

const LABEL_TO_EDGE_TYPE: Record<string, MemoryEdgeType> = {
  related_to: 'SHARED_ENTITY',
  precedes: 'TEMPORAL_SEQUENCE',
  similar_to: 'SAME_TOPIC',
  opposite_of: 'CONTRADICTS',
  causes: 'CAUSED_BY',
  is_a: 'SCHEMA_INSTANCE',
};

function labelToEdgeType(label: string, properties?: Record<string, unknown>): MemoryEdgeType {
  // Prefer explicit memoryEdgeType stored in properties
  if (properties?.memoryEdgeType) return properties.memoryEdgeType as MemoryEdgeType;
  return LABEL_TO_EDGE_TYPE[label] ?? 'SHARED_ENTITY';
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class KnowledgeGraphMemoryGraph implements IMemoryGraph {
  /** In-memory cache of node IDs for hasNode() (sync requirement). */
  private nodeCache = new Set<string>();
  /** In-memory edge cache for sync getEdges(). */
  private edgeCache = new Map<string, MemoryEdge[]>();

  constructor(private readonly kg: IKnowledgeGraph) {}

  async initialize(): Promise<void> {
    await this.kg.initialize();

    // Warm caches from existing memory entities
    const existing = await this.kg.queryEntities({
      entityTypes: ['memory'],
      limit: 10_000,
    });
    for (const entity of existing) {
      this.nodeCache.add(entity.id);
    }
  }

  // --- Node operations ---

  async addNode(memoryId: string, metadata: MemoryGraphNodeMeta): Promise<void> {
    await this.kg.upsertEntity({
      id: memoryId,
      type: 'memory',
      label: `memory:${memoryId}`,
      properties: {
        memoryType: metadata.type,
        scope: metadata.scope,
        scopeId: metadata.scopeId,
        strength: metadata.strength,
      },
      confidence: metadata.strength,
      source: {
        type: 'system',
        timestamp: new Date(metadata.createdAt).toISOString(),
        method: 'cognitive-memory',
      },
    });
    this.nodeCache.add(memoryId);
  }

  async removeNode(memoryId: string): Promise<void> {
    await this.kg.deleteEntity(memoryId);
    this.nodeCache.delete(memoryId);
    this.edgeCache.delete(memoryId);
  }

  hasNode(memoryId: string): boolean {
    return this.nodeCache.has(memoryId);
  }

  // --- Edge operations ---

  async addEdge(edge: MemoryEdge): Promise<void> {
    if (!this.nodeCache.has(edge.sourceId) || !this.nodeCache.has(edge.targetId)) return;
    if (edge.sourceId === edge.targetId) return;

    const relationType = EDGE_TYPE_TO_LABEL[edge.type] as KnowledgeRelation['type'];
    await this.kg.upsertRelation({
      sourceId: edge.sourceId,
      targetId: edge.targetId,
      type: relationType,
      label: edge.type,
      weight: edge.weight,
      bidirectional: true,
      confidence: edge.weight,
      properties: {
        memoryEdgeType: edge.type,
      },
      source: {
        type: 'system',
        timestamp: new Date(edge.createdAt).toISOString(),
        method: 'cognitive-memory',
      },
    });

    // Update edge cache
    this.cacheEdge(edge);
  }

  getEdges(memoryId: string, type?: MemoryEdgeType): MemoryEdge[] {
    const cached = this.edgeCache.get(memoryId) ?? [];
    if (!type) return cached;
    return cached.filter((e) => e.type === type);
  }

  async removeEdge(sourceId: string, targetId: string): Promise<void> {
    // Find the relation ID first
    const relations = await this.kg.getRelations(sourceId, { direction: 'both' });
    for (const rel of relations) {
      if (
        (rel.sourceId === sourceId && rel.targetId === targetId) ||
        (rel.sourceId === targetId && rel.targetId === sourceId)
      ) {
        await this.kg.deleteRelation(rel.id);
        break;
      }
    }

    // Update cache
    const sourceEdges = this.edgeCache.get(sourceId);
    if (sourceEdges) {
      this.edgeCache.set(sourceId, sourceEdges.filter(
        (e) => !(e.targetId === targetId || e.sourceId === targetId),
      ));
    }
  }

  // --- Spreading activation ---

  async spreadingActivation(
    seedIds: string[],
    config?: SpreadingActivationConfig,
  ): Promise<ActivatedNode[]> {
    return spreadActivation({
      seedIds,
      getNeighbors: async (nodeId) => {
        if (!this.nodeCache.has(nodeId)) return [];

        try {
          const { entities, relations } = await this.kg.getNeighborhood(nodeId, 1);
          return relations
            .filter((r) => r.sourceId === nodeId || r.targetId === nodeId)
            .map((r) => ({
              id: r.sourceId === nodeId ? r.targetId : r.sourceId,
              weight: r.weight,
            }))
            .filter((n) => this.nodeCache.has(n.id));
        } catch {
          return [];
        }
      },
      config,
    });
  }

  // --- Co-activation (Hebbian learning) ---

  async recordCoActivation(memoryIds: string[], learningRate: number = 0.1): Promise<void> {
    const validIds = memoryIds.filter((id) => this.nodeCache.has(id));
    const now = Date.now();

    for (let i = 0; i < validIds.length; i++) {
      for (let j = i + 1; j < validIds.length; j++) {
        const existingEdges = this.getEdges(validIds[i]).filter(
          (e) => e.targetId === validIds[j] || e.sourceId === validIds[j],
        );

        if (existingEdges.length > 0) {
          // Strengthen existing edge
          const edge = existingEdges[0];
          const newWeight = Math.min(1.0, edge.weight + learningRate);
          await this.addEdge({ ...edge, weight: newWeight });
        } else {
          await this.addEdge({
            sourceId: validIds[i],
            targetId: validIds[j],
            type: 'CO_ACTIVATED',
            weight: learningRate,
            createdAt: now,
          });
        }
      }
    }
  }

  // --- Conflict detection ---

  getConflicts(memoryId: string): MemoryEdge[] {
    return this.getEdges(memoryId, 'CONTRADICTS');
  }

  // --- Clustering ---

  async detectClusters(minSize: number = 3): Promise<MemoryCluster[]> {
    // Use KnowledgeGraph traversal to find connected components
    const visited = new Set<string>();
    const clusters: MemoryCluster[] = [];
    let clusterIdx = 0;

    for (const nodeId of this.nodeCache) {
      if (visited.has(nodeId)) continue;

      try {
        const result = await this.kg.traverse(nodeId, {
          maxDepth: 5,
          direction: 'both',
          maxNodes: 100,
        });

        const component: string[] = [];
        component.push(result.root.id);
        visited.add(result.root.id);

        for (const level of result.levels) {
          for (const entity of level.entities) {
            if (!visited.has(entity.id) && this.nodeCache.has(entity.id)) {
              visited.add(entity.id);
              component.push(entity.id);
            }
          }
        }

        if (component.length >= minSize) {
          clusters.push({
            clusterId: `cluster_${clusterIdx++}`,
            memberIds: component,
            density: result.totalRelations / Math.max(1, (component.length * (component.length - 1)) / 2),
          });
        }
      } catch {
        visited.add(nodeId);
      }
    }

    return clusters;
  }

  // --- Lifecycle ---

  nodeCount(): number {
    return this.nodeCache.size;
  }

  edgeCount(): number {
    let count = 0;
    for (const edges of this.edgeCache.values()) {
      count += edges.length;
    }
    return Math.floor(count / 2); // undirected
  }

  clear(): void {
    this.nodeCache.clear();
    this.edgeCache.clear();
  }

  async shutdown(): Promise<void> {
    this.clear();
  }

  // --- Internal ---

  private cacheEdge(edge: MemoryEdge): void {
    // Cache for both endpoints
    for (const id of [edge.sourceId, edge.targetId]) {
      const list = this.edgeCache.get(id) ?? [];
      // Remove existing edge between these two nodes
      const filtered = list.filter(
        (e) =>
          !((e.sourceId === edge.sourceId && e.targetId === edge.targetId) ||
            (e.sourceId === edge.targetId && e.targetId === edge.sourceId)),
      );
      filtered.push(edge);
      this.edgeCache.set(id, filtered);
    }
  }
}
