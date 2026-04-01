/**
 * @file GraphRuntime.ts
 * @description Main execution engine for the AgentOS Unified Orchestration Layer.
 *
 * `GraphRuntime` ties together the `StateManager`, `NodeScheduler`, `NodeExecutor`,
 * and `ICheckpointStore` subsystems into a single runnable unit. It supports three
 * execution modes:
 *
 * - **`invoke()`** — execute a graph to completion and return final artifacts.
 * - **`stream()`** — execute a graph while yielding `GraphEvent` values at every step.
 * - **`resume()`** — restore a previously interrupted run from its latest checkpoint.
 *
 * Design principles:
 * - No mutable instance state beyond the injected config; each `invoke`/`stream`/`resume`
 *   call is fully isolated.
 * - All state lives in `GraphState`; `StateManager` is the sole authority for mutations.
 * - Checkpointing is always delegated to the injected `ICheckpointStore`.
 * - Edge evaluation is a pure function of `GraphEdge[]`, `GraphState`, and `NodeExecutionResult`.
 */
import type { CompiledExecutionGraph, EffectClass, GraphState } from '../ir/types.js';
import type { GraphEvent, MissionExpansionTrigger, MissionGraphPatch } from '../events/GraphEvent.js';
import type { ICheckpointStore } from '../checkpoint/ICheckpointStore.js';
import { NodeExecutor } from './NodeExecutor.js';
/**
 * Dependencies required to construct a `GraphRuntime`.
 *
 * @property checkpointStore - Persistence backend for checkpoint snapshots.
 * @property nodeExecutor    - Dispatcher that runs individual graph nodes.
 */
export interface GraphRuntimeConfig {
    /** Persistence backend for checkpoint snapshots. */
    checkpointStore: ICheckpointStore;
    /** Dispatcher that executes individual `GraphNode` instances. */
    nodeExecutor: NodeExecutor;
    /** Optional mission graph expansion hook applied between node executions. */
    expansionHandler?: GraphExpansionHandler;
    /** Optional periodic planner reevaluation cadence, in completed nodes. */
    reevalInterval?: number;
    /**
     * Optional discovery engine for `discovery`-type edge routing.
     * When present and an edge has a `discoveryQuery`, the engine is called to
     * resolve the target dynamically. Falls back to `discoveryFallback` when absent.
     */
    discoveryEngine?: {
        discover(query: string, options?: unknown): Promise<{
            results?: Array<{
                id?: string;
                name?: string;
            }>;
        }>;
    };
    /**
     * Optional persona trait values for `personality`-type edge routing.
     * Keys are trait names (e.g. `'openness'`), values are 0–1 floats.
     * When absent, traits are read from `state.scratch._personaTraits` or default to 0.5.
     */
    personaTraits?: Record<string, number>;
}
export interface GraphExpansionRequest {
    trigger: MissionExpansionTrigger;
    reason: string;
    request: unknown;
    patch?: MissionGraphPatch;
}
export interface GraphExpansionContext {
    graph: CompiledExecutionGraph;
    runId: string;
    nodeId: string;
    state: GraphState;
    request: GraphExpansionRequest;
    checkpointIdBefore?: string;
    completedNodes: string[];
    skippedNodes: string[];
    nodeResults: Record<string, {
        effectClass: EffectClass;
        output: unknown;
        durationMs: number;
    }>;
}
export interface GraphExpansionResult {
    graph?: CompiledExecutionGraph;
    events?: GraphEvent[];
}
export interface GraphExpansionHandler {
    handle(context: GraphExpansionContext): Promise<GraphExpansionResult | null>;
}
/**
 * Main execution engine for compiled AgentOS graphs.
 *
 * Instantiate once and reuse across multiple runs — the runtime itself is stateless
 * between calls. Each `invoke()` / `stream()` / `resume()` call creates isolated local
 * state tracked via closures.
 *
 * @example
 * ```ts
 * const runtime = new GraphRuntime({ checkpointStore, nodeExecutor });
 * const result = await runtime.invoke(compiledGraph, { query: 'hello' });
 * ```
 */
