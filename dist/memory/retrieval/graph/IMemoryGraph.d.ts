/**
 * @fileoverview Adapter interface for the memory association graph.
 *
 * Abstracts over graphology (dev/testing) and IKnowledgeGraph (production).
 * Supports:
 * - Node/edge CRUD for memory traces
 * - Spreading activation (Anderson's ACT-R)
 * - Co-activation recording (Hebbian learning)
 * - Conflict/contradiction edge detection
 * - Community/cluster detection for consolidation
 *
 * @module agentos/memory/graph/IMemoryGraph
 */
export interface MemoryGraphNodeMeta {
    type: string;
    scope: string;
    scopeId: string;
    /** Current encoding strength (updated periodically). */
    strength: number;
    createdAt: number;
}
export type MemoryEdgeType = 'SHARED_ENTITY' | 'TEMPORAL_SEQUENCE' | 'SAME_TOPIC' | 'CONTRADICTS' | 'SUPERSEDES' | 'CAUSED_BY' | 'CO_ACTIVATED' | 'SCHEMA_INSTANCE';
export interface MemoryEdge {
    sourceId: string;
    targetId: string;
    type: MemoryEdgeType;
    weight: number;
    createdAt: number;
}
export interface SpreadingActivationConfig {
    /** Maximum hops from seed nodes. @default 3 */
    maxDepth?: number;
    /** Activation decay per hop (multiplied each step). @default 0.5 */
    decayPerHop?: number;
    /** Minimum activation to continue spreading. @default 0.1 */
    activationThreshold?: number;
    /** Maximum activated nodes to return. @default 20 */
    maxResults?: number;
}
export interface ActivatedNode {
    memoryId: string;
    activation: number;
    depth: number;
    /** IDs of seed nodes that contributed activation. */
    activatedBy: string[];
}
export interface MemoryCluster {
    clusterId: string;
    memberIds: string[];
    density: number;
}
export interface IMemoryGraph {
    /** Initialize the graph backend. */
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
}
//# sourceMappingURL=IMemoryGraph.d.ts.map