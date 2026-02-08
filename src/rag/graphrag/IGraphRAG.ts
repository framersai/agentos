/**
 * @file IGraphRAG.ts
 * @description Interfaces and types for the AgentOS GraphRAG module.
 * Implements Microsoft's GraphRAG concepts (entity extraction, community detection,
 * hierarchical summarization) in pure TypeScript.
 *
 * @module AgentOS/RAG/GraphRAG
 * @version 1.0.0
 */

import type { MetadataValue } from '../IVectorStore.js';

// =============================================================================
// Entity & Relationship Types
// =============================================================================

export interface GraphEntity {
  id: string;
  name: string;
  type: string;
  description: string;
  properties: Record<string, unknown>;
  embedding?: number[];
  sourceDocumentIds: string[];
  /** Frequency count across all source documents */
  frequency: number;
  createdAt: string;
  updatedAt: string;
}

export interface GraphRelationship {
  id: string;
  sourceEntityId: string;
  targetEntityId: string;
  type: string;
  description: string;
  weight: number;
  properties: Record<string, unknown>;
  sourceDocumentIds: string[];
  createdAt: string;
}

// =============================================================================
// Community Types (Leiden/Louvain clustering output)
// =============================================================================

export interface GraphCommunity {
  id: string;
  /** Level in the hierarchy (0 = root, higher = more granular) */
  level: number;
  /** Parent community ID (null for root) */
  parentCommunityId: string | null;
  /** Child community IDs */
  childCommunityIds: string[];
  /** Entity IDs belonging to this community */
  entityIds: string[];
  /** Relationship IDs internal to this community */
  relationshipIds: string[];
  /** LLM-generated summary of this community */
  summary: string;
  /** Key findings extracted from the community */
  findings: string[];
  /** Aggregate importance score */
  importance: number;
  /** Title/label for the community */
  title: string;
  createdAt: string;
}

// =============================================================================
// Extraction Types
// =============================================================================

export interface ExtractionResult {
  entities: GraphEntity[];
  relationships: GraphRelationship[];
  sourceDocumentId: string;
}

export interface EntityExtractionPromptContext {
  text: string;
  entityTypes?: string[];
  language?: string;
}

// =============================================================================
// Search Types
// =============================================================================

export interface GraphRAGSearchOptions {
  /** Maximum number of results */
  topK?: number;
  /** Minimum relevance score (0-1) */
  minRelevance?: number;
  /** Specific community levels to search */
  communityLevels?: number[];
  /** Include entity details in results */
  includeEntities?: boolean;
  /** Include relationship details in results */
  includeRelationships?: boolean;
  /** Metadata filter for source documents */
  metadataFilter?: Record<string, MetadataValue>;
}

export interface GlobalSearchResult {
  query: string;
  /** Aggregated answer from community summaries */
  answer: string;
  /** Community summaries used to generate the answer */
  communitySummaries: Array<{
    communityId: string;
    level: number;
    title: string;
    summary: string;
    relevanceScore: number;
  }>;
  /** Total communities searched */
  totalCommunitiesSearched: number;
  diagnostics?: {
    embeddingTimeMs?: number;
    searchTimeMs?: number;
    synthesisTimeMs?: number;
  };
}

export interface LocalSearchResult {
  query: string;
  /** Direct entity/relationship matches */
  entities: Array<GraphEntity & { relevanceScore: number }>;
  relationships: GraphRelationship[];
  /** Community context for matched entities */
  communityContext: Array<{
    communityId: string;
    title: string;
    summary: string;
    level: number;
  }>;
  /** Assembled context string for LLM consumption */
  augmentedContext: string;
  diagnostics?: {
    embeddingTimeMs?: number;
    searchTimeMs?: number;
    graphTraversalTimeMs?: number;
  };
}

// =============================================================================
// Configuration
// =============================================================================

export interface GraphRAGConfig {
  /** Unique ID for this GraphRAG engine instance */
  engineId: string;
  /** Entity types to extract (e.g., ['person', 'organization', 'concept']) */
  entityTypes?: string[];
  /** Maximum community hierarchy depth */
  maxCommunityLevels?: number;
  /** Minimum community size (entities) before splitting stops */
  minCommunitySize?: number;
  /** Louvain resolution parameter (higher = more communities) */
  communityResolution?: number;
  /** Whether to generate embeddings for entities */
  generateEntityEmbeddings?: boolean;
  /** Embedding model ID to use */
  embeddingModelId?: string;
  /**
   * Embedding dimension for the selected embedding model.
   *
   * Optional: when omitted and an `embeddingManager` is available, the engine will
   * probe the embedding dimension at runtime by generating a tiny embedding once.
   */
  embeddingDimension?: number;
  /** Maximum tokens for community summaries */
  maxSummaryTokens?: number;
  /** Vector store provider ID for entity embeddings */
  vectorStoreProviderId?: string;
  /** Collection name for entity embeddings */
  entityCollectionName?: string;
  /** Collection name for community summary embeddings */
  communityCollectionName?: string;
  /** SQL table prefix for persistence */
  tablePrefix?: string;
}

// =============================================================================
// Engine Interface
// =============================================================================

export interface IGraphRAGEngine {
  /** Initialize the engine with configuration */
  initialize(config: GraphRAGConfig): Promise<void>;

  /**
   * Ingest documents: extract entities/relationships, build graph,
   * detect communities, generate summaries.
   */
  ingestDocuments(
    documents: Array<{ id: string; content: string; metadata?: Record<string, MetadataValue> }>,
  ): Promise<{
    entitiesExtracted: number;
    relationshipsExtracted: number;
    communitiesDetected: number;
    documentsProcessed: number;
  }>;

  /**
   * Remove one or more previously-ingested documents from the graph.
   *
   * This subtracts the document's entity/relationship contributions and recomputes
   * communities. It is used to keep GraphRAG in sync when a source document is
   * deleted or moved out of indexed categories.
   */
  removeDocuments(documentIds: string[]): Promise<{
    documentsRemoved: number;
    communitiesDetected: number;
  }>;

  /**
   * Global search: answers broad questions using community summaries.
   * Best for "What are the main themes?" type questions.
   */
  globalSearch(query: string, options?: GraphRAGSearchOptions): Promise<GlobalSearchResult>;

  /**
   * Local search: finds specific entities and their context.
   * Best for "Tell me about X" type questions.
   */
  localSearch(query: string, options?: GraphRAGSearchOptions): Promise<LocalSearchResult>;

  /** Get all entities */
  getEntities(options?: { type?: string; limit?: number }): Promise<GraphEntity[]>;

  /** Get all relationships for an entity */
  getRelationships(entityId: string): Promise<GraphRelationship[]>;

  /** Get community hierarchy */
  getCommunities(level?: number): Promise<GraphCommunity[]>;

  /** Get statistics */
  getStats(): Promise<{
    totalEntities: number;
    totalRelationships: number;
    totalCommunities: number;
    communityLevels: number;
    documentsIngested: number;
  }>;

  /** Clear all data */
  clear(): Promise<void>;

  /** Shutdown and cleanup */
  shutdown(): Promise<void>;
}
