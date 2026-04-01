/**
 * @fileoverview LLM-as-Judge Reranker — two-phase hybrid reranking using LLM calls.
 *
 * Phase 1: Batch pointwise scoring with a cheap model (gpt-4o-mini, haiku).
 *          Groups documents into batches of 10, asks LLM to score 0-10.
 * Phase 2: Listwise final ranking with a synthesis model.
 *          Takes top-K from phase 1, asks LLM to rank by relevance.
 *
 * Cognitive science: Combines absolute judgment (pointwise) with comparative
 * judgment (listwise) — mirrors how human expert reviewers evaluate documents.
 *
 * References:
 * - Sun, W., et al. (2023). "Is ChatGPT Good at Search? Investigating Large
 *   Language Models as Re-Ranking Agents." arXiv:2304.09542
 * - Qin, Z., et al. (2023). "Large Language Models are Effective Text Rankers
 *   with Pairwise Ranking Prompting." arXiv:2306.17563
 *
 * @module agentos/rag/reranking/providers/LlmJudgeReranker
 */
import type { IRerankerProvider, RerankerInput, RerankerOutput, RerankerRequestConfig } from '../IRerankerService.js';
/** Configuration for the LLM judge reranker. */
export interface LlmJudgeRerankerConfig {
    /** LLM call function: (systemPrompt, userPrompt, model?) → response text. */
    llmCallFn: (system: string, user: string, model?: string) => Promise<string>;
    /** Model for batch pointwise scoring (cheap). Auto-detected if not set. */
    scoringModel?: string;
    /** Model for listwise final ranking (better). Agent's primary if not set. */
    rankingModel?: string;
    /** Max documents to process in phase 1. */
    maxPointwiseDocuments?: number;
    /** How many survive phase 1 into phase 2. */
    pointwiseTopK?: number;
    /** Timeout per LLM call in ms. */
    timeoutMs?: number;
    /** Batch size for pointwise scoring. */
    batchSize?: number;
}
/** Two-phase LLM-based reranker: batch pointwise + listwise top-K. */
export declare class LlmJudgeReranker implements IRerankerProvider {
    readonly providerId: "llm-judge";
    private readonly llmCallFn;
    private readonly scoringModel?;
    private readonly rankingModel?;
    private readonly maxPointwiseDocuments;
    private readonly pointwiseTopK;
    private readonly batchSize;
    constructor(config: LlmJudgeRerankerConfig);
    isAvailable(): Promise<boolean>;
    rerank(input: RerankerInput, config: RerankerRequestConfig): Promise<RerankerOutput>;
    /** Phase 1: Score documents in batches. */
    private batchPointwiseScore;
    /** Phase 2: Listwise ranking of top candidates. */
    private listwiseRank;
}
//# sourceMappingURL=LlmJudgeReranker.d.ts.map