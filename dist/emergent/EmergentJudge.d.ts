/**
 * @fileoverview EmergentJudge — LLM-as-judge evaluator for forged tools.
 * @module @framers/agentos/emergent/EmergentJudge
 *
 * Evaluates runtime-created tools across three distinct evaluation modes, each
 * scaled to the risk level of the operation:
 *
 * - **Creation review** (`reviewCreation`): Full code audit + test output
 *   validation. Invokes a single LLM call against the judge model to score
 *   safety, correctness, determinism, and boundedness. The tool is only
 *   approved if both safety and correctness pass.
 *
 * - **Reuse validation** (`validateReuse`): Pure programmatic schema conformance
 *   check run on every invocation. Zero LLM calls — must be fast. Validates
 *   that the tool's output matches its declared JSON Schema type constraints.
 *
 * - **Promotion panel** (`reviewPromotion`): Two independent LLM calls using
 *   the promotion model — one safety auditor and one correctness reviewer.
 *   Both must approve for the promotion verdict to pass. This dual-judge
 *   gate prevents single-point-of-failure in the promotion decision.
 *
 * All LLM interaction is abstracted behind a `generateText` callback so the
 * judge is model-agnostic and trivially testable with mock implementations.
 */
import type { CreationVerdict, ReuseVerdict, PromotionVerdict, EmergentTool } from './types.js';
import type { JSONSchemaObject } from '../core/tools/ITool.js';
/**
 * A candidate tool submitted for creation review by the {@link EmergentJudge}.
 *
 * Contains all the information the judge needs to evaluate safety, correctness,
 * determinism, and bounded execution: the tool's identity and schemas, its
 * source code or composition spec, the sandbox API allowlist, and the results
 * of any test runs.
 */
export interface ToolCandidate {
    /** Machine-readable name for the proposed tool. */
    name: string;
    /** Natural language description of the tool's purpose and behaviour. */
    description: string;
    /** JSON Schema defining the tool's input arguments. */
    inputSchema: JSONSchemaObject;
    /** JSON Schema defining the tool's expected output shape (optional). */
    outputSchema?: JSONSchemaObject;
    /**
     * The tool's source code (for sandbox mode) or serialized composition spec
     * (for compose mode). Included in the LLM prompt for security auditing.
     */
    source: string;
    /**
     * Whether the tool was built by composing existing tools (`'compose'`) or
     * by running arbitrary code in a sandbox (`'sandbox'`).
     */
    implementationMode: 'compose' | 'sandbox';
    /**
     * Sandbox API allowlist — the set of APIs the tool's code is permitted to
     * invoke. Only relevant for `'sandbox'` mode tools. Used by the safety
     * auditor to verify that the code does not exceed its declared API surface.
     */
    allowlist?: string[];
    /**
     * Results of test runs executed against the candidate tool before review.
     * Each entry contains the input, output, success flag, and optional error.
     * The judge uses these to assess correctness and determinism.
     */
    testResults: Array<{
        input: unknown;
        output: unknown;
        success: boolean;
        error?: string;
    }>;
}
/**
 * Configuration for the {@link EmergentJudge}.
 *
 * All LLM interaction is abstracted behind the `generateText` callback,
 * making the judge model-agnostic and easily testable with mocks.
 */
