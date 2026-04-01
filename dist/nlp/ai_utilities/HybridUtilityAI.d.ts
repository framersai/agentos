/**
 * @fileoverview Hybrid IUtilityAI that delegates to LLM-based or statistical
 * implementations depending on the task. LLM methods are preferred for
 * summarization, classification, and keyword extraction; statistical methods
 * for tokenization, stemming, n-grams, readability, and similarity.
 *
 * Falls back gracefully: if one backend is unavailable, the other is tried.
 */
import type { IUtilityAI, UtilityAIConfigBase, ParseJsonOptions, SummarizationOptions, ClassificationOptions, ClassificationResult, KeywordExtractionOptions, TokenizationOptions, StemmingOptions, SimilarityOptions, SentimentAnalysisOptions, SentimentResult, LanguageDetectionOptions, LanguageDetectionResult, TextNormalizationOptions, NGramOptions, ReadabilityOptions, ReadabilityResult } from './IUtilityAI';
export interface HybridUtilityAIConfig extends UtilityAIConfigBase {
    /** LLM-based implementation (used for generative tasks). */
    llm?: IUtilityAI;
    /** Statistical/NLP implementation (used for deterministic tasks). */
    statistical?: IUtilityAI;
}
/**
 * Routes each utility method to the most appropriate backend:
 * - **LLM**: summarization, classification, keyword extraction, JSON repair
 * - **Statistical**: tokenization, stemming, n-grams, readability, similarity
 * - **Either with preference**: sentiment, language detection
 *
 * If the preferred backend is unavailable, falls back to the other.
 */
export declare class HybridUtilityAI implements IUtilityAI {
    readonly utilityId: string;
    private readonly llm;
    private readonly stat;
    constructor(config: HybridUtilityAIConfig);
    initialize(config: UtilityAIConfigBase & Record<string, any>): Promise<void>;
    private preferLLM;
    private preferStat;
    summarize(textToSummarize: string, options?: SummarizationOptions): Promise<string>;
    classifyText(textToClassify: string, options: ClassificationOptions): Promise<ClassificationResult>;
    extractKeywords(textToAnalyze: string, options?: KeywordExtractionOptions): Promise<string[]>;
    parseJsonSafe<T = any>(jsonString: string, options?: ParseJsonOptions<T>): Promise<T | null>;
    tokenize(text: string, options?: TokenizationOptions): Promise<string[]>;
    stemTokens(tokens: string[], options?: StemmingOptions): Promise<string[]>;
    normalizeText(text: string, options?: TextNormalizationOptions): Promise<string>;
    generateNGrams(tokens: string[], options: NGramOptions): Promise<Record<number, string[][]>>;
    calculateReadability(text: string, options: ReadabilityOptions): Promise<ReadabilityResult>;
    calculateSimilarity(text1: string, text2: string, options?: SimilarityOptions): Promise<number>;
    analyzeSentiment(text: string, options?: SentimentAnalysisOptions): Promise<SentimentResult>;
    detectLanguage(text: string, options?: LanguageDetectionOptions): Promise<LanguageDetectionResult[]>;
    checkHealth(): Promise<{
        isHealthy: boolean;
        details?: any;
        dependencies?: Array<{
            name: string;
            isHealthy: boolean;
            details?: any;
        }>;
    }>;
    shutdown(): Promise<void>;
}
//# sourceMappingURL=HybridUtilityAI.d.ts.map