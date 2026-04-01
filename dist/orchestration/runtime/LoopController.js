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
// ---------------------------------------------------------------------------
// LoopController
// ---------------------------------------------------------------------------
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
export class LoopController {
    /**
     * Execute the ReAct loop and yield {@link LoopEvent}s.
     *
     * @param config - Loop behaviour configuration.
     * @param context - Callbacks to the underlying LLM/tool layer.
     * @yields {LoopEvent} Structured events for each phase of the loop.
     * @throws {Error} Only when `failureMode === 'fail_closed'` and a tool fails.
     */
    async *execute(config, context) {
        let iteration = 0;
        while (iteration < config.maxIterations) {
            iteration++;
            // ------------------------------------------------------------------
            // Generate phase: consume the streaming generator chunk by chunk,
            // yielding events as they arrive.  The final LoopOutput is captured
            // from the generator's return value (done === true).
            // ------------------------------------------------------------------
            const gen = context.generateStream();
            let gmiOutput;
            while (true) {
                const { value, done } = await gen.next();
                if (done) {
                    // The generator's return value is the LoopOutput summary.
                    gmiOutput = value;
                    break;
                }
                // Yield chunk events to the caller.
                const chunk = value;
                if (chunk.type === 'text_delta' && chunk.content) {
                    yield { type: 'text_delta', content: chunk.content };
                }
                if (chunk.type === 'tool_call_request' && chunk.toolCalls) {
                    yield { type: 'tool_call_request', toolCalls: chunk.toolCalls };
                }
            }
            // Natural termination: no tool calls requested.
            if (!gmiOutput || gmiOutput.toolCalls.length === 0) {
                yield { type: 'loop_complete', totalIterations: iteration };
                return;
            }
            // ------------------------------------------------------------------
            // Act phase: execute tool calls (parallel or sequential).
            // ------------------------------------------------------------------
            const toolCalls = gmiOutput.toolCalls;
            let results;
            if (config.parallelTools) {
                // Dispatch all tool calls simultaneously; collect all outcomes even
                // if some reject, so we can still feed partial results back.
                const settled = await Promise.allSettled(toolCalls.map((tc) => context.executeTool(tc)));
                results = settled.map((s, i) => {
                    if (s.status === 'fulfilled')
                        return s.value;
                    // Convert a rejected promise into a failed LoopToolCallResult so
                    // downstream handling is uniform.
                    return {
                        id: toolCalls[i].id,
                        name: toolCalls[i].name,
                        success: false,
                        error: String(s.reason),
                    };
                });
            }
            else {
                // Sequential execution — preserves order and stops early on
                // fail_closed errors (handled in the yield loop below).
                results = [];
                for (const tc of toolCalls) {
                    const result = await context.executeTool(tc);
                    results.push(result);
                }
            }
            // ------------------------------------------------------------------
            // Observe phase: yield results, handle failures per failureMode.
            // ------------------------------------------------------------------
            for (const result of results) {
                if (result.success) {
                    yield { type: 'tool_result', toolName: result.name, result };
                }
                else {
                    const errorMsg = result.error ?? 'unknown error';
                    yield { type: 'tool_error', toolName: result.name, error: errorMsg };
                    if (config.failureMode === 'fail_closed') {
                        throw new Error(`Tool ${result.name} failed (fail_closed): ${errorMsg}`);
                    }
                    // fail_open: continue — the error is already yielded above.
                }
            }
            // Feed all results (successes and failures) back into the conversation
            // so the LLM has full context on the next iteration.
            context.addToolResults(results);
        }
        // Exceeded maxIterations without a natural stop.
        yield { type: 'max_iterations_reached', iteration: config.maxIterations };
    }
}
//# sourceMappingURL=LoopController.js.map