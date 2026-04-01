/**
 * @fileoverview Hybrid IUtilityAI that delegates to LLM-based or statistical
 * implementations depending on the task. LLM methods are preferred for
 * summarization, classification, and keyword extraction; statistical methods
 * for tokenization, stemming, n-grams, readability, and similarity.
 *
 * Falls back gracefully: if one backend is unavailable, the other is tried.
 */
/**
 * Routes each utility method to the most appropriate backend:
 * - **LLM**: summarization, classification, keyword extraction, JSON repair
 * - **Statistical**: tokenization, stemming, n-grams, readability, similarity
 * - **Either with preference**: sentiment, language detection
 *
 * If the preferred backend is unavailable, falls back to the other.
 */
export class HybridUtilityAI {
    constructor(config) {
        this.llm = config.llm;
        this.stat = config.statistical;
        if (!this.llm && !this.stat) {
            throw new Error('HybridUtilityAI requires at least one backend (llm or statistical)');
        }
        this.utilityId = config.utilityId ?? `hybrid-${this.llm?.utilityId ?? 'none'}-${this.stat?.utilityId ?? 'none'}`;
    }
    async initialize(config) {
        await Promise.all([
            this.llm?.initialize?.(config),
            this.stat?.initialize?.(config),
        ]);
    }
    preferLLM() {
        return this.llm ?? this.stat;
    }
    preferStat() {
        return this.stat ?? this.llm;
    }
    // --- LLM-preferred methods ---
    async summarize(textToSummarize, options) {
        return this.preferLLM().summarize(textToSummarize, options);
    }
    async classifyText(textToClassify, options) {
        return this.preferLLM().classifyText(textToClassify, options);
    }
    async extractKeywords(textToAnalyze, options) {
        return this.preferLLM().extractKeywords(textToAnalyze, options);
    }
    async parseJsonSafe(jsonString, options) {
        // Try statistical (fast parsing) first, fall back to LLM (repair)
        try {
            const result = await this.preferStat().parseJsonSafe(jsonString, options);
            if (result !== null)
                return result;
        }
        catch { /* fall through */ }
        if (this.llm && this.stat) {
            return this.llm.parseJsonSafe(jsonString, options);
        }
        return null;
    }
    // --- Statistical-preferred methods ---
    async tokenize(text, options) {
        return this.preferStat().tokenize(text, options);
    }
    async stemTokens(tokens, options) {
        return this.preferStat().stemTokens(tokens, options);
    }
    async normalizeText(text, options) {
        return this.preferStat().normalizeText(text, options);
    }
    async generateNGrams(tokens, options) {
        return this.preferStat().generateNGrams(tokens, options);
    }
    async calculateReadability(text, options) {
        return this.preferStat().calculateReadability(text, options);
    }
    async calculateSimilarity(text1, text2, options) {
        return this.preferStat().calculateSimilarity(text1, text2, options);
    }
    // --- Either with preference ---
    async analyzeSentiment(text, options) {
        return this.preferStat().analyzeSentiment(text, options);
    }
    async detectLanguage(text, options) {
        return this.preferStat().detectLanguage(text, options);
    }
    // --- Health & lifecycle ---
    async checkHealth() {
        const deps = [];
        if (this.llm) {
            try {
                const h = await this.llm.checkHealth();
                deps.push({ name: `llm:${this.llm.utilityId}`, ...h });
            }
            catch (e) {
                deps.push({ name: `llm:${this.llm.utilityId}`, isHealthy: false, details: e.message });
            }
        }
        if (this.stat) {
            try {
                const h = await this.stat.checkHealth();
                deps.push({ name: `stat:${this.stat.utilityId}`, ...h });
            }
            catch (e) {
                deps.push({ name: `stat:${this.stat.utilityId}`, isHealthy: false, details: e.message });
            }
        }
        return {
            isHealthy: deps.every((d) => d.isHealthy),
            dependencies: deps,
        };
    }
    async shutdown() {
        await Promise.all([
            this.llm?.shutdown?.(),
            this.stat?.shutdown?.(),
        ]);
    }
}
//# sourceMappingURL=HybridUtilityAI.js.map