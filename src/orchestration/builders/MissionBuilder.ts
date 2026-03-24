/**
 * @file MissionBuilder.ts
 * @description Fluent builder API for goal-oriented mission authoring.
 *
 * The `mission()` factory function returns a `MissionBuilder` that collects
 * configuration through a chainable interface before compiling the mission into
 * a `CompiledMission` — the execution-ready wrapper that exposes `invoke()`,
 * `stream()`, `resume()`, `explain()`, and `toIR()`.
 *
 * Typical usage:
 * ```ts
 * const researchMission = mission('research')
 *   .input(z.object({ topic: z.string() }))
 *   .goal('Research {{topic}} and produce a concise summary')
 *   .returns(z.object({ summary: z.string() }))
 *   .planner({ strategy: 'linear', maxSteps: 6 })
 *   .policy({ guardrails: ['content-safety'] })
 *   .compile();
 *
 * const result = await researchMission.invoke({ topic: 'quantum computing' });
 * ```
 */

import type { GraphNode, CompiledExecutionGraph, GraphState } from '../ir/types.js';
import type { ICheckpointStore } from '../checkpoint/ICheckpointStore.js';
import { InMemoryCheckpointStore } from '../checkpoint/InMemoryCheckpointStore.js';
import { MissionCompiler, type MissionConfig } from '../compiler/MissionCompiler.js';
import { GraphRuntime } from '../runtime/GraphRuntime.js';
import { NodeExecutor } from '../runtime/NodeExecutor.js';
import type { GraphEvent } from '../events/GraphEvent.js';

// ---------------------------------------------------------------------------
// Factory function
// ---------------------------------------------------------------------------

/**
 * Create a new `MissionBuilder` for the named mission.
 *
 * @param name - Human-readable mission name; used as the compiled graph's display name
 *               and as a stable slug prefix for run ids and checkpoint keys.
 * @returns A fresh `MissionBuilder` instance ready to be configured.
 *
 * @example
 * ```ts
 * const m = mission('summarise-article')
 *   .input(inputSchema)
 *   .goal('Summarise {{url}} in three bullet points')
 *   .returns(outputSchema)
 *   .planner({ strategy: 'linear', maxSteps: 4 })
 *   .compile();
 * ```
 */
export function mission(name: string): MissionBuilder {
  return new MissionBuilder(name);
}

// ---------------------------------------------------------------------------
// MissionBuilder
// ---------------------------------------------------------------------------

/**
 * Fluent builder that collects mission configuration and validates it at `.compile()` time.
 *
 * All setter methods return `this` for chaining.  No compilation work is performed until
 * `.compile()` is called, ensuring fast construction of mission objects at module load time.
 */
export class MissionBuilder {
  /** @internal Zod or JSON-Schema describing the mission's input payload. */
  private _inputSchema: any;
  /** @internal Goal prompt template with optional `{{variable}}` placeholders. */
  private _goalTemplate: string = '';
  /** @internal Zod or JSON-Schema describing the mission's output artifacts. */
  private _returnsSchema: any;
  /** @internal Planner configuration (strategy, step budget, iteration caps). */
  private _plannerConfig: MissionConfig['plannerConfig'] | undefined;
  /** @internal Optional mission-level policy overrides. */
  private _policyConfig: MissionConfig['policyConfig'];
  /** @internal Declarative anchor node splice descriptors. */
  private _anchors: MissionConfig['anchors'] = [];

  /**
   * @param name - Display name for this mission; passed through to the compiled graph.
   */
  constructor(private readonly name: string) {}

  // -------------------------------------------------------------------------
  // Builder setters
  // -------------------------------------------------------------------------

  /**
   * Declare the input schema for this mission.
   *
   * Accepts a Zod schema object or a plain JSON-Schema `Record<string, unknown>`.
   * The schema is stored in the compiled graph's `stateSchema.input` field and used
   * by the runtime for optional input validation.
   *
   * @param schema - Zod or JSON-Schema object describing the expected input payload.
   */
  input(schema: any): this {
    this._inputSchema = schema;
    return this;
  }

