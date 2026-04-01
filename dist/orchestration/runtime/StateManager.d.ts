/**
 * @file StateManager.ts
 * @description Manages the mutable {@link GraphState} partitions for an active graph run.
 *
 * Responsibilities:
 *  - Creating a clean initial state from caller-supplied input.
 *  - Applying node output patches to the `scratch` partition, honoring per-field
 *    {@link StateReducers} for deterministic conflict resolution.
 *  - Applying node output patches to the `artifacts` partition (last-write-wins by default).
 *  - Merging states produced by parallel branches using the same reducer logic.
 *  - Tracking the ordered list of visited node ids and the global iteration counter.
 *
 * `StateManager` is intentionally stateless between calls — it receives the current
 * {@link GraphState} as an argument and returns a *new* object; it never mutates in place.
 * This makes it straightforward to unit-test and safe to use in concurrent contexts.
 */
import type { StateReducers, GraphState } from '../ir/types.js';
/**
 * Manages the {@link GraphState} partitions (`input`, `scratch`, `artifacts`,
 * `memory`, `diagnostics`) for a single graph run.
 *
 * All methods return a *new* `GraphState` object; the original is never mutated.
 *
 * @example
 * ```ts
 * const manager = new StateManager({ 'scratch.messages': 'concat' });
 * let state = manager.initialize({ prompt: 'Hello' });
 * state = manager.updateScratch(state, { messages: ['first'] });
 * state = manager.updateScratch(state, { messages: ['second'] });
 * // state.scratch.messages === ['first', 'second']
 * ```
 */
export declare class StateManager {
    private readonly reducers;
    /**
     * @param reducers - Field-level reducer configuration keyed by dot-notation paths
     *                   (e.g. `'scratch.messages'`).  Determines how conflicting values
     *                   are merged during `updateScratch()` and `mergeParallelBranches()`.
     */
    constructor(reducers: StateReducers);
    /**
     * Create a clean initial {@link GraphState} from the caller-supplied `input` value.
     *
     * The `input` partition is frozen with `Object.freeze()` so that no node can
     * accidentally mutate it.  All other partitions start empty.
     *
     * @param input - Arbitrary value provided by the graph caller; becomes `state.input`.
     * @returns A fully initialised `GraphState` ready for the first node execution.
     */
    initialize(input: unknown): GraphState;
    /**
     * Apply a `patch` to the `scratch` partition, honoring any registered reducers.
     *
     * For each key in `patch`:
     *  - If a reducer is registered at `scratch.<key>` **and** the key already exists
     *    in the current scratch, the reducer is called to merge the existing and incoming
     *    values.
     *  - Otherwise the incoming value simply overwrites (last-write-wins semantics).
     *
     * @param state - Current graph state (not mutated).
     * @param patch - Partial scratch update emitted by a completed node.
     * @returns New `GraphState` with the merged scratch partition.
     */
    updateScratch(state: GraphState, patch: Record<string, unknown>): GraphState;
    /**
     * Apply a `patch` to the `artifacts` partition using last-write-wins semantics.
     *
     * Artifact fields are intended for caller-facing outputs and are not subject to
     * reducer logic in this method.  If you need reducer-aware artifact merging, use
     * `mergeParallelBranches()` instead.
     *
     * @param state - Current graph state (not mutated).
     * @param patch - Partial artifacts update emitted by a completed node.
     * @returns New `GraphState` with the updated artifacts partition.
     */
    updateArtifacts(state: GraphState, patch: Record<string, unknown>): GraphState;
    /**
     * Record that execution has entered `nodeId`.
     *
     * Updates `currentNodeId`, appends to `visitedNodes`, and increments `iteration`.
     *
     * @param state  - Current graph state (not mutated).
     * @param nodeId - Id of the node that is about to execute.
     * @returns New `GraphState` reflecting the visit.
     */
    recordNodeVisit(state: GraphState, nodeId: string): GraphState;
    /**
     * Merge the `scratch` partitions of one or more parallel branch states back into
     * a single `GraphState`.
     *
     * The algorithm walks every key present in any branch's scratch object and applies
     * the registered reducer for that key (if any) against the accumulator.  When no
     * reducer is registered, the last branch's value wins.
     *
     * The `artifacts`, `memory`, `diagnostics`, `visitedNodes`, and `iteration` fields
     * of `baseState` are preserved unchanged — the caller is responsible for merging
     * those separately if needed.
     *
     * @param baseState    - State prior to the parallel fan-out (provides the baseline scratch).
     * @param branchStates - States produced by each parallel branch.
     * @returns New `GraphState` with the merged scratch partition.
     */
    mergeParallelBranches(baseState: GraphState, branchStates: GraphState[]): GraphState;
    /**
     * Dispatch to a {@link BuiltinReducer} strategy or call a custom {@link ReducerFn}.
     *
     * @param reducer  - The reducer to apply.
     * @param existing - Value currently stored in `GraphState`.
     * @param incoming - New value emitted by the most recently completed node.
     * @returns The merged value.
     */
    private applyReducer;
    /**
     * Construct an empty {@link MemoryView} used during state initialisation.
     */
    private emptyMemoryView;
    /**
     * Construct a zeroed {@link DiagnosticsView} used during state initialisation.
     */
    private emptyDiagnostics;
}
//# sourceMappingURL=StateManager.d.ts.map