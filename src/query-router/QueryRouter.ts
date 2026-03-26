/**
 * @fileoverview QueryRouter — main orchestrator that wires together the
 * QueryClassifier, QueryDispatcher, and QueryGenerator into a complete
 * classify -> dispatch -> generate pipeline.
 *
 * @module @framers/agentos/query-router/QueryRouter
 *
 * The QueryRouter is the top-level entry point for the intelligent query
 * routing system. Given a user query and optional conversation history, it:
 *
 * 1. **Classifies** the query into a complexity tier (T0-T3) using the
 *    {@link QueryClassifier}.
 * 2. **Dispatches** the classified query to the tier-appropriate retrieval
 *    pipeline via the {@link QueryDispatcher}, which orchestrates vector
 *    search, graph expansion, reranking, and deep research.
 * 3. **Generates** a grounded answer with citations via the
 *    {@link QueryGenerator}, using the retrieved context chunks.
 *
 * The router also handles:
 * - Corpus loading from markdown files on disk
 * - Keyword fallback retrieval when embeddings are unavailable
 * - Event emission for full pipeline observability
 * - Lifecycle hooks (onClassification, onRetrieval) for consumer integration
 *
 * **Embedding note:** The `init()` method's embedding step is a placeholder
 * for now (Task 8 wires real embeddings). All retrieval currently goes through
 * {@link KeywordFallback}.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, extname } from 'node:path';

import { QueryClassifier } from './QueryClassifier.js';
import { QueryDispatcher } from './QueryDispatcher.js';
import { QueryGenerator } from './QueryGenerator.js';
import { TopicExtractor } from './TopicExtractor.js';
import { KeywordFallback } from './KeywordFallback.js';
import type {
  ClassificationResult,
  ConversationMessage,
  CorpusChunk,
  QueryResult,
  QueryRouterEventUnion,
  QueryTier,
  RetrievalResult,
  RetrievedChunk,
  SourceCitation,
  TopicEntry,
} from './types.js';

// ============================================================================
// Configuration
// ============================================================================

/**
 * Full configuration for the QueryRouter pipeline.
 *
 * All fields except `knowledgeCorpus` have sensible defaults. The
 * constructor merges user-supplied values over {@link QUERY_ROUTER_DEFAULTS}.
 */
export interface QueryRouterFullConfig {
  /** Directories containing .md/.mdx files to ingest as the knowledge corpus. */
  knowledgeCorpus: string[];

  /** LLM model for the classifier. @default 'gpt-4o-mini' */
  classifierModel: string;

  /** LLM provider for the classifier. @default 'openai' */
  classifierProvider: string;

  /**
   * Minimum confidence threshold for accepting a classification.
   * Below this, the tier is bumped up by 1.
   * @default 0.7
   */
  confidenceThreshold: number;

  /** Maximum tier the classifier may assign. @default 3 */
  maxTier: QueryTier;

  /** Embedding provider name. @default 'openai' */
  embeddingProvider: string;

  /** Embedding model identifier. @default 'text-embedding-3-small' */
  embeddingModel: string;

  /** LLM model for T0/T1 generation. @default 'gpt-4o-mini' */
  generationModel: string;

  /** LLM model for T2/T3 generation (deep). @default 'gpt-4o' */
  generationModelDeep: string;

  /** LLM provider for generation. @default 'openai' */
  generationProvider: string;

  /** Whether graph-based retrieval is enabled. @default true */
  graphEnabled: boolean;

  /** Whether deep research is enabled. @default Boolean(process.env.SERPER_API_KEY) */
  deepResearchEnabled: boolean;

  /** Number of recent conversation messages to include as context. @default 5 */
  conversationWindowSize: number;

  /** Maximum estimated tokens for documentation context. @default 4000 */
  maxContextTokens: number;

  /** Whether to cache query results. @default true */
  cacheResults: boolean;

  /**
   * Hook called after classification completes.
   * Receives the ClassificationResult for consumer integration.
   */
  onClassification?: (result: ClassificationResult) => void;

  /**
   * Hook called after retrieval completes.
   * Receives the RetrievalResult for consumer integration.
   */
  onRetrieval?: (result: RetrievalResult) => void;

