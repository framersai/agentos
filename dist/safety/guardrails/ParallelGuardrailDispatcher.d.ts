/**
 * @module ParallelGuardrailDispatcher
 *
 * Two-phase parallel guardrail dispatcher that separates sanitizers
 * (sequential, order-dependent) from classifiers (parallel, independent).
 *
 * **Phase 1 (Sequential):** Guardrails with `config.canSanitize === true`
 * run one-at-a-time in registration order. Each sanitizer receives the
 * cumulative output of all preceding sanitizers. A BLOCK here short-circuits
 * the entire pipeline.
 *
 * **Phase 2 (Parallel):** Remaining guardrails run concurrently via
 * `Promise.allSettled`. They receive the fully-sanitized text from Phase 1.
 * If any Phase 2 guardrail returns SANITIZE, it is **downgraded to FLAG**
 * because concurrent sanitization would produce non-deterministic results.
 *
 * The final outcome uses "worst-wins" aggregation:
 * BLOCK (severity 3) > FLAG (severity 2) > ALLOW (severity 0).
 *
 * @example
 * ```typescript
 * import { ParallelGuardrailDispatcher } from '@framers/agentos/safety/guardrails';
 *
 * const outcome = await ParallelGuardrailDispatcher.evaluateInput(
 *   [piiRedactor, toxicityClassifier, policyGuard],
 *   userInput,
 *   guardrailContext,
 * );
 * ```
 */
import type { AgentOSInput } from '../../api/types/AgentOSInput';
import { type AgentOSResponse } from '../../api/types/AgentOSResponse';
import { type GuardrailContext, type IGuardrailService } from './IGuardrailService';
import type { GuardrailInputOutcome, GuardrailOutputOptions } from './guardrailDispatcher';
/**
 * Stateless two-phase parallel guardrail dispatcher.
 *
 * All methods are static — no instantiation needed. The class exists purely
 * as a namespace to keep the two public entry points grouped.
 */
export declare class ParallelGuardrailDispatcher {
    /**
     * Evaluate user input through registered guardrails using two-phase execution.
     *
     * **Phase 1 (Sequential — sanitizers):**
     * Guardrails with `config.canSanitize === true` run one-at-a-time in
     * registration order. Each sees (and may modify) the cumulative sanitized
     * input. A BLOCK result short-circuits immediately — Phase 2 never runs.
     *
     * **Phase 2 (Parallel — classifiers):**
     * All remaining guardrails run concurrently via `Promise.allSettled` on
     * the text produced by Phase 1. A Phase 2 SANITIZE is downgraded to FLAG.
     *
     * **Aggregation:** worst-wins (BLOCK > FLAG > ALLOW). The singular
     * `evaluation` field is set to the first BLOCK, else the worst-severity
     * evaluation, else the last evaluation by registration order.
     *
     * @param services  - Array of guardrail services (already normalized)
     * @param input     - User input to evaluate
     * @param context   - Conversational context for policy decisions
     * @returns Outcome with sanitized input and all evaluations in registration order
     */
    static evaluateInput(services: IGuardrailService[], input: AgentOSInput, context: GuardrailContext): Promise<GuardrailInputOutcome>;
    /**
     * Wrap a response stream with two-phase guardrail filtering.
     *
     * Partitions services into four groups (once, up front):
     * 1. **Streaming sanitizers** (`canSanitize && evaluateStreamingChunks`)
     * 2. **Streaming parallel** classifiers (`evaluateStreamingChunks && !canSanitize`)
     * 3. **Final sanitizers** (`canSanitize && !evaluateStreamingChunks`)
     * 4. **Final parallel** classifiers (the rest with `evaluateOutput`)
     *
     * For each TEXT_DELTA chunk: Phase 1 runs streaming sanitizers sequentially
     * (with per-service rate limiting), then Phase 2 runs streaming classifiers
     * in parallel.
     *
     * For each isFinal chunk: Phase 1 runs final sanitizers sequentially, then
     * Phase 2 runs final classifiers in parallel. All services with
     * `evaluateOutput` participate in final evaluation.
     *
     * A BLOCK in either phase terminates the stream immediately with an error
     * chunk.
     *
     * @param services  - Array of guardrail services (already normalized)
     * @param context   - Conversational context for policy decisions
     * @param stream    - Source response stream to filter
     * @param options   - Stream options and input evaluations to embed
     * @returns Wrapped async generator with guardrail filtering applied
     */
    static wrapOutput(services: IGuardrailService[], context: GuardrailContext, stream: AsyncGenerator<AgentOSResponse, void, undefined>, options: GuardrailOutputOptions): AsyncGenerator<AgentOSResponse, void, undefined>;
}
//# sourceMappingURL=ParallelGuardrailDispatcher.d.ts.map