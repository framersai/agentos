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
 * - Real vector embedding via EmbeddingManager + VectorStoreManager (in-memory)
 * - Keyword fallback retrieval when embeddings are unavailable
 * - Event emission for full pipeline observability
 * - Lifecycle hooks (onClassification, onRetrieval) for consumer integration
 *
 * Embedding pipeline: The `init()` method attempts to initialize an
 * AIModelProviderManager, EmbeddingManager, and VectorStoreManager to enable
 * real vector search. If any step fails (e.g., no API key configured), the
 * router falls back gracefully to {@link KeywordFallback} for all retrieval.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, extname } from 'node:path';

import { QueryClassifier } from './QueryClassifier.js';
import { QueryDispatcher } from './QueryDispatcher.js';
import { QueryGenerator } from './QueryGenerator.js';
import { TopicExtractor } from './TopicExtractor.js';
import { KeywordFallback } from './KeywordFallback.js';
import { DEFAULT_QUERY_ROUTER_CONFIG } from './types.js';
import type {
  ClassificationResult,
  ConversationMessage,
  CorpusChunk,
  QueryResult,
  QueryRouterConfig,
  QueryRouterEventUnion,
  QueryTier,
  RetrievalResult,
  RetrievedChunk,
  SourceCitation,
  TopicEntry,
} from './types.js';

// RAG module types — imported as types to keep the dependency graph light.
// The actual classes are dynamically imported in init() to stay optional.
import type { EmbeddingManager } from '../rag/EmbeddingManager.js';
import type { VectorStoreManager } from '../rag/VectorStoreManager.js';
import type { AIModelProviderManager } from '../core/llm/providers/AIModelProviderManager.js';
import type { VectorDocument } from '../rag/IVectorStore.js';

// ============================================================================
// Configuration
// ============================================================================

type QueryRouterResolvedConfig = Omit<
  Required<QueryRouterConfig>,
  'onClassification' | 'onRetrieval' | 'apiKey' | 'baseUrl'
