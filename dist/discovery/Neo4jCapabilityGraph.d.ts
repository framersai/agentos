/**
 * @fileoverview Neo4j-backed Capability Graph implementation.
 *
 * Implements `ICapabilityGraph` using Neo4j for persistent capability
 * relationship storage. Designed for scaling to 1000+ capabilities
 * where in-memory graphology becomes impractical.
 *
 * Also implements the `rerank()` method used by CapabilityDiscoveryEngine
 * for graph-based re-ranking of search results.
 *
 * @module @framers/agentos/discovery/Neo4jCapabilityGraph
 * @see ./types.ts for the ICapabilityGraph interface.
 */
import type { ICapabilityGraph, CapabilityDescriptor, CapabilityEdge, RelatedCapability, PresetCoOccurrence } from './types.js';
import type { Neo4jConnectionManager } from '../memory/retrieval/graph/neo4j/Neo4jConnectionManager.js';
export declare class Neo4jCapabilityGraph implements ICapabilityGraph {
    private cypher;
    constructor(connectionManager: Neo4jConnectionManager);
    buildGraph(capabilities: CapabilityDescriptor[], presetCoOccurrences?: PresetCoOccurrence[]): void;
    private _buildPromise;
    private _ensureBuilt;
    private _buildGraphAsync;
    getRelated(_capabilityId: string): RelatedCapability[];
    /**
     * Async version of getRelated for Neo4j usage.
     */
    getRelatedAsync(capabilityId: string): Promise<RelatedCapability[]>;
    getSubgraph(_capabilityIds: string[]): {
        nodes: string[];
        edges: CapabilityEdge[];
    };
    /**
     * Async version of getSubgraph for Neo4j usage.
     */
    getSubgraphAsync(capabilityIds: string[]): Promise<{
        nodes: string[];
        edges: CapabilityEdge[];
    }>;
    nodeCount(): number;
    nodeCountAsync(): Promise<number>;
    edgeCount(): number;
    edgeCountAsync(): Promise<number>;
    clear(): void;
    /**
     * Re-rank search results using graph relationships.
     * Matches the CapabilityGraph.rerank() signature for drop-in replacement.
     */
    rerank(searchResults: Array<{
        id: string;
        score: number;
    }>, graphBoostFactor: number): Promise<Array<{
        id: string;
        score: number;
        boosted: boolean;
    }>>;
    private addEdge;
}
//# sourceMappingURL=Neo4jCapabilityGraph.d.ts.map