  /**
   * Set the goal template for this mission.
   *
   * The template is a free-form string that describes what the mission should achieve.
   * It may include `{{variable}}` placeholders that will be interpolated with values
   * from the input payload at plan generation time.
   *
   * Example: `'Research {{topic}} and produce a concise summary'`
   *
   * @param template - Goal prompt template string.
   */
  goal(template: string): this {
    this._goalTemplate = template;
    return this;
  }

  /**
   * Declare the output (return) schema for this mission.
   *
   * Accepts a Zod schema object or a plain JSON-Schema `Record<string, unknown>`.
   * The schema is stored in the compiled graph's `stateSchema.artifacts` field.
   *
   * @param schema - Zod or JSON-Schema object describing the expected artifact payload.
   */
  returns(schema: any): this {
    this._returnsSchema = schema;
    return this;
  }

  /**
   * Configure the planner used to decompose the goal into execution steps.
   *
   * @param config - Planner settings including strategy name, step budget, and
   *                 per-node iteration and tool-parallelism caps.
   */
  planner(config: MissionConfig['plannerConfig']): this {
    this._plannerConfig = config;
    return this;
  }

  /**
   * Apply mission-level policy overrides.
   *
   * Policies declared here are applied to **all** compiled nodes unless a node already
   * carries its own policy declaration.  This is the preferred mechanism for setting
   * blanket guardrails, memory consistency modes, or persona settings across a mission.
   *
   * @param config - Policy configuration object.
   */
  policy(config: NonNullable<MissionConfig['policyConfig']>): this {
    this._policyConfig = config;
    return this;
  }

  /**
   * Declare an anchor node that will be spliced into the execution order.
   *
   * Anchors let callers inject pre-built `GraphNode` objects (e.g. specialised tool
   * invocations, human-in-the-loop checkpoints, or validation guardrails) at precise
   * positions within the phase-ordered plan without modifying the planner output.
   *
   * @param id          - Unique node id assigned to the anchor in the compiled graph.
   * @param node        - Pre-built `GraphNode` (from `gmiNode`, `toolNode`, etc.).
   * @param constraints - Placement constraints: phase, `after` / `before` ordering.
   */
  anchor(
    id: string,
    node: GraphNode,
    constraints: MissionConfig['anchors'][0]['constraints'],
  ): this {
    this._anchors.push({ id, node, constraints });
    return this;
  }

  // -------------------------------------------------------------------------
  // Compile
  // -------------------------------------------------------------------------

  /**
   * Validate configuration and compile this mission into a `CompiledMission`.
   *
   * Required fields: `input`, `goal`, `returns`, `planner`.
   * Throws with a descriptive message if any required field is missing.
   *
   * @param options                - Optional compilation overrides.
   * @param options.checkpointStore - Custom checkpoint store; defaults to `InMemoryCheckpointStore`.
   * @returns A `CompiledMission` ready to `invoke()`, `stream()`, or `explain()`.
   * @throws {Error} When required builder fields are missing.
   */
  compile(options?: { checkpointStore?: ICheckpointStore }): CompiledMission {
    if (!this._inputSchema) {
      throw new Error('mission() requires .input() — input schema is required');
    }
    if (!this._goalTemplate) {
      throw new Error('mission() requires .goal() — goal template is required');
    }
    if (!this._returnsSchema) {
      throw new Error('mission() requires .returns() — returns schema is required');
    }
    if (!this._plannerConfig) {
      throw new Error('mission() requires .planner() — planner config is required');
    }

    const config: MissionConfig = {
      name: this.name,
      inputSchema: this._inputSchema,
      goalTemplate: this._goalTemplate,
      returnsSchema: this._returnsSchema,
      plannerConfig: this._plannerConfig,
      policyConfig: this._policyConfig,
      anchors: this._anchors,
    };

    const store = options?.checkpointStore ?? new InMemoryCheckpointStore();
    return new CompiledMission(config, store);
  }
}

// ---------------------------------------------------------------------------
// CompiledMission
// ---------------------------------------------------------------------------

/**
 * Execution wrapper for a compiled mission.
 *
 * Lazily re-compiles the IR on each call so that changes to the underlying
 * config are reflected without needing to rebuild the mission object.  In
 * production callers typically compile once and reuse the `CompiledMission`
 * for many invocations.
 */