  /** Optional API key override for LLM calls. */
  apiKey?: string;

  /** Optional base URL override for LLM providers. */
  baseUrl?: string;
}

/**
 * Default configuration values for the QueryRouter.
 * These are merged under any user-supplied config in the constructor.
 */
const QUERY_ROUTER_DEFAULTS: Omit<QueryRouterFullConfig, 'knowledgeCorpus'> = {
  classifierModel: 'gpt-4o-mini',
  classifierProvider: 'openai',
  confidenceThreshold: 0.7,
  maxTier: 3,
  embeddingProvider: 'openai',
  embeddingModel: 'text-embedding-3-small',
  generationModel: 'gpt-4o-mini',
  generationModelDeep: 'gpt-4o',
  generationProvider: 'openai',
  graphEnabled: true,
  deepResearchEnabled: Boolean(process.env.SERPER_API_KEY),
  conversationWindowSize: 5,
  maxContextTokens: 4000,
  cacheResults: true,
};

/** Regex for splitting markdown by h1-h3 headings. */
const HEADING_REGEX = /^#{1,3}\s+(.+)/;

/** Maximum character length for a single corpus chunk. */
const MAX_CHUNK_CHARS = 6000;

/** Minimum content length for a chunk to be included. */
const MIN_CHUNK_CHARS = 20;

/** Supported markdown file extensions for corpus loading. */
const MARKDOWN_EXTENSIONS = new Set(['.md', '.mdx']);

// ============================================================================
// QueryRouter
// ============================================================================

/**
 * Main orchestrator that wires together the QueryClassifier, QueryDispatcher,
 * and QueryGenerator into a complete classify -> dispatch -> generate pipeline.
 *
 * @example
 * ```typescript
 * const router = new QueryRouter({
 *   knowledgeCorpus: ['./docs'],
 *   generationModel: 'gpt-4o-mini',
 *   generationModelDeep: 'gpt-4o',
 *   generationProvider: 'openai',
 * });
 *
 * await router.init();
 * const result = await router.route('How does authentication work?');
 * console.log(result.answer);
 * console.log(result.sources);
 *
 * await router.close();
 * ```
 */
export class QueryRouter {
  /** Resolved configuration with defaults applied. */
  private readonly config: QueryRouterFullConfig;

  /** Loaded corpus chunks from disk. */
  private corpus: CorpusChunk[] = [];

  /** Topic entries extracted from the corpus. */
  private topics: TopicEntry[] = [];

  /** Keyword-based fallback search engine. */
  private keywordFallback: KeywordFallback | null = null;

  /** Chain-of-thought query classifier. */
  private classifier: QueryClassifier | null = null;

  /** Tier-routing dispatcher. */
  private dispatcher: QueryDispatcher | null = null;

  /** LLM answer generator. */
  private generator: QueryGenerator | null = null;

  /** Accumulated lifecycle events for observability. */
  private events: QueryRouterEventUnion[] = [];

  /** Whether init() has been called successfully. */
  private initialized = false;

  /**
   * Creates a new QueryRouter instance.
   *
   * Merges user-supplied configuration over {@link QUERY_ROUTER_DEFAULTS}.
   * The router is NOT ready to use until {@link init} is called.
   *
   * @param config - Partial configuration; `knowledgeCorpus` is required.
   */
  constructor(config: Partial<QueryRouterFullConfig> & { knowledgeCorpus: string[] }) {
    this.config = {
      ...QUERY_ROUTER_DEFAULTS,
      ...config,
    };
  }

  // ==========================================================================
  // PUBLIC API
  // ==========================================================================

