/**
 * @fileoverview In-memory graphology-based memory graph (dev/testing).
 *
 * Follows the CapabilityGraph pattern: lazy-loaded graphology,
 * O(1) neighbor lookups, sub-ms traversal for typical memory counts.
 *
 * @module agentos/memory/graph/GraphologyMemoryGraph
 */
import type { IMemoryGraph, MemoryGraphNodeMeta, MemoryEdge, MemoryEdgeType, SpreadingActivationConfig, ActivatedNode, MemoryCluster } from './IMemoryGraph.js';
export declare class GraphologyMemoryGraph implements IMemoryGraph {
    private graph;
    initialize(): Promise<void>;
    private ensureGraph;
    addNode(memoryId: string, metadata: MemoryGraphNodeMeta): Promise<void>;
    removeNode(memoryId: string): Promise<void>;
    hasNode(memoryId: string): boolean;
    addEdge(edge: MemoryEdge): Promise<void>;
    getEdges(memoryId: string, type?: MemoryEdgeType): MemoryEdge[];
    removeEdge(sourceId: string, targetId: string): Promise<void>;
    spreadingActivation(seedIds: string[], config?: SpreadingActivationConfig): Promise<ActivatedNode[]>;
    recordCoActivation(memoryIds: string[], learningRate?: number): Promise<void>;
    getConflicts(memoryId: string): MemoryEdge[];
    detectClusters(minSize?: number): Promise<MemoryCluster[]>;
    nodeCount(): number;
    edgeCount(): number;
    clear(): void;
    shutdown(): Promise<void>;
}
//# sourceMappingURL=GraphologyMemoryGraph.d.ts.map