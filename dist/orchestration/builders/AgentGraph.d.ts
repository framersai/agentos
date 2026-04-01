/**
 * @file AgentGraph.ts
 * @description Fluent builder for constructing compiled agent execution graphs.
 *
 * `AgentGraph` provides a type-safe, chainable API for declaring nodes and edges —
 * including static, conditional, discovery-based, and personality-driven routing —
 * and then compiling the resulting graph into a `CompiledExecutionGraph` IR object
 * that the `GraphRuntime` can execute.
 *
 * ```
 * AgentGraph (builder)
 *   → GraphCompiler.compile()  → CompiledExecutionGraph (IR)
 *   → GraphValidator.validate() → validation gate
 *   → CompiledAgentGraph        → GraphRuntime.invoke() / stream() / resume()
 * ```
 *
 * Typical usage:
 * ```ts
 * const graph = new AgentGraph({ input: z.object({ topic: z.string() }), ... })
 *   .addNode('search', toolNode('web_search'))
 *   .addEdge(START, 'search')
 *   .addEdge('search', END)
 *   .compile();
 *
 * const result = await graph.invoke({ topic: 'AgentOS' });
 * ```
 */
import type { GraphNode, GraphState, CompiledExecutionGraph, StateReducers, MemoryConsistencyMode } from '../ir/types.js';
import { START, END } from '../ir/types.js';
import type { ICheckpointStore } from '../checkpoint/ICheckpointStore.js';
import type { GraphEvent } from '../events/GraphEvent.js';
export { START, END };
/**
 * Fluent builder for agent execution graphs.
 *
 * Each mutating method returns `this` to support method chaining.  All state is held
 * in private Maps/arrays; nothing is compiled or validated until `.compile()` is called.
 *
 * @template TState - Narrows the `GraphState` type used in conditional-edge callbacks.
 *   Defaults to the base `GraphState` when not specified.
 */
export declare class AgentGraph<TState extends GraphState = GraphState> {
    private readonly stateSchema;
    private readonly config?;
    /** All user-declared nodes, keyed by their assigned id. */
    private nodes;
    /** All directed edges declared via `addEdge`, `addConditionalEdge`, etc. */
    private edges;
    /** Monotonically increasing counter used to generate unique edge ids. */
    private edgeCounter;
    /**
     * @param stateSchema - Zod schemas for the three `GraphState` generic partitions.
     *   - `input`     — shape of the frozen user-provided input passed to `invoke()`.
     *   - `scratch`   — shape of the mutable node-to-node communication bag.
     *   - `artifacts` — shape of the accumulated external outputs returned by `invoke()`.
     * @param config - Optional graph-wide configuration overrides.
     */
    constructor(stateSchema: {
        /** Zod schema for `GraphState.input`. */
        input: any;
        /** Zod schema for `GraphState.scratch`. */
        scratch: any;
        /** Zod schema for `GraphState.artifacts`. */
        artifacts: any;
    }, config?: {
        /** Field-level merge strategies for `scratch` and `artifacts` fields. */
        reducers?: StateReducers;
        /** Graph-wide memory consistency mode (default: `'snapshot'`). */
        memoryConsistency?: MemoryConsistencyMode;
        /** Graph-wide checkpoint persistence strategy (default: `'none'`). */
        checkpointPolicy?: "every_node" | "explicit" | "none";
    } | undefined);
    /**
     * Add a node to the graph.
     *
     * The node's `id` field is overridden with the supplied `id` argument so the
     * user-declared identifier is always canonical.
     *
     * @param id   - Unique node identifier within this graph.  Must not equal `START` or `END`.
     * @param node - A `GraphNode` produced by one of the factory helpers in `builders/nodes.ts`.
     * @returns `this` for chaining.
     * @throws {Error} When `id` has already been registered.
     */
    addNode(id: string, node: GraphNode): this;
    /**
     * Add an unconditional (static) edge that is always followed at runtime.
     *
     * Either `source` or `target` (or both) may be the `START` / `END` sentinels.
     *
     * @param source - Source node id (or `START`).
     * @param target - Target node id (or `END`).
     * @returns `this` for chaining.
     */
    addEdge(source: string, target: string): this;
    /**
     * Add a conditional edge whose target is determined at runtime by a callback.
     *
     * The `condition` function receives the current `GraphState` and returns the id of
     * the next node to activate.  The returned id is resolved against the edge list at
     * runtime; no compile-time validation of the returned id is performed.
     *
     * Because conditional edges encode the target resolution in a closure, the `target`
     * field stored in the IR is set to the placeholder `'__CONDITIONAL__'`.
     *
     * @param source    - Source node id (or `START`).
     * @param condition - Pure function `(state: TState) => string` returning the next node id.
     * @returns `this` for chaining.
     */
    addConditionalEdge(source: string, condition: (state: TState) => string): this;
    /**
     * Add a discovery edge whose target is resolved at runtime via the capability discovery engine.
     *
     * When discovery returns no result, execution falls back to `config.fallbackTarget` (if provided)
     * or the placeholder `'__DISCOVERY__'`.
     *
     * @param source - Source node id.
     * @param config - Discovery configuration.
     * `config.query` is forwarded to the `CapabilityDiscoveryEngine`.
     * `config.kind` optionally restricts discovery to a specific capability kind.
     * `config.fallbackTarget` is used when discovery resolves no target.
     * @returns `this` for chaining.
     */
    addDiscoveryEdge(source: string, config: {
        /** Semantic query forwarded to the capability discovery engine. */
        query: string;
        /** Optional capability kind filter (`'tool'`, `'skill'`, `'extension'`, or `'any'`). */
        kind?: 'tool' | 'skill' | 'extension' | 'any';
        /** Fallback node id used when discovery resolves no target. */
        fallbackTarget?: string;
    }): this;
    /**
     * Add a personality edge whose target is chosen based on the agent's current trait value.
     *
     * At runtime the engine reads `config.trait` from the agent's HEXACO/PAD state and routes
     * to `config.above` when the value is ≥ `config.threshold`, or `config.below` otherwise.
     *
     * @param source - Source node id.
     * @param config - Personality routing configuration.
     * `config.trait` identifies the HEXACO/PAD value to inspect.
     * `config.threshold` is the decision boundary in the 0–1 range.
     * `config.above` is used when the trait value is greater than or equal to the threshold.
     * `config.below` is used when the trait value is below the threshold.
     * @returns `this` for chaining.
     */
    addPersonalityEdge(source: string, config: {
        /** HEXACO/PAD trait name, e.g. `'conscientiousness'` or `'openness'`. */
        trait: string;
        /** Decision threshold in range 0–1. */
        threshold: number;
        /** Target node id when the trait value is at or above the threshold. */
        above: string;
        /** Target node id when the trait value is below the threshold. */
        below: string;
    }): this;
    /**
     * Compile the builder state into a `CompiledAgentGraph` ready for execution.
     *
     * Compilation steps:
     * 1. Call `GraphCompiler.compile()` to produce the raw `CompiledExecutionGraph` IR.
     * 2. (Optional, default: enabled) Call `GraphValidator.validate()` to assert structural
     *    correctness — any validation error or warning causes an exception.
     * 3. Wrap the IR and a checkpoint store in a `CompiledAgentGraph` instance.
     *
     * Pass `{ validate: false }` to skip validation (e.g. for cyclic graphs under construction).
     *
     * @param options - Optional compilation flags.
     * `options.checkpointStore` overrides the default `InMemoryCheckpointStore`.
     * `options.validate` can be set to `false` to skip structural validation.
     * @returns A `CompiledAgentGraph` instance ready for `invoke()` / `stream()` / `resume()`.
     * @throws {Error} When validation is enabled and the graph contains structural errors or warnings.
     */
    compile(options?: {
        /** Custom checkpoint persistence backend. Defaults to an in-memory store. */
        checkpointStore?: ICheckpointStore;
        /**
         * Whether to run `GraphValidator.validate()` before returning.
         * Defaults to `true`. Set to `false` for cyclic or incomplete graphs under construction.
         */
        validate?: boolean;
    }): CompiledAgentGraph<TState>;
}
/**
 * A compiled, execution-ready agent graph.
 *
 * Returned by `AgentGraph.compile()` — do not instantiate directly.
 *
 * Wraps a `CompiledExecutionGraph` IR object and a `GraphRuntime` instance, exposing
 * the three execution modes: synchronous `invoke()`, streaming `stream()`, and
 * checkpoint-based `resume()`.
 *
 * @template TState - Type parameter threaded from the parent `AgentGraph`.
 */