  /**
   * Initialise the router: load corpus from disk, extract topics, build
   * keyword fallback index, and instantiate classifier/dispatcher/generator.
   *
   * Must be called before `classify()`, `retrieve()`, or `route()`.
   *
   * The embedding step is a placeholder for now — Task 8 wires real
   * vector embeddings. All retrieval currently delegates to KeywordFallback.
   */
  async init(): Promise<void> {
    // 1. Load corpus chunks from the configured knowledge directories
    this.corpus = this.loadCorpus(this.config.knowledgeCorpus);

    // 2. Extract topics for the classifier's system prompt
    const topicExtractor = new TopicExtractor();
    this.topics = topicExtractor.extract(this.corpus);
    const topicList = topicExtractor.formatForPrompt(this.topics);

    // 3. Build keyword fallback index
    this.keywordFallback = new KeywordFallback(this.corpus);

    // 4. Instantiate the classifier
    this.classifier = new QueryClassifier({
      model: this.config.classifierModel,
      provider: this.config.classifierProvider,
      confidenceThreshold: this.config.confidenceThreshold,
      maxTier: this.config.maxTier,
      topicList,
      toolList: '',
      apiKey: this.config.apiKey,
      baseUrl: this.config.baseUrl,
    });

    // 5. Instantiate the generator
    this.generator = new QueryGenerator({
      model: this.config.generationModel,
      modelDeep: this.config.generationModelDeep,
      provider: this.config.generationProvider,
      apiKey: this.config.apiKey,
      baseUrl: this.config.baseUrl,
      maxContextTokens: this.config.maxContextTokens,
    });

    // 6. Instantiate the dispatcher with callback dependencies
    this.dispatcher = new QueryDispatcher({
      vectorSearch: (query: string, topK: number) => this.vectorSearch(query, topK),
      graphExpand: (seeds: RetrievedChunk[]) => this.graphExpand(seeds),
      rerank: (query: string, chunks: RetrievedChunk[], topN: number) =>
        this.rerank(query, chunks, topN),
      deepResearch: (query: string, sources: string[]) =>
        this.deepResearch(query, sources),
      emit: (event: QueryRouterEventUnion) => this.emit(event),
      graphEnabled: this.config.graphEnabled,
      deepResearchEnabled: this.config.deepResearchEnabled,
    });

    this.initialized = true;
  }

  /**
   * Classify a query into a complexity tier without dispatching or generating.
   *
   * Useful when consumers want to inspect the classification before deciding
   * whether to proceed with the full pipeline.
   *
   * @param query - The user's natural-language query.
   * @param conversationHistory - Optional recent conversation messages.
   * @returns The classification result with tier, confidence, and reasoning.
   * @throws If the router has not been initialised via {@link init}.
   */
  async classify(
    query: string,
    conversationHistory?: ConversationMessage[],
  ): Promise<ClassificationResult> {
    this.ensureInitialized();

    const trimmedHistory = conversationHistory?.slice(
      -this.config.conversationWindowSize,
    );

    return this.classifier!.classify(query, trimmedHistory);
  }

  /**
   * Retrieve context at a specific tier, bypassing the classifier.
   *
   * Useful when the caller already knows the appropriate retrieval depth
   * and wants to skip classification overhead.
   *
   * @param query - The user's natural-language query.
   * @param tier - The complexity tier to retrieve at (0-3).
   * @returns The retrieval result with chunks and optional graph/research data.
   * @throws If the router has not been initialised via {@link init}.
   */
  async retrieve(query: string, tier: QueryTier): Promise<RetrievalResult> {
    this.ensureInitialized();
    return this.dispatcher!.dispatch(query, tier);
  }

