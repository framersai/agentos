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
import type { CompiledExecutionGraph } from '../ir/types.js';
/**
 * The result returned by `GraphValidator.validate()`.
 *
 * `valid` is `true` iff `errors` is empty — warnings do not affect validity.
 */
export interface ValidationResult {
    /** `true` when no structural errors were found. */
    valid: boolean;
    /** Fatal structural problems that would prevent correct execution. */
    errors: string[];
    /** Non-fatal issues that should be reviewed but do not block execution. */
    warnings: string[];
}
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
export declare class GraphValidator {
    /**
     * Validates a compiled execution graph.
     *
     * @param graph   - The `CompiledExecutionGraph` produced by a compiler pass.
     * @param options - Optional validation flags.
     * @param options.requireAcyclic - When `true` (the default) any cycle is treated as an error.
     *   Pass `false` to allow cyclic graphs (e.g. iterative agent loops).
     * @returns A `ValidationResult` describing errors and warnings found.
     */
    static validate(graph: CompiledExecutionGraph, options?: {
        requireAcyclic?: boolean;
    }): ValidationResult;
}
//# sourceMappingURL=Validator.d.ts.map