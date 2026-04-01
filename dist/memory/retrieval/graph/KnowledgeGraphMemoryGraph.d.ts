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
import type { IKnowledgeGraph } from '../../retrieval/graph/knowledge/IKnowledgeGraph.js';
import type { IMemoryGraph, MemoryGraphNodeMeta, MemoryEdge, MemoryEdgeType, SpreadingActivationConfig, ActivatedNode, MemoryCluster } from './IMemoryGraph.js';
export declare class KnowledgeGraphMemoryGraph implements IMemoryGraph {
    private readonly kg;
    /** In-memory cache of node IDs for hasNode() (sync requirement). */
    private nodeCache;
    /** In-memory edge cache for sync getEdges(). */
    private edgeCache;
    constructor(kg: IKnowledgeGraph);
    initialize(): Promise<void>;
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
    private cacheEdge;
}
//# sourceMappingURL=KnowledgeGraphMemoryGraph.d.ts.map