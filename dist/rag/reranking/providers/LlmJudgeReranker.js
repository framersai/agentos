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
const POINTWISE_SYSTEM = `You are a relevance scorer. Rate each document's relevance to the query on a scale of 0-10. 10 = perfectly relevant, 0 = completely irrelevant. Return ONLY a JSON array of integer scores, one per document, in the same order. Example: [8, 3, 7, 2, 9]`;
const LISTWISE_SYSTEM = `You are a relevance ranker. Rank the documents by relevance to the query, most relevant first. Return ONLY a JSON array of document IDs in ranked order. Example: ["doc-3", "doc-1", "doc-5"]`;
/** Two-phase LLM-based reranker: batch pointwise + listwise top-K. */
export class LlmJudgeReranker {
    constructor(config) {
        this.providerId = 'llm-judge';
        this.llmCallFn = config.llmCallFn;
        this.scoringModel = config.scoringModel;
        this.rankingModel = config.rankingModel;
        this.maxPointwiseDocuments = config.maxPointwiseDocuments ?? 100;
        this.pointwiseTopK = config.pointwiseTopK ?? 20;
        this.batchSize = config.batchSize ?? 10;
    }
    async isAvailable() {
        return typeof this.llmCallFn === 'function';
    }
    async rerank(input, config) {
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
        let finalRanking;
        try {
            finalRanking = await this.listwiseRank(input.query, candidates, topN);
        }
        catch {
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
    async batchPointwiseScore(query, documents) {
        const batches = [];
        for (let i = 0; i < documents.length; i += this.batchSize) {
            batches.push(documents.slice(i, i + this.batchSize));
        }
        const results = [];
        for (const batch of batches) {
            const docList = batch
                .map((d, i) => `[${i + 1}] ${d.content.slice(0, 200)}`)
                .join('\n');
            const userPrompt = `Query: "${query}"\n\nDocuments:\n${docList}`;
            try {
                const raw = await this.llmCallFn(POINTWISE_SYSTEM, userPrompt, this.scoringModel);
                const cleaned = raw.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
                const scores = JSON.parse(cleaned);
                for (let i = 0; i < batch.length; i++) {
                    results.push({
                        ...batch[i],
                        score: typeof scores[i] === 'number' ? scores[i] : 0,
                    });
                }
            }
            catch {
                for (const doc of batch) {
                    results.push({ ...doc, score: 0 });
                }
            }
        }
        return results;
    }
    /** Phase 2: Listwise ranking of top candidates. */
    async listwiseRank(query, candidates, topN) {
        const docList = candidates
            .map((d) => `[${d.id}] ${d.content.slice(0, 200)}`)
            .join('\n');
        const userPrompt = `Query: "${query}"\n\nDocuments:\n${docList}`;
        const raw = await this.llmCallFn(LISTWISE_SYSTEM, userPrompt, this.rankingModel);
        const cleaned = raw.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
        const ranking = JSON.parse(cleaned);
        const candidateMap = new Map(candidates.map((c) => [c.id, c]));
        const results = [];
        for (let i = 0; i < Math.min(ranking.length, topN); i++) {
            const doc = candidateMap.get(ranking[i]);
            if (!doc)
                continue;
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
//# sourceMappingURL=LlmJudgeReranker.js.map