export class CompiledMission {
  /**
   * @param config          - Frozen mission configuration snapshot.
   * @param checkpointStore - Checkpoint persistence backend.
   */
  constructor(
    private readonly config: MissionConfig,
    private readonly checkpointStore: ICheckpointStore,
  ) {}

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Run `MissionCompiler.compile()` to produce a fresh `CompiledExecutionGraph`.
   * Called lazily by each execution method so the IR is always up-to-date.
   */
  private compileIR(): CompiledExecutionGraph {
    return MissionCompiler.compile(this.config);
  }

  /**
   * Create a new `GraphRuntime` bound to this mission's checkpoint store.
   * A fresh runtime is created per invocation to ensure full call isolation.
   */
  private createRuntime(): GraphRuntime {
    return new GraphRuntime({
      checkpointStore: this.checkpointStore,
      nodeExecutor: new NodeExecutor({}),
    });
  }

  // -------------------------------------------------------------------------
  // Execution API
  // -------------------------------------------------------------------------

  /**
   * Execute the mission to completion and return the final artifacts.
   *
   * @param input - Input payload conforming to the mission's `inputSchema`.
   * @returns The final `GraphState.artifacts` value once all nodes have completed.
   */
  async invoke(input: unknown): Promise<unknown> {
    const ir = this.compileIR();
    return this.createRuntime().invoke(ir, input);
  }

  /**
   * Execute the mission while yielding `GraphEvent` values at each step.
   *
   * Useful for streaming progress updates to a UI or logging pipeline.
   *
   * @param input - Input payload conforming to the mission's `inputSchema`.
   * @yields `GraphEvent` objects emitted by the runtime at each node lifecycle point.
   */
  async *stream(input: unknown): AsyncIterable<GraphEvent> {
    const ir = this.compileIR();
    yield* this.createRuntime().stream(ir, input);
  }

  /**
   * Resume a previously interrupted run from its latest checkpoint.
   *
   * @param checkpointId - Either the original run id or an exact checkpoint id.
   * @param _patch       - Optional partial `GraphState` to merge before resuming (reserved).
   * @returns The final `GraphState.artifacts` value once execution completes.
   */
  async resume(checkpointId: string, _patch?: Partial<GraphState>): Promise<unknown> {
    const ir = this.compileIR();
    return this.createRuntime().resume(ir, checkpointId);
  }

  /**
   * Retrieve a diagnostic snapshot of a completed or in-progress run.
   *
   * @param _runId - Run id assigned by the runtime at invocation time.
   * @returns A `RunInspection`-shaped object (stub — full implementation in Task 17+).
   */
  async inspect(_runId: string): Promise<unknown> {
    // Stub — RunInspection API wired in a future task
    return {};
  }

  // -------------------------------------------------------------------------
  // Introspection utilities
  // -------------------------------------------------------------------------

  /**
   * Return a human-readable execution plan without actually running the mission.
   *
   * Useful for debugging, testing, and displaying "what will happen" summaries in UIs.
   *
   * @param _input - Input payload (currently unused; reserved for future goal interpolation).
   * @returns An object containing:
   *   - `steps`: flat array of `{ id, type, config }` descriptors for each node.
   *   - `ir`: the full `CompiledExecutionGraph` for deeper inspection.
   */
  async explain(_input: unknown): Promise<{ steps: any[]; ir: CompiledExecutionGraph }> {
    const ir = this.compileIR();
    return {
      steps: ir.nodes.map(n => ({
        id: n.id,
        type: n.type,
        config: n.executorConfig,
      })),
      ir,
    };
  }

  /**
   * Export the compiled plan as a static `CompiledExecutionGraph`.
   *
   * Allows callers to "graduate" a dynamically-planned mission to a fixed workflow or
   * graph for performance-sensitive deployments where replanning is not desired.
   *
   * @returns The compiled IR, suitable for passing directly to `GraphRuntime`.
   */
  toWorkflow(): CompiledExecutionGraph {
    return this.compileIR();
  }

  /**
   * Alias of `toWorkflow()` — returns the compiled `CompiledExecutionGraph` IR.
   *
   * @returns The compiled IR.
   */
  toIR(): CompiledExecutionGraph {
    return this.compileIR();
  }
}
