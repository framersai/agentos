/**
 * @fileoverview SelfEvaluateTool — ITool implementation that enables agents to
 * evaluate their own response quality, adjust runtime parameters, and report
 * on performance drift over a session.
 *
 * @module @framers/agentos/emergent/SelfEvaluateTool
 *
 * Three actions:
 * - `evaluate` — Score a response using an LLM judge (via generateText).
 * - `adjust`   — Tweak runtime parameters (temperature, verbosity) or
 *   delegate personality adjustments to {@link AdaptPersonalityTool}.
 * - `report`   — Aggregate session evaluation history, compute score averages,
 *   and list all adjustments made.
 *
 * The tool mutates session state during `adjust`, either by delegating to
 * `adapt_personality` or by updating ephemeral runtime parameters.
 */
import type { ITool, ToolExecutionResult, ToolExecutionContext, JSONSchemaObject } from '../core/tools/ITool.js';
import { generateText } from '../api/generateText.js';
import { type AdaptPersonalityTool } from './AdaptPersonalityTool.js';
/**
 * Score dimensions returned by the LLM evaluation judge.
 */
export interface EvaluationScores {
    /** How relevant the response is to the user's query (0–1). */
    relevance: number;
    /** How clear and well-structured the response is (0–1). */
    clarity: number;
    /** How accurate the factual content is (0–1). */
    accuracy: number;
    /** How helpful the response is for the user's goal (0–1). */
    helpfulness: number;
}
/**
 * A recorded evaluation with scores and timestamp.
 */
export interface EvaluationRecord {
    /** The scores assigned by the LLM judge. */
    scores: EvaluationScores;
    /** ISO-8601 timestamp of when the evaluation was performed. */
    timestamp: string;
}
/**
 * A recorded parameter adjustment.
 */
export interface AdjustmentRecord {
    /** The parameter that was adjusted. */
    param: string;
    /** Value before adjustment. */
    prev: unknown;
    /** Value after adjustment. */
    new: unknown;
    /** ISO-8601 timestamp of when the adjustment was made. */
    timestamp: string;
}
/**
 * Memory trace stored via the optional storeMemory callback.
 */
export interface MemoryTrace {
    /** Trace type identifier. */
    type: string;
    /** Scope of the trace (e.g. 'session'). */
    scope: string;
    /** Serialized trace content. */
    content: string;
    /** Tags for categorization and retrieval. */
    tags: string[];
}
/**
 * Input arguments accepted by the `self_evaluate` tool.
 * Discriminated on the `action` field.
 */
export interface SelfEvaluateInput extends Record<string, any> {
    /** The action to perform: evaluate, adjust, or report. */
    action: 'evaluate' | 'adjust' | 'report';
    /** The response text to evaluate (required for evaluate). */
    response?: string;
    /** The original user query for context (required for evaluate). */
    query?: string;
    /** The parameter to adjust (required for adjust). */
    param?: string;
    /** The new value for the parameter (required for adjust). */
    value?: unknown;
    /** Reasoning for personality adjustments (required when param is a personality trait). */
    reasoning?: string;
}
/**
 * Dependencies injected into the {@link SelfEvaluateTool} constructor.
 */
export interface SelfEvaluateDeps {
    /** Configuration controlling auto-adjust behaviour and evaluation limits. */
    config: {
        /** Whether adjustments are applied automatically after evaluations. */
        autoAdjust: boolean;
        /** Parameters that may be adjusted (e.g. 'temperature', 'verbosity', 'openness'). */
        adjustableParams: string[];
        /** Maximum number of evaluations allowed per session. */
        maxEvaluationsPerSession: number;
        /** Optional explicit model override for the evaluation judge. */
        evaluationModel?: string;
    };
    /** Optional AdaptPersonalityTool for delegating personality adjustments. */
    adaptPersonality?: AdaptPersonalityTool;
    /** Optional callback to persist evaluation traces to long-term memory. */
    storeMemory?: (trace: MemoryTrace) => Promise<void>;
    /** Optional override for tests or custom judge routing. */
    generateTextImpl?: typeof generateText;
    /** Optional host-level getter for session runtime parameters. */
    getSessionParam?: (param: string, context: ToolExecutionContext) => unknown;
    /** Optional host-level setter for session runtime parameters. */
    setSessionParam?: (param: string, value: unknown, context: ToolExecutionContext) => void;
}
/**
 * ITool implementation enabling agents to evaluate their own responses,
 * adjust runtime parameters, and generate performance reports.
 *
 * @example
 * ```ts
 * const tool = new SelfEvaluateTool({
 *   config: {
 *     autoAdjust: false,
 *     adjustableParams: ['temperature', 'verbosity'],
 *     maxEvaluationsPerSession: 20,
 *   },
 * });
 *
 * const result = await tool.execute({
 *   action: 'evaluate',
 *   response: 'The capital of France is Paris.',
 *   query: 'What is the capital of France?',
 * }, context);
 * ```
 */
export declare class SelfEvaluateTool implements ITool<SelfEvaluateInput> {
    /** @inheritdoc */
    readonly id = "com.framers.emergent.self-evaluate";
    /** @inheritdoc */
    readonly name = "self_evaluate";
    /** @inheritdoc */
    readonly displayName = "Self Evaluate";
    /** @inheritdoc */
    readonly description: string;
    /** @inheritdoc */
    readonly category = "emergent";
    /** @inheritdoc */
    readonly hasSideEffects = true;
    /** @inheritdoc */
    readonly inputSchema: JSONSchemaObject;
    /** Mutable self-evaluation state keyed by session identity. */
    private readonly sessionStates;
    /** Injected dependencies. */
    private readonly deps;
    /**
     * Create a new SelfEvaluateTool.
     *
     * @param deps - Injected dependencies including config, optional
     *   adaptPersonality tool, and optional memory store callback.
     */
    constructor(deps: SelfEvaluateDeps);
    /**
     * Execute the requested self-evaluation action.
     *
     * @param args - Action type and associated parameters.
     * @param context - Tool execution context.
     * @returns A {@link ToolExecutionResult} wrapping the action outcome.
     */
    execute(args: SelfEvaluateInput, context: ToolExecutionContext): Promise<ToolExecutionResult>;
    /**
     * Evaluate a response using an LLM judge and record the scores.
     *
     * Calls generateText with a small model to produce structured JSON scores,
     * then persists the evaluation as a memory trace if storeMemory is provided.
     */
    private handleEvaluate;
    /**
     * Adjust a runtime parameter.
     *
     * For personality traits (openness, conscientiousness, etc.), delegates to
     * the injected AdaptPersonalityTool. For non-personality params (temperature,
     * verbosity), stores the value in session state.
     */
    private handleAdjust;
    /**
     * Generate a session performance report.
     *
     * Aggregates all evaluations, computes score averages, lists all adjustments,
     * and summarizes personality drift and skill changes.
     */
    private handleReport;
    private resolveEvaluationModel;
    private buildEvaluationPrompt;
    private parseEvaluation;
    private extractJsonPayload;
    private normalizeScore;
    private normalizeAdjustments;
    private isPersonalityTrait;
    private delegatePersonalityAdjustment;
    private applySuggestedAdjustments;
    private getSessionState;
}
//# sourceMappingURL=SelfEvaluateTool.d.ts.map