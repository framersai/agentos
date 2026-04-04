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
import { START, END } from '../ir/types.js';
/**
 * Schedules graph node execution by computing topological ordering, detecting
 * structural issues (cycles, unreachable nodes), and determining which nodes
 * are ready to run given a set of already-completed nodes.
 *
 * All methods are pure and stateless with respect to execution — the scheduler
 * only reads the static graph structure provided at construction time.
 */
export class NodeScheduler {
    /**
     * Constructs a NodeScheduler from a compiled graph's node and edge lists.
     *
     * @param nodes - All real (non-sentinel) graph nodes.
     * @param edges - All directed edges, including those from/to START or END sentinels.
     */
    constructor(nodes, edges) {
        /** Maps each node id to its outgoing neighbour ids. Includes START and END. */
        this.adjacency = new Map();
        /** Maps each node id to the ids of nodes that have edges pointing into it. Includes START and END. */
        this.predecessors = new Map();
        this.nodeIds = new Set(nodes.map(n => n.id));
        // Initialise adjacency and predecessor lists for every real node plus the
        // two virtual sentinels so edge lookups never need a null-check.
        for (const id of [START, END, ...this.nodeIds]) {
            this.adjacency.set(id, []);
            this.predecessors.set(id, []);
        }
        // Runtime-resolved placeholder sentinels.  Edges targeting these have their
        // real destination determined by a function/discovery engine at execution time,
        // so at build time we conservatively treat the source as able to reach *every*
        // real node (plus __END__) to avoid false "unreachable" warnings and incorrect
        // topological sort results.
        const RUNTIME_SENTINELS = new Set(['__CONDITIONAL__', '__DISCOVERY__']);
        for (const edge of edges) {
            if (RUNTIME_SENTINELS.has(edge.target)) {
                // The real target is unknown at compile time — fan out to all real nodes + END.
                const allTargets = [...this.nodeIds, END];
                for (const t of allTargets) {
                    this.adjacency.get(edge.source)?.push(t);
                    this.predecessors.get(t)?.push(edge.source);
                }
            }
            else {
                this.adjacency.get(edge.source)?.push(edge.target);
                this.predecessors.get(edge.target)?.push(edge.source);
            }
        }
    }
    // ---------------------------------------------------------------------------
    // Topological ordering
    // ---------------------------------------------------------------------------
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
    topologicalSort() {
        // Compute in-degree for every real node (edges from sentinels count too).
        const inDegree = new Map();
        for (const id of this.nodeIds) {
            const preds = this.predecessors.get(id) ?? [];
            inDegree.set(id, preds.length);
        }
        // Seed the queue with nodes that have no predecessors at all, or whose
        // only predecessors are START (treated as "already satisfied" at t=0).
        const queue = [];
        for (const [id, _degree] of inDegree) {
            // A node is initially ready when all its predecessors are sentinels
            // (START/END) or it has no predecessors.
            const realPredCount = (this.predecessors.get(id) ?? []).filter(p => p !== START && p !== END).length;
            if (realPredCount === 0) {
                queue.push(id);
            }
        }
        const sorted = [];
        // Track a "virtual" in-degree that only counts real predecessors so that
        // START/END sentinel edges don't artificially inflate the degree.
        const realInDegree = new Map();
        for (const id of this.nodeIds) {
            realInDegree.set(id, (this.predecessors.get(id) ?? []).filter(p => p !== START && p !== END).length);
        }
        while (queue.length > 0) {
            const current = queue.shift();
            sorted.push(current);
            for (const neighbour of this.adjacency.get(current) ?? []) {
                // Skip sentinel targets — they have no real in-degree entry.
                if (!this.nodeIds.has(neighbour))
                    continue;
                const remaining = (realInDegree.get(neighbour) ?? 0) - 1;
                realInDegree.set(neighbour, remaining);
                if (remaining === 0) {
                    queue.push(neighbour);
                }
            }
        }
        return sorted;
    }
    // ---------------------------------------------------------------------------
    // Cycle detection
    // ---------------------------------------------------------------------------
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
    hasCycles() {
        return this.topologicalSort().length < this.nodeIds.size;
    }
    // ---------------------------------------------------------------------------
    // Ready-node detection
    // ---------------------------------------------------------------------------
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
    getReadyNodes(completedNodeIds, skippedNodeIds = []) {
        // Build a unified "done" set that includes the START sentinel so that nodes
        // whose only predecessor is START are treated as immediately satisfiable.
        const done = new Set([START, ...completedNodeIds, ...skippedNodeIds]);
        const ready = [];
        for (const nodeId of this.nodeIds) {
            // Skip nodes that are already done.
            if (done.has(nodeId))
                continue;
            const preds = this.predecessors.get(nodeId) ?? [];
            if (preds.every(p => done.has(p))) {
                ready.push(nodeId);
            }
        }
        return ready;
    }
    // ---------------------------------------------------------------------------
    // Reachability analysis
    // ---------------------------------------------------------------------------
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
    getUnreachableNodes() {
        const visited = new Set();
        const queue = [START];
        while (queue.length > 0) {
            const current = queue.shift();
            if (visited.has(current))
                continue;
            visited.add(current);
            for (const neighbour of this.adjacency.get(current) ?? []) {
                if (!visited.has(neighbour)) {
                    queue.push(neighbour);
                }
            }
        }
        // Return real nodes that BFS never visited.
        return [...this.nodeIds].filter(id => !visited.has(id));
    }
}
//# sourceMappingURL=NodeScheduler.js.map