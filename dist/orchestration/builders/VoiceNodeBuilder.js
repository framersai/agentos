/**
 * @file VoiceNodeBuilder.ts
 * @description DSL builder for voice pipeline graph nodes.
 *
 * `voiceNode()` is the fluent factory for creating `GraphNode` IR entries of
 * type `'voice'`. It mirrors the ergonomics of `gmiNode()` / `toolNode()` but
 * targets the voice executor path, letting authors configure STT/TTS overrides,
 * turn limits, barge-in behaviour, and exit-reason routing in a single
 * declarative chain.
 *
 * ## Exit-reason routing
 *
 * Voice nodes complete with a reason string (e.g. `'completed'`, `'interrupted'`,
 * `'hangup'`, `'turns-exhausted'`, `'keyword:goodbye'`). The `on()` method maps
 * each reason to the next node id. These mappings are stored in `edges` on the
 * returned `GraphNode` and are expanded by the compiler into `GraphEdge` objects
 * during lowering.
 *
 * ## Produced GraphNode fields
 *
 * | Field           | Value              | Rationale                                        |
 * |-----------------|--------------------|--------------------------------------------------|
 * | `type`          | `'voice'`          | Selects the VoiceNodeExecutor at runtime.        |
 * | `executionMode` | `'react_bounded'`  | Voice nodes run a multi-turn loop, not one-shot. |
 * | `effectClass`   | `'external'`       | Voice I/O touches the real world (audio).        |
 * | `checkpoint`    | `'before'`         | Snapshot before session start for crash recovery.|
 *
 * @example
 * ```typescript
 * voiceNode('listen', { mode: 'conversation', maxTurns: 5 })
 *   .on('completed', 'summarize')
 *   .on('interrupted', 'listen')
 *   .on('hangup', 'end')
 *   .build();
 * ```
 *
 * See `VoiceNodeExecutor` for the runtime executor that processes voice nodes.
 * @see {@link VoiceNodeConfig} -- the configuration shape from the graph IR.
 */
// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------
/**
 * Create a new {@link VoiceNodeBuilder} for a voice pipeline graph node.
 *
 * This is the primary entry point for the voice node DSL. Use the returned
 * builder's `.on()` method to add exit-reason routes and `.build()` to
 * produce the `GraphNode` IR object.
 *
 * @param id     - Unique node identifier within the parent graph. Must be
 *                 unique across all nodes in the graph to avoid collision
 *                 in the edge map and checkpoint scratch keys.
 * @param config - Voice pipeline configuration for this node (mode, STT/TTS
 *                 overrides, turn limits, exit conditions).
 * @returns A fluent builder; call `.on()` to add exit-reason routes and
 *          `.build()` to produce the `GraphNode` IR object.
 *
 * @example
 * ```typescript
 * const node = voiceNode('greet', { mode: 'conversation' })
 *   .on('completed', 'process')
 *   .on('hangup', 'cleanup')
 *   .build();
 * ```
 *
 * @see {@link VoiceNodeBuilder} -- the returned builder class.
 */
export function voiceNode(id, config) {
    return new VoiceNodeBuilder(id, config);
}
// ---------------------------------------------------------------------------
// VoiceNodeBuilder
// ---------------------------------------------------------------------------
/**
 * Fluent DSL builder for voice graph nodes.
 *
 * Collects exit-reason -> target-node mappings via {@link on} and produces a
 * fully-specified `GraphNode` via {@link build}.
 *
 * The builder is designed to be chained. Each `on()` call returns `this`,
 * enabling a declarative voice node definition:
 *
 * ```typescript
 * voiceNode('listen', { mode: 'conversation', maxTurns: 5 })
 *   .on('completed', 'summarize')
 *   .on('interrupted', 'listen')
 *   .on('hangup', 'end')
 * ```
 *
 * @see {@link voiceNode} -- the factory function that creates builder instances.
 * See `VoiceNodeExecutor` for the runtime that resolves exit reasons and edge routing.
 */
