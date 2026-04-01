import { AgentOSResponseChunkType, } from '../../api/types/AgentOSResponse.js';
import { GuardrailAction, } from './IGuardrailService.js';
import { serializeEvaluation, withGuardrailMetadata, createGuardrailBlockedStream, hasEvaluateOutput, } from './guardrailDispatcher.js';
// ---------------------------------------------------------------------------
// Severity map used by worstAction — SANITIZE is excluded because it is
// always downgraded to FLAG before reaching the aggregator.
// ---------------------------------------------------------------------------
/** @internal Numeric severity for each guardrail action. Higher = worse. */
const ACTION_SEVERITY = {
    [GuardrailAction.ALLOW]: 0,
    [GuardrailAction.SANITIZE]: 1, // only used as tiebreaker — should not appear in Phase 2
    [GuardrailAction.FLAG]: 2,
    [GuardrailAction.BLOCK]: 3,
};
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
/**
 * Race a promise against an optional timeout.
 *
 * If `timeoutMs` is not set (undefined / 0), the original promise is returned
 * unmodified. On timeout or error the function returns `null` (fail-open)
 * and logs a warning so operators can tune the timeout.
 *
 * @param fn        - The async function to execute
 * @param timeoutMs - Maximum milliseconds to wait (undefined = no limit)
 * @returns The evaluation result, or `null` on timeout / error
 */
async function callWithTimeout(fn, timeoutMs) {
    try {
        if (!timeoutMs || timeoutMs <= 0) {
            return await fn();
        }
        // Race the evaluation against a timeout sentinel
        const result = await Promise.race([
            fn(),
            new Promise((resolve) => {
                setTimeout(() => resolve(null), timeoutMs);
            }),
        ]);
        return result;
    }
    catch (error) {
        console.warn('[AgentOS][Guardrails] callWithTimeout: guardrail threw, failing open.', error);
        return null;
    }
}
/**
 * Determine the worst (highest-severity) action from a list of evaluations.
 *
 * Returns `GuardrailAction.ALLOW` when the list is empty.
 *
 * @param evaluations - Non-empty array of evaluation results
 * @returns The action with the highest severity
 */
function worstAction(evaluations) {
    if (evaluations.length === 0) {
        return GuardrailAction.ALLOW;
    }
    let worst = evaluations[0].action;
    for (let i = 1; i < evaluations.length; i++) {
        const candidate = evaluations[i].action;
        if (ACTION_SEVERITY[candidate] > ACTION_SEVERITY[worst]) {
            worst = candidate;
        }
    }
    return worst;
}
/**
 * If a Phase 2 guardrail returns SANITIZE, downgrade it to FLAG with a
 * warning. Concurrent sanitization is non-deterministic so we refuse it.
 *
 * @param evaluation - The raw evaluation from Phase 2
 * @param svcIndex   - Registration index for logging
 * @returns The (potentially downgraded) evaluation
 */
function downgradePhase2Sanitize(evaluation, svcIndex) {
    if (evaluation.action !== GuardrailAction.SANITIZE) {
        return evaluation;
    }
    console.warn(`[AgentOS][Guardrails] Phase 2 guardrail at index ${svcIndex} returned SANITIZE — ` +
        'downgrading to FLAG because concurrent sanitization is non-deterministic.');
    return {
        ...evaluation,
        action: GuardrailAction.FLAG,
        reason: evaluation.reason
            ? `${evaluation.reason} [downgraded from SANITIZE]`
            : 'SANITIZE downgraded to FLAG in parallel phase',
    };
}
// ---------------------------------------------------------------------------
// ParallelGuardrailDispatcher
// ---------------------------------------------------------------------------
/**
 * Stateless two-phase parallel guardrail dispatcher.
 *
 * All methods are static — no instantiation needed. The class exists purely
 * as a namespace to keep the two public entry points grouped.
 */