  /**
   * Full end-to-end pipeline: classify -> dispatch -> generate.
   *
   * This is the primary method for answering user queries. It:
   * 1. Classifies the query to determine retrieval depth.
   * 2. Dispatches retrieval at the classified tier.
   * 3. Generates a grounded answer from the retrieved context.
   * 4. Emits lifecycle events throughout for observability.
   *
   * @param query - The user's natural-language query.
   * @param conversationHistory - Optional recent conversation messages.
   * @returns The final query result with answer, classification, sources, and timing.
   * @throws If the router has not been initialised via {@link init}.
   */
  async route(
    query: string,
    conversationHistory?: ConversationMessage[],
  ): Promise<QueryResult> {
    this.ensureInitialized();

    const routeStart = Date.now();
    const fallbacksUsed: string[] = [];

    // --- Phase 1: Classification ---
    const classification = await this.classify(query, conversationHistory);

    this.emit({
      type: 'classify:complete',
      result: classification,
      durationMs: Date.now() - routeStart,
      timestamp: Date.now(),
    });

    // Fire the onClassification hook if configured
    if (this.config.onClassification) {
      this.config.onClassification(classification);
    }

    // --- Phase 2: Retrieval ---
    const retrieval = await this.dispatcher!.dispatch(
      query,
      classification.tier,
      classification.suggestedSources,
    );

    // Fire the onRetrieval hook if configured
    if (this.config.onRetrieval) {
      this.config.onRetrieval(retrieval);
    }

    // --- Phase 3: Generation ---
    this.emit({
      type: 'generate:start',
      contextChunkCount: retrieval.chunks.length,
      timestamp: Date.now(),
    });

    const generateResult = await this.generator!.generate(
      query,
      classification.tier,
      retrieval.chunks,
      retrieval.researchSynthesis,
    );

    // Build source citations from the retrieved chunks
    const sources: SourceCitation[] = retrieval.chunks.map((chunk) => ({
      path: chunk.sourcePath,
      heading: chunk.heading,
      relevanceScore: chunk.relevanceScore,
      matchType: chunk.matchType,
    }));

    this.emit({
      type: 'generate:complete',
      answerLength: generateResult.answer.length,
      citationCount: sources.length,
      durationMs: Date.now() - routeStart,
      timestamp: Date.now(),
    });

    // --- Assemble final result ---
    const totalDuration = Date.now() - routeStart;
    const tiersUsed: QueryTier[] = [classification.tier];

    const result: QueryResult = {
      answer: generateResult.answer,
      classification,
      sources,
      durationMs: totalDuration,
      tiersUsed,
      fallbacksUsed,
    };

    this.emit({
      type: 'route:complete',
      result,
      durationMs: totalDuration,
      timestamp: Date.now(),
    });

    return result;
  }

  /**
   * Tear down resources and release references.
   *
   * Safe to call multiple times. After close(), the router must be
   * re-initialised via {@link init} before further use.
   */
  async close(): Promise<void> {
    this.classifier = null;
    this.dispatcher = null;
    this.generator = null;
    this.keywordFallback = null;
    this.corpus = [];
    this.topics = [];
    this.events = [];
    this.initialized = false;
  }

  // ==========================================================================
  // PRIVATE — Corpus loading
  // ==========================================================================

  /**
   * Load and chunk markdown files from the configured corpus directories.
   *
   * Recursively walks each directory, reads .md and .mdx files, and splits
   * their content by h1-h3 headings. Each heading section becomes a
   * CorpusChunk (capped at {@link MAX_CHUNK_CHARS} characters, minimum
   * {@link MIN_CHUNK_CHARS} to filter out trivially small sections).
   *
   * @param paths - Array of directory paths to scan for markdown files.
   * @returns Array of CorpusChunk objects ready for indexing.
   */
  private loadCorpus(paths: string[]): CorpusChunk[] {
    const chunks: CorpusChunk[] = [];
    let chunkIndex = 0;

    for (const dirPath of paths) {
      if (!existsSync(dirPath)) {
        continue;
      }

      this.walkDir(dirPath, (filePath: string) => {
        const ext = extname(filePath);
        if (!MARKDOWN_EXTENSIONS.has(ext)) {
          return;
        }

        try {
          const content = readFileSync(filePath, 'utf-8');
          const sections = this.splitByHeadings(content, filePath);

          for (const section of sections) {
            if (section.content.length < MIN_CHUNK_CHARS) {
              continue;
            }

            chunks.push({
              id: `chunk_${chunkIndex++}`,
              heading: section.heading,
              content: section.content.slice(0, MAX_CHUNK_CHARS),
              sourcePath: filePath,
            });
          }
        } catch {
          // Skip unreadable files gracefully
        }
      });
    }

    return chunks;
  }

