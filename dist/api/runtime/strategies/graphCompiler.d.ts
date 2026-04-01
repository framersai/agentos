/**
 * @file graphCompiler.ts
 * Compiles agency() strategy configurations into CompiledExecutionGraph IR.
 *
 * This bridge enables the high-level agency() API to leverage the full
 * GraphRuntime DAG engine, gaining:
 *  - Checkpointing / mid-run persistence
 *  - Structured state passing (scratch/artifacts)
 *  - Conditional edge routing
 *  - Guardrail nodes
 *  - Parallel node execution
 *  - Serializable IR
 *
 * Each strategy maps to a different graph topology:
 *  - sequential: A -> B -> C -> END
 *  - parallel: START -> [A, B, C] -> synthesize -> END
 *  - debate: round-based chains with a final synthesizer
 *  - review-loop: producer -> reviewer -> conditional back-edge
 *  - hierarchical: manager GMI node with delegation tool calls
 *
 * @see {@link compileAgencyToGraph} -- the main entry point.
 * @see {@link GraphRuntime} -- the engine that executes the compiled graph.
 */
import type { CompiledExecutionGraph } from '../../../orchestration/ir/types.js';
import type { AgencyOptions } from '../types.js';
/**
 * Compiles an agency configuration into a CompiledExecutionGraph
 * that can be executed by GraphRuntime.
 *
 * Each sub-agent becomes a GMI node in the graph. The strategy
 * determines how nodes are connected:
 * - sequential: A -> B -> C -> END
 * - parallel: START -> [A, B, C] -> synthesize -> END
 * - debate: round-based sequential chain -> synthesize -> END
 * - review-loop: produce -> review -> (conditional) produce/END
 * - hierarchical: manager GMI node -> END (delegation via tool calls)
 *
 * The compiled graph carries:
 * - Proper state reducers for scratch field merging
 * - Checkpoint policy for mid-run persistence
 * - Schema declarations for input/scratch/artifacts
 *
 * @param config - The full AgencyOptions with agents, strategy, and settings.
 * @param prompt - The user's input prompt to inject into the graph's initial state.
 * @returns A CompiledExecutionGraph ready for GraphRuntime.invoke() or .stream().
 *
 * @example
 * ```ts
 * const graph = compileAgencyToGraph(agencyConfig, 'Summarise AI research.');
 * const runtime = new GraphRuntime({ checkpointStore, nodeExecutor });
 * const result = await runtime.invoke(graph, { prompt: 'Summarise AI research.' });
 * ```
 */
export declare function compileAgencyToGraph(config: AgencyOptions, prompt: string): CompiledExecutionGraph;
/**
 * Maps the final GraphState from a GraphRuntime run back to the shape
 * expected by the agency API's GenerateTextResult.
 *
 * Extracts the final text output from artifacts/scratch and constructs
 * the agentCalls array from the graph's diagnostic node timings.
 *
 * @param finalOutput - The artifacts payload returned by GraphRuntime.invoke().
 * @param config - The original agency configuration (used for metadata).
 * @returns An object compatible with the agency execute() return shape.
 */
export declare function mapGraphResultToAgencyResult(finalOutput: unknown, config: AgencyOptions): Record<string, unknown>;
/**
 * Maps a GraphEvent from the runtime's stream into an AgencyStreamPart.
 *
 * Translates the lower-level graph events (node_start, node_end, text_delta)
 * into the agency-level event vocabulary (agent-start, agent-end, text).
 *
 * @param event - A GraphEvent from GraphRuntime.stream().
 * @param config - The original agency configuration (used for metadata).
 * @returns An AgencyStreamPart, or null if the event has no agency-level equivalent.
 */
export declare function mapGraphEventToAgencyEvent(event: {
    type: string;
    [key: string]: unknown;
}, config: AgencyOptions): {
    type: string;
    [key: string]: unknown;
} | null;
//# sourceMappingURL=graphCompiler.d.ts.map