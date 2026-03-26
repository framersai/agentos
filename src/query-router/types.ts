/**
 * @fileoverview Core types for the QueryRouter module.
 * @module @framers/agentos/query-router/types
 *
 * Defines all interfaces, configuration, event types, and data structures
 * used by the intelligent query routing pipeline. The QueryRouter classifies
 * incoming queries by complexity tier, retrieves relevant context from vector
 * stores and knowledge graphs, and generates grounded answers with citations.
 *
 * Key concepts:
 * - QueryTier: Four-tier complexity classification (0 = trivial, 3 = research)
 * - ClassificationResult: Output of the query classifier with confidence scoring
 * - RetrievalResult: Aggregated chunks from vector, graph, and research sources
 * - QueryResult: Final answer with citations, timing, and tier metadata
 * - QueryRouterConfig: Fully documented configuration with sensible defaults
 * - Event system: Discriminated union of lifecycle events for observability
 */

import type { IVectorStore } from '../rag/IVectorStore.js';

// ============================================================================
// QUERY TIER
// ============================================================================

/**
 * Complexity tier assigned to an incoming query.
 *
 * - `0` — **Trivial**: Answered from conversation context or general knowledge
 *   (e.g., "What is TypeScript?"). No retrieval needed.
 * - `1` — **Simple lookup**: Single-source retrieval sufficient
 *   (e.g., "What port does the API run on?"). Vector search only.
 * - `2` — **Multi-source**: Requires combining information from multiple chunks
 *   or graph traversal (e.g., "How does auth flow from frontend to backend?").
 * - `3` — **Research**: Deep investigation across the entire corpus, possibly
 *   with iterative refinement (e.g., "Compare all caching strategies used in
 *   this codebase and recommend improvements.").
 */
export type QueryTier = 0 | 1 | 2 | 3;

// ============================================================================
// CLASSIFICATION
// ============================================================================

/**
 * Result of classifying a user query into a complexity tier.
 * Produced by the {@link QueryClassifier}.
 */
export interface ClassificationResult {
  /**
   * The assigned complexity tier.
   * @see QueryTier
   */
  tier: QueryTier;

  /**
   * Confidence score for the classification (0 to 1).
   * A score below the configured threshold may trigger fallback behaviour.
   */
  confidence: number;

  /**
   * Human-readable reasoning explaining why this tier was chosen.
   * Useful for debugging and audit trails.
   */
  reasoning: string;

  /**
   * Whether the agent's internal knowledge is likely sufficient to answer
   * without any retrieval. When `true` and tier is 0, the router may skip
   * retrieval entirely.
   */
  internalKnowledgeSufficient: boolean;

  /**
   * Suggested source types to consult for this query.
   * @example ['vector', 'graph']
   */
  suggestedSources: Array<'vector' | 'graph' | 'research'>;

  /**
   * Tool names the classifier believes are needed to answer this query.
   * Empty array if no tools are required.
   */
  toolsNeeded: string[];
}

// ============================================================================
// RETRIEVAL
// ============================================================================

/**
 * A single chunk of content retrieved during the retrieval phase.
 */
export interface RetrievedChunk {
  /** Unique identifier for the chunk (typically from the vector store). */
  id: string;

  /** The text content of the chunk. */
  content: string;

  /** Section heading or title the chunk belongs to, if available. */
  heading: string;

  /** File path or document source path this chunk was extracted from. */
  sourcePath: string;

  /**
   * Relevance score (0 to 1) indicating how well this chunk matches
   * the query. Higher is better.
   */
  relevanceScore: number;

  /**
   * Which retrieval method produced this chunk.
   * - `'vector'` — Dense vector similarity search
   * - `'graph'` — Knowledge graph traversal (GraphRAG)
   * - `'research'` — Iterative deep research synthesis
   */
  matchType: 'vector' | 'graph' | 'research';
}

/**
 * A citation referencing a source used in generating the final answer.
 */
export interface SourceCitation {
  /** File path or document path of the cited source. */
  path: string;

  /** Section heading within the source, if applicable. */
  heading: string;

  /**
   * Relevance score of the cited source (0 to 1).
   * Inherited from the highest-scoring chunk from this source.
   */
  relevanceScore: number;