export class VoiceNodeBuilder {
    /**
     * Creates a new VoiceNodeBuilder.
     *
     * @param id     - Node identifier; exposed as a readonly property for
     *                 introspection by callers that need to reference this
     *                 node before building (e.g. for cross-node edge wiring).
     * @param config - `VoiceNodeConfig` forwarded to the node's `executorConfig`
     *                 at build time. Immutable after construction.
     */
    constructor(
    /** The node id assigned at construction time. */
    id, config) {
        this.id = id;
        this.config = config;
        /**
         * Mapping from exit-reason string to target node id.
         * Populated by successive calls to {@link on}.
         *
         * Uses a `Map` rather than a plain object to preserve insertion order
         * (useful for debugging) and to allow O(1) overwrites when `on()` is
         * called with an already-registered reason.
         */
        this.edgeMap = new Map();
    }
    // -------------------------------------------------------------------------
    // Fluent API
    // -------------------------------------------------------------------------
    /**
     * Register an exit-reason -> target-node route.
     *
     * When the voice node's session ends with `exitReason`, the graph transitions
     * to `target`. Multiple calls to `on()` accumulate routes; calling `on()` with
     * a reason that was already registered overwrites the previous target.
     *
     * ## Common exit reasons
     *
     * | Reason              | When it fires                                    |
     * |---------------------|--------------------------------------------------|
     * | `'completed'`       | Session ended normally (catch-all).              |
     * | `'turns-exhausted'` | `maxTurns` reached.                              |
     * | `'hangup'`          | Transport disconnected.                          |
     * | `'interrupted'`     | User barged in (VoiceInterruptError).            |
     * | `'silence-timeout'` | No speech activity for 30 seconds.               |
     * | `'keyword:<word>'`  | A `final_transcript` contained an exit keyword.  |
     *
     * @param exitReason - The reason string returned by the voice executor.
     * @param target     - Either the string id of the target node, or an object
     *                     with an `id` property (compatible with other builder
     *                     instances, e.g. `voiceNode('other', ...)`).
     * @returns `this` for fluent chaining.
     *
     * @example
     * ```typescript
     * builder
     *   .on('completed', 'next-node')
     *   .on('hangup', { id: 'cleanup-node' });
     * ```
     */
    on(exitReason, target) {
        this.edgeMap.set(exitReason, typeof target === 'string' ? target : target.id);
        return this;
    }
    // -------------------------------------------------------------------------
    // Compilation
    // -------------------------------------------------------------------------
    /**
     * Produce a `GraphNode` IR object from the accumulated builder state.
     *
     * The returned node has:
     * - `type: 'voice'` in sync with `executorConfig.type`.
     * - `executionMode: 'react_bounded'` -- voice nodes run a multi-turn loop.
     * - `effectClass: 'external'` -- voice I/O touches the real world.
     * - `checkpoint: 'before'` -- snapshot taken before the session starts so the
     *   run can be resumed from the start of the voice turn if the process crashes.
     * - `edges` -- plain object mapping exit-reason strings to target node ids,
     *   populated from all `on()` calls. The compiler is responsible for
     *   expanding these into `GraphEdge` instances.
     *
     * @returns A `GraphNode` with the `edges` extension field. Cast to `any`
     *          to accommodate the `edges` field not present on the base interface.
     *
     * @example
     * ```typescript
     * const node = voiceNode('greet', { mode: 'conversation' })
     *   .on('completed', 'process')
     *   .build();
     *
     * console.log(node.type);             // 'voice'
     * console.log(node.edges.completed);  // 'process'
     * ```
     */
    build() {
        return {
            id: this.id,
            type: 'voice',
            executorConfig: { type: 'voice', voiceConfig: this.config },
            executionMode: 'react_bounded',
            effectClass: 'external',
            checkpoint: 'before',
            // The edges field is an extension not present on the base GraphNode
            // interface. It is consumed by the graph compiler during lowering and
            // by VoiceNodeExecutor for runtime route resolution.
            edges: Object.fromEntries(this.edgeMap),
        }; // Cast required because GraphNode's base interface doesn't declare `edges`.
    }
}
//# sourceMappingURL=VoiceNodeBuilder.js.map