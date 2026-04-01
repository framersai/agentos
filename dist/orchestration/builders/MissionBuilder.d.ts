/**
 * @file MissionBuilder.ts
 * @description Fluent builder API for goal-oriented mission authoring.
 *
 * The `mission()` factory function returns a `MissionBuilder` that collects
 * configuration through a chainable interface before compiling the mission into
 * a `CompiledMission`. The current compiler emits a fixed phase-ordered graph
 * and applies anchors and mission-wide policies on top of that stub plan.
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
import { type MissionConfig } from '../compiler/MissionCompiler.js';
import type { GraphEvent } from '../events/GraphEvent.js';
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
export declare function mission(name: string): MissionBuilder;
/**
 * Fluent builder that collects mission configuration and validates it at `.compile()` time.
 *
 * All setter methods return `this` for chaining.  No compilation work is performed until
 * `.compile()` is called, ensuring fast construction of mission objects at module load time.
 */
export declare class MissionBuilder {
    private readonly name;
    /** @internal Zod or JSON-Schema describing the mission's input payload. */
    private _inputSchema;
    /** @internal Goal prompt template with optional `{{variable}}` placeholders. */
    private _goalTemplate;
    /** @internal Zod or JSON-Schema describing the mission's output artifacts. */
    private _returnsSchema;
    /** @internal Planner configuration (strategy, step budget, iteration caps). */
    private _plannerConfig;
    /** @internal Optional mission-level policy overrides. */
    private _policyConfig;
    /** @internal Declarative anchor node splice descriptors. */
    private _anchors;
    /** @internal Autonomy mode: autonomous, guided, guardrailed. */
    private _autonomy;
    /** @internal Provider assignment strategy configuration. */
    private _providerStrategy;
    /** @internal Maximum cost cap in USD. */
    private _costCap;
    /** @internal Maximum concurrent agent count. */
    private _maxAgents;
    /** @internal Number of Tree of Thought branches to explore. */
    private _branchCount;
    /** @internal Planner model identifier (for ToT planning phases). */
    private _plannerModel;
    /** @internal Execution model identifier (for agent nodes). */
    private _executionModel;
    /**
     * @param name - Display name for this mission; passed through to the compiled graph.
     */
    constructor(name: string);
    /**
     * Declare the input schema for this mission.
     *
     * Accepts a Zod schema object or a plain JSON-Schema `Record<string, unknown>`.
     * The schema is stored in the compiled graph's `stateSchema.input` field and used
     * by the runtime for optional input validation.
     *
     * @param schema - Zod or JSON-Schema object describing the expected input payload.
     */
    input(schema: any): this;
    /**
     * Set the goal template for this mission.
     *
     * The template is a free-form string that describes what the mission should achieve.
     * It may include `{{variable}}` placeholders. The current stub compiler passes
     * the template through verbatim into generated node instructions; future planner
     * integrations may interpolate it from runtime input.
     *
     * Example: `'Research {{topic}} and produce a concise summary'`
     *
     * @param template - Goal prompt template string.
     */
    goal(template: string): this;
    /**
     * Declare the output (return) schema for this mission.
     *
     * Accepts a Zod schema object or a plain JSON-Schema `Record<string, unknown>`.
     * The schema is stored in the compiled graph's `stateSchema.artifacts` field.
     *
     * @param schema - Zod or JSON-Schema object describing the expected artifact payload.
     */
    returns(schema: any): this;
    /**
     * Configure planner hints recorded on the mission config.
     *
     * Today the compiler emits a fixed stub plan regardless of strategy. These
     * settings are still preserved so planner-backed mission compilation can adopt
     * them without changing the authoring API.
     *
     * @param config - Planner settings including strategy name, step budget, and
     *                 per-node iteration and tool-parallelism caps.
     */
    planner(config: MissionConfig['plannerConfig']): this;
    /**
     * Apply mission-level policy overrides.
     *
     * Policies declared here are applied to **all** compiled nodes unless a node already
     * carries its own policy declaration.  This is the preferred mechanism for setting
     * blanket guardrails, memory consistency modes, or persona settings across a mission.
     *
     * @param config - Policy configuration object.
     */
    policy(config: NonNullable<MissionConfig['policyConfig']>): this;
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
    anchor(id: string, node: GraphNode, constraints: MissionConfig['anchors'][0]['constraints']): this;
    /**
     * Set the autonomy mode for this mission.
     *
     * - `autonomous` — all expansion gates auto-approve. Only stops at hard caps.
     * - `guided` — every expansion requires explicit user approval.
     * - `guardrailed` — auto-approves below configurable thresholds, asks above.
     *
     * @param mode - Autonomy mode.
     */
    autonomy(mode: 'autonomous' | 'guided' | 'guardrailed'): this;
    /**
     * Set the provider assignment strategy for this mission.
     *
     * @param strategy - Strategy name: best, cheapest, balanced, explicit, mixed.
     * @param options - Optional explicit assignments and fallback strategy.
     */
    providerStrategy(strategy: string, options?: {
        assignments?: Record<string, {
            provider: string;
            model?: string;
        }>;
        fallback?: string;
    }): this;
    /**
     * Set the maximum cost in USD before execution pauses for approval.
     *
     * @param amount - Cost cap in USD.
     */
    costCap(amount: number): this;
    /**
     * Set the maximum number of concurrent agents.
     *
     * @param count - Agent count cap.
     */
    maxAgents(count: number): this;
    /**
     * Set the number of Tree of Thought branches to explore during planning.
     *
     * @param count - Branch count (default: 3, max: 3 for linear/parallel/hierarchical).
     */
    branches(count: number): this;
    /**
     * Set the model used for Tree of Thought planning phases.
     *
     * Use a strong reasoning model here (e.g., claude-opus-4-6, gpt-4o) for
     * better plan quality. Defaults to the same model as execution if not set.
     *
     * @param model - Model identifier string (e.g., 'claude-opus-4-6').
     */
    plannerModel(model: string): this;
    /**
     * Set the default model used for agent node execution.
     *
     * Can differ from the planner model — e.g., use Opus for planning
     * but GPT-5.4 for actual agent output generation.
     *
     * @param model - Model identifier string (e.g., 'gpt-5.4').
     */
    executionModel(model: string): this;
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
    compile(options?: {
        checkpointStore?: ICheckpointStore;
    }): CompiledMission;
}
/**
 * Execution wrapper for a compiled mission.
 *
 * Lazily re-compiles the IR on each call so that changes to the underlying
 * config are reflected without needing to rebuild the mission object.  In
 * production callers typically compile once and reuse the `CompiledMission`
 * for many invocations.
 */
