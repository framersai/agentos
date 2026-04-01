/**
 * @file NodeExecutor.ts
 * @description Dispatches execution to the appropriate handler based on `GraphNode.executorConfig.type`.
 *
 * The executor is intentionally thin — it contains no retry logic (handled by `GraphRuntime`),
 * no state mutation (handled by `StateManager`), and no event emission (handled by the caller).
 * Each private method maps one-to-one with a `NodeExecutorConfig` variant.
 *
 * Execution flow:
 *   `execute()` → optional timeout race → `executeNode()` → variant handler
 *
 * Placeholders for `gmi`, `extension`, and `subgraph` nodes are wired in `GraphRuntime`
 * after the `LoopController` and extension managers are available.
 */
import type { GraphNode, GraphState, CompiledExecutionGraph } from '../ir/types.js';
import type { GraphEvent, MissionExpansionTrigger, MissionGraphPatch } from '../events/GraphEvent.js';
import type { LoopController, LoopChunk, LoopOutput } from './LoopController.js';
import type { VoiceNodeExecutor } from './VoiceNodeExecutor.js';
/**
 * The normalised result returned by every `NodeExecutor.execute()` call regardless
 * of which executor variant was dispatched.
 *
 * The runtime inspects these fields to decide the next graph step:
 * - `success`          — whether the node completed without error.
 * - `output`           — arbitrary payload produced by the node (tool result, LLM response, etc.).
 * - `error`            — human-readable error message; only present when `success` is `false`.
 * - `routeTarget`      — next node id determined by a `router` or `guardrail` node.
 * - `scratchUpdate`    — partial object merged into `GraphState.scratch` by `StateManager`.
 * - `artifactsUpdate`  — partial object merged into `GraphState.artifacts` by `StateManager`.
 * - `events`           — additional `GraphEvent` values the executor wants the runtime to emit.
 * - `interrupt`        — when `true`, the runtime suspends the run and waits for human input.
 */
export interface NodeExecutionResult {
    /** Whether the node completed successfully. */
    success: boolean;
    /** Arbitrary output produced by the node. */
    output?: unknown;
    /** Human-readable error description; populated only when `success` is `false`. */
    error?: string;
    /** Target node id returned by `router` or guardrail rerouting. */
    routeTarget?: string;
    /** Partial update to merge into `GraphState.scratch`. */
    scratchUpdate?: Record<string, unknown>;
    /** Partial update to merge into `GraphState.artifacts`. */
    artifactsUpdate?: Record<string, unknown>;
    /** Extra runtime events the executor wants to surface to callers. */
    events?: GraphEvent[];
    /** Mission graph expansion requests emitted by this node's tool usage. */
    expansionRequests?: Array<{
        trigger: MissionExpansionTrigger;
        reason: string;
        request: unknown;
        patch?: MissionGraphPatch;
    }>;
    /** When `true`, the runtime must suspend and await human resolution. */
    interrupt?: boolean;
}
/**
 * External dependencies injected into `NodeExecutor` at construction time.
 *
 * Using an interface rather than concrete types keeps the executor decoupled from
 * the full `ToolOrchestrator` and `GuardrailEngine` implementations and makes the
 * unit-test surface minimal.
 *
 * GMI / extension / subgraph managers are omitted here and wired by `GraphRuntime`
 * once those subsystems are available.
 */
