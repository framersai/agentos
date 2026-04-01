/**
 * @file WorkflowBuilder.ts
 * @description Fluent DSL for authoring deterministic, acyclic workflow graphs.
 *
 * `workflow()` is the sequential/pipeline-oriented authoring API in the AgentOS
 * Unified Orchestration Layer. Unlike `AgentGraph` (which allows arbitrary directed
 * graphs including cycles), every workflow is a strict DAG — cycles are detected and
 * rejected at compile time.
 *
 * Supported step primitives:
 * - `step()` / `then()` — a single named node (tool, GMI, or human).
 * - `branch()` — a router + fan-out; branches rejoin at the next step.
 * - `parallel()` — fan-out to N concurrent nodes that rejoin via merge reducers.
 *
 * All GMI steps default to `executionMode: 'single_turn'` to keep workflows
 * deterministic and cost-bounded.
 *
 * @example
 * ```ts
 * const wf = workflow('summarize-and-tag')
 *   .input(z.object({ text: z.string() }))
 *   .returns(z.object({ summary: z.string(), tags: z.array(z.string()) }))
 *   .step('fetch', { tool: 'web_fetch' })
 *   .step('summarize', { gmi: { instructions: 'Summarize the document.' } })
 *   .compile();
 *
 * const result = await wf.invoke({ text: 'hello world' });
 * ```
 */
import type { CompiledExecutionGraph, MemoryPolicy, DiscoveryPolicy, GuardrailPolicy, VoiceNodeConfig, BuiltinReducer, ReducerFn } from '../ir/types.js';
import type { VoiceTransportConfig } from '../runtime/VoiceTransportAdapter.js';
import type { ICheckpointStore } from '../checkpoint/ICheckpointStore.js';
import type { GraphEvent } from '../events/GraphEvent.js';
/**
 * Configuration for a single workflow step node.
 *
 * Exactly one of `tool`, `gmi`, `human`, `extension`, or `subgraph` must be provided
 * to specify the execution strategy.  All remaining fields are optional policies.
 */
export interface StepConfig {
    /** Name of a registered `ITool` to invoke. */
    tool?: string;
    /**
     * General Model Invocation config. `executionMode` is always overridden to
     * `'single_turn'` inside a workflow to keep execution deterministic.
     */
    gmi?: {
        instructions: string;
        /** Ignored at runtime — always coerced to `'single_turn'` by the workflow compiler. */
        executionMode?: 'single_turn';
        /** Hard cap on LLM output tokens for this step. */
        maxTokens?: number;
    };
    /** Human-in-the-loop step; suspends the run until a human provides a response. */
    human?: {
        prompt: string;
    };
    /** Call a method on a registered extension. */
    extension?: {
        extensionId: string;
        method: string;
    };
    /** Delegate to a previously compiled sub-workflow or agent graph. */
    subgraph?: CompiledExecutionGraph;
    /** Memory read/write policy for this step. */
    memory?: MemoryPolicy;
    /** Capability discovery policy applied before execution. */
    discovery?: DiscoveryPolicy;
    /** Declarative guardrail policy applied to input and/or output. */
    guardrails?: GuardrailPolicy;
    /** When `true`, execution suspends and waits for human approval before proceeding. */
    requiresApproval?: boolean;
    /** What to do when the step fails. */
    onFailure?: 'abort' | 'skip' | 'retry';
    /** Automatic retry configuration. Only used when `onFailure` is `'retry'`. */
    retryPolicy?: {
        maxAttempts: number;
        backoff: 'fixed' | 'linear' | 'exponential';
        backoffMs: number;
    };
    /** Maximum wall-clock execution time in milliseconds. */
    timeout?: number;
    /** Side-effect classification used by the runtime for scheduling decisions. */
    effectClass?: 'pure' | 'read' | 'write' | 'external' | 'human';
    /**
     * Voice pipeline node configuration.
     * When provided alongside `executorConfig.type: 'voice'`, these settings are
     * forwarded to the VoiceNodeExecutor.  Typically set via the `voiceNode()`
     * builder rather than directly through `StepConfig`.
     */
    voice?: VoiceNodeConfig;
}
/**
 * Create a new `WorkflowBuilder` with the given human-readable name.
 *
 * @param name - Display name embedded in the compiled `CompiledExecutionGraph`.
 * @returns A fresh `WorkflowBuilder` instance.
 *
 * @example
 * ```ts
 * const wf = workflow('my-pipeline')
 *   .input(z.object({ query: z.string() }))
 *   .returns(z.object({ answer: z.string() }))
 *   .step('search', { tool: 'web_search' })
 *   .step('answer', { gmi: { instructions: 'Answer the question.' } })
 *   .compile();
 * ```
 */
