/**
 * @fileoverview HyDE (Hypothetical Document Embedding) retriever.
 *
 * Instead of embedding the raw user query for retrieval, HyDE first generates
 * a hypothetical answer using an LLM, then embeds THAT answer to search the
 * vector store. The hypothesis is semantically closer to stored answers than
 * the raw question, improving retrieval quality.
 *
 * Supports adaptive thresholding: starts at a high similarity threshold and
 * steps down until content is found, ensuring full coverage.
 *
 * Based on: Gao et al. 2023 "Precise Zero-Shot Dense Retrieval without
 * Relevance Labels" and Lei et al. 2025 "Never Come Up Empty: Adaptive HyDE
 * Retrieval for Improving LLM Developer Support".
 *
 * @module agentos/rag/HydeRetriever
 */

import type { IEmbeddingManager } from './IEmbeddingManager.js';
import type { IVectorStore, QueryOptions, QueryResult } from './IVectorStore.js';

// ── Configuration ──────────────────────────────────────────────────────────

export interface HydeConfig {
  /** Enable HyDE retrieval. Default: false. */
  enabled?: boolean;
  /** Initial similarity threshold. Default: 0.7. */
  initialThreshold?: number;
  /** Minimum threshold to step down to. Default: 0.3. */
  minThreshold?: number;
  /** Step size for adaptive thresholding. Default: 0.1. */
  thresholdStep?: number;
  /** Use adaptive thresholding (step down when no results). Default: true. */
  adaptiveThreshold?: boolean;
  /** Max tokens for hypothesis generation. Default: 200. */
  maxHypothesisTokens?: number;
  /** Custom system prompt for hypothesis generation. */
  hypothesisSystemPrompt?: string;
  /** Use full-answer granularity (recommended by research). Default: true. */
  fullAnswerGranularity?: boolean;
}

export const DEFAULT_HYDE_CONFIG: Required<HydeConfig> = {
  enabled: false,
  initialThreshold: 0.7,
  minThreshold: 0.3,
  thresholdStep: 0.1,
  adaptiveThreshold: true,
  maxHypothesisTokens: 200,
  hypothesisSystemPrompt:
    'You are a knowledgeable assistant. Generate a concise, factual answer to the following question. ' +
    'This answer will be used for semantic search, so be specific and include relevant technical terms.',
  fullAnswerGranularity: true,
};

function clampUnitInterval(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(1, Math.max(0, value));
}

/** Merge partial config with defaults. */
export function resolveHydeConfig(partial?: Partial<HydeConfig>): Required<HydeConfig> {
  const merged = { ...DEFAULT_HYDE_CONFIG, ...partial };
  const initialThreshold = clampUnitInterval(
    merged.initialThreshold,
    DEFAULT_HYDE_CONFIG.initialThreshold,
  );
  const minThreshold = Math.min(
    initialThreshold,
    clampUnitInterval(merged.minThreshold, DEFAULT_HYDE_CONFIG.minThreshold),
  );
  const thresholdStep =
    typeof merged.thresholdStep === 'number' && Number.isFinite(merged.thresholdStep) && merged.thresholdStep > 0
      ? merged.thresholdStep
      : DEFAULT_HYDE_CONFIG.thresholdStep;
  const maxHypothesisTokens =
    typeof merged.maxHypothesisTokens === 'number' && Number.isFinite(merged.maxHypothesisTokens) && merged.maxHypothesisTokens > 0
      ? Math.floor(merged.maxHypothesisTokens)
      : DEFAULT_HYDE_CONFIG.maxHypothesisTokens;

  return {
    ...merged,
    initialThreshold,
    minThreshold,
    thresholdStep,
    maxHypothesisTokens,
  };
}

// ── LLM Caller ─────────────────────────────────────────────────────────────

/** Minimal interface for the LLM call needed by HyDE. */
export type HydeLlmCaller = (
  systemPrompt: string,
  userPrompt: string,
) => Promise<string>;

// ── Result ─────────────────────────────────────────────────────────────────

export interface HydeRetrievalResult {
  /** The generated hypothesis used for embedding. */
  hypothesis: string;
  /** The embedding of the hypothesis. */
  hypothesisEmbedding: number[];
  /** Vector store query result. */
  queryResult: QueryResult;
  /** Final similarity threshold that produced results. */
  effectiveThreshold: number;
  /** Number of threshold steps taken (0 = first try worked). */
  thresholdSteps: number;
  /** Time taken for hypothesis generation (ms). */
  hypothesisLatencyMs: number;
  /** Time taken for embedding + retrieval (ms). */
  retrievalLatencyMs: number;
}

// ── Core Retriever ─────────────────────────────────────────────────────────

/**
 * HyDE retriever: generates a hypothetical answer, embeds it, and searches
 * the vector store with adaptive thresholding.
 */
export class HydeRetriever {
  private config: Required<HydeConfig>;
  private llmCaller: HydeLlmCaller;
  private embeddingManager: IEmbeddingManager;

