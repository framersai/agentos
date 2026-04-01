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
import type { GraphNode, GraphEdge, CompiledExecutionGraph, StateReducers, MemoryConsistencyMode } from '../ir/types.js';
/**
 * Everything the compiler needs to produce a `CompiledExecutionGraph`.
 *
 * @property name               - Human-readable name embedded in the compiled graph.
 * @property nodes              - All user-declared nodes keyed by their declared id.
 * @property edges              - All directed edges (including START / END connections).
 * @property stateSchema        - Zod schema instances for the three GraphState generics.
 * @property reducers           - Field-level merge strategies forwarded unchanged to the IR.
 * @property memoryConsistency  - Graph-wide memory isolation mode.
 * @property checkpointPolicy   - Graph-wide default checkpoint persistence strategy.
 */
export interface GraphCompilerInput {
    /** Human-readable graph name; used as the `name` field in the compiled output. */
    name: string;
    /** All `GraphNode` instances keyed by their assigned id. */
    nodes: Map<string, GraphNode>;
    /** All directed edges declared by the builder (start/end sentinels included). */
    edges: GraphEdge[];
    /**
     * Zod schema instances for each of the three `GraphState` generic partitions.
     * Lowered to JSON Schema during compilation via `lowerZodToJsonSchema`.
     */
    stateSchema: {
        /** Schema for `GraphState.input` — the frozen user-provided input. */
        input: any;
        /** Schema for `GraphState.scratch` — the node-to-node communication bag. */
        scratch: any;
        /** Schema for `GraphState.artifacts` — accumulated external outputs. */
        artifacts: any;
    };
    /** Field-level reducer configuration passed through to the IR without modification. */
    reducers: StateReducers;
    /** Graph-wide memory consistency mode. */
    memoryConsistency: MemoryConsistencyMode;
    /** Graph-wide checkpoint persistence strategy. */
    checkpointPolicy: 'every_node' | 'explicit' | 'none';
}
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
export declare class GraphCompiler {
    /**
     * Compile builder state into a `CompiledExecutionGraph` IR object.
     *
     * This method is **pure** — it reads from `input` and returns a new object without
     * mutating any of its arguments.
     *
     * @param input - The full set of builder state required for compilation.
     * @returns A `CompiledExecutionGraph` ready for validation and execution.
     */
    static compile(input: GraphCompilerInput): CompiledExecutionGraph;
}
//# sourceMappingURL=GraphCompiler.d.ts.map