/**
 * @file VoiceNodeBuilder.ts
 * @description DSL builder for voice pipeline graph nodes.
 *
 * `voiceNode()` is the fluent factory for creating `GraphNode` IR entries of
 * type `'voice'`.  It mirrors the ergonomics of `gmiNode()` / `toolNode()` but
 * targets the voice executor path, letting authors configure STT/TTS overrides,
 * turn limits, barge-in behaviour, and exit-reason routing in a single
 * declarative chain.
 *
 * Exit-reason routing is the key concept: voice nodes complete with a reason
 * string (e.g. `'completed'`, `'interrupted'`, `'hangup'`), and `on()` maps
 * each reason to the next node id.  These mappings are stored in `edges` on the
 * returned `GraphNode` and are intended to be expanded by the compiler into
 * `GraphEdge` objects during lowering.
 *
 * @example
 * ```typescript
 * voiceNode('listen', { mode: 'conversation', maxTurns: 5 })
 *   .on('completed', 'summarize')
 *   .on('interrupted', 'listen')
 *   .on('hangup', 'end')
 *   .build();
 * ```
 */

import type { GraphNode, VoiceNodeConfig } from '../ir/types.js';

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a new {@link VoiceNodeBuilder} for a voice pipeline graph node.
 *
 * @param id     - Unique node identifier within the parent graph.
 * @param config - Voice pipeline configuration for this node.
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
 */
export function voiceNode(id: string, config: VoiceNodeConfig): VoiceNodeBuilder {
  return new VoiceNodeBuilder(id, config);
}

// ---------------------------------------------------------------------------
// VoiceNodeBuilder
// ---------------------------------------------------------------------------

/**
 * Fluent DSL builder for voice graph nodes.
 *
 * Collects exit-reason → target-node mappings via {@link on} and produces a
 * fully-specified `GraphNode` via {@link build}.
 *
 * The builder is designed to be chained:
 * ```typescript
 * voiceNode('listen', { mode: 'conversation', maxTurns: 5 })
 *   .on('completed', 'summarize')
 *   .on('interrupted', 'listen')
 *   .on('hangup', 'end')
 * ```
 */
export class VoiceNodeBuilder {
  /**
   * Mapping from exit-reason string to target node id.
   * Populated by successive calls to {@link on}.
   */
  private edgeMap = new Map<string, string>();

  /**
   * @param id     - Node identifier; exposed as a readonly property for introspection.
   * @param config - `VoiceNodeConfig` forwarded to the node's `executorConfig`.
   */
  constructor(
    /** The node id assigned at construction time. */
    readonly id: string,
    private readonly config: VoiceNodeConfig,
  ) {}

  // -------------------------------------------------------------------------
  // Fluent API
  // -------------------------------------------------------------------------

  /**
   * Register an exit-reason → target-node route.
   *
   * When the voice node's session ends with `exitReason`, the graph transitions
   * to `target`.  Multiple calls to `on()` accumulate routes; calling `on()` with
   * a reason that was already registered overwrites the previous target.
   *
   * @param exitReason - The reason string returned by the voice executor
   *                     (e.g. `'completed'`, `'interrupted'`, `'hangup'`,
   *                     `'turns-exhausted'`, `'silence-timeout'`).
   * @param target     - Either the string id of the target node, or an object
   *                     with an `id` property (compatible with builder instances).
   * @returns `this` for fluent chaining.
   *
   * @example
   * ```typescript
   * builder
   *   .on('completed', 'next-node')
   *   .on('hangup', { id: 'cleanup-node' });
   * ```
   */
  on(exitReason: string, target: string | { id: string }): this {
    this.edgeMap.set(
      exitReason,
      typeof target === 'string' ? target : target.id,
    );
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
   * - `executionMode: 'react_bounded'` — voice nodes run a multi-turn loop.
   * - `effectClass: 'external'` — voice I/O touches the real world.
   * - `checkpoint: 'before'` — snapshot taken before the session starts so the
   *   run can be resumed from the start of the voice turn if the process crashes.
   * - `edges` — plain object mapping exit-reason strings to target node ids,
   *   populated from all `on()` calls.  The compiler is responsible for
   *   expanding these into `GraphEdge` instances.
   *
   * @returns A `GraphNode` cast to `any` to accommodate the `edges` extension
   *          field not present on the base interface.
   */
  build(): GraphNode {
    return {
      id: this.id,
      type: 'voice',
      executorConfig: { type: 'voice', voiceConfig: this.config },
      executionMode: 'react_bounded',
      effectClass: 'external',
      checkpoint: 'before',
      edges: Object.fromEntries(this.edgeMap),
    } as any; // GraphNode has more required fields; cast for builder convenience
  }
}
