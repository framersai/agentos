/**
 * @file NodeScheduler.ts
 * @description Topological ordering, cycle detection, and ready-node detection
 * for compiled execution graph scheduling in the AgentOS Unified Orchestration Layer.
 *
 * Uses Kahn's algorithm (BFS-based) for topological sorting, which also serves
 * as the foundation for cycle detection. The scheduler treats START and END as
 * virtual nodes that participate in edge traversal but are excluded from the
 * returned topological order.
 */
import type { GraphNode, GraphEdge } from '../ir/types.js';
/**
 * Schedules graph node execution by computing topological ordering, detecting
 * structural issues (cycles, unreachable nodes), and determining which nodes
 * are ready to run given a set of already-completed nodes.
 *
 * All methods are pure and stateless with respect to execution — the scheduler
 * only reads the static graph structure provided at construction time.
 */
export declare class NodeScheduler {
    /** Maps each node id to its outgoing neighbour ids. Includes START and END. */
    private adjacency;
    /** Maps each node id to the ids of nodes that have edges pointing into it. Includes START and END. */
    private predecessors;
    /** Set of real (non-sentinel) node ids derived from the provided GraphNode array. */
    private nodeIds;
    /**
     * Constructs a NodeScheduler from a compiled graph's node and edge lists.
     *
     * @param nodes - All real (non-sentinel) graph nodes.
     * @param edges - All directed edges, including those from/to START or END sentinels.
     */
    constructor(nodes: GraphNode[], edges: GraphEdge[]);
    /**
     * Returns real node ids in a valid topological execution order using Kahn's
     * algorithm (BFS over in-degree).
     *
     * START and END sentinels are intentionally excluded from the returned array
     * because they are virtual control-flow markers, not executable nodes.
     *
     * If the graph contains a cycle, the returned array will be shorter than
     * `nodeIds.size` — use {@link hasCycles} to distinguish this case explicitly.
     *
     * @returns Ordered array of real node ids; empty if there are no real nodes.
     */
    topologicalSort(): string[];
    /**
     * Returns `true` if the graph contains at least one directed cycle among the
     * real nodes (sentinels are excluded from cycle detection).
     *
     * Implemented by comparing the length of the topological sort result against
     * the total number of real nodes: Kahn's algorithm processes every node in a
     * DAG, so any shortfall indicates nodes trapped inside a cycle.
     *
     * @returns `true` when a cycle exists; `false` for a valid DAG.
     */
    hasCycles(): boolean;
    /**
     * Returns the ids of all real nodes that are eligible to execute next, given
     * the set of nodes that have already finished (completed or skipped).
     *
     * A node is "ready" when:
     * 1. It has not already completed or been skipped.
     * 2. Every one of its predecessors is either the START sentinel or a member of
     *    the completed/skipped set.
     *
     * @param completedNodeIds - Node ids that have successfully finished execution.
     * @param skippedNodeIds   - Node ids that were bypassed (e.g. via conditional routing).
     * @returns Array of node ids that can be dispatched for execution immediately.
     */
    getReadyNodes(completedNodeIds: string[], skippedNodeIds?: string[]): string[];
    /**
     * Returns the ids of all real nodes that are not reachable from the START
     * sentinel via a BFS traversal of the adjacency list.
     *
     * Unreachable (orphan) nodes indicate a structural authoring error: they can
     * never execute because no execution path leads to them.  The runtime may
     * choose to warn, error, or prune these nodes before starting a run.
     *
     * @returns Array of node ids that cannot be reached from START; empty for a
     *          well-formed graph.
     */
    getUnreachableNodes(): string[];
}
//# sourceMappingURL=NodeScheduler.d.ts.map