export class ParallelGuardrailDispatcher {
    // -----------------------------------------------------------------------
    // evaluateInput
    // -----------------------------------------------------------------------
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
    static async evaluateInput(services, input, context) {
        if (services.length === 0) {
            return { sanitizedInput: input, evaluations: [] };
        }
        // -- Partition into sanitizers (Phase 1) and parallel classifiers (Phase 2)
        const sanitizers = [];
        const parallel = [];
        for (let i = 0; i < services.length; i++) {
            const svc = services[i];
            if (svc.config?.canSanitize === true) {
                sanitizers.push(svc);
            }
            else {
                parallel.push({ svc, registrationIndex: i });
            }
        }
        // Pre-allocate evaluation slots so results appear in registration order.
        // null slots are compacted away at the end.
        const evaluationSlots = new Array(services.length).fill(null);
        let sanitizedInput = input;
        // -----------------------------------------------------------------
        // Phase 1: Sequential sanitizers
        // -----------------------------------------------------------------
        for (let i = 0; i < services.length; i++) {
            const svc = services[i];
            // Only Phase 1 services (sanitizers) run sequentially
            if (svc.config?.canSanitize !== true) {
                continue;
            }
            if (!svc.evaluateInput) {
                continue;
            }
            const timeoutMs = svc.config?.timeoutMs;
            const evaluation = await callWithTimeout(() => svc.evaluateInput({ context, input: sanitizedInput }), timeoutMs);
            if (!evaluation) {
                continue;
            }
            evaluationSlots[i] = evaluation;
            // BLOCK in Phase 1 short-circuits everything — Phase 2 never runs
            if (evaluation.action === GuardrailAction.BLOCK) {
                const evaluations = evaluationSlots.filter(Boolean);
                return { sanitizedInput, evaluation, evaluations };
            }
            // SANITIZE: update the running sanitized input for the next sanitizer
            if (evaluation.action === GuardrailAction.SANITIZE && evaluation.modifiedText !== undefined) {
                sanitizedInput = {
                    ...sanitizedInput,
                    textInput: evaluation.modifiedText,
                };
            }
        }
        // -----------------------------------------------------------------
        // Phase 2: Parallel classifiers
        // -----------------------------------------------------------------
        if (parallel.length > 0) {
            const settled = await Promise.allSettled(parallel.map(({ svc }) => {
                if (!svc.evaluateInput) {
                    return Promise.resolve(null);
                }
                const timeoutMs = svc.config?.timeoutMs;
                return callWithTimeout(() => svc.evaluateInput({ context, input: sanitizedInput }), timeoutMs);
            }));
            // Slot results back into registration order
            for (let j = 0; j < parallel.length; j++) {
                const outcome = settled[j];
                if (outcome.status === 'rejected') {
                    console.warn('[AgentOS][Guardrails] Phase 2 evaluateInput rejected.', outcome.reason);
                    continue;
                }
                let evaluation = outcome.value;
                if (!evaluation) {
                    continue;
                }
                // Downgrade SANITIZE → FLAG in Phase 2
                evaluation = downgradePhase2Sanitize(evaluation, parallel[j].registrationIndex);
                evaluationSlots[parallel[j].registrationIndex] = evaluation;
            }
        }
        // -----------------------------------------------------------------
        // Aggregate: compact slots, pick "evaluation" (singular)
        // -----------------------------------------------------------------
        const evaluations = evaluationSlots.filter(Boolean);
        if (evaluations.length === 0) {
            return { sanitizedInput, evaluations: [] };
        }
        // Pick the singular evaluation: first BLOCK, else worst severity, else last
        const blockEval = evaluations.find((e) => e.action === GuardrailAction.BLOCK);
        if (blockEval) {
            return { sanitizedInput, evaluation: blockEval, evaluations };
        }
        const worst = worstAction(evaluations);
        // Find the first evaluation matching worst severity
        const worstEval = evaluations.find((e) => e.action === worst) ?? evaluations.at(-1);
        return {
            sanitizedInput,
            evaluation: worstEval,
            evaluations,
        };
    }
    // -----------------------------------------------------------------------
    // wrapOutput
    // -----------------------------------------------------------------------
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
    static async *wrapOutput(services, context, stream, options) {
        if (services.length === 0) {
            yield* stream;
            return;
        }
        // -- Partition into 4 groups once --------------------------------
        /** Streaming sanitizers: Phase 1 for TEXT_DELTA chunks */
        const streamingSanitizers = [];
        /** Streaming classifiers: Phase 2 for TEXT_DELTA chunks */
        const streamingParallel = [];
        /** Final sanitizers: Phase 1 for isFinal chunks */
        const finalSanitizers = [];
        /** Final classifiers: Phase 2 for isFinal chunks */
        const finalParallel = [];
        for (let i = 0; i < services.length; i++) {
            const svc = services[i];
            if (!hasEvaluateOutput(svc)) {
                continue;
            }
            const isStreaming = svc.config?.evaluateStreamingChunks === true;
            const isSanitizer = svc.config?.canSanitize === true;
            if (isStreaming && isSanitizer) {
                streamingSanitizers.push(svc);
            }
            else if (isStreaming && !isSanitizer) {
                streamingParallel.push({ svc, registrationIndex: i });
            }
            // All services with evaluateOutput participate in final evaluation
            if (isSanitizer) {
                finalSanitizers.push(svc);
            }
            else {
                finalParallel.push({ svc, registrationIndex: i });
            }
        }
        // -- Metadata from input evaluation --------------------------------
        const serializedInputEvaluations = (options.inputEvaluations ?? []).map(serializeEvaluation);
        let inputMetadataApplied = serializedInputEvaluations.length === 0;
        // -- Per-service rate limiting for streaming evaluation -------------
        const streamingEvaluationCounts = new Map();
        // -- Main stream loop ----------------------------------------------
        for await (const chunk of stream) {
            let currentChunk = chunk;
            // Attach input evaluation metadata to the first output chunk
            if (!inputMetadataApplied && serializedInputEvaluations.length > 0) {
                currentChunk = withGuardrailMetadata(currentChunk, { input: serializedInputEvaluations });
                inputMetadataApplied = true;
            }
            // ---------------------------------------------------------------
            // TEXT_DELTA (non-final): streaming guardrails
            // ---------------------------------------------------------------
            if (chunk.type === AgentOSResponseChunkType.TEXT_DELTA &&
                !chunk.isFinal &&
                (streamingSanitizers.length > 0 || streamingParallel.length > 0)) {
                const outputEvaluations = [];
                let workingChunk = currentChunk;
                // Phase 1: sequential streaming sanitizers
                for (const svc of streamingSanitizers) {
                    const svcId = svc.id || 'unknown';
                    const currentCount = streamingEvaluationCounts.get(svcId) || 0;
                    const maxEvals = svc.config?.maxStreamingEvaluations;
                    // Skip if this service has hit its rate limit
                    if (maxEvals !== undefined && currentCount >= maxEvals) {
                        continue;
                    }
                    const timeoutMs = svc.config?.timeoutMs;
                    const evaluation = await callWithTimeout(() => svc.evaluateOutput({ context, chunk: workingChunk, ragSources: options.ragSources }), timeoutMs);
                    streamingEvaluationCounts.set(svcId, currentCount + 1);
                    if (!evaluation) {
                        continue;
                    }
                    outputEvaluations.push(evaluation);
                    // BLOCK terminates the stream immediately
                    if (evaluation.action === GuardrailAction.BLOCK) {
                        yield* createGuardrailBlockedStream(context, evaluation, options);
                        return;
                    }
                    // SANITIZE: modify the textDelta for downstream services
                    if (evaluation.action === GuardrailAction.SANITIZE && evaluation.modifiedText !== undefined) {
                        workingChunk = {
                            ...workingChunk,
                            textDelta: evaluation.modifiedText,
                        };
                    }
                }
                // Phase 2: parallel streaming classifiers
                if (streamingParallel.length > 0) {
                    const tasks = streamingParallel.map(({ svc, registrationIndex }) => {
                        const svcId = svc.id || `svc-${registrationIndex}`;
                        const currentCount = streamingEvaluationCounts.get(svcId) || 0;
                        const maxEvals = svc.config?.maxStreamingEvaluations;
                        // Rate-limited services return null immediately
                        if (maxEvals !== undefined && currentCount >= maxEvals) {
                            return Promise.resolve({ evaluation: null, registrationIndex, svcId });
                        }
                        const timeoutMs = svc.config?.timeoutMs;
                        return callWithTimeout(() => svc.evaluateOutput({ context, chunk: workingChunk, ragSources: options.ragSources }), timeoutMs).then((evaluation) => {
                            streamingEvaluationCounts.set(svcId, currentCount + 1);
                            return { evaluation, registrationIndex, svcId };
                        });
                    });
                    const results = await Promise.allSettled(tasks);
                    for (const result of results) {
                        if (result.status === 'rejected') {
                            console.warn('[AgentOS][Guardrails] Phase 2 streaming evaluateOutput rejected.', result.reason);
                            continue;
                        }
                        const { evaluation: rawEvaluation, registrationIndex } = result.value;
                        if (!rawEvaluation) {
                            continue;
                        }
                        // Downgrade SANITIZE → FLAG in Phase 2
                        const evaluation = downgradePhase2Sanitize(rawEvaluation, registrationIndex);
                        outputEvaluations.push(evaluation);
                        // BLOCK terminates the stream immediately
                        if (evaluation.action === GuardrailAction.BLOCK) {
                            yield* createGuardrailBlockedStream(context, evaluation, options);
                            return;
                        }
                    }
                }
                // Attach output evaluation metadata
                if (outputEvaluations.length > 0) {
                    workingChunk = withGuardrailMetadata(workingChunk, {
                        output: outputEvaluations.map(serializeEvaluation),
                    });
                }
                currentChunk = workingChunk;
            }
            // ---------------------------------------------------------------
            // isFinal chunks: all guardrails participate
            // ---------------------------------------------------------------
            if (chunk.isFinal &&
                (finalSanitizers.length > 0 || finalParallel.length > 0)) {
                const outputEvaluations = [];
                let workingChunk = currentChunk;
                // Phase 1: sequential final sanitizers
                for (const svc of finalSanitizers) {
                    if (!svc.evaluateOutput) {
                        continue;
                    }
                    const timeoutMs = svc.config?.timeoutMs;
                    const evaluation = await callWithTimeout(() => svc.evaluateOutput({ context, chunk: workingChunk, ragSources: options.ragSources }), timeoutMs);
                    if (!evaluation) {
                        continue;
                    }
                    outputEvaluations.push(evaluation);
                    // BLOCK terminates the stream
                    if (evaluation.action === GuardrailAction.BLOCK) {
                        yield* createGuardrailBlockedStream(context, evaluation, options);
                        return;
                    }
                    // SANITIZE: modify finalResponseText or textDelta
                    if (evaluation.action === GuardrailAction.SANITIZE &&
                        evaluation.modifiedText !== undefined) {
                        if (workingChunk.type === AgentOSResponseChunkType.FINAL_RESPONSE) {
                            workingChunk = {
                                ...workingChunk,
                                finalResponseText: evaluation.modifiedText,
                            };
                        }
                        else {
                            workingChunk = {
                                ...workingChunk,
                                textDelta: evaluation.modifiedText,
                            };
                        }
                    }
                }
                // Phase 2: parallel final classifiers
                if (finalParallel.length > 0) {
                    const tasks = finalParallel.map(({ svc, registrationIndex }) => {
                        if (!svc.evaluateOutput) {
                            return Promise.resolve({ evaluation: null, registrationIndex });
                        }
                        const timeoutMs = svc.config?.timeoutMs;
                        return callWithTimeout(() => svc.evaluateOutput({ context, chunk: workingChunk, ragSources: options.ragSources }), timeoutMs).then((evaluation) => ({ evaluation, registrationIndex }));
                    });
                    const results = await Promise.allSettled(tasks);
                    for (const result of results) {
                        if (result.status === 'rejected') {
                            console.warn('[AgentOS][Guardrails] Phase 2 final evaluateOutput rejected.', result.reason);
                            continue;
                        }
                        const { evaluation: rawEvaluation, registrationIndex } = result.value;
                        if (!rawEvaluation) {
                            continue;
                        }
                        // Downgrade SANITIZE → FLAG in Phase 2
                        const evaluation = downgradePhase2Sanitize(rawEvaluation, registrationIndex);
                        outputEvaluations.push(evaluation);
                        // BLOCK terminates the stream
                        if (evaluation.action === GuardrailAction.BLOCK) {
                            yield* createGuardrailBlockedStream(context, evaluation, options);
                            return;
                        }
                    }
                }
                // Attach output evaluation metadata
                if (outputEvaluations.length > 0) {
                    workingChunk = withGuardrailMetadata(workingChunk, {
                        output: outputEvaluations.map(serializeEvaluation),
                    });
                }
                currentChunk = workingChunk;
            }
            yield currentChunk;
        }
    }
}
//# sourceMappingURL=ParallelGuardrailDispatcher.js.map