  /**
   * Recursively walk a directory tree, invoking a callback for each file.
   *
   * @param dir - The directory to walk.
   * @param callback - Function called with the absolute path of each file.
   */
  private walkDir(dir: string, callback: (filePath: string) => void): void {
    try {
      const entries = readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          this.walkDir(fullPath, callback);
        } else if (entry.isFile()) {
          callback(fullPath);
        }
      }
    } catch {
      // Skip inaccessible directories gracefully
    }
  }

  /**
   * Split markdown content into sections by h1-h3 headings.
   *
   * Each section captures the heading text and the content between it and
   * the next heading (or end of file). Content before the first heading is
   * assigned a heading of "(intro)".
   *
   * @param content - The raw markdown file content.
   * @param sourcePath - File path (used for the section's sourcePath field).
   * @returns Array of sections with heading and content fields.
   */
  private splitByHeadings(
    content: string,
    sourcePath: string,
  ): Array<{ heading: string; content: string }> {
    const lines = content.split('\n');
    const sections: Array<{ heading: string; content: string }> = [];
    let currentHeading = '(intro)';
    let currentLines: string[] = [];

    for (const line of lines) {
      const match = line.match(HEADING_REGEX);

      if (match) {
        // Flush the previous section
        if (currentLines.length > 0) {
          sections.push({
            heading: currentHeading,
            content: currentLines.join('\n').trim(),
          });
        }

        currentHeading = match[1].trim();
        currentLines = [];
      } else {
        currentLines.push(line);
      }
    }

    // Flush the final section
    if (currentLines.length > 0) {
      sections.push({
        heading: currentHeading,
        content: currentLines.join('\n').trim(),
      });
    }

    return sections;
  }

  // ==========================================================================
  // PRIVATE — Retrieval callbacks (injected into QueryDispatcher)
  // ==========================================================================

  /**
   * Vector search callback for the dispatcher.
   *
   * Currently delegates to the KeywordFallback engine since real embeddings
   * are not yet wired (Task 8). When embeddings are available, this method
   * will delegate to the VectorStoreManager instead.
   *
   * @param query - The user's query string.
   * @param topK - Maximum number of chunks to return.
   * @returns Promise resolving to an array of matched chunks.
   */
  private async vectorSearch(query: string, topK: number): Promise<RetrievedChunk[]> {
    if (!this.keywordFallback) {
      return [];
    }
    return this.keywordFallback.search(query, topK);
  }

  /**
   * Graph expansion callback for the dispatcher.
   *
   * Placeholder — returns empty array. Will be wired to GraphRAG in a
   * future task.
   *
   * @param _seeds - Seed chunks to expand from (unused for now).
   * @returns Promise resolving to an empty array.
   */
  private async graphExpand(_seeds: RetrievedChunk[]): Promise<RetrievedChunk[]> {
    return [];
  }

  /**
   * Reranking callback for the dispatcher.
   *
   * Placeholder — returns the first topN chunks without actual reranking.
   * Will be replaced by a cross-encoder or LLM-based reranker in a future task.
   *
   * @param _query - The user's query (unused for now).
   * @param chunks - Candidate chunks to rerank.
   * @param topN - Maximum number of chunks to keep.
   * @returns Promise resolving to the first topN chunks.
   */
  private async rerank(
    _query: string,
    chunks: RetrievedChunk[],
    topN: number,
  ): Promise<RetrievedChunk[]> {
    return chunks.slice(0, topN);
  }

  /**
   * Deep research callback for the dispatcher.
   *
   * Placeholder — returns empty synthesis and empty sources. Will be wired
   * to a real research engine when SERPER_API_KEY is available.
   *
   * @param _query - The user's query (unused for now).
   * @param _sources - Source identifiers to consult (unused for now).
   * @returns Promise resolving to empty synthesis and sources.
   */
  private async deepResearch(
    _query: string,
    _sources: string[],
  ): Promise<{ synthesis: string; sources: RetrievedChunk[] }> {
    return { synthesis: '', sources: [] };
  }

  // ==========================================================================
  // PRIVATE — Event emission
  // ==========================================================================

  /**
   * Store a lifecycle event and emit a structured console log.
   *
   * Events are accumulated in the `events` array for later inspection
   * and also logged to the console with a `[QueryRouter]` prefix for
   * real-time observability.
   *
   * @param event - The typed lifecycle event to emit.
   */
  private emit(event: QueryRouterEventUnion): void {
    this.events.push(event);
  }

  // ==========================================================================
  // PRIVATE — Guards
  // ==========================================================================

  /**
   * Assert that the router has been initialised via {@link init}.
   *
   * @throws Error if `init()` has not been called.
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error(
        'QueryRouter has not been initialised. Call init() before classify/retrieve/route.',
      );
    }
  }
}