  /**
   * Which retrieval method produced the cited source.
   * @see RetrievedChunk.matchType
   */
  matchType: 'vector' | 'graph' | 'research';
}

/**
 * Aggregated result of the retrieval phase across all active retrieval
 * strategies (vector search, graph traversal, deep research).
 */
export interface RetrievalResult {
  /** Retrieved content chunks, sorted by relevance (highest first). */
  chunks: RetrievedChunk[];

  /**
   * Entities discovered via knowledge graph traversal.
   * Present only when graph retrieval was used (tier >= 2).
   */
  graphEntities?: Array<{ name: string; type: string; description: string }>;

  /**
   * Synthesized narrative from the deep research phase.
   * Present only when research retrieval was used (tier 3).
   */
  researchSynthesis?: string;

  /** Wall-clock duration of the retrieval phase in milliseconds. */
  durationMs: number;
}

// ============================================================================
// CONVERSATION
// ============================================================================

/**
 * A single message in the conversation history.
 * Used for providing conversational context to the classifier and generator.
 */
export interface ConversationMessage {
  /** The role of the message author. */
  role: 'user' | 'assistant';

  /** The text content of the message. */
  content: string;
}

// ============================================================================
// QUERY RESULT
// ============================================================================

/**
 * Final result returned by the QueryRouter after classification, retrieval,
 * and answer generation.
 */
export interface QueryResult {
  /** The generated answer text, grounded in retrieved sources. */
  answer: string;

  /** The classification result that determined routing behaviour. */
  classification: ClassificationResult;

  /** Citations for the sources used in generating the answer. */
  sources: SourceCitation[];

  /** Total wall-clock duration of the entire query pipeline in milliseconds. */
  durationMs: number;

  /**
   * Which tiers were actually exercised during this query.
   * @example [0] for trivial, [1, 2] for multi-source with fallback
   */
  tiersUsed: QueryTier[];

  /**
   * Names of fallback strategies that were activated during this query.
   * Empty array if no fallbacks were needed.
   * @example ['keyword-fallback', 'tier-escalation']
   */
  fallbacksUsed: string[];
}

// ============================================================================
// CONFIGURATION
// ============================================================================

/**
 * Configuration for the QueryRouter pipeline.
 * All fields have sensible defaults documented via `@default` annotations.
 */
export interface QueryRouterConfig {
  /**
   * Minimum confidence threshold for accepting a classification result.
   * If confidence falls below this, the router may escalate to a higher tier.
   * @default 0.6
   */
  confidenceThreshold: number;

  /**
   * Maximum number of vector search results to retrieve per query.
   * @default 10
   */
  maxChunks: number;

  /**
   * Minimum relevance score (0 to 1) for a chunk to be included in results.
   * Chunks below this threshold are discarded.
   * @default 0.25
   */
  minRelevance: number;

  /**
   * Whether to enable GraphRAG-based retrieval for tier >= 2 queries.
   * Requires a configured GraphRAG engine.
   * @default true
   */
  enableGraphRetrieval: boolean;

  /**
   * Whether to enable deep research mode for tier 3 queries.
   * Research mode performs iterative multi-pass retrieval and synthesis.
   * @default true
   */
  enableResearch: boolean;

  /**
   * Maximum number of research iterations for tier 3 queries.
   * Each iteration refines the search based on gaps found in prior passes.
   * @default 3
   */
  maxResearchIterations: number;

  /**
   * Maximum total duration (in milliseconds) allowed for a single query
   * before the router returns whatever partial result is available.
   * @default 30000
   */
  timeoutMs: number;

  /**
   * Vector store collection name used for corpus chunk embeddings.
   * @default 'query_router_corpus'
   */
  collectionName: string;

  /**
   * Embedding model identifier. When undefined, the default model
   * from EmbeddingManager is used.
   * @default undefined
   */
  embeddingModelId?: string;

  /**
   * Whether to enable the keyword fallback strategy when vector
   * retrieval returns insufficient results.
   * @default true
   */
  enableKeywordFallback: boolean;

  /**
   * Number of recent conversation messages to include as context
   * for classification and generation.
   * @default 5
   */
  conversationHistoryLimit: number;

