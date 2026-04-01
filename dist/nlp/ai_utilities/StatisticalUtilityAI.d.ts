/**
 * @fileoverview Implementation of IUtilityAI using statistical and
 * conventional NLP methods, primarily leveraging the 'natural' library.
 * This utility is suited for tasks where deterministic, fast, and often offline
 * processing is preferred over LLM-based approaches.
 *
 * @module backend/agentos/nlp/ai_utilities/StatisticalUtilityAI
 * @see ./IUtilityAI.ts
 * @see 'natural' library documentation
 */
import { IUtilityAI, UtilityAIConfigBase, ParseJsonOptions, SummarizationOptions, ClassificationOptions, ClassificationResult, KeywordExtractionOptions, TokenizationOptions, StemmingOptions, SimilarityOptions, SentimentAnalysisOptions, SentimentResult, LanguageDetectionOptions, LanguageDetectionResult, TextNormalizationOptions, NGramOptions, ReadabilityOptions, ReadabilityResult } from './IUtilityAI';
export interface StatisticalUtilityAIConfig extends UtilityAIConfigBase {
    resourcePath?: string;
    defaultStopWordsLanguage?: string;
    customStopWordsPaths?: Record<string, string>;
    summarizerConfig?: {
        lexRank?: {
            similarityThreshold?: number;
            dampingFactor?: number;
            maxIterations?: number;
            epsilon?: number;
        };
    };
    classifierConfig?: {
        naiveBayes?: {
            modelStoragePath?: string;
            defaultModelId?: string;
            defaultAlpha?: number;
        };
    };
    sentimentConfig?: {
        lexiconPath?: string;
        defaultLexiconLanguage?: string;
    };
    languageDetectionConfig?: {
        nGramProfilePath?: string;
    };
    readabilitySyllableAlgorithm?: 'regex_approx' | 'dictionary_lookup';
}
export declare class StatisticalUtilityAI implements IUtilityAI {
    readonly utilityId: string;
    private config;
    private isInitialized;
    private tokenizers;
    private stemmers;
    private stopWords;
    private classifiers;
    private sentimentAnalyzers;
    private createStemmerRegistry;
    constructor(utilityId?: string);
    initialize(config: StatisticalUtilityAIConfig): Promise<void>;
    private ensureInitialized;
    private getStopWords;
    private getStemmer;
    private getSentimentAnalyzer;
    private loadSentimentLexiconFromFile;
    summarize(textToSummarize: string, options?: SummarizationOptions): Promise<string>;
    classifyText(textToClassify: string, options: ClassificationOptions): Promise<ClassificationResult>;
    extractKeywords(textToAnalyze: string, options?: KeywordExtractionOptions): Promise<string[]>;
    tokenize(text: string, options?: TokenizationOptions): Promise<string[]>;
    stemTokens(tokens: string[], options?: StemmingOptions): Promise<string[]>;
    calculateSimilarity(text1: string, text2: string, options?: SimilarityOptions): Promise<number>;
    analyzeSentiment(text: string, options?: SentimentAnalysisOptions): Promise<SentimentResult>;
    detectLanguage(_text: string, _options?: LanguageDetectionOptions): Promise<LanguageDetectionResult[]>;
    normalizeText(text: string, options?: TextNormalizationOptions): Promise<string>;
    generateNGrams(tokens: string[], options: NGramOptions): Promise<Record<number, string[][]>>;
    calculateReadability(text: string, options: ReadabilityOptions): Promise<ReadabilityResult>;
    checkHealth(): Promise<{
        isHealthy: boolean;
        details?: any;
        dependencies?: Array<{
            name: string;
            isHealthy: boolean;
            details?: any;
        }>;
    }>;
    trainModel(trainingData: Array<{
        text: string;
        label: string;
    }>, modelType: string, // e.g., "text_classifier_naive_bayes"
    trainingOptions?: {
        modelId?: string;
        stemmer?: 'porter' | 'lancaster';
        alpha?: number;
    }): Promise<{
        success: boolean;
        message?: string;
        modelId?: string;
    }>;
    saveTrainedModel(modelId: string, modelType?: string, storagePath?: string): Promise<{
        success: boolean;
        pathOrStoreId?: string;
        message?: string;
    }>;
    loadTrainedModel(modelId: string, modelType?: string, storagePath?: string): Promise<{
        success: boolean;
        message?: string;
    }>;
    private computeCosineSimilarity;
    parseJsonSafe<T = any>(jsonString: string, options?: ParseJsonOptions<T>): Promise<T | null>;
    shutdown(): Promise<void>;
}
//# sourceMappingURL=StatisticalUtilityAI.d.ts.map