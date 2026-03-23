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

import type { GraphNode, GraphState, GraphCondition } from '../ir/types.js';
import type { GraphEvent } from '../events/GraphEvent.js';

// ---------------------------------------------------------------------------
// Public result type
// ---------------------------------------------------------------------------

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
  /** When `true`, the runtime must suspend and await human resolution. */
  interrupt?: boolean;
}

// ---------------------------------------------------------------------------
// Dependency injection surface
// ---------------------------------------------------------------------------

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
      toolCallRequest: { toolName: string; arguments: Record<string, unknown> };
    }): Promise<{ success?: boolean; isError?: boolean; output?: unknown; error?: string }>;
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
    evaluate(
      content: unknown,
      guardrailIds: string[],
    ): Promise<{ passed: boolean; results: unknown[] }>;
  };
}

// ---------------------------------------------------------------------------
// NodeExecutor
// ---------------------------------------------------------------------------

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
export class NodeExecutor {
  /**
   * @param deps - External service adapters. All fields are optional; missing services
   *               cause graceful degradation rather than hard failures.
   */
  constructor(private readonly deps: NodeExecutorDeps) {}

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Execute `node` against the provided `state`, optionally racing against a timeout.
   *
   * If `node.timeout` is set, execution races against a timer that resolves with a
   * `success: false` result after the specified number of milliseconds.
   *
   * @param node  - Immutable node descriptor from the compiled graph IR.
   * @param state - Current (partial) graph state threaded from the runtime.
   * @returns A `NodeExecutionResult` describing the outcome.
   */
  async execute(node: GraphNode, state: Partial<GraphState>): Promise<NodeExecutionResult> {
    if (node.timeout) {
      return Promise.race([
        this.executeNode(node, state),
        this.buildTimeoutPromise(node.timeout, node.id),
      ]);
    }
    return this.executeNode(node, state);
  }

  // ---------------------------------------------------------------------------
  // Internal dispatch
  // ---------------------------------------------------------------------------

  /**
   * Dispatches to the correct private handler based on `executorConfig.type`.
   *
   * Each branch receives only the narrowed config type it needs, keeping handler
   * signatures precise and avoiding accidental access to unrelated fields.
   */
  private async executeNode(
    node: GraphNode,
    state: Partial<GraphState>,
  ): Promise<NodeExecutionResult> {
    const config = node.executorConfig;

    switch (config.type) {
      case 'tool':
        return this.executeTool(config, state);

      case 'router':
        return this.executeRouter(config, state);

      case 'guardrail':
        return this.executeGuardrail(config, state);

      case 'human':
        return this.executeHuman(config);

      case 'gmi':
        // GMI execution is delegated to `LoopController` and wired in `GraphRuntime`.
        // This placeholder allows the executor to be used before the LLM subsystem is ready.
        return { success: true, output: 'gmi-placeholder' };

      case 'extension':
        // Extension execution is wired by `GraphRuntime` once the extension manager is available.
        return { success: true, output: 'extension-placeholder' };

      case 'subgraph':
        // Subgraph delegation is wired by `GraphRuntime` once nested graph lookup is available.
        return { success: true, output: 'subgraph-placeholder' };
    }
  }

  // ---------------------------------------------------------------------------
  // Variant handlers
  // ---------------------------------------------------------------------------