export declare class GraphRuntime {
    private readonly config;
    /**
     * @param config - Injected dependencies shared across all runs handled by this instance.
     */
    constructor(config: GraphRuntimeConfig);
    /**
     * Execute the graph to completion and return the final `artifacts` payload.
     *
     * This is a convenience wrapper around `stream()` that discards intermediate events
     * and awaits the terminal `run_end` event.
     *
     * @param graph - Compiled execution graph to run.
     * @param input - Initial user-provided input; frozen into `GraphState.input`.
     * @returns The `GraphState.artifacts` value after the last node completes.
     */
    invoke(graph: CompiledExecutionGraph, input: unknown): Promise<unknown>;
    /**
     * Execute the graph while yielding `GraphEvent` values at each significant step.
     *
     * Events are emitted in strict causal order:
     * `run_start` → (`node_start` → `node_end` → `edge_transition`?)+ → `run_end`
     *
     * Checkpoints are saved according to both the graph-wide `checkpointPolicy` and
     * per-node `checkpoint` settings. An `interrupt` event causes immediate suspension
     * followed by a terminal `run_end`.
     *
     * @param graph - Compiled execution graph to run.
     * @param input - Initial user-provided input; frozen into `GraphState.input`.
     * @yields {GraphEvent} Runtime events in causal order.
     */
    stream(graph: CompiledExecutionGraph, input: unknown): AsyncGenerator<GraphEvent>;
    /**
     * Resume a previously interrupted run from its latest persisted checkpoint.
     *
     * The runtime restores `GraphState` from the checkpoint and re-executes any nodes
     * that had not yet completed when the run was suspended. Nodes recorded as
     * `write`, `external`, or `human` effect-class are replayed from their stored
     * outputs to avoid duplicate side-effects; all other nodes are re-executed.
     *
     * @param graph - The same compiled graph that was originally invoked.
     * @param runOrCheckpointId - Either the original run id or an exact checkpoint id.
     * @returns The final `GraphState.artifacts` value after resumption completes.
     * @throws {Error} When no checkpoint exists for the given identifier.
     */
    resume(graph: CompiledExecutionGraph, runOrCheckpointId: string): Promise<unknown>;
    /**
     * Resume a previously interrupted run and stream runtime events from the restore point.
     *
     * Accepts either the original run id or an exact checkpoint id. The resolved checkpoint
     * is used to reconstruct `GraphState`, then execution continues through the same event
     * stream contract as {@link stream()}.
     *
     * @param graph - Compiled execution graph to resume.
     * @param runOrCheckpointId - Either the original run id or an exact checkpoint id.
     * @yields {GraphEvent} Runtime events in causal order from the checkpoint onward.
     * @throws {Error} When no checkpoint exists for the given identifier.
     */
    streamResume(graph: CompiledExecutionGraph, runOrCheckpointId: string): AsyncGenerator<GraphEvent>;
    /**
     * Continue execution from a restored checkpoint state.
     *
     * Mirrors `stream()` but initialises `completedNodes` / `nodeResults` from the
     * checkpoint so previously-finished work is not repeated. Nodes with side-effectful
     * effect classes are replayed from stored outputs; pure / read nodes are re-executed.
     *
     * @param graph      - The compiled execution graph.
     * @param runId      - Original run identifier for checkpoint persistence.
     * @param state      - `GraphState` restored from the checkpoint.
     * @param checkpoint - Full checkpoint snapshot; provides `nodeResults` and `visitedNodes`.
     * @yields {GraphEvent} Runtime events in causal order, starting from the resume point.
     */
    private continueFromCheckpoint;
    /**
     * Evaluate the outgoing edges from a just-completed node and return the list of
     * target node ids to activate next.
     *
     * Priority rule: if `result.routeTarget` is set (returned by `router` or `guardrail`
     * nodes) it overrides any edge-derived targets.
     *
     * @param edges  - All outgoing edges from the source node.
     * @param state  - Current `GraphState` passed to condition functions.
     * @param result - Execution result; `routeTarget` takes precedence when present.
     * @returns Ordered array of target node ids (may include `END`).
     */
    private evaluateEdges;
    /**
     * Serialize the current execution state into a `Checkpoint` and persist it
     * via the injected `ICheckpointStore`.
     *
     * @param graph        - The compiled graph (provides `id`).
     * @param runId        - Unique run identifier assigned at `stream()` call-time.
     * @param nodeId       - The node at whose boundary the checkpoint is being taken.
     * @param state        - Current full `GraphState`.
     * @param nodeResults  - Accumulated per-node execution results.
     * @param visitedNodes - Ordered list of completed node ids.
     */
    private saveCheckpoint;
    private attachCheckpointMetadata;
    private extractTimeoutMs;
    private resolvePendingEdgeIds;
}
//# sourceMappingURL=GraphRuntime.d.ts.map