> &
  Pick<QueryRouterConfig, 'onClassification' | 'onRetrieval' | 'apiKey' | 'baseUrl'>;

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
  private readonly config: QueryRouterResolvedConfig;

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

  /** Embedding manager for generating vector embeddings. Null if not available. */
  private embeddingManager: EmbeddingManager | null = null;

  /** Vector store manager for persisting and querying embeddings. Null if not available. */
  private vectorStoreManager: VectorStoreManager | null = null;

  /** AI model provider manager used by the embedding manager. Null if not available. */
  private providerManager: AIModelProviderManager | null = null;

  /** Embedding dimension for the configured model. Zero if embeddings unavailable. */
  private embeddingDimension = 0;

  /**
   * The data source ID used for corpus embeddings in the vector store.
   * Matches the collection name configured during init().
   */
  private readonly corpusDataSourceId = 'query-router-corpus';

  /**
   * Creates a new QueryRouter instance.
   *
   * Merges user-supplied configuration over {@link QUERY_ROUTER_DEFAULTS}.
   * The router is NOT ready to use until {@link init} is called.
   *
   * @param config - Partial configuration; `knowledgeCorpus` is required.
   */
  constructor(config: QueryRouterConfig) {
    this.config = {
      ...DEFAULT_QUERY_ROUTER_CONFIG,
      ...config,
      deepResearchEnabled: config.deepResearchEnabled ?? Boolean(process.env.SERPER_API_KEY),
      availableTools: config.availableTools ?? [...DEFAULT_QUERY_ROUTER_CONFIG.availableTools],
    };
  }

  // ==========================================================================
  // PUBLIC API
  // ==========================================================================

  /**
   * Initialise the router: load corpus from disk, extract topics, build
   * keyword fallback index, embed the corpus into a vector store, and
   * instantiate classifier/dispatcher/generator.
   *
   * Must be called before `classify()`, `retrieve()`, or `route()`.
   *
   * The embedding step uses real EmbeddingManager + VectorStoreManager when
   * an LLM provider is available (e.g., OPENAI_API_KEY is set). If embedding
   * initialisation fails for any reason, the router falls back gracefully to
   * KeywordFallback for all retrieval.
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

    // 4. Attempt to embed corpus chunks into a real vector store.
    //    This is wrapped in a try/catch so failure is non-fatal — keyword
    //    fallback will still work for all retrieval operations.
    await this.embedCorpus();

    // 5. Instantiate the classifier
    this.classifier = new QueryClassifier({
      model: this.config.classifierModel,
      provider: this.config.classifierProvider,
      confidenceThreshold: this.config.confidenceThreshold,
      maxTier: this.config.maxTier,
      topicList,
      toolList: this.formatToolList(this.config.availableTools),
      apiKey: this.config.apiKey,
      baseUrl: this.config.baseUrl,
    });

    // 6. Instantiate the generator
    this.generator = new QueryGenerator({
      model: this.config.generationModel,
      modelDeep: this.config.generationModelDeep,
      provider: this.config.generationProvider,
      apiKey: this.config.apiKey,
      baseUrl: this.config.baseUrl,
      maxContextTokens: this.config.maxContextTokens,
    });

    // 7. Instantiate the dispatcher with callback dependencies
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

    const start = Date.now();
    this.emit({
      type: 'classify:start',
      query,
      timestamp: start,
    });

    const trimmedHistory = conversationHistory?.slice(
      -this.config.conversationWindowSize,
    );

    const result = await this.classifier!.classify(query, trimmedHistory);

    if (result.reasoning.startsWith('Classification failed;')) {
      this.emit({
        type: 'classify:error',
        error: new Error(result.reasoning),
        timestamp: Date.now(),
      });
    }

    this.emit({
      type: 'classify:complete',
      result,
      durationMs: Date.now() - start,
      timestamp: Date.now(),
    });

    return result;
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

    // --- Phase 1: Classification ---
    const classification = await this.classify(query, conversationHistory);

    // Fire the onClassification hook if configured
    if (this.config.onClassification) {
      this.config.onClassification(classification);
    }

    // --- Phase 2: Retrieval ---
    const retrievalEventStart = this.events.length;
    const retrieval = await this.dispatcher!.dispatch(
      query,
      classification.tier,
      classification.suggestedSources,
    );
    const retrievalEvents = this.events.slice(retrievalEventStart);
    const fallbacksUsed = this.collectFallbacks(classification, retrievalEvents);
    const tiersUsed = this.collectTiersUsed(classification, fallbacksUsed);

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
   * Shuts down embedding and vector store managers if they were initialised,
   * then nulls out all component references. Safe to call multiple times.
   * After close(), the router must be re-initialised via {@link init} before
   * further use.
   */
  async close(): Promise<void> {
    // Shut down RAG modules if they were initialised
    try {
      if (this.embeddingManager && typeof (this.embeddingManager as any).shutdown === 'function') {
        await this.embeddingManager.shutdown();
      }
    } catch { /* best-effort cleanup */ }
    try {
      if (this.vectorStoreManager) {
        await this.vectorStoreManager.shutdownAllProviders();
      }
    } catch { /* best-effort cleanup */ }
    try {
      if (this.providerManager) {
        await this.providerManager.shutdown();
      }
    } catch { /* best-effort cleanup */ }

    this.embeddingManager = null;
    this.vectorStoreManager = null;
    this.providerManager = null;
    this.embeddingDimension = 0;
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
  // PRIVATE — Corpus embedding
  // ==========================================================================

  /**
   * Embed all loaded corpus chunks into the vector store using real
   * EmbeddingManager and VectorStoreManager instances.
   *
   * The method dynamically imports the RAG modules to keep them optional —
   * if the imports fail or initialisation fails (e.g., no API key), the error
   * is caught and logged as a warning. The router will continue to function
   * using the KeywordFallback engine for all retrieval.
   *
   * Steps:
   * 1. Dynamic-import AIModelProviderManager, EmbeddingManager, VectorStoreManager
   * 2. Initialise the provider manager with the configured embedding provider
   * 3. Initialise the embedding manager with the configured model
   * 4. Initialise the vector store manager with an in-memory provider
   * 5. Create a collection with the correct dimension
   * 6. Embed all corpus chunks in batches of 50
   * 7. Upsert the resulting VectorDocuments into the vector store
   * 8. Cache embeddings on CorpusChunk.embedding for potential reuse
   */
  private async embedCorpus(): Promise<void> {
    if (this.corpus.length === 0) {
      return;
    }

    // Quick check: bail out early if there's obviously no API key configured.
    // This avoids the overhead of dynamic imports and provider initialization
    // in test environments and when no embedding provider is available.
    const apiKey = this.config.apiKey || process.env.OPENAI_API_KEY || '';
    if (!apiKey) {
      console.debug(
        '[QueryRouter] No embedding API key configured; skipping vector store embedding (keyword fallback active).',
      );
      return;
    }

    try {
      // --- Dynamic imports to keep RAG modules optional ---
      const [
        { AIModelProviderManager: AIModelProviderManagerClass },
        { EmbeddingManager: EmbeddingManagerClass },
        { VectorStoreManager: VectorStoreManagerClass },
      ] = await Promise.all([
        import('../core/llm/providers/AIModelProviderManager.js'),
        import('../rag/EmbeddingManager.js'),
        import('../rag/VectorStoreManager.js'),
      ]);

      // --- 1. Initialise the AI model provider manager ---
      const pm = new AIModelProviderManagerClass();
      await pm.initialize({
        providers: [
          {
            providerId: this.config.embeddingProvider,
            enabled: true,
            config: {
              apiKey: this.config.apiKey || process.env.OPENAI_API_KEY || '',
              ...(this.config.baseUrl ? { baseUrl: this.config.baseUrl } : {}),
            },
            isDefault: true,
          },
        ],
      });
      this.providerManager = pm;

      // --- 2. Initialise the embedding manager ---
      const em = new EmbeddingManagerClass();
      const embeddingModelId = this.config.embeddingModel;
      const embeddingProviderId = this.config.embeddingProvider;

      // Determine dimension: use a known dimension for common models, or
      // try to derive it by generating a single test embedding.
      let dimension = this.getKnownDimension(embeddingModelId);

      await em.initialize(
        {
          embeddingModels: [
            {
              modelId: embeddingModelId,
              providerId: embeddingProviderId,
              dimension: dimension || 1536, // initial guess; corrected below if needed
              isDefault: true,
            },
          ],
          defaultModelId: embeddingModelId,
          defaultBatchSize: 50,
        },
        pm,
      );
      this.embeddingManager = em;

      // If dimension was unknown, generate a probe embedding to discover it
      if (!dimension) {
        const probe = await em.generateEmbeddings({ texts: ['dimension probe'] });
        if (probe.embeddings.length > 0 && probe.embeddings[0].length > 0) {
          dimension = probe.embeddings[0].length;
        } else {
          dimension = 1536; // safe fallback for OpenAI models
        }
      }
      this.embeddingDimension = dimension;

      // --- 3. Initialise the vector store manager (in-memory) ---
      const vsm = new VectorStoreManagerClass();
      const collectionName = this.corpusDataSourceId;
      await vsm.initialize(
        {
          managerId: 'query-router-vsm',
          providers: [{ id: 'mem', type: 'in_memory' }],
          defaultProviderId: 'mem',
        },
        [
          {
            dataSourceId: collectionName,
            displayName: 'QueryRouter Corpus',
            vectorStoreProviderId: 'mem',
            actualNameInProvider: collectionName,
            embeddingDimension: dimension,
          },
        ],
      );
      this.vectorStoreManager = vsm;

      // --- 4. Create the collection ---
      const { store, collectionName: resolvedName } =
        await vsm.getStoreForDataSource(collectionName);

      if (typeof store.createCollection === 'function') {
        await store.createCollection(resolvedName, dimension);
      }

      // --- 5. Embed corpus chunks in batches of 50 ---
      const BATCH_SIZE = 50;
      const allDocuments: VectorDocument[] = [];

      for (let i = 0; i < this.corpus.length; i += BATCH_SIZE) {
        const batch = this.corpus.slice(i, i + BATCH_SIZE);
        const texts = batch.map((c) => c.content);

        const result = await em.generateEmbeddings({ texts });

        for (let j = 0; j < batch.length; j++) {
          const embedding = result.embeddings[j];
          if (!embedding || embedding.length === 0) {
            continue; // skip chunks that failed to embed
          }

          // Cache embedding on the CorpusChunk for potential later reuse
          batch[j].embedding = embedding;

          allDocuments.push({
            id: batch[j].id,
            embedding,
            textContent: batch[j].content,
            metadata: {
              heading: batch[j].heading,
              sourcePath: batch[j].sourcePath,
            },
          });
        }
      }

      // --- 6. Upsert into vector store ---
      if (allDocuments.length > 0) {
        await store.upsert(resolvedName, allDocuments);
      }

      console.log(
        `[QueryRouter] Embedded ${allDocuments.length} chunks into vector store (dim=${dimension})`,
      );
    } catch (error: unknown) {
      // Non-fatal: warn and continue — keyword fallback still works
      const message =
        error instanceof Error ? error.message : String(error);
      console.warn(
        `[QueryRouter] Embedding initialisation failed, falling back to keyword search: ${message}`,
      );
      // Clean up any partial state
      this.embeddingManager = null;
      this.vectorStoreManager = null;
      this.providerManager = null;
      this.embeddingDimension = 0;
    }
  }

  /**
   * Return a known embedding dimension for common models.
   *
   * This avoids an extra API call when the dimension can be statically
   * determined from the model identifier.
   *
   * @param modelId - The embedding model identifier.
   * @returns The known dimension, or 0 if unknown.
   */
  private getKnownDimension(modelId: string): number {
    const KNOWN_DIMENSIONS: Record<string, number> = {
      'text-embedding-3-small': 1536,
      'text-embedding-3-large': 3072,
      'text-embedding-ada-002': 1536,
    };
    return KNOWN_DIMENSIONS[modelId] ?? 0;
  }

  // ==========================================================================
  // PRIVATE — Retrieval callbacks (injected into QueryDispatcher)
  // ==========================================================================

  /**
   * Vector search callback for the dispatcher.
   *
   * When the EmbeddingManager and VectorStoreManager are available, this method
   * embeds the query, queries the vector store, and maps the results to
   * RetrievedChunk objects. If the RAG modules are not available (e.g., embedding
   * init failed), it falls back to the KeywordFallback engine and emits a
   * retrieve:fallback event.
   *
   * @param query - The user's query string.
   * @param topK - Maximum number of chunks to return.
   * @returns Promise resolving to an array of matched chunks.
   */
  private async vectorSearch(query: string, topK: number): Promise<RetrievedChunk[]> {
    // --- Real vector search when RAG modules are available ---
    if (this.embeddingManager && this.vectorStoreManager) {
      try {
        // Embed the query
        const queryResult = await this.embeddingManager.generateEmbeddings({
          texts: [query],
        });

        const queryEmbedding = queryResult.embeddings[0];
        if (!queryEmbedding || queryEmbedding.length === 0) {
          // Embedding failed for the query — fall through to keyword fallback
          throw new Error('Query embedding returned empty vector');
        }

        // Query the vector store
        const { store, collectionName } =
          await this.vectorStoreManager.getStoreForDataSource(this.corpusDataSourceId);

        const searchResults = await store.query(collectionName, queryEmbedding, {
          topK,
          includeTextContent: true,
          includeMetadata: true,
        });

        // Map retrieved vector documents to RetrievedChunk[]
        return searchResults.documents.map((doc) => ({
          id: doc.id,
          content: doc.textContent ?? '',
          heading: (doc.metadata?.heading as string) ?? '',
          sourcePath: (doc.metadata?.sourcePath as string) ?? '',
          relevanceScore: doc.similarityScore,
          matchType: 'vector' as const,
        }));
      } catch (error: unknown) {
        // On any error during vector search, fall back to keyword search
        const message =
          error instanceof Error ? error.message : String(error);
        console.warn(
          `[QueryRouter] Vector search failed, falling back to keyword search: ${message}`,
        );
        this.emit({
          type: 'retrieve:fallback',
          strategy: 'keyword-fallback',
          reason: `Vector search error: ${message}`,
          timestamp: Date.now(),
        });
      }
    } else {
      // RAG modules not available — emit a fallback event
      this.emit({
        type: 'retrieve:fallback',
        strategy: 'keyword-fallback',
        reason: 'Embeddings unavailable; using keyword search',
        timestamp: Date.now(),
      });
    }

    // --- Keyword fallback ---
    if (!this.keywordFallback) {
      return [];
    }
    return this.keywordFallback.search(query, topK);
  }

  /**
   * Graph expansion callback for the dispatcher.
   *
   * Placeholder — returns empty array.
   * // Follow-up: wire GraphRAGEngine
   *
   * @param _seeds - Seed chunks to expand from (unused for now).
   * @returns Promise resolving to an empty array.
   */
  private async graphExpand(_seeds: RetrievedChunk[]): Promise<RetrievedChunk[]> {
    // Follow-up: wire GraphRAGEngine
    return [];
  }

  /**
   * Reranking callback for the dispatcher.
   *
   * Placeholder — returns the first topN chunks without actual reranking.
   * // Follow-up: wire RerankerService
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
    // Follow-up: wire RerankerService
    return chunks.slice(0, topN);
  }

  /**
   * Deep research callback for the dispatcher.
   *
   * Placeholder — returns empty synthesis and empty sources.
   * // Follow-up: wire DeepResearchEngine
   *
   * @param _query - The user's query (unused for now).
   * @param _sources - Source identifiers to consult (unused for now).
   * @returns Promise resolving to empty synthesis and sources.
   */
  private async deepResearch(
    _query: string,
    _sources: string[],
  ): Promise<{ synthesis: string; sources: RetrievedChunk[] }> {
    // Follow-up: wire DeepResearchEngine
    return { synthesis: '', sources: [] };
  }

  /**
   * Format available tools for the classifier prompt.
   */
  private formatToolList(availableTools: string[]): string {
    return availableTools.length > 0 ? availableTools.join(', ') : '(none available)';
  }

  /**
   * Derive fallback strategy names from classification + retrieval events.
   */
  private collectFallbacks(
    classification: ClassificationResult,
    events: QueryRouterEventUnion[],
  ): string[] {
    const fallbacks = new Set<string>();

    if (classification.confidence < this.config.confidenceThreshold) {
      fallbacks.add('low-confidence-classification');
    }

    for (const event of events) {
      if (event.type === 'retrieve:fallback') {
        fallbacks.add(event.strategy);
      }
    }

    return Array.from(fallbacks);
  }

  /**
   * Approximate the tiers actually exercised when fallback strategies fired.
   */
  private collectTiersUsed(
    classification: ClassificationResult,
    fallbacksUsed: string[],
  ): QueryTier[] {
    const tiers = new Set<QueryTier>([classification.tier]);

    for (const fallback of fallbacksUsed) {
      if (fallback === 'research-skip') {
        tiers.add(2);
      }

      if (fallback === 'graph-skip' || fallback === 'keyword-fallback' || fallback === 'rerank-skip') {
        tiers.add(1);
      }
    }

    return Array.from(tiers).sort((a, b) => a - b) as QueryTier[];
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
