/**
 * @fileoverview An IUtilityAI implementation that primarily uses Large Language Models (LLMs)
 * via an AIModelProviderManager to perform its tasks. For tasks not suited to LLMs,
 * it may provide basic fallbacks or indicate non-support.
 *
 * @module backend/agentos/nlp/ai_utilities/LLMUtilityAI
 * @see ./IUtilityAI.ts
 * @see ../../core/llm/providers/AIModelProviderManager.ts
 */
import { IUtilityAI, UtilityAIConfigBase, ParseJsonOptions, SummarizationOptions, ClassificationOptions, ClassificationResult, KeywordExtractionOptions, TokenizationOptions, StemmingOptions, SimilarityOptions, SentimentAnalysisOptions, SentimentResult, LanguageDetectionOptions, LanguageDetectionResult, TextNormalizationOptions, NGramOptions, ReadabilityOptions, ReadabilityResult } from './IUtilityAI';
import { AIModelProviderManager } from '../../core/llm/providers/AIModelProviderManager';
import { IPromptEngineUtilityAI, ModelTargetInfo } from '../../core/llm/IPromptEngine';
import { ConversationMessage as Message } from '../../core/conversation/ConversationMessage';
export interface LLMUtilityAIConfig extends UtilityAIConfigBase {
    llmProviderManager: AIModelProviderManager;
    defaultModelId?: string;
    defaultProviderId?: string;
    summarizationModelId?: string;
    classificationModelId?: string;
    keywordModelId?: string;
    sentimentModelId?: string;
    languageDetectionModelId?: string;
    jsonFixerModelId?: string;
    semanticSimilarityModelId?: string;
    textNormalizationModelId?: string;
    readabilityEstimationModelId?: string;
}
export declare class LLMUtilityAI implements IUtilityAI, IPromptEngineUtilityAI {
    readonly utilityId: string;
    private config;
    private llmProviderManager;
    private isInitialized;
    private ajv;
    constructor(utilityId?: string);
    initialize(config: LLMUtilityAIConfig): Promise<void>;
    private ensureInitialized;
    private getModelAndProvider;
    private makeLLMCall;
    summarize(textToSummarize: string, options?: SummarizationOptions): Promise<string>;
    parseJsonSafe<T = any>(jsonString: string, options?: ParseJsonOptions<T>): Promise<T | null>;
    classifyText(textToClassify: string, options: ClassificationOptions): Promise<ClassificationResult>;
    extractKeywords(textToAnalyze: string, options?: KeywordExtractionOptions): Promise<string[]>;
    analyzeSentiment(text: string, options?: SentimentAnalysisOptions): Promise<SentimentResult>;
    detectLanguage(text: string, options?: LanguageDetectionOptions): Promise<LanguageDetectionResult[]>;
    tokenize(text: string, options?: TokenizationOptions): Promise<string[]>;
    stemTokens(tokens: string[], _options?: StemmingOptions): Promise<string[]>;
    calculateSimilarity(text1: string, text2: string, options?: SimilarityOptions): Promise<number>;
    normalizeText(text: string, options?: TextNormalizationOptions): Promise<string>;
    generateNGrams(tokens: string[], options: NGramOptions): Promise<Record<number, string[][]>>;
    calculateReadability(text: string, options: ReadabilityOptions): Promise<ReadabilityResult>;
    private formatConversationHistory;
    private formatRagContext;
    summarizeConversationHistory(messages: ReadonlyArray<Message>, targetTokenCount: number, modelInfo: Readonly<ModelTargetInfo>, preserveImportantMessages?: boolean): Promise<{
        summaryMessages: Message[];
        originalTokenCount: number;
        finalTokenCount: number;
        messagesSummarized: number;
    }>;
    summarizeRAGContext(context: string | ReadonlyArray<{
        source: string;
        content: string;
        relevance?: number;
    }>, targetTokenCount: number, modelInfo: Readonly<ModelTargetInfo>, preserveSourceAttribution?: boolean): Promise<{
        summary: string;
        originalTokenCount: number;
        finalTokenCount: number;
        preservedSources?: string[];
    }>;
    checkHealth(): Promise<{
        isHealthy: boolean;
        details?: any;
        dependencies?: Array<{
            name: string;
            isHealthy: boolean;
            details?: any;
        }>;
    }>;
    trainModel(): Promise<{
        success: boolean;
        message?: string;
        modelId?: string;
    }>;
    saveTrainedModel(): Promise<{
        success: boolean;
        pathOrStoreId?: string;
        message?: string;
    }>;
    loadTrainedModel(): Promise<{
        success: boolean;
        message?: string;
    }>;
    shutdown(): Promise<void>;
}
//# sourceMappingURL=LLMUtilityAI.d.ts.map