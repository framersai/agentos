/**
 * GraphRAG Module
 *
 * TypeScript-native GraphRAG implementation for AgentOS.
 * Provides entity extraction, community detection (Louvain), hierarchical
 * summarization, and global/local search.
 *
 * @module AgentOS/RAG/GraphRAG
 */

export { GraphRAGEngine } from './GraphRAGEngine.js';

export type {
  IGraphRAGEngine,
  GraphRAGConfig,
  GraphEntity,
  GraphRelationship,
  GraphCommunity,
  GraphRAGSearchOptions,
  GlobalSearchResult,
  LocalSearchResult,
  ExtractionResult,
} from './IGraphRAG.js';
