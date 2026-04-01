/**
 * @file GraphCompiler.ts
 * @description Compiles an AgentGraph builder's internal state into a `CompiledExecutionGraph` IR object.
 *
 * The compiler is a pure, stateless transformation — it accepts a snapshot of the builder's
 * node map and edge list, lowers Zod schemas to JSON Schema, and produces the canonical IR
 * that the `GraphRuntime` operates on.
 *
 * This is intentionally thin: validation belongs in `GraphValidator`, optimisation passes
 * (dead-node elimination, edge compaction) can be added as separate compiler passes later.
 */
import { lowerZodToJsonSchema } from './SchemaLowering.js';
// ---------------------------------------------------------------------------
// GraphCompiler
// ---------------------------------------------------------------------------
/**
 * Stateless compiler that transforms AgentGraph builder state into a `CompiledExecutionGraph`.
 *
 * Compilation steps:
 * 1. Flatten the `nodes` Map into a plain array (preserving insertion order).
 * 2. Copy the `edges` array without transformation.
 * 3. Lower each Zod state schema to a JSON Schema object via `lowerZodToJsonSchema`.
 * 4. Assign a unique `id` based on `name` and the current timestamp.
 * 5. Forward `reducers`, `memoryConsistency`, and `checkpointPolicy` unchanged.
 *
 * @example
 * ```ts
 * const ir = GraphCompiler.compile({
 *   name: 'my-agent',
 *   nodes,
 *   edges,
 *   stateSchema: { input: z.object({ topic: z.string() }), scratch: z.object({}), artifacts: z.object({}) },
 *   reducers: {},
 *   memoryConsistency: 'snapshot',
 *   checkpointPolicy: 'none',
 * });
 * ```
 */
export class GraphCompiler {
    /**
     * Compile builder state into a `CompiledExecutionGraph` IR object.
     *
     * This method is **pure** — it reads from `input` and returns a new object without
     * mutating any of its arguments.
     *
     * @param input - The full set of builder state required for compilation.
     * @returns A `CompiledExecutionGraph` ready for validation and execution.
     */
    static compile(input) {
        return {
            // Unique graph id: name slug + wall-clock timestamp for collision resistance.
            id: `graph-${input.name}-${Date.now()}`,
            name: input.name,
            // Flatten Map → Array preserving the order in which nodes were added to the builder.
            nodes: Array.from(input.nodes.values()),
            // Edges are already an array; copy reference (immutable after compile).
            edges: input.edges,
            // Lower each Zod schema partition to a plain JSON Schema object.
            stateSchema: {
                input: lowerZodToJsonSchema(input.stateSchema.input),
                scratch: lowerZodToJsonSchema(input.stateSchema.scratch),
                artifacts: lowerZodToJsonSchema(input.stateSchema.artifacts),
            },
            // Forward reducer, consistency, and checkpoint config unchanged.
            reducers: input.reducers,
            checkpointPolicy: input.checkpointPolicy,
            memoryConsistency: input.memoryConsistency,
        };
    }
}
//# sourceMappingURL=GraphCompiler.js.map