/**
 * @file LLMJudge.ts
 * @description LLM-as-Judge evaluation scorer using GPT-4 or other models
 * to semantically evaluate agent outputs.
 *
 * @module AgentOS/Evaluation
 * @version 1.0.0
 */
import type { AIModelProviderManager } from '../core/llm/providers/AIModelProviderManager';
import type { ScorerFunction } from './IEvaluator';
/**
 * Configuration for LLM Judge
 */
export interface LLMJudgeConfig {
    /** LLM provider manager */
    llmProvider: AIModelProviderManager;
    /** Model to use for judging */
    modelId?: string;
    /** Provider ID */
    providerId?: string;
    /** Temperature for judging (lower = more consistent) */
    temperature?: number;
    /** Custom system prompt for the judge */
    systemPrompt?: string;
}
/**
 * Evaluation criteria for LLM judge
 */
export interface JudgeCriteria {
    /** Criterion name */
    name: string;
    /** Description of what to evaluate */
    description: string;
    /** Weight (0-1) */
    weight?: number;
    /** Rubric for scoring */
    rubric?: string;
}
/**
 * LLM judgment result
 */
export interface JudgmentResult {
    /** Overall score (0-1) */
    score: number;
    /** Individual criterion scores */
    criteriaScores: Record<string, number>;
    /** Reasoning for the judgment */
    reasoning: string;
    /** Specific feedback */
    feedback: string[];
    /** Confidence in the judgment */
    confidence: number;
}
/**
 * LLM-based judge for semantic evaluation
 */
export declare class LLMJudge {
    private readonly llmProvider;
    private readonly modelId;
    private readonly providerId?;
    private readonly temperature;
    private readonly systemPrompt;
    constructor(config: LLMJudgeConfig);
    /**
     * Judge an AI output against criteria
     */
    judge(input: string, actualOutput: string, expectedOutput?: string, criteria?: JudgeCriteria[]): Promise<JudgmentResult>;
    /**
     * Create a scorer function for use with Evaluator
     */
    createScorer(criteria?: JudgeCriteria[]): ScorerFunction;
    /**
     * Compare two outputs and determine which is better
     */
    compare(input: string, outputA: string, outputB: string, criteria?: JudgeCriteria[]): Promise<{
        winner: 'A' | 'B' | 'tie';
        scoreA: number;
        scoreB: number;
        reasoning: string;
    }>;
    /**
     * Batch evaluate multiple outputs
     */
    batchJudge(evaluations: Array<{
        input: string;
        actualOutput: string;
        expectedOutput?: string;
    }>, criteria?: JudgeCriteria[], concurrency?: number): Promise<JudgmentResult[]>;
}
/**
 * Pre-built criteria sets for common use cases
 */
export declare const CRITERIA_PRESETS: {
    /** For evaluating code generation */
    codeGeneration: JudgeCriteria[];
    /** For evaluating summaries */
    summarization: JudgeCriteria[];
    /** For evaluating Q&A */
    questionAnswering: JudgeCriteria[];
    /** For evaluating creative writing */
    creativeWriting: JudgeCriteria[];
    /** For evaluating safety/harmlessness */
    safety: JudgeCriteria[];
};
//# sourceMappingURL=LLMJudge.d.ts.map