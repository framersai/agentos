/**
 * @fileoverview Types for RAG audit trails — full transparency on memory/RAG operations.
 * Captures per-operation details (vector search, graph search, reranking, embeddings)
 * with token usage, cost tracking, and source attribution.
 * @module @framers/agentos/rag/audit
 */

/** A single RAG operation within a request pipeline. */
export interface RAGOperationEntry {
  operationId: string;
  operationType:
    | 'vector_query'
    | 'graph_local'
    | 'graph_global'
    | 'ingest'
    | 'rerank'
    | 'embedding';

  /** ISO 8601 timestamp when the operation started. */
  startedAt: string;
  /** Duration in milliseconds. */
  durationMs: number;

  /** Retrieval strategy details (for vector_query operations). */
  retrievalMethod?: {
    strategy: 'similarity' | 'mmr' | 'hybrid';
    hybridAlpha?: number;
    topK?: number;
    mmrLambda?: number;
  };

  /** Source documents/chunks that contributed to this operation's results. */
  sources: RAGSourceAttribution[];

  /** Token usage breakdown for this operation. */
  tokenUsage: {
    embeddingTokens: number;
    llmPromptTokens: number;
    llmCompletionTokens: number;
    totalTokens: number;
  };

  /** Estimated cost in USD for this operation. */
  costUSD: number;

  /** Number of results returned by this operation. */
  resultsCount: number;

  /** Relevance score statistics across results. */
  relevanceScores?: { min: number; max: number; avg: number };

  /** Data source IDs queried by this operation. */
  dataSourceIds?: string[];

  /** Collection IDs involved in this operation. */
  collectionIds?: string[];

  /** Graph-specific details (for graph_local / graph_global operations). */
  graphDetails?: {
    entitiesMatched: number;
    communitiesSearched: number;
    traversalTimeMs: number;
  };

  /** Reranking-specific details (for rerank operations). */
  rerankDetails?: {
    providerId: string;
    modelId: string;
    documentsReranked: number;
  };
}

/** Attribution to a specific source document/chunk. */
export interface RAGSourceAttribution {
  chunkId: string;
  documentId: string;
  /** Original source pointer (URL, file path, etc.). */
  source?: string;
  /** First 200 characters of chunk content. */
  contentSnippet: string;
  /** Similarity/relevance score (0–1). */
  relevanceScore: number;
  /** Data source / collection this chunk came from. */
  dataSourceId?: string;
  /** Chunk metadata. */
  metadata?: Record<string, unknown>;
}

/** Aggregated audit trail for a complete RAG request. */
export interface RAGAuditTrail {
  trailId: string;
  /** Correlates with the conversation turn or API request. */
  requestId: string;
  /** Wunderland agent seed ID. */
  seedId?: string;
  /** Conversation session ID. */
  sessionId?: string;
  /** The user query that triggered RAG. */
  query: string;
  /** ISO 8601 timestamp. */
  timestamp: string;

  /** Per-operation breakdown. */
  operations: RAGOperationEntry[];

  /** Aggregated summary across all operations. */
  summary: {
    totalOperations: number;
    totalLLMCalls: number;
    totalEmbeddingCalls: number;
    totalTokens: number;
    totalPromptTokens: number;
    totalCompletionTokens: number;
    totalEmbeddingTokens: number;
    totalCostUSD: number;
    totalDurationMs: number;
    /** Unique operation types used (e.g. ['embedding', 'vector_query', 'rerank']). */
    operationTypes: string[];
    sourceSummary: {
      uniqueDocuments: number;
      uniqueCollections: number;
      uniqueDataSources: number;
    };
  };
}
