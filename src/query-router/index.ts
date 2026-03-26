/**
 * AgentOS QueryRouter Module
 *
 * Intelligent query routing pipeline that classifies incoming queries by
 * complexity, retrieves relevant context from vector stores and knowledge
 * graphs, and generates grounded answers with source citations.
 *
 * **Architecture Overview:**
 * ```
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │                         QueryRouter                                 │
 * │  (Orchestrates classification, retrieval, and answer generation)    │
 * └─────────────────────────────────────────────────────────────────────┘
 *                              │
 *        ┌─────────────────────┼─────────────────────┐
 *        ▼                     ▼                     ▼
 * ┌──────────────┐   ┌─────────────────┐   ┌─────────────────┐
 * │ QueryClassi- │   │ QueryDispatcher │   │ QueryGenerator  │
 * │ fier (tier   │   │ (retrieval      │   │ (LLM answer     │
 * │ assignment)  │   │  orchestration) │   │  generation)    │
 * └──────────────┘   └─────────────────┘   └─────────────────┘
 *                            │
 *          ┌─────────────────┼─────────────────┐
 *          ▼                 ▼                 ▼
 * ┌───────────────┐ ┌───────────────┐ ┌───────────────┐
 * │ Vector Search │ │ Graph Search  │ │ Keyword       │
 * │ (IVectorStore)│ │ (GraphRAG)    │ │ Fallback      │
 * └───────────────┘ └───────────────┘ └───────────────┘
 * ```
 *
 * @module @framers/agentos/query-router
 */

// ============================================================================
// Types
// ============================================================================

export * from './types.js';

// ============================================================================
// Core Components
// ============================================================================

export { QueryClassifier } from './QueryClassifier.js';
export { QueryDispatcher } from './QueryDispatcher.js';
export { QueryGenerator } from './QueryGenerator.js';
export { QueryRouter } from './QueryRouter.js';
export { TopicExtractor } from './TopicExtractor.js';
export { KeywordFallback } from './KeywordFallback.js';