  /**
   * Temperature for the LLM used in answer generation.
   * Lower values produce more deterministic, focused answers.
   * @default 0.3
   */
  generationTemperature: number;

  /**
   * Maximum tokens for the generated answer.
   * @default 2048
   */
  generationMaxTokens: number;
}

/**
 * Default configuration values for the QueryRouter.
 * @see QueryRouterConfig
 */
export const DEFAULT_QUERY_ROUTER_CONFIG: Readonly<QueryRouterConfig> = {
  confidenceThreshold: 0.6,
  maxChunks: 10,
  minRelevance: 0.25,
  enableGraphRetrieval: true,
  enableResearch: true,
  maxResearchIterations: 3,
  timeoutMs: 30_000,
  collectionName: 'query_router_corpus',
  embeddingModelId: undefined,
  enableKeywordFallback: true,
  conversationHistoryLimit: 5,
  generationTemperature: 0.3,
  generationMaxTokens: 2048,
};

// ============================================================================
// EVENTS — Observability lifecycle events
// ============================================================================

/**
 * Emitted when query classification begins.
 */
export interface ClassifyStartEvent {
  type: 'classify:start';
  /** The raw user query being classified. */
  query: string;
  /** Timestamp when classification started. */
  timestamp: number;
}

/**
 * Emitted when query classification completes successfully.
 */
export interface ClassifyCompleteEvent {
  type: 'classify:complete';
  /** The classification result. */
  result: ClassificationResult;
  /** Duration of classification in milliseconds. */
  durationMs: number;
  /** Timestamp when classification completed. */
  timestamp: number;
}

/**
 * Emitted when query classification fails.
 */
export interface ClassifyErrorEvent {
  type: 'classify:error';
  /** The error that caused classification to fail. */
  error: Error;
  /** Timestamp when the error occurred. */
  timestamp: number;
}

/**
 * Emitted when the retrieval phase begins.
 */
export interface RetrieveStartEvent {
  type: 'retrieve:start';
  /** The assigned tier driving retrieval strategy. */
  tier: QueryTier;
  /** Timestamp when retrieval started. */
  timestamp: number;
}

/**
 * Emitted when vector search results are available.
 */
export interface RetrieveVectorEvent {
  type: 'retrieve:vector';
  /** Number of chunks returned by vector search. */
  chunkCount: number;
  /** Duration of vector retrieval in milliseconds. */
  durationMs: number;
  /** Timestamp of the event. */
  timestamp: number;
}

/**
 * Emitted when graph traversal results are available.
 */
export interface RetrieveGraphEvent {
  type: 'retrieve:graph';
  /** Number of entities discovered via graph traversal. */
  entityCount: number;
  /** Duration of graph retrieval in milliseconds. */
  durationMs: number;
  /** Timestamp of the event. */
  timestamp: number;
}

/**
 * Emitted when reranking of retrieved chunks completes.
 */
export interface RetrieveRerankEvent {
  type: 'retrieve:rerank';
  /** Number of chunks before reranking. */
  inputCount: number;
  /** Number of chunks after reranking (may be fewer due to threshold filtering). */
  outputCount: number;
  /** Duration of reranking in milliseconds. */
  durationMs: number;
  /** Timestamp of the event. */
  timestamp: number;
}

/**
 * Emitted when the entire retrieval phase completes.
 */
export interface RetrieveCompleteEvent {
  type: 'retrieve:complete';
  /** The aggregated retrieval result. */
  result: RetrievalResult;
  /** Timestamp when retrieval completed. */
  timestamp: number;
}

/**
 * Emitted when a retrieval fallback strategy is activated.
 */
export interface RetrieveFallbackEvent {
  type: 'retrieve:fallback';
  /** Name of the fallback strategy activated (e.g., 'keyword-fallback'). */
  strategy: string;
  /** Reason the fallback was triggered. */
  reason: string;
  /** Timestamp of the event. */
  timestamp: number;
}

/**
 * Emitted when deep research begins (tier 3 only).
 */
