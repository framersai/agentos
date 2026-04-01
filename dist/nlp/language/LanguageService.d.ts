/**
 * @file LanguageService.ts
 * @description Lightweight reference implementation of a multilingual orchestration service.
 */
import { ILanguageService, DetectedLanguageResult, LanguageNegotiationParams, LanguageNegotiationResult, TranslationResult } from './interfaces';
export interface AgentOSLanguageConfig {
    defaultLanguage: string;
    supportedLanguages: string[];
    fallbackLanguages?: string[];
    pivotLanguage?: string;
    autoDetect?: boolean;
    preferSourceLanguageResponses?: boolean;
    /** Detection provider configs (ordered by priority). */
    detectionProviderConfigs?: Array<{
        id: string;
        priority?: number;
        params?: Record<string, any>;
    }>;
    /** Translation provider configs. */
    translationProviderConfigs?: Array<{
        id: string;
        priority?: number;
        costTier?: 'low' | 'medium' | 'high';
        supportedLanguages?: string[];
        params?: Record<string, any>;
    }>;
    /** Maximum characters to attempt direct single-shot translation before chunking. */
    maxDirectCharsPerTranslation?: number;
    /** Enable partitioning of code blocks from prose during translation for better fidelity. */
    enableCodeAwareTranslation?: boolean;
    /** Optional caching of translation outputs. */
    enableCaching?: boolean;
    /** Approximate max entries in translation cache (LRU). */
    translationCacheMaxEntries?: number;
    /** If true, attempt pivot normalization (source->pivot) before generation. */
    enablePivotNormalization?: boolean;
}
export declare class LanguageService implements ILanguageService {
    private readonly config;
    private detectionProviders;
    private translationProviders;
    private initialized;
    private translationCache?;
    constructor(config: AgentOSLanguageConfig);
    initialize(): Promise<void>;
    detectLanguages(text: string): Promise<DetectedLanguageResult[]>;
    negotiate(params: LanguageNegotiationParams): LanguageNegotiationResult;
    /** Attempt pivot normalization of content (source->pivot) if pivot provided. */
    maybeNormalizeForPivot(content: string, source: string, pivot?: string): Promise<{
        normalized: string;
        providerId?: string;
    } | null>;
    maybeTranslateForDisplay(content: string, source: string, target: string): Promise<TranslationResult | null>;
    translateQueryForRag(query: string, source: string, pivot: string): Promise<TranslationResult | null>;
    translateRagResults(results: Array<{
        content: string;
        language: string;
    }>, target: string): Promise<Array<{
        content: string;
        sourceLanguage: string;
        translated?: string;
    }>>;
    translateToolArguments(args: Record<string, any>, source: string, toolLanguage: string): Promise<{
        translatedArgs: Record<string, any>;
        providerId?: string;
    } | null>;
    translateToolResult(result: any, source: string, target: string): Promise<{
        translatedResult: any;
        providerId?: string;
    } | null>;
    shutdown(): Promise<void>;
    /** Internal provider selection & execution with caching, code-block awareness. */
    private performTranslation;
    private pickTranslationProvider;
    private hashContent;
}
//# sourceMappingURL=LanguageService.d.ts.map