export interface EmergentJudgeConfig {
    /**
     * Model ID used for the single-pass creation review.
     * Should be a fast, cost-efficient model since correctness is primarily
     * validated through test cases.
     * @example "gpt-4o-mini"
     */
    judgeModel: string;
    /**
     * Model ID used by both reviewers in the promotion panel.
     * Should be a more capable model than `judgeModel` since promotion
     * decisions are higher-stakes.
     * @example "gpt-4o"
     */
    promotionModel: string;
    /**
     * Callback that invokes an LLM to generate text from a prompt.
     * The judge calls this for creation reviews and promotion panels.
     *
     * @param model - The model ID to use for generation.
     * @param prompt - The full prompt string to send to the LLM.
     * @returns The raw text response from the LLM.
     */
    generateText: (model: string, prompt: string) => Promise<string>;
}
/**
 * Evaluates forged tools for safety, correctness, and quality using LLM-as-judge.
 *
 * Three evaluation modes, each scaled to the risk level of the operation:
 *
 * | Mode | LLM calls | When used |
 * |---|---|---|
 * | `reviewCreation` | 1 | Newly forged tool — full code audit + test validation |
 * | `validateReuse` | 0 | Every invocation — pure programmatic schema check |
 * | `reviewPromotion` | 2 | Tier promotion — dual-judge safety + correctness panel |
 *
 * @example
 * ```ts
 * const judge = new EmergentJudge({
 *   judgeModel: 'gpt-4o-mini',
 *   promotionModel: 'gpt-4o',
 *   generateText: async (model, prompt) => callLlm(model, prompt),
 * });
 *
 * // Creation review
 * const verdict = await judge.reviewCreation(candidate);
 * if (verdict.approved) { registry.register(tool, 'session'); }
 *
 * // Reuse validation (no LLM call)
 * const reuse = judge.validateReuse('tool-1', output, outputSchema);
 * if (!reuse.valid) { throw new Error(reuse.schemaErrors.join(', ')); }
 *
 * // Promotion panel
 * const promotion = await judge.reviewPromotion(tool);
 * if (promotion.approved) { registry.promote(tool.id, 'agent'); }
 * ```
 */