export declare class CompiledMission {
    private readonly config;
    private readonly checkpointStore;
    /**
     * @param config          - Frozen mission configuration snapshot.
     * @param checkpointStore - Checkpoint persistence backend.
     */
    constructor(config: MissionConfig, checkpointStore: ICheckpointStore);
    /**
     * Run `MissionCompiler.compile()` to produce a fresh `CompiledExecutionGraph`.
     * Called lazily by each execution method so the IR is always up-to-date.
     */
    private compileIR;
    /**
     * Create a new `GraphRuntime` bound to this mission's checkpoint store.
     * A fresh runtime is created per invocation to ensure full call isolation.
     */
    private createRuntime;
    /**
     * Execute the mission to completion and return the final artifacts.
     *
     * @param input - Input payload conforming to the mission's `inputSchema`.
     * @returns The final `GraphState.artifacts` value once all nodes have completed.
     */
    invoke(input: unknown): Promise<unknown>;
    /**
     * Execute the mission while yielding `GraphEvent` values at each step.
     *
     * Useful for streaming progress updates to a UI or logging pipeline.
     *
     * @param input - Input payload conforming to the mission's `inputSchema`.
     * @yields `GraphEvent` objects emitted by the runtime at each node lifecycle point.
     */
    stream(input: unknown): AsyncIterable<GraphEvent>;
    /**
     * Resume a previously interrupted run from its latest checkpoint.
     *
     * @param checkpointId - Either the original run id or an exact checkpoint id.
     * @param _patch       - Optional partial `GraphState` to merge before resuming (reserved).
     * @returns The final `GraphState.artifacts` value once execution completes.
     */
    resume(checkpointId: string, _patch?: Partial<GraphState>): Promise<unknown>;
    /**
     * Retrieve a diagnostic snapshot of a completed or in-progress run.
     *
     * @param _runId - Run id assigned by the runtime at invocation time.
     * @returns A `RunInspection`-shaped object (stub — full implementation in Task 17+).
     */
    inspect(_runId: string): Promise<unknown>;
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
    explain(_input: unknown): Promise<{
        steps: any[];
        ir: CompiledExecutionGraph;
    }>;
    /**
     * Export the compiled plan as a static `CompiledExecutionGraph`.
     *
     * Allows callers to "graduate" a dynamically-planned mission to a fixed workflow or
     * graph for performance-sensitive deployments where replanning is not desired.
     *
     * @returns The compiled IR, suitable for passing directly to `GraphRuntime`.
     */
    toWorkflow(): CompiledExecutionGraph;
    /**
     * Alias of `toWorkflow()` — returns the compiled `CompiledExecutionGraph` IR.
     *
     * @returns The compiled IR.
     */
    toIR(): CompiledExecutionGraph;
}
//# sourceMappingURL=MissionBuilder.d.ts.map