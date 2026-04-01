/**
 * @file interfaces.ts
 * @description Core multilingual service contracts for AgentOS.
 * Defines provider-agnostic interfaces for language detection, translation,
 * and the high-level language orchestration service used throughout the runtime.
 *
 * The goal is to allow hosts to plug in any combination of third-party APIs
 * (e.g., OpenAI, DeepL, Azure Translator, Google Cloud Translation, custom ML models)
 * while retaining consistent negotiation, auditing, and fallback behavior.
 */
/**
 * Represents a single language confidence result.
 * Code SHOULD be a BCP-47 or ISO 639-1 code (e.g. "en", "en-US", "es", "fr-FR").
 */
export interface DetectedLanguageResult {
    /** Detected language code (BCP-47 preferred; may degrade to ISO 639-1). */
    code: string;
    /** Confidence score in range [0,1]. */
    confidence: number;
    /** Optional provider-specific metadata (raw probabilities, tokens, etc.). */
    providerMetadata?: Record<string, unknown>;
}
/**
 * Configuration descriptor for a language detection provider.
 */
export interface ILanguageDetectionProviderConfig {
    /** Unique ID referenced in AgentOSConfig.languageConfig.detectionProviders. */
    id: string;
    /** Optional initialization parameters (API keys, model hints, etc.). */
    params?: Record<string, unknown>;
    /** Relative priority (lower executes earlier). */
    priority?: number;
    /** Minimum confidence threshold before a result is considered. */
    minConfidence?: number;
}
/**
 * Pluggable detection provider interface.
 * Providers SHOULD return an ordered list with the highest confidence first.
 */
export interface ILanguageDetectionProvider {
    readonly id: string;
    readonly isInitialized: boolean;
    /** Perform any async setup (API key validation, model warm-up). */
    initialize(): Promise<void>;
    /** Detect language from plain text. */
    detect(text: string): Promise<DetectedLanguageResult[]>;
    /** Optional audio-based detection (e.g., short clip classification). */
    detectFromAudio?(audio: Buffer): Promise<DetectedLanguageResult[]>;
    /** Dispose resources (close handles, free model memory). */
    shutdown?(): Promise<void>;
}
/**
 * Configuration descriptor for a translation provider.
 */
export interface ITranslationProviderConfig {
    id: string;
    params?: Record<string, unknown>;
    /** Cost tier hint for routing ("low", "medium", "high"). */
    costTier?: 'low' | 'medium' | 'high';
    /** Relative priority for fallback ordering. */
    priority?: number;
    /** Maximum characters per request (provider constraint). */
    maxCharsPerRequest?: number;
    /** Supported language codes subset; undefined means provider attempts all. */
    supportedLanguages?: string[];
}
/** Domain categories inform provider-specific prompt tuning or glossary application. */
export type TranslationDomain = 'general' | 'technical' | 'code' | 'prompt' | 'rag' | 'ui';
/** Options for translation calls. */
export interface TranslationOptions {
    domain?: TranslationDomain;
    /** Preserve markdown/code fencing. */
    preserveFormatting?: boolean;
    /** If streaming incremental translation is desired (phase 2). */
    streamingCallback?: (delta: string) => void;
    /** Abort controller for cancellation semantics. */
    abortSignal?: AbortSignal;
}
/** Result of a translation operation. */
export interface TranslationResult {
    output: string;
    providerId: string;
    sourceLanguage: string;
    targetLanguage: string;
    /** Raw provider timing or token usage. */
    providerMetadata?: Record<string, unknown>;
}
/** Pluggable translation provider interface. */
export interface ITranslationProvider {
    readonly id: string;
    readonly isInitialized: boolean;
    initialize(): Promise<void>;
    translate(input: string, source: string, target: string, options?: TranslationOptions): Promise<TranslationResult>;
    shutdown?(): Promise<void>;
}
/** Negotiation input parameters for the LanguageService. */
export interface LanguageNegotiationParams {
    explicitUserLanguage?: string;
    detectedLanguages?: DetectedLanguageResult[];
    conversationPreferred?: string;
    personaDefault?: string;
    configDefault: string;
    supported: string[];
    fallbackChain: string[];
    preferSourceLanguageResponses?: boolean;
    /** Optional pre-specified target language override. */
    targetLanguage?: string;
}
/** Output of negotiation step. */
export interface LanguageNegotiationResult {
    sourceLanguage: string;
    targetLanguage: string;
    pivotLanguage?: string;
    confidence: number;
    negotiationPath: string[];
    warnings?: string[];
}
/**
 * High-level language orchestration service used by AgentOS runtime.
 */
export interface ILanguageService {
    /** Initialize providers and internal caches. */
    initialize(): Promise<void>;
    /** Perform language detection across configured providers & merge results. */
    detectLanguages(text: string): Promise<DetectedLanguageResult[]>;
    /** Determine target/pivot languages given negotiation inputs. */
    negotiate(params: LanguageNegotiationParams): LanguageNegotiationResult;
    /** Optional normalization before prompt construction (pivot). */
    maybeNormalizeForPivot(content: string, source: string, pivot?: string): Promise<{
        normalized: string;
        providerId?: string;
    } | null>;
    /** Translate post-generation to user display target (if differs). */
    maybeTranslateForDisplay(content: string, source: string, target: string): Promise<TranslationResult | null>;
    /** Translate query for RAG pivot search. */
    translateQueryForRag(query: string, source: string, pivot: string): Promise<TranslationResult | null>;
    /** Translate retrieved RAG results back to target language. */
    translateRagResults(results: Array<{
        content: string;
        language: string;
    }>, target: string): Promise<Array<{
        content: string;
        sourceLanguage: string;
        translated?: string;
    }>>;
    /** Wrap tool input translation logic. */
    translateToolArguments(args: Record<string, any>, source: string, toolLanguage: string): Promise<{
        translatedArgs: Record<string, any>;
        providerId?: string;
    } | null>;
    /** Wrap tool result translation logic. */
    translateToolResult(result: any, source: string, target: string): Promise<{
        translatedResult: any;
        providerId?: string;
    } | null>;
    /** Graceful shutdown for providers. */
    shutdown(): Promise<void>;
}
/** Utility to determine if a code block should be excluded from translation. */
export declare function isLikelyCodeBlock(snippet: string): boolean;
/** Simple heuristic partition for mixed content translation strategies. */
export declare function partitionCodeAndProse(content: string): {
    codeBlocks: string[];
    prose: string;
};
/** Recombine partitioned content after translating prose only. */
export declare function recombineCodeAndProse(translatedProse: string, codeBlocks: string[]): string;
//# sourceMappingURL=interfaces.d.ts.map