export interface ResearchStartEvent {
  type: 'research:start';
  /** The original query being researched. */
  query: string;
  /** Maximum number of research iterations configured. */
  maxIterations: number;
  /** Timestamp when research started. */
  timestamp: number;
}

/**
 * Emitted after each iteration of the research loop.
 */
export interface ResearchPhaseEvent {
  type: 'research:phase';
  /** Current iteration number (1-based). */
  iteration: number;
  /** Total configured iterations. */
  totalIterations: number;
  /** Number of new chunks discovered in this iteration. */
  newChunksFound: number;
  /** Timestamp of the event. */
  timestamp: number;
}

/**
 * Emitted when deep research completes.
 */
export interface ResearchCompleteEvent {
  type: 'research:complete';
  /** Total number of research iterations performed. */
  iterationsUsed: number;
  /** Total chunks gathered across all iterations. */
  totalChunks: number;
  /** Duration of the research phase in milliseconds. */
  durationMs: number;
  /** Timestamp when research completed. */
  timestamp: number;
}

/**
 * Emitted when answer generation begins.
 */
export interface GenerateStartEvent {
  type: 'generate:start';
  /** Number of context chunks provided to the generator. */
  contextChunkCount: number;
  /** Timestamp when generation started. */
  timestamp: number;
}

/**
 * Emitted when answer generation completes.
 */
export interface GenerateCompleteEvent {
  type: 'generate:complete';
  /** Length of the generated answer in characters. */
  answerLength: number;
  /** Number of source citations in the answer. */
  citationCount: number;
  /** Duration of generation in milliseconds. */
  durationMs: number;
  /** Timestamp when generation completed. */
  timestamp: number;
}

/**
 * Emitted when the entire query routing pipeline completes.
 */
export interface RouteCompleteEvent {
  type: 'route:complete';
  /** The final query result. */
  result: QueryResult;
  /** Total duration of the entire pipeline in milliseconds. */
  durationMs: number;
  /** Timestamp when routing completed. */
  timestamp: number;
}

/**
 * Discriminated union of all QueryRouter lifecycle events.
 * The `type` field serves as the discriminant for exhaustive matching.
 *
 * @example
 * ```typescript
 * function handleEvent(event: QueryRouterEventUnion) {
 *   switch (event.type) {
 *     case 'classify:start':
 *       console.log(`Classifying: ${event.query}`);
 *       break;
 *     case 'retrieve:vector':
 *       console.log(`Vector search returned ${event.chunkCount} chunks`);
 *       break;
 *     case 'route:complete':
 *       console.log(`Done in ${event.durationMs}ms`);
 *       break;
 *   }
 * }
 * ```
 */
export type QueryRouterEventUnion =
  | ClassifyStartEvent
  | ClassifyCompleteEvent
  | ClassifyErrorEvent
  | RetrieveStartEvent
  | RetrieveVectorEvent
  | RetrieveGraphEvent
  | RetrieveRerankEvent
  | RetrieveCompleteEvent
  | RetrieveFallbackEvent
  | ResearchStartEvent
  | ResearchPhaseEvent
  | ResearchCompleteEvent
  | GenerateStartEvent
  | GenerateCompleteEvent
  | RouteCompleteEvent;

// ============================================================================
// CORPUS DATA STRUCTURES
// ============================================================================

/**
 * A chunk of corpus content with optional pre-computed embedding.
 * Used during corpus ingestion into the vector store.
 */
export interface CorpusChunk {
  /** Unique identifier for the chunk. */
  id: string;

  /** The text content of the chunk. */
  content: string;

  /** Section heading or title the chunk belongs to. */
  heading: string;

  /** File path or document source path this chunk was extracted from. */
  sourcePath: string;

  /**
   * Pre-computed embedding vector. When present, the ingestion pipeline
   * can skip embedding generation for this chunk.
   */
  embedding?: number[];
}

/**
 * A topic extracted from a query or document for routing and filtering.
 * Used by the {@link TopicExtractor} to guide retrieval strategy.
 */
export interface TopicEntry {
  /** The topic name or phrase (e.g., "authentication", "database migrations"). */
  name: string;

  /**
   * Where this topic was derived from.
   * @example 'query', 'document', 'graph-entity'
   */
  source: string;
}
