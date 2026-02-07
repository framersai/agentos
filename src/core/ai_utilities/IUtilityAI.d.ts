/**
 * @fileoverview Defines the comprehensive interface for a Utility AI service in AgentOS.
 * This service provides a wide array of common AI-driven and statistical NLP utility functions
 * such as text summarization, classification, keyword extraction, sentiment analysis,
 * language detection, text normalization, JSON parsing, similarity calculation, n-gram generation,
 * and readability assessment. The interface allows for diverse underlying implementations
 * (e.g., LLM-based, statistical NLP libraries, or other machine learning models).
 * @module backend/agentos/core/ai_utilities/IUtilityAI
 */
import { JSONSchemaObject } from '../tools/ITool';
/**
 * Base configuration for any IUtilityAI implementation.
 */
export interface UtilityAIConfigBase {
    /** Unique identifier for this specific utility AI service instance. */
    utilityId?: string;
    /** Default language for processing if not specified in method options (e.g., 'en', 'es'). BCP-47 format preferred. */
    defaultLanguage?: string;
    /** Path to a directory containing resource files (e.g., stop word lists, lexicons, trained models for statistical utilities). */
    resourcePath?: string;
}
/** Options for text summarization. */
export interface SummarizationOptions {
    desiredLength?: 'short' | 'medium' | 'long' | number;
    method?: 'extractive_sentence_rank' | 'first_n_sentences' | 'abstractive_llm' | 'key_points_llm' | string;
    modelId?: string;
    providerId?: string;
    methodOptions?: Record<string, any>;
    maxInputLength?: number;
    language?: string;
}
/** Options for text classification. */
export interface ClassificationOptions {
    candidateClasses: string[];
    multiLabel?: boolean;
    method?: 'naive_bayes' | 'llm_zeroshot' | 'keyword_matching' | string;
    modelId?: string;
    providerId?: string;
    methodOptions?: Record<string, any>;
    language?: string;
}
export interface ClassificationScore {
    classLabel: string;
    score: number;
}
export interface ClassificationResult {
    bestClass: string | string[];
    confidence: number | number[];
    allScores: ClassificationScore[];
}
export interface KeywordExtractionOptions {
    maxKeywords?: number;
    method?: 'tf_idf' | 'rake' | 'frequency_based' | 'llm' | string;
    modelId?: string;
    providerId?: string;
    methodOptions?: Record<string, any>;
    language?: string;
}
export interface TokenizationOptions {
    type?: 'word' | 'sentence' | 'subword_bpe';
    toLowerCase?: boolean;
    removePunctuation?: boolean;
    language?: string;
    modelId?: string;
}
export interface StemmingOptions {
    algorithm?: 'porter' | 'lancaster' | string;
    language?: string;
}
export interface SimilarityOptions {
    method?: 'cosine_tfidf' | 'cosine_embedding' | 'jaccard' | 'levenshtein' | 'llm_semantic' | string;
    stem?: boolean;
    removeStopWords?: boolean;
    language?: string;
    embeddingModelId?: string;
    embeddingProviderId?: string;
    llmModelId?: string;
    llmProviderId?: string;
    corpusForIDF?: string[];
}
export interface SentimentAnalysisOptions {
    method?: 'lexicon_based' | 'llm' | 'trained_classifier' | string;
    modelId?: string;
    providerId?: string;
    lexiconNameOrPath?: string;
    language?: string;
    methodOptions?: Record<string, any>;
}
export interface SentimentResult {
    score: number;
    polarity: 'positive' | 'negative' | 'neutral';
    comparative?: number;
    intensity?: number;
    positiveTokens?: Array<{
        token: string;
        score?: number;
    }>;
    negativeTokens?: Array<{
        token: string;
        score?: number;
    }>;
    neutralTokens?: Array<{
        token: string;
        score?: number;
    }>;
}
export interface LanguageDetectionOptions {
    maxCandidates?: number;
    method?: 'n_gram' | 'llm' | 'heuristic' | string;
    modelId?: string;
    providerId?: string;
    methodOptions?: Record<string, any>;
}
export interface LanguageDetectionResult {
    language: string;
    confidence: number;
}
export interface TextNormalizationOptions {
    toLowerCase?: boolean;
    removePunctuation?: boolean;
    removeStopWords?: boolean;
    stem?: boolean;
    stemAlgorithm?: StemmingOptions['algorithm'];
    expandContractions?: boolean;
    replaceNumbersWith?: string | null;
    stripHtml?: boolean;
    language?: string;
}
export interface NGramOptions {
    n: number | number[];
    includePartial?: boolean;
}
export interface ReadabilityOptions {
    formula: 'flesch_kincaid_reading_ease' | 'flesch_kincaid_grade_level' | 'gunning_fog' | 'smog_index' | 'coleman_liau_index' | 'automated_readability_index' | string;
}
export interface ReadabilityResult {
    score: number;
    interpretation?: string;
    gradeLevel?: string;
}
/** Options for safe JSON parsing. */
export interface ParseJsonOptions<_T = any> {
    /** If true, attempts to use an LLM to fix or extract JSON if standard parsing fails. */
    attemptFixWithLLM?: boolean;
    /** Model ID to use for LLM-based fixing. */
    llmModelIdForFix?: string;
    /** Provider ID for the LLM fixer. */
    llmProviderIdForFix?: string;
    /**
     * Optional JSON schema to validate the parsed object against.
     * If validation fails, the method may return null or attempt to fix again.
     */
    targetSchema?: JSONSchemaObject;
    /** Max repair attempts with LLM if schema validation fails. */
    maxRepairAttempts?: number;
}
/**
 * @interface IUtilityAI
 * Defines the contract for a comprehensive Utility AI service.
 */