  /**
   * Invokes a registered `ITool` via `ToolOrchestrator.processToolCall()`.
   *
   * Static args from `config.args` are merged into the call. The orchestrator
   * is responsible for argument validation and schema enforcement.
   *
   * @param config - `{ type: 'tool'; toolName: string; args?: Record<string, unknown> }`
   * @param state  - Current graph state (not used directly but available for future extension).
   */
  private async executeTool(
    config: { type: 'tool'; toolName: string; args?: Record<string, unknown> },
    _state: Partial<GraphState>,
  ): Promise<NodeExecutionResult> {
    if (!this.deps.toolOrchestrator) {
      return {
        success: false,
        error: 'No ToolOrchestrator configured',
      };
    }

    const result = await this.deps.toolOrchestrator.processToolCall({
      toolCallRequest: {
        toolName: config.toolName,
        arguments: config.args ?? {},
      },
    });

    return {
      success: result.success ?? !result.isError,
      output: result.output,
      error: result.error,
    };
  }

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
  private async executeRouter(
    config: { type: 'router'; condition: GraphCondition },
    state: Partial<GraphState>,
  ): Promise<NodeExecutionResult> {
    let target: string;

    if (config.condition.type === 'function') {
      // The function condition receives the full state and returns a node id.
      target = config.condition.fn(state as GraphState);
    } else {
      // Expression-based conditions are evaluated by the minimal DSL interpreter.
      target = this.evaluateExpression(config.condition.expr, state);
    }

    return { success: true, routeTarget: target };
  }

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
  private async executeGuardrail(
    config: {
      type: 'guardrail';
      guardrailIds: string[];
      onViolation: 'block' | 'reroute' | 'warn' | 'sanitize';
      rerouteTarget?: string;
    },
    state: Partial<GraphState>,
  ): Promise<NodeExecutionResult> {
    if (!this.deps.guardrailEngine) {
      // Permissive fallback: no engine means no enforcement.
      return {
        success: true,
        output: { passed: true, message: 'No guardrail engine configured' },
      };
    }

    const result = await this.deps.guardrailEngine.evaluate(state.scratch, config.guardrailIds);

    if (!result.passed && config.onViolation === 'reroute' && config.rerouteTarget) {
      // Soft violation: redirect the graph to the recovery branch.
      return { success: true, routeTarget: config.rerouteTarget };
    }

    // For all other violation actions (block, warn, sanitize) the runtime inspects
    // `success: false` and acts according to its own policy.
    return {
      success: result.passed,
      output: result,
    };
  }

  /**
   * Suspends execution and surfaces a prompt to a human operator.
   *
   * The runtime must treat `interrupt: true` as a signal to persist state, emit an
   * `interrupt` event, and halt the current run until the operator provides a response.
   *
   * @param config - `{ type: 'human'; prompt: string }`
   */
  private executeHuman(
    config: { type: 'human'; prompt: string },
  ): Promise<NodeExecutionResult> {
    return Promise.resolve({
      success: false,
      interrupt: true,
      error: 'Awaiting human input',
      output: { prompt: config.prompt },
    });
  }

  // ---------------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------------

  /**
   * Minimal DSL expression evaluator for `{ type: 'expression' }` routing conditions.
   *
   * Current implementation is a stub that returns the expression string unchanged.
   * A full implementation would parse `"scratch.confidence > 0.8 ? 'approve' : 'review'"`
   * using a sandboxed interpreter with dot-path access to `state` fields.
   *
   * @param expr  - The DSL expression string from `GraphConditionExpr`.
   * @param state - Current graph state (available for a real implementation to traverse).
   * @returns The resolved target node id (or the raw expression until the evaluator is complete).
   *
   * @todo Implement a sandboxed expression interpreter (tracked separately).
   */
  private evaluateExpression(expr: string, _state: Partial<GraphState>): string {
    return expr;
  }

  /**
   * Builds a `Promise` that resolves with a timeout-failure result after `ms` milliseconds.
   *
   * Races against `executeNode()` inside `execute()` to enforce `GraphNode.timeout`.
   *
   * @param ms     - Timeout duration in milliseconds.
   * @param nodeId - Node id included in the error message for debugging.
   */
  private buildTimeoutPromise(ms: number, nodeId: string): Promise<NodeExecutionResult> {
    return new Promise((resolve) => {
      setTimeout(
        () => resolve({ success: false, error: `Node ${nodeId} timeout after ${ms}ms` }),
        ms,
      );
    });
  }
}
