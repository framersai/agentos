/**
 * @fileoverview SQLite-backed implementation of IMemoryGraph.
 *
 * Stores memory graph nodes in the `knowledge_nodes` table (type = 'memory_graph')
 * and memory association edges in the `knowledge_edges` table — both managed by
 * SqliteBrain. All node metadata is serialised into the `properties` JSON column.
 *
 * ## Algorithms
 *
 * ### Spreading activation (Anderson's ACT-R model)
 * BFS from each seed node. At each hop the activation value is multiplied by
 * `(1 - decayPerHop) * edgeWeight`, modelling the attenuation of priming
 * signals as they propagate through associative memory. Multiple paths to the
 * same node are resolved by keeping the maximum activation reached so far
 * (best-path semantics). The BFS terminates when:
 * - the current activation falls below `activationThreshold`, or
 * - the hop count exceeds `maxDepth`.
 *
 * ### Hebbian co-activation (recordCoActivation)
 * For every unordered pair (A, B) in `memoryIds`, a CO_ACTIVATED edge is
 * upserted. If the edge already exists its weight is incremented by
 * `learningRate` (capped at 1.0). This implements the classic Hebbian rule:
 * "neurons that fire together wire together".
 *
 * ### Connected-component clustering (detectClusters)
 * Union-Find (path-compressed) over all edges in the graph. Each component
 * with at least `minSize` members is returned as a {@link MemoryCluster}.
 * The `centroidId` is chosen as the member with the highest total edge weight
 * (i.e. the most central node in the component's subgraph).
 *
 * @module memory/store/SqliteMemoryGraph
 */
import type { SqliteBrain } from './SqliteBrain.js';
import type { IMemoryGraph, MemoryEdge, MemoryEdgeType, MemoryGraphNodeMeta, SpreadingActivationConfig, ActivatedNode, MemoryCluster } from '../graph/IMemoryGraph.js';
/**
 * SQLite-backed implementation of {@link IMemoryGraph}.
 *
 * **Thread safety**: inherits the underlying adapter's concurrency model.
 * Writes serialise automatically through WAL when using SQLite-backed adapters.
 *
 * **Usage:**
 * ```ts
 * const brain = await SqliteBrain.open('/path/to/brain.sqlite');
 * const graph = new SqliteMemoryGraph(brain);
 * await graph.initialize();
 *
 * await graph.addNode('mem-1', { type: 'episodic', scope: 'session', scopeId: 's1', strength: 1.0, createdAt: Date.now() });
 * await graph.addEdge({ sourceId: 'mem-1', targetId: 'mem-2', type: 'SAME_TOPIC', weight: 0.8, createdAt: Date.now() });
 *
 * const activated = await graph.spreadingActivation(['mem-1']);
 * ```
 */
