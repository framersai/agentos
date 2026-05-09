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

import type {
  IRerankerProvider,
  RerankerInput,
  RerankerOutput,
  RerankerRequestConfig,
  RerankedDocument,
} from '../IRerankerService.js';

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

const POINTWISE_SYSTEM = `You are a relevance scorer. Rate each document's relevance to the query on a scale of 0-10. 10 = perfectly relevant, 0 = completely irrelevant. Return ONLY a JSON array of integer scores, one per document, in the same order. Example: [8, 3, 7, 2, 9]`;

const LISTWISE_SYSTEM = `You are a relevance ranker. Rank the documents by relevance to the query, most relevant first. Return ONLY a JSON array of document IDs in ranked order. Example: ["doc-3", "doc-1", "doc-5"]`;

/** Two-phase LLM-based reranker: batch pointwise + listwise top-K. */
export class LlmJudgeReranker implements IRerankerProvider {
  public readonly providerId = 'llm-judge' as const;

  private readonly llmCallFn: LlmJudgeRerankerConfig['llmCallFn'];
  private readonly scoringModel?: string;
  private readonly rankingModel?: string;
  private readonly maxPointwiseDocuments: number;
  private readonly pointwiseTopK: number;
  private readonly batchSize: number;

  constructor(config: LlmJudgeRerankerConfig) {
    this.llmCallFn = config.llmCallFn;
    this.scoringModel = config.scoringModel;
    this.rankingModel = config.rankingModel;
    this.maxPointwiseDocuments = config.maxPointwiseDocuments ?? 100;
    this.pointwiseTopK = config.pointwiseTopK ?? 20;
    this.batchSize = config.batchSize ?? 10;
  }

  async isAvailable(): Promise<boolean> {
    return typeof this.llmCallFn === 'function';
  }

  async rerank(input: RerankerInput, config: RerankerRequestConfig): Promise<RerankerOutput> {
    const topN = config.topN ?? this.pointwiseTopK;
    let documents = input.documents;

    if (documents.length > this.maxPointwiseDocuments) {
      documents = documents.slice(0, this.maxPointwiseDocuments);
    }

    // Phase 1: Batch pointwise scoring
    const scored = await this.batchPointwiseScore(input.query, documents);

    // Sort by score descending, take top-K for phase 2
    scored.sort((a, b) => b.score - a.score);
    const candidates = scored.slice(0, this.pointwiseTopK);

    // Phase 2: Listwise ranking
    let finalRanking: RerankedDocument[];
    try {
      finalRanking = await this.listwiseRank(input.query, candidates, topN);
    } catch {
      // Fallback: use pointwise scores
      finalRanking = candidates.slice(0, topN).map((c, i) => ({
        id: c.id,
        content: c.content,
        relevanceScore: 1 - (i / Math.max(topN, 1)),
        originalScore: c.originalScore,
        metadata: c.metadata,
      }));
    }

    return { results: finalRanking };
  }

  /** Phase 1: Score documents in batches. */
  private async batchPointwiseScore(
    query: string,
    documents: RerankerInput['documents'],
  ): Promise<Array<RerankerInput['documents'][number] & { score: number }>> {
    const batches: RerankerInput['documents'][] = [];
    for (let i = 0; i < documents.length; i += this.batchSize) {
      batches.push(documents.slice(i, i + this.batchSize));
    }

    const results: Array<RerankerInput['documents'][number] & { score: number }> = [];

    for (const batch of batches) {
      const docList = batch
        .map((d, i) => `[${i + 1}] ${d.content.slice(0, 200)}`)
        .join('\n');
      const userPrompt = `Query: "${query}"\n\nDocuments:\n${docList}`;

      try {
        const raw = await this.llmCallFn(POINTWISE_SYSTEM, userPrompt, this.scoringModel);
        const cleaned = raw.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
        const scores = JSON.parse(cleaned) as number[];

        for (let i = 0; i < batch.length; i++) {
          results.push({
            ...batch[i],
            score: typeof scores[i] === 'number' ? scores[i] : 0,
          });
        }
      } catch {
        for (const doc of batch) {
          results.push({ ...doc, score: 0 });
        }
      }
    }

    return results;
  }

  /** Phase 2: Listwise ranking of top candidates. */
  private async listwiseRank(
    query: string,
    candidates: Array<RerankerInput['documents'][number] & { score: number }>,
    topN: number,
  ): Promise<RerankedDocument[]> {
    const docList = candidates
      .map((d) => `[${d.id}] ${d.content.slice(0, 200)}`)
      .join('\n');
    const userPrompt = `Query: "${query}"\n\nDocuments:\n${docList}`;

    const raw = await this.llmCallFn(LISTWISE_SYSTEM, userPrompt, this.rankingModel);
    const cleaned = raw.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    const ranking = JSON.parse(cleaned) as string[];

    const candidateMap = new Map(candidates.map((c) => [c.id, c]));
    const results: RerankedDocument[] = [];

    for (let i = 0; i < Math.min(ranking.length, topN); i++) {
      const doc = candidateMap.get(ranking[i]);
      if (!doc) continue;
      results.push({
        id: doc.id,
        content: doc.content,
        relevanceScore: 1 - (i / Math.max(ranking.length, 1)),
        originalScore: doc.originalScore,
        metadata: doc.metadata,
      });
    }

    return results;
  }
}