export declare function workflow(name: string): WorkflowBuilder;
/**
 * Fluent builder for deterministic DAG workflows.
 *
 * Steps are appended in declaration order and connected sequentially. Branch and
 * parallel primitives fan out and automatically rejoin at the next declared step.
 *
 * Call `.compile()` to validate the graph (must be acyclic) and obtain a
 * `CompiledWorkflow` ready for `invoke()`, `stream()`, or `resume()`.
 */
export declare class WorkflowBuilder {
    /** Zod schema (or any plain object) representing `GraphState.input`. */
    private inputSchema;
    /** Zod schema (or any plain object) representing `GraphState.artifacts`. */
    private returnsSchema;
    /** Ordered list of steps declared by the author. */
    private steps;
    /** Human-readable name forwarded to the compiled graph. */
    private readonly name;
    /**
     * Optional transport configuration set via {@link transport}.
     * When present, the compiled workflow is associated with a transport backend
     * (e.g. a voice pipeline) that intercepts graph I/O at runtime.
     */
    private _transportConfig;
    /**
     * @param name - Human-readable workflow name.
     */
    constructor(name: string);
    /**
     * Declare the input schema for this workflow.
     *
     * Accepts a Zod schema or any plain object; the value is forwarded to
     * `GraphCompiler` which lowers it to JSON Schema via `lowerZodToJsonSchema`.
     *
     * @param schema - Input schema (Zod instance or plain JSON Schema object).
     */
    input(schema: any): this;
    /**
     * Declare the return (output artifacts) schema for this workflow.
     *
     * @param schema - Output schema (Zod instance or plain JSON Schema object).
     */
    returns(schema: any): this;
    /**
     * Attach a transport backend to this workflow.
     *
     * When `type` is `'voice'`, the compiled workflow will route graph I/O
     * through the voice transport adapter at runtime. The `config` values
     * override per-field defaults from `agent.config.json`.
     *
     * The transport config is stored as `_transportConfig` on the builder
     * instance and is available for inspection or forwarding to the runtime.
     *
     * @param type   - Transport kind; currently only `'voice'` is supported.
     * @param config - Optional voice pipeline overrides (STT, TTS, voice, etc.).
     * @returns `this` for fluent chaining.
     *
     * @example
     * ```typescript
     * const wf = workflow('voice-flow')
     *   .input(inputSchema)
     *   .returns(outputSchema)
     *   .transport('voice', { stt: 'deepgram', tts: 'openai', voice: 'alloy' })
     *   .step('listen', { tool: 'listen_tool' })
     *   .compile();
     * ```
     */
    transport(type: 'voice', config?: Omit<VoiceTransportConfig, 'type'>): this;
    /**
     * Append a single named step to the workflow.
     *
     * The step is connected from all current tail nodes and becomes the new
     * single-element tail after it is added.
     *
     * @param id     - Unique step identifier within this workflow.
     * @param config - Execution and policy configuration for the step.
     */
    step(id: string, config: StepConfig): this;
    /**
     * Alias for `step()` — reads more naturally when chaining sequential steps.
     *
     * @param id     - Unique step identifier.
     * @param config - Execution and policy configuration.
     */
    then(id: string, config: StepConfig): this;
    /**
     * Append a conditional branch to the workflow.
     *
     * The `condition` function is evaluated at runtime against `GraphState` and must
     * return one of the keys of `routes`. Each route becomes its own branch node; all
     * branches become the collective tail that the next declared step connects from.
     *
     * @param condition - Routing function; return value must match a key in `routes`.
     * @param routes    - Map of route key → step config for each branch arm.
     */
    branch(condition: (state: any) => string, routes: Record<string, StepConfig>): this;
    /**
     * Append a parallel fan-out to the workflow.
     *
     * All `steps` execute concurrently (subject to runtime scheduling). After all
     * branches complete, their outputs are merged using the `join.merge` reducers.
     * The parallel branch nodes collectively become the new tail.
     *
     * @param steps - Array of step configs to execute concurrently.
     * @param join  - Fan-in configuration including merge strategy and reducers.
     */
    parallel(steps: StepConfig[], join: {
        strategy: 'all' | 'any' | 'quorum';
        quorumCount?: number;
        merge: Record<string, BuiltinReducer | ReducerFn>;
        timeout?: number;
    }): this;
    /**
     * Compile the workflow into an executable `CompiledWorkflow`.
     *
     * Compilation steps:
     * 1. Validate that `.input()` and `.returns()` schemas were declared.
     * 2. Lower each `InternalStep` into `GraphNode` + `GraphEdge` IR objects,
     *    threading `tailNodeIds` to connect steps sequentially.
     * 3. Connect all final tail nodes to `END`.
     * 4. Run `GraphCompiler.compile()` to produce a `CompiledExecutionGraph`.
     * 5. Run `GraphValidator.validate()` with `{ requireAcyclic: true }` — throws on cycle.
     * 6. Wrap in a `CompiledWorkflow` with a `GraphRuntime` backed by the given store.
     *
     * @param options - Optional compilation options.
     * @param options.checkpointStore - Custom checkpoint backend; defaults to `InMemoryCheckpointStore`.
     * @throws {Error} When `.input()` or `.returns()` was not called.
     * @throws {Error} When the compiled graph contains a cycle (should never happen via this API).
     */
    compile(options?: {
        checkpointStore?: ICheckpointStore;
    }): CompiledWorkflow;
    /**
     * Lower a `StepConfig` into a `GraphNode` with the given `id`.
     *
     * Priority order for executor type selection:
     * `tool` → `gmi` → `human` → `extension` → `subgraph` → fallback tool node.
     *
     * GMI nodes always receive `executionMode: 'single_turn'` regardless of what
     * the author specified in `config.gmi.executionMode`.
     *
     * @param id     - Node id to assign.
     * @param config - Caller-supplied step configuration.
     * @returns A fully constructed `GraphNode` ready for the IR.
     */
    private configToNode;
}
/**
 * An execution-ready workflow produced by `WorkflowBuilder.compile()`.
 *
 * Wraps a `CompiledExecutionGraph` and a `GraphRuntime`, exposing the same
 * three execution modes as the raw runtime:
 *
 * - `invoke(input)` — run to completion and return final artifacts.
 * - `stream(input)` — run while yielding `GraphEvent` values at each step.
 * - `resume(checkpointId)` — restore an interrupted run from a checkpoint.
 */