export declare class CompiledAgentGraph<TState extends GraphState = GraphState> {
    private readonly ir;
    /** Internal `GraphRuntime` instance reused across all invocations. */
    private readonly runtime;
    /**
     * @param ir              - Compiled execution graph IR produced by `GraphCompiler`.
     * @param checkpointStore - Persistence backend for checkpoint snapshots.
     */
    constructor(ir: CompiledExecutionGraph, checkpointStore: ICheckpointStore);
    /**
     * Execute the graph to completion and return the final `artifacts` payload.
     *
     * This is the simplest execution mode — it buffers all events internally and returns
     * only the terminal output.  Use `stream()` when you need real-time progress updates.
     *
     * @param input - Initial user-provided input frozen into `GraphState.input`.
     * @returns The `GraphState.artifacts` value after the last node completes.
     */
    invoke(input: unknown): Promise<unknown>;
    /**
     * Execute the graph while yielding `GraphEvent` values at each significant step.
     *
     * Events are emitted in strict causal order:
     * `run_start` → (`node_start` → `node_end` → `edge_transition`?)+ → `run_end`
     *
     * @param input - Initial user-provided input frozen into `GraphState.input`.
     * @yields {GraphEvent} Runtime events in causal order.
     */
    stream(input: unknown): AsyncIterable<GraphEvent>;
    /**
     * Resume a previously interrupted run from its latest persisted checkpoint.
     *
     * The `patch` argument is accepted for API compatibility with future resume-with-patch
     * support; it is not forwarded to the runtime in the current implementation.
     *
     * @param checkpointId - Either the original run id or an exact checkpoint id.
     * @param patch        - Reserved for future use: optional partial state override.
     * @returns The final `GraphState.artifacts` value after resumption completes.
     * @throws {Error} When no checkpoint exists for the given identifier.
     */
    resume(checkpointId: string, patch?: Partial<TState>): Promise<unknown>;
    /**
     * Inspect execution state for a completed or in-progress run.
     *
     * @param _runId - The unique run identifier assigned at `stream()` call-time.
     * @returns A stub object — full inspection support is tracked separately.
     *
     * Full runtime inspection is not implemented yet; this currently returns a
     * stub object until the run-registry subsystem lands.
     */
    inspect(_runId: string): Promise<unknown>;
    /**
     * Return the underlying `CompiledExecutionGraph` IR.
     *
     * Useful for serialisation, debugging, or forwarding to external tooling.
     */
    toIR(): CompiledExecutionGraph;
}
//# sourceMappingURL=AgentGraph.d.ts.map