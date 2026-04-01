/**
 * @file Validator.ts
 * @description Static graph validator for `CompiledExecutionGraph` IR objects.
 *
 * Validation is split into two severity levels:
 *   - **errors**   — structural problems that will cause runtime failures (missing entry/exit
 *     points, dangling edge references, cycles when acyclicity is required).
 *   - **warnings** — non-fatal issues worth investigating (unreachable nodes).
 *
 * The validator delegates cycle detection and reachability analysis to `NodeScheduler`,
 * which already implements Kahn's algorithm and DFS reachability traversal.
 */
import { NodeScheduler } from '../runtime/NodeScheduler.js';
// ---------------------------------------------------------------------------
// GraphValidator
// ---------------------------------------------------------------------------
/**
 * Static validator for compiled execution graphs.
 *
 * Runs a suite of structural checks against a `CompiledExecutionGraph`:
 *
 * 1. **Cycle detection** — rejects cyclic graphs when `requireAcyclic` is not `false`.
 * 2. **Unreachable nodes** — warns when one or more nodes cannot be reached from `__START__`.
 * 3. **Edge reference integrity** — errors when an edge's source/target names a non-existent node
 *    (ignoring the sentinel values `__START__` and `__END__`).
 * 4. **Entry point** — errors when no edge originates from `__START__`.
 * 5. **Exit point** — errors when no edge terminates at `__END__`.
 *
 * @example
 * ```ts
 * const result = GraphValidator.validate(graph, { requireAcyclic: true });
 * if (!result.valid) {
 *   throw new Error(result.errors.join('\n'));
 * }
 * ```
 */
export class GraphValidator {
    /**
     * Validates a compiled execution graph.
     *
     * @param graph   - The `CompiledExecutionGraph` produced by a compiler pass.
     * @param options - Optional validation flags.
     * @param options.requireAcyclic - When `true` (the default) any cycle is treated as an error.
     *   Pass `false` to allow cyclic graphs (e.g. iterative agent loops).
     * @returns A `ValidationResult` describing errors and warnings found.
     */
    static validate(graph, options) {
        const errors = [];
        const warnings = [];
        // Delegate cycle detection and reachability analysis to NodeScheduler.
        const scheduler = new NodeScheduler(graph.nodes, graph.edges);
        // -----------------------------------------------------------------------
        // 1. Cycle detection
        // -----------------------------------------------------------------------
        // Default behaviour: acyclicity is required.  Authors opt into cycles by
        // explicitly passing { requireAcyclic: false }.
        if (options?.requireAcyclic !== false && scheduler.hasCycles()) {
            errors.push('Graph contains a cycle — cycles are not allowed when requireAcyclic is true');
        }
        // -----------------------------------------------------------------------
        // 2. Unreachable nodes
        // -----------------------------------------------------------------------
        const unreachable = scheduler.getUnreachableNodes();
        if (unreachable.length > 0) {
            warnings.push(`Unreachable nodes detected: ${unreachable.join(', ')}`);
        }
        // -----------------------------------------------------------------------
        // 3. Edge reference integrity
        // -----------------------------------------------------------------------
        // Build a fast-lookup set of declared node ids.
        const nodeIds = new Set(graph.nodes.map((n) => n.id));
        for (const edge of graph.edges) {
            // __START__ and __END__ are virtual sentinels — they are never in graph.nodes.
            if (edge.source !== '__START__' && !nodeIds.has(edge.source)) {
                errors.push(`Edge ${edge.id} references unknown source node: ${edge.source}`);
            }
            if (edge.target !== '__END__' && !nodeIds.has(edge.target)) {
                errors.push(`Edge ${edge.id} references unknown target node: ${edge.target}`);
            }
        }
        // -----------------------------------------------------------------------
        // 4. Entry point check
        // -----------------------------------------------------------------------
        if (!graph.edges.some((e) => e.source === '__START__')) {
            errors.push('No edges from START — graph has no entry point');
        }
        // -----------------------------------------------------------------------
        // 5. Exit point check
        // -----------------------------------------------------------------------
        if (!graph.edges.some((e) => e.target === '__END__')) {
            errors.push('No edges to END — graph has no exit point');
        }
        return { valid: errors.length === 0, errors, warnings };
    }
}
//# sourceMappingURL=Validator.js.map