export interface NodeExecutorDeps {
    /**
     * Routes tool-call requests to registered `ITool` implementations.
     * When absent, any `tool` node will resolve with `success: false`.
     */
    toolOrchestrator?: {
        /**
         * Process a single tool call and return its result.
         *
         * @param details - Wrapper containing `toolCallRequest.toolName` and `toolCallRequest.arguments`.
         * @returns Promise resolving to an object with at least `output` and `isError` / `success`.
         */
        processToolCall(details: {
            toolCallRequest: {
                toolName: string;
                arguments: Record<string, unknown>;
            };
        }): Promise<{
            success?: boolean;
            isError?: boolean;
            output?: unknown;
            error?: string;
        }>;
    };
    /**
     * Evaluates one or more named guardrails against a content payload.
     * When absent, guardrail nodes are treated as always-passing.
     */
    guardrailEngine?: {
        /**
         * Run all listed guardrails against `content` and return a combined verdict.
         *
         * @param content      - The payload to evaluate (typically `GraphState.scratch`).
         * @param guardrailIds - Ordered list of guardrail identifiers to run.
         * @returns Aggregated result with `passed` flag and per-guardrail `results`.
         */
        evaluate(content: unknown, guardrailIds: string[]): Promise<{
            passed: boolean;
            results: unknown[];
        }>;
    };
    /**
     * LoopController for GMI node execution. When provided alongside `providerCall`,
     * GMI nodes delegate to the LoopController's ReAct loop instead of returning a placeholder.
     */
    loopController?: LoopController;
    /**
     * Provider-specific LLM call that returns a streaming async generator.
     * Used by GMI nodes to produce text via the LoopController.
     *
     * @param instructions - System instructions from the GMI node config.
     * @param state        - Current graph state for context injection.
     * @returns Async generator yielding LoopChunks and returning a LoopOutput.
     */
    providerCall?: (instructions: string, state: Partial<GraphState>) => AsyncGenerator<LoopChunk, LoopOutput, undefined>;
    /**
     * Resolves a subgraph id to its compiled execution graph for recursive invocation.
     * When absent, subgraph nodes return a placeholder.
     */
    subgraphResolver?: (graphId: string) => CompiledExecutionGraph | undefined;
    /**
     * Factory that creates a GraphRuntime for subgraph execution.
     * Injected to avoid circular imports between NodeExecutor and GraphRuntime.
     */
    createSubgraphRuntime?: (graph: CompiledExecutionGraph) => {
        invoke(graph: CompiledExecutionGraph, input: unknown): Promise<unknown>;
    };
    /**
     * Executes an extension method by ID. When absent, extension nodes return a placeholder.
     *
     * @param extensionId - The registered extension identifier.
     * @param method      - The method name to invoke on the extension.
     * @param input       - Input data passed to the extension method.
     * @returns Promise resolving to the extension's output.
     */
    extensionExecutor?: (extensionId: string, method: string, input: unknown) => Promise<{
        success: boolean;
        output?: unknown;
        error?: string;
    }>;
    /**
     * Executor for `voice` nodes. Manages voice pipeline sessions, turn collection,
     * and exit-condition racing. When absent, voice nodes return `success: false`.
     */
    voiceExecutor?: VoiceNodeExecutor;
}
/**
 * Stateless executor that dispatches a `GraphNode` to the appropriate handler.
 *
 * One `NodeExecutor` instance is typically shared across the lifetime of a `GraphRuntime`
 * and reused for every node invocation within every run. All state is passed through
 * `GraphState` and returned via `NodeExecutionResult`.
 *
 * @example
 * ```ts
 * const executor = new NodeExecutor({ toolOrchestrator, guardrailEngine });
 * const result = await executor.execute(node, graphState);
 * if (!result.success) console.error(result.error);
 * ```
 */