export interface IUtilityAI {
    readonly utilityId: string;
    initialize(config: UtilityAIConfigBase & Record<string, any>): Promise<void>;
    summarize(textToSummarize: string, options?: SummarizationOptions): Promise<string>;
    classifyText(textToClassify: string, options: ClassificationOptions): Promise<ClassificationResult>;
    extractKeywords(textToAnalyze: string, options?: KeywordExtractionOptions): Promise<string[]>;
    tokenize(text: string, options?: TokenizationOptions): Promise<string[]>;
    stemTokens(tokens: string[], options?: StemmingOptions): Promise<string[]>;
    calculateSimilarity(text1: string, text2: string, options?: SimilarityOptions): Promise<number>;
    analyzeSentiment(text: string, options?: SentimentAnalysisOptions): Promise<SentimentResult>;
    detectLanguage(text: string, options?: LanguageDetectionOptions): Promise<LanguageDetectionResult[]>;
    normalizeText(text: string, options?: TextNormalizationOptions): Promise<string>;
    generateNGrams(tokens: string[], options: NGramOptions): Promise<Record<number, string[][]>>;
    calculateReadability(text: string, options: ReadabilityOptions): Promise<ReadabilityResult>;
    /**
     * Safely parses a string that is expected to be JSON, potentially using an LLM to fix common issues.
     * @template T - The expected type of the parsed JSON object.
     * @param {string} jsonString - The string to parse.
     * @param {ParseJsonOptions<T>} [options] - Options for parsing and fixing.
     * @returns {Promise<T | null>} The parsed object, or null if parsing and fixing fail.
     */
    parseJsonSafe<T = any>(jsonString: string, options?: ParseJsonOptions<T>): Promise<T | null>;
    checkHealth(): Promise<{
        isHealthy: boolean;
        details?: any;
        dependencies?: Array<{
            name: string;
            isHealthy: boolean;
            details?: any;
        }>;
    }>;
    shutdown?(): Promise<void>;
    trainModel?(trainingData: Array<{
        text: string;
        label: string;
    } | any>, modelType: string, // e.g., 'text_classifier_naive_bayes', 'sentiment_analyzer_vader_custom'
    trainingOptions?: Record<string, any>): Promise<{
        success: boolean;
        message?: string;
        modelId?: string;
    }>;
    saveTrainedModel?(modelTypeOrId: string, pathOrStoreId?: string): Promise<{
        success: boolean;
        pathOrStoreId?: string;
        message?: string;
    }>;
    loadTrainedModel?(modelTypeOrId: string, pathOrStoreId?: string): Promise<{
        success: boolean;
        message?: string;
    }>;
}
//# sourceMappingURL=IUtilityAI.d.ts.map