export declare class EmergentJudge {
    /** Resolved configuration containing model IDs and the generateText callback. */
    private readonly config;
    /**
     * Create a new EmergentJudge instance.
     *
     * @param config - Judge configuration specifying models and the LLM callback.
     *   The `generateText` function is called for creation reviews and promotion
     *   panels but never for reuse validation (which is purely programmatic).
     */
    constructor(config: EmergentJudgeConfig);
    /**
     * Full code + test review for a newly forged tool.
     *
     * Builds a structured prompt from the candidate's details (name, description,
     * schemas, source code, sandbox allowlist, test results) and asks the LLM to
     * evaluate four dimensions: SAFETY, CORRECTNESS, DETERMINISM, BOUNDED.
     *
     * The tool is approved only if both `safety.passed` AND `correctness.passed`
     * are `true` in the LLM response.
     *
     * If the LLM returns malformed JSON that cannot be parsed, a rejected verdict
     * is returned with confidence 0 and a reasoning string explaining the parse
     * failure. This prevents bad LLM output from accidentally approving a tool.
     *
     * @param candidate - The tool candidate to evaluate. Must include source code
     *   and at least one test result.
     * @returns A {@link CreationVerdict} indicating approval or rejection with
     *   per-dimension scores and reasoning.
     */
    reviewCreation(candidate: ToolCandidate): Promise<CreationVerdict>;
    /**
     * Pure schema validation on each reuse — no LLM call.
     *
     * Validates that `output` conforms to the declared `schema` using basic type
     * checking. This runs on every tool invocation so it must be fast — no LLM
     * calls, no network I/O, no async operations.
     *
     * Checks performed:
     * - If schema declares `type: 'object'`, verify output is a non-null object.
     * - If schema declares `properties`, verify each declared property key exists
     *   on the output object.
     * - If schema declares `required`, verify each required property key exists.
     * - If schema declares `type: 'string'`, verify output is a string.
     * - If schema declares `type: 'number'` or `type: 'integer'`, verify output
     *   is a number.
     * - If schema declares `type: 'boolean'`, verify output is a boolean.
     * - If schema declares `type: 'array'`, verify output is an array.
     *
     * @param _toolId - The ID of the tool being reused (reserved for future
     *   anomaly detection; currently unused).
     * @param output - The actual output value produced by the tool invocation.
     * @param schema - The tool's declared output JSON Schema.
     * @returns A {@link ReuseVerdict} with `valid: true` if the output conforms,
     *   or `valid: false` with a `schemaErrors` array describing each mismatch.
     */
    validateReuse(_toolId: string, output: unknown, schema: JSONSchemaObject): ReuseVerdict;
    /**
     * Two-judge panel for tier promotion. Both must approve.
     *
     * Sends two independent LLM calls in parallel using the promotion model:
     * 1. **Safety auditor**: Reviews the tool's source code and usage history for
     *    security concerns (data exfiltration, resource exhaustion, API abuse).
     * 2. **Correctness reviewer**: Reviews the tool's source code and all historical
     *    outputs for correctness issues (schema violations, edge case failures).
     *
     * Both reviewers must return `approved: true` for the promotion to pass. If
     * either reviewer's response fails to parse as JSON, the promotion is rejected.
     *
     * @param tool - The emergent tool to evaluate for promotion. Must have usage
     *   stats and judge verdicts from prior reviews.
     * @returns A {@link PromotionVerdict} containing both sub-verdicts and the
     *   combined approval decision.
     */
    reviewPromotion(tool: EmergentTool): Promise<PromotionVerdict>;
    /**
     * Build the creation review prompt from a tool candidate.
     *
     * The prompt asks the LLM to act as a security auditor and evaluate the
     * candidate across four dimensions: SAFETY, CORRECTNESS, DETERMINISM, BOUNDED.
     *
     * @param candidate - The tool candidate to build the prompt for.
     * @returns The fully-formed prompt string.
     */
    private buildCreationPrompt;
    /**
     * Build the safety auditor prompt for promotion review.
     *
     * Focuses the reviewer on security concerns: API surface, data exfiltration,
     * resource exhaustion, and sandbox escape vectors.
     *
     * @param tool - The emergent tool being considered for promotion.
     * @returns The safety auditor prompt string.
     */
    private buildSafetyAuditorPrompt;
    /**
     * Build the correctness reviewer prompt for promotion review.
     *
     * Focuses the reviewer on functional correctness: schema conformance,
     * edge case handling, success rate, and output consistency.
     *
     * @param tool - The emergent tool being considered for promotion.
     * @returns The correctness reviewer prompt string.
     */
    private buildCorrectnessReviewerPrompt;
    /**
     * Recursively validate a value against a JSON Schema definition.
     *
     * Implements a focused subset of JSON Schema validation without external
     * dependencies (no ajv). Supports:
     * - Type checking: object, string, number, integer, boolean, array
     * - String constraints: minLength, maxLength, pattern, enum
     * - Number constraints: minimum, maximum
     * - Object constraints: required fields, recursive property validation
     * - Array constraints: recursive items validation
     *
     * This runs on every tool invocation so it must be fast — no LLM calls,
     * no network I/O, no async operations.
     *
     * @param value - The value to validate.
     * @param schema - The JSON Schema to validate against.
     * @returns An object with `valid: true` if the value conforms, or
     *   `valid: false` with an `errors` array describing each mismatch.
     */
    private validateAgainstSchema;
    /**
     * Validate a value against a JSON Schema `type` declaration.
     *
     * Performs basic type checking without a full JSON Schema validator library.
     * Supports object (with optional properties/required checks), string, number,
     * integer, boolean, and array types.
     *
     * @param value - The value to validate.
     * @param schema - The JSON Schema to validate against.
     * @returns An array of error strings (empty if valid).
     */
    private validateType;
    /**
     * Produce a human-readable type description for an arbitrary value.
     *
     * @param value - The value to describe.
     * @returns A string like `"null"`, `"array"`, `"object"`, `"string"`, etc.
     */
    private describeType;
    /**
     * Extract a JSON object from a potentially wrapped LLM response.
     *
     * LLMs sometimes wrap JSON in markdown code fences or prepend/append prose.
     * This method attempts to find the first `{` and last `}` and extract the
     * substring between them.
     *
     * @param raw - The raw LLM response string.
     * @returns The extracted JSON substring, or the original string if no
     *   braces are found.
     */
    private extractJson;
    /**
     * Build a rejected {@link CreationVerdict} with confidence 0.
     *
     * Used when the LLM call fails or returns unparseable output. By defaulting
     * to rejection, we ensure that system-level failures never accidentally
     * approve a tool.
     *
     * @param reasoning - Explanation of why the verdict defaulted to rejection.
     * @returns A rejected CreationVerdict.
     */
    private rejectedVerdict;
}
//# sourceMappingURL=EmergentJudge.d.ts.map