export declare class NodeExecutor {
    private readonly deps;
    /**
     * @param deps - External service adapters. All fields are optional; missing services
     *               cause graceful degradation rather than hard failures.
     */
    constructor(deps: NodeExecutorDeps);
    /**
     * Execute `node` against the provided `state`, optionally racing against a timeout.
     *
     * If `node.timeout` is set, execution races against a timer that resolves with a
     * `success: false` result after the specified number of milliseconds.
     *
     * For `human` nodes with an `onTimeout` directive, the timeout result is modified:
     * - `'accept'` — auto-accept on timeout.
     * - `'reject'` — auto-reject on timeout.
     * - `'error'`  — standard timeout error (default behaviour for all node types).
     *
     * @param node  - Immutable node descriptor from the compiled graph IR.
     * @param state - Current (partial) graph state threaded from the runtime.
     * @returns A `NodeExecutionResult` describing the outcome.
     */
    execute(node: GraphNode, state: Partial<GraphState>): Promise<NodeExecutionResult>;
    /**
     * Dispatches to the correct private handler based on `executorConfig.type`.
     *
     * Each branch receives only the narrowed config type it needs, keeping handler
     * signatures precise and avoiding accidental access to unrelated fields.
     */
    private executeNode;
    /**
     * Invokes a registered `ITool` via `ToolOrchestrator.processToolCall()`.
     *
     * Static args from `config.args` are merged into the call. The orchestrator
     * is responsible for argument validation and schema enforcement.
     *
     * @param config - `{ type: 'tool'; toolName: string; args?: Record<string, unknown> }`
     * @param state  - Current graph state (not used directly but available for future extension).
     */
    private executeTool;
    /**
     * Evaluates a `GraphCondition` and returns the resolved target node id as `routeTarget`.
     *
     * Two condition strategies are supported:
     * - `function` — calls the runtime-registered TypeScript `fn` directly.
     * - `expression` — delegates to `evaluateExpression()` for DSL string evaluation.
     *
     * @param config - `{ type: 'router'; condition: GraphCondition }`
     * @param state  - Current graph state passed to the condition function/evaluator.
     */
    private executeRouter;
    /**
     * Evaluates a set of guardrails against `state.scratch` and either passes through
     * or triggers the configured violation action.
     *
     * When no `guardrailEngine` is configured, the node always passes (permissive default).
     * Violation handling currently supports `'reroute'`; `'block'`, `'warn'`, and `'sanitize'`
     * are propagated via `success: false` for the runtime to handle.
     *
     * @param config - Guardrail node config with `guardrailIds`, `onViolation`, and optional `rerouteTarget`.
     * @param state  - Current graph state; `state.scratch` is passed to the engine as the content payload.
     */
    private executeGuardrail;
    /**
     * Executes a human-in-the-loop node.
     *
     * The node supports several automated resolution strategies that bypass the
     * default human-interrupt behaviour:
     *
     * - `autoAccept` — resolve immediately with `approved: true`.
     * - `autoReject` — resolve immediately with `approved: false` and an optional reason.
     * - `judge` — delegate to an LLM judge via `generateText()`. If the judge's
     *   confidence is below `confidenceThreshold`, execution falls through to the
     *   normal human interrupt.
     *
     * When none of these options are set (or the judge cannot decide), the runtime
     * must treat `interrupt: true` as a signal to persist state, emit an `interrupt`
     * event, and halt the current run until the operator provides a response.
     *
     * @param config - Human node executor config including prompt and optional
     *   automation directives.
     */
    private executeHuman;
    /**
     * Runs post-approval guardrails for a human node when an approval
     * decision has been reached (auto-accept, LLM judge, or timeout-accept).
     *
     * When `guardrailOverride` is not `false` and the node has an associated
     * `guardrailPolicy`, the guardrails are evaluated. If any guardrail blocks,
     * this returns a denial result; otherwise returns `null` (proceed normally).
     *
     * @param config - The human node's executor config.
     * @param approvalOutput - The approval output that was about to be returned.
     * @returns A `NodeExecutionResult` denying the action, or `null` if guardrails pass.
     */
    private runHumanNodeGuardrails;
    /**
     * Executes a GMI (General Model Invocation) node via the LoopController.
     *
     * When `deps.loopController` and `deps.providerCall` are both available, builds a
     * `LoopContext` that wires the provider's streaming generator to the LoopController's
     * ReAct loop. Text deltas are accumulated and returned as the node output.
     *
     * Falls back to a placeholder when the LLM subsystem is not yet wired (e.g. in tests
     * or when Wunderland provides its own override).
     *
     * @param config - GMI executor config with instructions and optional sampling params.
     * @param state  - Current graph state for context injection into the provider call.
     */
    private executeGmi;
    /**
     * Executes a subgraph node by recursively invoking a child `GraphRuntime`.
     *
     * When `deps.subgraphResolver` and `deps.createSubgraphRuntime` are both available,
     * the resolver looks up the compiled graph by id, input/output mappings are applied
     * to shuttle data between parent scratch and child input/artifacts, and a new runtime
     * instance executes the child graph to completion.
     *
     * Falls back to a placeholder when the subgraph subsystem is not yet wired.
     *
     * @param config - Subgraph executor config with graphId and optional field mappings.
     * @param state  - Current parent graph state used for input mapping.
     */
    private executeSubgraph;
    /**
     * Executes an extension method via the injected `extensionExecutor`.
     *
     * @param config - Extension executor config with extensionId and method name.
     * @param state  - Current graph state passed as input to the extension.
     */
    private executeExtension;
    /**
     * Safe dot-path expression evaluator for `{ type: 'expression' }` routing conditions.
     *
     * Replaces partition references (`scratch`, `input`, `artifacts`) with their resolved
     * values from `state`, then evaluates the resulting expression using `new Function()`.
     * Only simple comparisons and boolean logic are supported.
     *
     * @param expr  - The DSL expression string from `GraphConditionExpr`.
     * @param state - Current graph state whose partitions are accessible in the expression.
     * @returns The resolved target node id, or `'false'` if evaluation fails.
     */
    private evaluateExpression;
    /**
     * Resolves a dot-separated path against an object, returning the nested value.
     *
     * @param obj  - Root object to traverse.
     * @param path - Dot-separated field path (e.g. `'foo.bar.baz'`).
     * @returns The resolved value, or `undefined` if any segment is missing.
     */
    private resolvePathValue;
    /**
     * Sets a value at a dot-separated path on an object, creating intermediate objects as needed.
     *
     * @param obj   - Root object to mutate.
     * @param path  - Dot-separated field path (e.g. `'foo.bar'`).
     * @param value - Value to set at the terminal key.
     */
    private setPathValue;
    /**
     * Builds a `Promise` that resolves with a timeout-failure result after `ms` milliseconds.
     *
     * Races against `executeNode()` inside `execute()` to enforce `GraphNode.timeout`.
     *
     * @param ms     - Timeout duration in milliseconds.
     * @param nodeId - Node id included in the error message for debugging.
     */
    private buildTimeoutPromise;
}
//# sourceMappingURL=NodeExecutor.d.ts.map