export declare class SqliteMemoryGraph implements IMemoryGraph {
    private readonly brain;
    /**
     * In-memory node index: maps memoryId → MemoryGraphNodeMeta.
     *
     * We keep an in-memory cache so that `hasNode()` and `nodeCount()` are O(1)
     * without requiring a synchronous SQLite query (both are called from
     * hot-path retrieval code). The cache is hydrated during `initialize()` and
     * kept in sync through every `addNode` / `removeNode` / `clear` call.
     */
    private readonly _nodes;
    /**
     * In-memory edge index: maps `${sourceId}:${targetId}` → MemoryEdge.
     *
     * Edges are also kept in-memory for O(1) adjacency lookups used by
     * spreading activation and cluster detection. Persisted to SQLite on every
     * write so the graph survives restarts.
     */
    private readonly _edges;
    /**
     * @param brain - The shared SqliteBrain connection for this agent.
     *   The `knowledge_nodes` and `knowledge_edges` tables must already exist
     *   (SqliteBrain creates them in its constructor).
     */
    constructor(brain: SqliteBrain);
    /**
     * Hydrate the in-memory node and edge caches from the SQLite database.
     *
     * Must be called once before any other method. Safe to call multiple times
     * (idempotent — fully replaces in-memory state each time).
     */
    initialize(): Promise<void>;
    /**
     * Shut down the memory graph.
     *
     * Currently a no-op because SqliteBrain owns the DB connection lifetime.
     * Provided for interface compliance and forward compatibility.
     */
    shutdown(): Promise<void>;
    /**
     * Add a memory node to the graph.
     *
     * The node is persisted to `knowledge_nodes` (type = 'memory_graph') with
     * the metadata serialised into the `properties` JSON column. If a node with
     * the same `memoryId` already exists it is silently replaced (upsert).
     *
     * @param memoryId - Unique identifier for the memory trace this node represents.
     * @param metadata - Structural metadata describing the memory.
     */
    addNode(memoryId: string, metadata: MemoryGraphNodeMeta): Promise<void>;
    /**
     * Remove a node and all its incident edges from the graph.
     *
     * Edges referencing the removed node are deleted from both SQLite and the
     * in-memory cache to keep the graph consistent.
     *
     * @param memoryId - ID of the node to remove.
     */
    removeNode(memoryId: string): Promise<void>;
    /**
     * Check whether a node exists in the graph.
     *
     * O(1) in-memory lookup — does not touch SQLite.
     *
     * @param memoryId - ID to check.
     * @returns `true` if the node is present, `false` otherwise.
     */
    hasNode(memoryId: string): boolean;
    /**
     * Add a directed edge between two memory nodes.
     *
     * If an edge with the same `(sourceId, targetId)` pair already exists it is
     * replaced (upsert by composite key). The underlying SQLite row is identified
     * by a deterministic UUID derived from the source/target pair so that
     * repeated upserts land on the same row.
     *
     * @param edge - Edge descriptor including type, weight, and timestamp.
     */
    addEdge(edge: MemoryEdge): Promise<void>;
    /**
     * Retrieve all edges incident to a memory node.
     *
     * Returns edges where `memoryId` appears as either source or target.
     * Optionally filters by edge type.
     *
     * O(E) scan over the in-memory edge map — acceptable for typical graph sizes
     * (< 10k edges).
     *
     * @param memoryId - Node ID to query.
     * @param type     - Optional edge type filter.
     * @returns Array of matching {@link MemoryEdge} objects.
     */
    getEdges(memoryId: string, type?: MemoryEdgeType): MemoryEdge[];
    /**
     * Remove a directed edge from the graph.
     *
     * @param sourceId - Source node ID.
     * @param targetId - Target node ID.
     */
    removeEdge(sourceId: string, targetId: string): Promise<void>;
    /**
     * Run spreading activation from a set of seed nodes.
     *
     * Implements Anderson's ACT-R spreading activation model using BFS:
     *
     * 1. Each seed node starts with activation = 1.0.
     * 2. When a node propagates to a neighbour, the neighbour's activation
     *    receives: `parentActivation * (1 - decayPerHop) * edgeWeight`.
     * 3. If a node is reached by multiple paths, the maximum activation is kept.
     * 4. Nodes below `activationThreshold` are not expanded further.
     * 5. BFS stops at depth `maxDepth`.
     *
     * Seed nodes are excluded from the returned list (they are the query, not
     * the result).
     *
     * @param seedIds - IDs of the memory nodes that trigger the activation.
     * @param config  - Optional tuning parameters.
     * @returns Activated nodes sorted by activation descending, capped at `maxResults`.
     */
    spreadingActivation(seedIds: string[], config?: SpreadingActivationConfig): Promise<ActivatedNode[]>;
    /**
     * Record that a set of memories were activated together (Hebbian learning).
     *
     * For every unordered pair (A, B) in `memoryIds`, a CO_ACTIVATED edge is
     * upserted:
     * - If no edge exists, it is created with `weight = learningRate`.
     * - If an edge already exists, its weight is incremented by `learningRate`
     *   and capped at 1.0.
     *
     * This implements the Hebbian rule "neurons that fire together wire together"
     * at the memory graph level, gradually strengthening associations between
     * memories that are frequently retrieved in the same context.
     *
     * @param memoryIds    - IDs of co-activated memories.
     * @param learningRate - Weight increment per co-activation event. @default 0.1
     */
    recordCoActivation(memoryIds: string[], learningRate?: number): Promise<void>;
    /**
     * Return all CONTRADICTS edges incident to a given memory node.
     *
     * A CONTRADICTS edge signals that two memories express mutually incompatible
     * beliefs or facts. The consolidation engine uses this to trigger
     * conflict-resolution passes.
     *
     * @param memoryId - The memory node to check for contradictions.
     * @returns Array of CONTRADICTS edges (may be empty).
     */
    getConflicts(memoryId: string): MemoryEdge[];
    /**
     * Detect connected components (clusters) in the memory graph.
     *
     * Uses path-compressed Union-Find over all edges. Components are filtered
     * to those with at least `minSize` members.
     *
     * The `centroidId` of each cluster is the member with the highest total
     * incident edge weight (most central node). If the cluster has only one
     * member, `centroidId` equals that member.
     *
     * The `density` of a cluster is computed as:
     * `actualEdges / maxPossibleEdges` where `maxPossibleEdges = n*(n-1)`.
     * For single-member clusters, density = 0.
     *
     * @param minSize - Minimum component size to include. @default 2
     * @returns Array of {@link MemoryCluster} objects.
     */
    detectClusters(minSize?: number): Promise<MemoryCluster[]>;
    /**
     * Return the number of nodes currently in the graph.
     * O(1) — backed by the in-memory Map size.
     */
    nodeCount(): number;
    /**
     * Return the number of edges currently in the graph.
     * O(1) — backed by the in-memory Map size.
     */
    edgeCount(): number;
    /**
     * Remove all nodes and edges from the graph (both in-memory and SQLite).
     *
     * This is a destructive, irreversible operation. Intended for tests and
     * administrative resets only.
     */
    clear(): Promise<void>;
    /**
     * Derive a deterministic, stable UUID for a directed edge from
     * `sourceId` to `targetId`.
     *
     * Using a deterministic ID means that calling `addEdge` twice with the same
     * source/target lands on the same SQLite row — enabling the `INSERT OR REPLACE`
     * upsert semantics.
     *
     * @param sourceId - Edge source node ID.
     * @param targetId - Edge target node ID.
     * @returns A UUID v5-style hex string.
     */
    private _edgeId;
}
//# sourceMappingURL=SqliteMemoryGraph.d.ts.map