export declare class CompiledWorkflow {
    private readonly ir;
    /** Underlying execution runtime. */
    private readonly runtime;
    /**
     * @param ir              - The compiled execution graph (produced by `GraphCompiler`).
     * @param checkpointStore - Checkpoint persistence backend.
     */
    constructor(ir: CompiledExecutionGraph, checkpointStore: ICheckpointStore);
    /**
     * Execute the workflow to completion and return the final `artifacts` payload.
     *
     * @param input - Must conform to the schema declared via `.input()`.
     * @returns The `GraphState.artifacts` value after all nodes complete.
     */
    invoke(input: unknown): Promise<unknown>;
    /**
     * Execute the workflow while yielding `GraphEvent` values at each step boundary.
     *
     * @param input - Must conform to the schema declared via `.input()`.
     * @yields {GraphEvent} Runtime events in causal order.
     */
    stream(input: unknown): AsyncIterable<GraphEvent>;
    /**
     * Resume a previously interrupted workflow run from its latest checkpoint.
     *
     * @param checkpointId - Either the original run id or an exact checkpoint id.
     * @returns The final `GraphState.artifacts` value after resumption completes.
     */
    resume(checkpointId: string): Promise<unknown>;
    /**
     * Expose the compiled IR for inspection, serialisation, or subgraph composition.
     *
     * @returns The underlying `CompiledExecutionGraph`.
     */
    toIR(): CompiledExecutionGraph;
}
//# sourceMappingURL=WorkflowBuilder.d.ts.map