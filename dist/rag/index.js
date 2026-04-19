/**
 * AgentOS RAG (Retrieval Augmented Generation) Module
 *
 * This module provides a complete RAG system for AgentOS including:
 * - Vector store abstractions and implementations
 * - Embedding management with caching
 * - Document ingestion and chunking
 * - Context retrieval and augmentation
 *
 * **Architecture Overview:**
 * ```
 * ┌─────────────────────────────────────────────────────────────────┐
 * │                    RetrievalAugmentor                           │
 * │  (Orchestrates ingestion, retrieval, and document management)  │
 * └─────────────────────────────────────────────────────────────────┘
 *                              │
 *          ┌───────────────────┴───────────────────┐
 *          ▼                                       ▼
 * ┌─────────────────────┐              ┌─────────────────────┐
 * │  EmbeddingManager   │              │ VectorStoreManager  │
 * │  (Embedding gen,    │              │ (Multi-provider     │
 * │   caching, models)  │              │  vector storage)    │
 * └─────────────────────┘              └─────────────────────┘
 *          │                                       │
 *          ▼                                       ▼
 * ┌─────────────────────┐              ┌─────────────────────┐
 * │ AIModelProvider     │              │ IVectorStore        │
 * │ (OpenAI, etc.)      │              │ implementations     │
 * └─────────────────────┘              └─────────────────────┘
 *                                              │
 *                    ┌─────────────────────────┼─────────────────────────┐
 *                    ▼                         ▼                         ▼
 *           ┌───────────────┐         ┌───────────────┐         ┌───────────────┐
 *           │ InMemoryStore │         │ SqlVectorStore│         │ Pinecone/etc  │
 *           │ (dev/testing) │         │ (cross-plat)  │         │ (cloud)       │
 *           └───────────────┘         └───────────────┘         └───────────────┘
 *                                             │
 *                                             ▼
 *                                    @framers/sql-storage-adapter
 *                                    (SQLite/Postgres/IndexedDB)
 * ```
 *
 * @module @framers/agentos/rag
 *
 * @example Basic RAG Setup
 * ```typescript
 * import {
 *   VectorStoreManager,
 *   EmbeddingManager,
 *   RetrievalAugmentor
 * } from '../rag/index.js';
 *
 * // Initialize vector store manager
 * const vectorStoreManager = new VectorStoreManager();
 * await vectorStoreManager.initialize(
 *   {
 *     managerId: 'main-vsm',
 *     providers: [{
 *       id: 'sql-store',
 *       type: 'sql',
 *       storage: { filePath: './vectors.db' }
 *     }],
 *     defaultProviderId: 'sql-store'
 *   },
 *   [{ dataSourceId: 'docs', vectorStoreProviderId: 'sql-store', actualNameInProvider: 'documents' }]
 * );
 *
 * // Initialize embedding manager
 * const embeddingManager = new EmbeddingManager();
 * await embeddingManager.initialize(embeddingConfig, aiProviderManager);
 *
 * // Initialize retrieval augmentor
 * const ragAugmentor = new RetrievalAugmentor();
 * await ragAugmentor.initialize(ragConfig, embeddingManager, vectorStoreManager);
 *
 * // Ingest documents
 * await ragAugmentor.ingestDocuments([
 *   { id: 'doc-1', content: 'Document content here...' }
 * ]);
 *
 * // Retrieve context
 * const result = await ragAugmentor.retrieveContext('What is machine learning?');
 * console.log(result.augmentedContext);
 * ```
 */
// ============================================================================
// Implementations
// ============================================================================
export { VectorStoreManager } from './VectorStoreManager.js';
export { EmbeddingManager } from './EmbeddingManager.js';
export { RetrievalAugmentor } from './RetrievalAugmentor.js';
// HyDE (Hypothetical Document Embedding) Retriever
export { HydeRetriever, DEFAULT_HYDE_CONFIG, resolveHydeConfig, } from './HydeRetriever.js';
// ============================================================================
// Vector Store Implementations
// ============================================================================
export { InMemoryVectorStore } from './vector_stores/InMemoryVectorStore.js';
export { SqlVectorStore } from './vector_stores/SqlVectorStore.js';
export { HnswlibVectorStore } from './vector_stores/HnswlibVectorStore.js';
export { QdrantVectorStore } from './vector_stores/QdrantVectorStore.js';
// ============================================================================
// GraphRAG
// ============================================================================
export { GraphRAGEngine } from '../memory/retrieval/graph/graphrag/index.js';
export { RAGAuditCollector, RAGOperationHandle, } from './audit/index.js';
// ============================================================================
// Multimodal Indexing (images, audio)
// ============================================================================
export { MultimodalIndexer } from './multimodal/index.js';
export { SpeechProviderAdapter } from './multimodal/index.js';
export { LLMVisionAdapter } from './multimodal/index.js';
export { createMultimodalIndexerFromResolver, } from './multimodal/index.js';
// ============================================================================
// Hybrid Search (BM25 + Dense)
// ============================================================================
export { BM25Index } from './search/index.js';
export { HybridSearcher } from './search/index.js';
// ============================================================================
// Semantic Chunking
// ============================================================================
export { SemanticChunker, } from './chunking/index.js';
// ============================================================================
// RAPTOR (Recursive Abstractive Processing for Tree-Organized Retrieval)
// ============================================================================
export { RaptorTree, } from './raptor/index.js';
// ============================================================================
// Unified Retrieval (plan-based orchestrator)
// ============================================================================
export { UnifiedRetriever, buildDefaultPlan } from './unified/index.js';
export { DEFAULT_MEMORY_RETRIEVAL_POLICY, buildRetrievalPlanFromPolicy, getCandidateLimit, resolveMemoryRetrievalPolicy, } from './unified/index.js';
// ============================================================================
// Vector Math Utilities
// ============================================================================
export { cosineSimilarity, dotProduct, euclideanDistance, embeddingToBlob, blobToEmbedding, blobToFloat32, isLegacyJsonBlob, } from './utils/vectorMath.js';
// ============================================================================
// Migration Engine
// ============================================================================
export { PineconeVectorStore } from './vector_stores/PineconeVectorStore.js';
export { MigrationEngine } from './migration/MigrationEngine.js';
// ============================================================================
// Backend Auto-Setup
// ============================================================================
export { DockerDetector } from './setup/DockerDetector.js';
export { QdrantSetup } from './setup/QdrantSetup.js';
export { PostgresSetup } from './setup/PostgresSetup.js';
// Citation verification
export { CitationVerifier } from './citation/index.js';
//# sourceMappingURL=index.js.map