  constructor(opts: {
    config?: Partial<HydeConfig>;
    llmCaller: HydeLlmCaller;
    embeddingManager: IEmbeddingManager;
  }) {
    this.config = resolveHydeConfig(opts.config);
    this.llmCaller = opts.llmCaller;
    this.embeddingManager = opts.embeddingManager;
  }

  /** Whether HyDE is enabled. */
  get enabled(): boolean {
    return this.config.enabled;
  }

  private buildHypothesisSystemPrompt(): string {
    const instructions: string[] = [this.config.hypothesisSystemPrompt];
    if (this.config.fullAnswerGranularity) {
      instructions.push(
        'Return a concise but complete hypothetical answer in natural language prose, not just keywords or bullet fragments.',
      );
    } else {
      instructions.push('Return only the shortest hypothetical answer needed for semantic retrieval.');
    }
    instructions.push(`Keep the answer under ${this.config.maxHypothesisTokens} tokens.`);
    return instructions.join(' ');
  }

  /**
   * Generate a hypothetical answer for a query.
   */
  async generateHypothesis(query: string): Promise<{ hypothesis: string; latencyMs: number }> {
    const start = Date.now();
    const hypothesis = await this.llmCaller(
      this.buildHypothesisSystemPrompt(),
      query,
    );
    return {
      hypothesis: hypothesis.trim(),
      latencyMs: Date.now() - start,
    };
  }

  /**
   * Embed the hypothesis and search the vector store.
   * Uses adaptive thresholding: starts at initialThreshold, steps down
   * until results are found or minThreshold is reached.
   */
  async retrieve(opts: {
    query: string;
    vectorStore: IVectorStore;
    collectionName: string;
    queryOptions?: Partial<QueryOptions>;
    /** Pre-generated hypothesis (skip generation if provided). */
    hypothesis?: string;
  }): Promise<HydeRetrievalResult> {
    // Step 1: Generate hypothesis
    let hypothesis: string;
    let hypothesisLatencyMs: number;

    if (opts.hypothesis) {
      hypothesis = opts.hypothesis;
      hypothesisLatencyMs = 0;
    } else {
      const result = await this.generateHypothesis(opts.query);
      hypothesis = result.hypothesis;
      hypothesisLatencyMs = result.latencyMs;
    }

    // Step 2: Embed the hypothesis
    const retrievalStart = Date.now();
    const embeddingResponse = await this.embeddingManager.generateEmbeddings({
      texts: [hypothesis],
    });

    if (!embeddingResponse.embeddings?.[0]?.length) {
      // Embedding failed — return empty result
      return {
        hypothesis,
        hypothesisEmbedding: [],
        queryResult: { documents: [] },
        effectiveThreshold: this.config.initialThreshold,
        thresholdSteps: 0,
        hypothesisLatencyMs,
        retrievalLatencyMs: Date.now() - retrievalStart,
      };
    }

    const hypothesisEmbedding = embeddingResponse.embeddings[0];

    // Step 3: Adaptive threshold search
    let threshold = this.config.initialThreshold;
    let steps = 0;
    let queryResult: QueryResult = { documents: [] };

    while (threshold >= this.config.minThreshold) {
      const {
        minSimilarityScore: _ignoredMinSimilarityScore,
        ...extraQueryOptions
      } = opts.queryOptions ?? {};
      const queryOpts: QueryOptions = {
        topK: extraQueryOptions.topK ?? 5,
        minSimilarityScore: threshold,
        includeTextContent: true,
        includeMetadata: true,
        ...extraQueryOptions,
      };

      queryResult = await opts.vectorStore.query(
        opts.collectionName,
        hypothesisEmbedding,
        queryOpts,
      );

      if (queryResult.documents.length > 0 || !this.config.adaptiveThreshold) {
        break;
      }

      // Step down threshold
      const nextThreshold = Math.round((threshold - this.config.thresholdStep) * 100) / 100;
      if (nextThreshold < this.config.minThreshold) {
        break;
      }
      threshold = nextThreshold;
      steps++;
    }

    return {
      hypothesis,
      hypothesisEmbedding,
      queryResult,
      effectiveThreshold: Math.max(threshold, this.config.minThreshold),
      thresholdSteps: steps,
      hypothesisLatencyMs,
      retrievalLatencyMs: Date.now() - retrievalStart,
    };
  }

  /**
   * Convenience: retrieve and format as augmented context string.
   */
  async retrieveContext(opts: {
    query: string;
    vectorStore: IVectorStore;
    collectionName: string;
    queryOptions?: Partial<QueryOptions>;
    separator?: string;
  }): Promise<{
    context: string;
    hypothesis: string;
    effectiveThreshold: number;
    chunkCount: number;
    latencyMs: number;
  }> {
    const result = await this.retrieve(opts);

    const separator = opts.separator ?? '\n\n---\n\n';
    const chunks = result.queryResult.documents
      .map((doc) => doc.textContent || '')
      .filter(Boolean);

    return {
      context: chunks.join(separator),
      hypothesis: result.hypothesis,
      effectiveThreshold: result.effectiveThreshold,
      chunkCount: chunks.length,
      latencyMs: result.hypothesisLatencyMs + result.retrievalLatencyMs,
    };
  }
}
