/**
 * @file LoopController.ts
 * @description Reusable, configurable ReAct (Reason + Act) loop controller for AgentOS.
 *
 * Extracted from the GMI implementation to provide a generic orchestration primitive
 * that supports parallel/sequential tool dispatch, configurable failure modes, and
 * iteration limits. Yields structured {@link LoopEvent}s for observability.
 *
 * NOTE: The GMI (src/cognitive_substrate/GMI.ts) still maintains its own inline
 * tool-calling loop in `processTurnStream()`.  The GMI loop carries RAG retrieval,
 * prompt reconstruction, persona-scoped tool orchestration, and GMI state
 * management that this controller does not yet abstract.  The GMI loop documents
 * a future refactor path to delegate iteration/termination logic here.  See the
 * comment block in GMI.processTurnStream() for details.
 *
 * @example
 * ```typescript
 * const controller = new LoopController();
 * for await (const event of controller.execute(config, context)) {
 *   if (event.type === 'text_delta') process.stdout.write(event.content);
 * }
 * ```
 */
/**
 * Configuration that governs a single LoopController execution.
 */
export interface LoopConfig {
    /** Maximum number of ReAct iterations before the loop is forcibly terminated. */
    maxIterations: number;
    /**
     * When `true`, all tool calls within a single iteration are dispatched in
     * parallel via `Promise.allSettled()`. When `false`, they execute sequentially.
     */
    parallelTools: boolean;
    /**
     * Determines how tool errors are handled:
     * - `'fail_open'`  — emit a `tool_error` event and continue the loop.
     * - `'fail_closed'` — throw immediately, aborting the loop.
     */
    failureMode: 'fail_open' | 'fail_closed';
    /**
     * Optional per-loop timeout in milliseconds. Currently reserved for
     * future implementation via AbortController; not enforced in v1.
     */
    timeout?: number;
}
/**
 * Execution context provided to the LoopController by the caller.
 * Abstracts away the underlying LLM/GMI implementation so the loop logic
 * remains provider-agnostic.
 */
export interface LoopContext {
    /**
     * Async generator that streams chunks during a single LLM inference pass.
     * Must return a `LoopOutput` as its generator return value (the value
     * passed to the final `done: true` result from `.next()`).
     */
    generateStream: () => AsyncGenerator<LoopChunk, LoopOutput, undefined>;
    /**
     * Execute a single tool call and return its result.
     * Implementations should never throw — instead return a result with
     * `success: false` and a populated `error` field.
     */
    executeTool: (toolCall: LoopToolCallRequest) => Promise<LoopToolCallResult>;
    /**
     * Feed tool results back into the conversation so the next `generateStream`
     * call has access to them. Typically appends tool messages to the message list.
     */
    addToolResults: (results: LoopToolCallResult[]) => void;
}
/**
 * A single tool invocation requested by the LLM.
 */
export interface LoopToolCallRequest {
    /** Unique identifier for this tool call within a response (matches the tool result). */
    id: string;
    /** Name of the tool to invoke. */
    name: string;
    /** Parsed arguments to pass to the tool. */
    arguments: Record<string, unknown>;
}
/**
 * The outcome of executing a {@link LoopToolCallRequest}.
 */
export interface LoopToolCallResult {
    /** Matches the originating `LoopToolCallRequest.id`. */
    id: string;
    /** Name of the tool that was called. */
    name: string;
    /** Whether the tool executed without error. */
    success: boolean;
    /** Serialisable output returned by the tool on success. */
    output?: unknown;
    /** Human-readable error message when `success` is `false`. */
    error?: string;
}
/**
 * A single chunk emitted by `generateStream` during inference.
 * Each chunk carries either a text fragment or a set of tool call requests.
 */
export interface LoopChunk {
    /**
     * - `'text_delta'` — incremental text from the assistant.
     * - `'tool_call_request'` — the LLM has decided to call one or more tools.
     */
    type: 'text_delta' | 'tool_call_request';
    /** Present when `type === 'text_delta'`. */
    content?: string;
    /** Present when `type === 'tool_call_request'`. */
    toolCalls?: LoopToolCallRequest[];
}
/**
 * The final return value of `generateStream` (carried in the generator's
 * `return` slot, i.e. `{ done: true, value: LoopOutput }`).
 */
export interface LoopOutput {
    /** Accumulated assistant text for this iteration. */
    responseText: string;
    /**
     * All tool calls requested in this iteration. An empty array signals that
     * the LLM is done and the loop should terminate.
     */
    toolCalls: LoopToolCallRequest[];
    /**
     * The LLM finish reason (e.g. `'stop'`, `'tool_calls'`, `'length'`).
     * Informational; not used for loop-control decisions.
     */
    finishReason: string;
}
/**
 * Discriminated union of all events emitted by {@link LoopController.execute}.
 * Consumers can switch on `event.type` to handle each case.
 */
export type LoopEvent = {
    type: 'text_delta';
    content: string;
} | {
    type: 'tool_call_request';
    toolCalls: LoopToolCallRequest[];
} | {
    type: 'tool_result';
    toolName: string;
    result: LoopToolCallResult;
} | {
    type: 'tool_error';
    toolName: string;
    error: string;
} | {
    type: 'max_iterations_reached';
    iteration: number;
} | {
    type: 'loop_complete';
    totalIterations: number;
};
/**
 * Configurable ReAct loop controller.
 *
 * Drives a generate → act → observe cycle, delegating LLM inference and
 * tool execution to the caller-provided {@link LoopContext}. The loop
 * terminates when:
 *
 * 1. The LLM returns no tool calls (natural stop), or
 * 2. `maxIterations` is exceeded, or
 * 3. A tool fails and `failureMode` is `'fail_closed'`.
 *
 * All intermediate events are yielded so callers can stream output to the
 * user or record an audit trace.
 */
export declare class LoopController {
    /**
     * Execute the ReAct loop and yield {@link LoopEvent}s.
     *
     * @param config - Loop behaviour configuration.
     * @param context - Callbacks to the underlying LLM/tool layer.
     * @yields {LoopEvent} Structured events for each phase of the loop.
     * @throws {Error} Only when `failureMode === 'fail_closed'` and a tool fails.
     */
    execute(config: LoopConfig, context: LoopContext): AsyncGenerator<LoopEvent>;
}
//# sourceMappingURL=LoopController.d.ts.map