/**
 * @fileoverview Hybrid IUtilityAI that delegates to LLM-based or statistical
 * implementations depending on the task. LLM methods are preferred for
 * summarization, classification, and keyword extraction; statistical methods
 * for tokenization, stemming, n-grams, readability, and similarity.
 *
 * Falls back gracefully: if one backend is unavailable, the other is tried.
 */

import type {
  IUtilityAI,
  UtilityAIConfigBase,
  ParseJsonOptions,
  SummarizationOptions,
  ClassificationOptions,
  ClassificationResult,
  KeywordExtractionOptions,
  TokenizationOptions,
  StemmingOptions,
  SimilarityOptions,
  SentimentAnalysisOptions,
  SentimentResult,
  LanguageDetectionOptions,
  LanguageDetectionResult,
  TextNormalizationOptions,
  NGramOptions,
  ReadabilityOptions,
  ReadabilityResult,
} from './IUtilityAI';

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
export class HybridUtilityAI implements IUtilityAI {
  public readonly utilityId: string;
  private readonly llm: IUtilityAI | undefined;
  private readonly stat: IUtilityAI | undefined;

  constructor(config: HybridUtilityAIConfig) {
    this.llm = config.llm;
    this.stat = config.statistical;
    if (!this.llm && !this.stat) {
      throw new Error('HybridUtilityAI requires at least one backend (llm or statistical)');
    }
    this.utilityId = config.utilityId ?? `hybrid-${this.llm?.utilityId ?? 'none'}-${this.stat?.utilityId ?? 'none'}`;
  }

  async initialize(config: UtilityAIConfigBase & Record<string, any>): Promise<void> {
    await Promise.all([
      this.llm?.initialize?.(config),
      this.stat?.initialize?.(config),
    ]);
  }

  private preferLLM(): IUtilityAI {
    return this.llm ?? this.stat!;
  }

  private preferStat(): IUtilityAI {
    return this.stat ?? this.llm!;
  }

  // --- LLM-preferred methods ---

  async summarize(textToSummarize: string, options?: SummarizationOptions): Promise<string> {
    return this.preferLLM().summarize(textToSummarize, options);
  }

  async classifyText(textToClassify: string, options: ClassificationOptions): Promise<ClassificationResult> {
    return this.preferLLM().classifyText(textToClassify, options);
  }

  async extractKeywords(textToAnalyze: string, options?: KeywordExtractionOptions): Promise<string[]> {
    return this.preferLLM().extractKeywords(textToAnalyze, options);
  }

  async parseJsonSafe<T = any>(jsonString: string, options?: ParseJsonOptions<T>): Promise<T | null> {
    // Try statistical (fast parsing) first, fall back to LLM (repair)
    try {
      const result = await this.preferStat().parseJsonSafe<T>(jsonString, options);
      if (result !== null) return result;
    } catch { /* fall through */ }
    if (this.llm && this.stat) {
      return this.llm.parseJsonSafe<T>(jsonString, options);
    }
    return null;
  }

  // --- Statistical-preferred methods ---

  async tokenize(text: string, options?: TokenizationOptions): Promise<string[]> {
    return this.preferStat().tokenize(text, options);
  }

  async stemTokens(tokens: string[], options?: StemmingOptions): Promise<string[]> {
    return this.preferStat().stemTokens(tokens, options);
  }

  async normalizeText(text: string, options?: TextNormalizationOptions): Promise<string> {
    return this.preferStat().normalizeText(text, options);
  }

  async generateNGrams(tokens: string[], options: NGramOptions): Promise<Record<number, string[][]>> {
    return this.preferStat().generateNGrams(tokens, options);
  }

  async calculateReadability(text: string, options: ReadabilityOptions): Promise<ReadabilityResult> {
    return this.preferStat().calculateReadability(text, options);
  }

  async calculateSimilarity(text1: string, text2: string, options?: SimilarityOptions): Promise<number> {
    return this.preferStat().calculateSimilarity(text1, text2, options);
  }

  // --- Either with preference ---

  async analyzeSentiment(text: string, options?: SentimentAnalysisOptions): Promise<SentimentResult> {
    return this.preferStat().analyzeSentiment(text, options);
  }

  async detectLanguage(text: string, options?: LanguageDetectionOptions): Promise<LanguageDetectionResult[]> {
    return this.preferStat().detectLanguage(text, options);
  }

  // --- Health & lifecycle ---

  async checkHealth(): Promise<{ isHealthy: boolean; details?: any; dependencies?: Array<{ name: string; isHealthy: boolean; details?: any }> }> {
    const deps: Array<{ name: string; isHealthy: boolean; details?: any }> = [];
    if (this.llm) {
      try {
        const h = await this.llm.checkHealth();
        deps.push({ name: `llm:${this.llm.utilityId}`, ...h });
      } catch (e) {
        deps.push({ name: `llm:${this.llm.utilityId}`, isHealthy: false, details: (e as Error).message });
      }
    }
    if (this.stat) {
      try {
        const h = await this.stat.checkHealth();
        deps.push({ name: `stat:${this.stat.utilityId}`, ...h });
      } catch (e) {
        deps.push({ name: `stat:${this.stat.utilityId}`, isHealthy: false, details: (e as Error).message });
      }
    }
    return {
      isHealthy: deps.every((d) => d.isHealthy),
      dependencies: deps,
    };
  }

  async shutdown(): Promise<void> {
    await Promise.all([
      this.llm?.shutdown?.(),
      this.stat?.shutdown?.(),
    ]);
  }
}
