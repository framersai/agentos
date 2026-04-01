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
import type { ClassificationResult, ConversationMessage, QueryResult, QueryRouterCorpusStats, QueryRouterConfig, QueryRouterRequestOptions, QueryTier, RetrievalResult } from './types.js';
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
export declare class QueryRouter {
    /** Resolved configuration with defaults applied. */
    private readonly config;
    /** Loaded corpus chunks from disk. */
    private corpus;
    /** Topic entries extracted from the corpus. */
    private topics;
    /** Keyword-based fallback search engine. */
    private keywordFallback;
    /** Chain-of-thought query classifier. */
    private classifier;
    /**
     * Optional capability discovery engine persisted across classifier rebuilds.
     *
     * The router recreates its classifier during `init()` and when background
     * GitHub indexing refreshes the topic list. Persist the attached discovery
     * engine so those classifier rebuilds do not silently drop capability-aware
     * planning.
     */
    private capabilityDiscoveryEngine;
    /** Tier-routing dispatcher. */
    private dispatcher;
    /** LLM answer generator. */
    private generator;
    /** Accumulated lifecycle events for observability. */
    private events;
    /** Whether init() has been called successfully. */
    private initialized;
    /** Embedding manager for generating vector embeddings. Null if not available. */
    private embeddingManager;
    /** Vector store manager for persisting and querying embeddings. Null if not available. */
    private vectorStoreManager;
    /** AI model provider manager used by the embedding manager. Null if not available. */
    private providerManager;
    /** Embedding dimension for the configured model. Zero if embeddings unavailable. */
    private embeddingDimension;
    /** Current embedding availability state for corpus retrieval. */
    private embeddingStatus;
    /**
     * Optional UnifiedRetriever for plan-based retrieval.
     *
     * When set via {@link setUnifiedRetriever}, the `route()` method uses
     * the UnifiedRetriever instead of the legacy QueryDispatcher for the
     * retrieval phase. The UnifiedRetriever executes a structured
     * {@link RetrievalPlan} across all available sources in parallel.
     *
     * @see setUnifiedRetriever
     */
    private unifiedRetriever;
    /**
     * The data source ID used for corpus embeddings in the vector store.
     * Matches the collection name configured during init().
     */
    private readonly corpusDataSourceId;
    /**
     * Creates a new QueryRouter instance.
     *
     * Merges user-supplied configuration over {@link QUERY_ROUTER_DEFAULTS}.
     * The router is NOT ready to use until {@link init} is called.
     *
     * @param config - Partial configuration; `knowledgeCorpus` is required.
     */
    constructor(config: QueryRouterConfig);
    /**
     * Attach a {@link UnifiedRetriever} for plan-based retrieval.
     *
     * When set, the `route()` method uses the UnifiedRetriever instead of
     * the legacy QueryDispatcher for the retrieval phase. The classifier
     * automatically produces a {@link RetrievalPlan} via `classifyWithPlan()`
     * and the retriever executes it across all available sources in parallel.
     *
     * Pass `null` to revert to the legacy QueryDispatcher pipeline.
     *
     * @param retriever - A configured UnifiedRetriever instance, or `null` to disable.
     *
     * @example
     * ```typescript
     * const retriever = new UnifiedRetriever({
     *   hybridSearcher, raptorTree, graphEngine, memoryManager,
     * });
     * router.setUnifiedRetriever(retriever);
     * // Now route() uses plan-based retrieval automatically
     * ```
     */
    setUnifiedRetriever(retriever: import('../rag/unified/UnifiedRetriever.js').UnifiedRetriever | null): void;
    /**
     * Get the attached UnifiedRetriever, or `null` if not configured.
     *
     * @returns The UnifiedRetriever instance, or `null`.
     */
    getUnifiedRetriever(): import('../rag/unified/UnifiedRetriever.js').UnifiedRetriever | null;
    /**
     * Attach a {@link CapabilityDiscoveryEngine} for capability-aware classification.
     *
     * When set, the classifier injects Tier 0 capability summaries (~150 tokens)
     * into its LLM prompt, enabling it to recommend which skills, tools, and
     * extensions should be activated for each query. The recommendations are
     * included in the {@link ExecutionPlan} returned by `classifyWithPlan()`.
     *
     * Pass `null` to detach and revert to keyword-based heuristic capability
     * selection.
     *
     * @param engine - A configured and initialized CapabilityDiscoveryEngine, or `null` to detach.
     *
     * @example
     * ```typescript
     * const engine = new CapabilityDiscoveryEngine(embeddingManager, vectorStore);
     * await engine.initialize({ tools, skills, extensions, channels });
     * router.setCapabilityDiscoveryEngine(engine);
     * // Now route() includes skill/tool/extension recommendations in the execution plan
     * ```
     */
    setCapabilityDiscoveryEngine(engine: import('../discovery/CapabilityDiscoveryEngine.js').CapabilityDiscoveryEngine | null): void;
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
    init(): Promise<void>;
    private loadGitHubExtensionModule;
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
    classify(query: string, conversationHistory?: ConversationMessage[], options?: QueryRouterRequestOptions): Promise<ClassificationResult>;
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
    retrieve(query: string, tier: QueryTier): Promise<RetrievalResult>;
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
    route(query: string, conversationHistory?: ConversationMessage[], options?: QueryRouterRequestOptions): Promise<QueryResult>;
    /**
     * Tear down resources and release references.
     *
     * Shuts down embedding and vector store managers if they were initialised,
     * then nulls out all component references. Safe to call multiple times.
     * After close(), the router must be re-initialised via {@link init} before
     * further use.
     */
    close(): Promise<void>;
    /**
     * Return lightweight corpus/index stats for observability and host startup
     * logs.
     *
     * Useful after {@link init} so callers can confirm the router loaded a real
     * corpus instead of only knowing that initialisation completed.
     */
    getCorpusStats(): QueryRouterCorpusStats;
    private getPlatformKnowledgeCounts;
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
    private loadCorpus;
    /**
     * Build a clear init-time error for empty or unreadable corpora.
     *
     * The router can technically operate with keyword fallback only, but it
     * should not silently mark itself ready when no corpus content was loaded
     * at all. Callers usually interpret a successful `init()` as "docs loaded".
     *
     * @param paths - Configured knowledge corpus directory paths.
     * @returns Human-readable error message for throwing from {@link init}.
     */
    private buildEmptyCorpusError;
    /**
     * Load the bundled platform knowledge corpus that ships with @framers/agentos.
     *
     * The corpus file (`knowledge/platform-corpus.json`) is generated at build
     * time by `scripts/build-knowledge-corpus.mjs` and contains tool reference
     * entries, skill summaries, FAQ, API reference, and troubleshooting guides.
     *
     * Falls back gracefully if the file is missing (e.g., in development before
     * the knowledge build step has run).
     *
     * @returns Loaded platform corpus chunks, or empty array if unavailable.
     */
    private loadPlatformKnowledge;
    /**
     * Recursively walk a directory tree, invoking a callback for each file.
     *
     * @param dir - The directory to walk.
     * @param callback - Function called with the absolute path of each file.
     */
    private walkDir;
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
    private splitByHeadings;
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
    private embedCorpus;
    private syncIndexedCorpusChunks;
    private appendCorpusChunks;
    private rebuildCorpusSearchState;
    private createClassifier;
    private trimConversationHistory;
    private indexAdditionalCorpusChunks;
    private disableVectorRetrieval;
    /**
     * Resolve API key for embedding calls.
     * Falls back through embedding-specific → global → env var scan.
     */
    private getEmbeddingApiKey;
    private getEmbeddingBaseUrl;
    /**
     * Resolve API key for LLM calls.
     *
     * Checks config override first, then scans all provider env vars in priority
     * order. Returns empty string for keyless providers (claude-code-cli, gemini-cli)
     * which is fine — generateText() handles them via CLISubprocessBridge.
     */
    private getLlmApiKey;
    /**
     * Resolve base URL for LLM calls.
     *
     * Only OpenRouter and Ollama need custom base URLs. All other providers
     * (including CLI) use their default endpoints via generateText() resolution.
     */
    private getLlmBaseUrl;
    /**
     * Return a known embedding dimension for common models.
     *
     * This avoids an extra API call when the dimension can be statically
     * determined from the model identifier.
     *
     * @param modelId - The embedding model identifier.
     * @returns The known dimension, or 0 if unknown.
     */
    private getKnownDimension;
    /**
     * Whether graph expansion is backed by a live implementation.
     *
     * Hosts should not treat `graphEnabled` as meaning GraphRAG is actually live.
     * `active` is reserved for a host-injected or future provider-backed graph
     * runtime rather than the built-in heuristic.
     */
    private hasLiveGraphRuntime;
    /**
     * Whether graph expansion is backed by the built-in heuristic expansion.
     */
    private hasHeuristicGraphRuntime;
    /**
     * Whether reranking is backed by a live implementation.
     *
     * `active` is reserved for a host-injected or future provider-backed
     * reranker rather than the built-in lexical heuristic.
     */
    private hasLiveRerankerRuntime;
    /**
     * Whether reranking is backed by the built-in lexical reranker.
     */
    private hasHeuristicRerankerRuntime;
    /**
     * Whether deep research is backed by a live implementation.
     *
     * `deepResearchEnabled` only means the branch may be attempted by config.
     * `active` is reserved for a host-injected or future provider-backed
     * research runtime rather than the built-in local-corpus heuristic.
     */
    private hasLiveDeepResearchRuntime;
    /**
     * Whether deep research is backed by the built-in corpus-only heuristic.
     */
    private hasHeuristicDeepResearchRuntime;
    /**
     * HyDE (Hypothetical Document Embeddings) search callback for the dispatcher.
     *
     * Generates a hypothetical answer to the query using the LLM, then searches
     * for documents similar to that hypothetical answer. Falls back to standard
     * vector search if no generation provider is available.
     *
     * @param query - The user's query string.
     * @param topK - Maximum number of chunks to return.
     * @returns Promise resolving to an array of matched chunks.
     */
    private hydeSearch;
    /**
     * Query decomposition callback for the dispatcher.
     *
     * Splits a complex multi-part query into independent sub-queries.
     * The built-in implementation uses simple sentence splitting as a heuristic.
     * A host-injected decomposer would use an LLM for semantic decomposition.
     *
     * @param query - The original multi-part user query.
     * @param maxSubQueries - Maximum number of sub-queries to generate.
     * @returns Array of decomposed sub-query strings.
     */
    private decomposeQuery;
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
    private vectorSearch;
    /**
     * Graph expansion callback for the dispatcher.
     *
     * Built-in heuristic graph expansion over the loaded corpus.
     *
     * This is not yet a true GraphRAG engine. It expands from seed chunks by
     * preferring:
     * - chunks from the same source document
     * - heading overlap with seed headings/content
     * - content overlap with seed headings/content
     *
     * @param seeds - Seed chunks to expand from.
     * @returns Promise resolving to related chunks marked as `graph`.
     */
    private graphExpand;
    /**
     * Reranking callback for the dispatcher.
     *
     * Built-in heuristic reranker.
     *
     * This is not yet a cross-encoder. It reorders candidate chunks by combining:
     * - original retrieval score
     * - heading term overlap
     * - content term overlap
     * - exact phrase containment
     *
     * This gives tier-2 routing a real second-pass ranking step today without
     * pretending the deeper reranker service is already wired.
     *
     * @param query - The user's query.
     * @param chunks - Candidate chunks to rerank.
     * @param topN - Maximum number of chunks to keep.
     * @returns Promise resolving to the best-ranked chunks.
     */
    private rerank;
    /**
     * Deep research callback for the dispatcher.
     *
     * Built-in corpus-only research heuristic.
     *
     * This is not web-backed research. It runs a few local keyword-based passes
     * over the loaded corpus using slightly different query formulations, merges
     * the results, and returns a compact synthesis built from the top findings.
     *
     * @param query - The user's query.
     * @param sources - Normalized research-source hints used to broaden local
     *                  matching.
     * @returns Promise resolving to synthesized local-corpus findings.
     */
    private deepResearch;
    /**
     * Format available tools for the classifier prompt.
     */
    private formatToolList;
    /**
     * Normalize text for simple lexical reranking.
     */
    private normalizeForRerank;
    /**
     * Tokenize text for lexical reranking.
     */
    private tokenizeForRerank;
    /**
     * Compute overlap ratio between query terms and candidate terms.
     */
    private computeTermOverlap;
    /**
     * Extract a short first-sentence style summary from a chunk for synthesis.
     */
    private firstSentence;
    /**
     * Derive fallback strategy names from classification + retrieval events.
     */
    private collectFallbacks;
    /**
     * Approximate the tiers actually exercised when fallback strategies fired.
     */
    private collectTiersUsed;
    /**
     * Store a lifecycle event and emit a structured console log.
     *
     * Events are accumulated in the `events` array for later inspection
     * and also logged to the console with a `[QueryRouter]` prefix for
     * real-time observability.
     *
     * @param event - The typed lifecycle event to emit.
     */
    private emit;
    /**
     * Assert that the router has been initialised via {@link init}.
     *
     * @throws Error if `init()` has not been called.
     */
    private ensureInitialized;
}
//# sourceMappingURL=QueryRouter.d.ts.map