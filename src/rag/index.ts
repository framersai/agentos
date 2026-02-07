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
 * } from '@framers/agentos/rag';
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
// Interfaces
// ============================================================================

export type {
  IVectorStore,
  VectorStoreProviderConfig,
  VectorDocument,
  RetrievedVectorDocument,
  QueryOptions,
  QueryResult,
  UpsertOptions,
  UpsertResult,
  DeleteOptions,
  DeleteResult,
  CreateCollectionOptions,
  MetadataFilter,
  MetadataValue,
  MetadataFieldCondition,
  MetadataScalarValue,
} from './IVectorStore.js';

export type {
  IVectorStoreManager,
  VectorStoreManagerHealthReport,
} from './IVectorStoreManager.js';

export type {
  IEmbeddingManager,
  EmbeddingRequest,
  EmbeddingResponse,
} from './IEmbeddingManager.js';

export type {
  IRetrievalAugmentor,
  RagDocumentInput,
  RagIngestionOptions,
  RagIngestionResult,
  RagRetrievalOptions,
  RagRetrievalResult,
  RagRetrievedChunk,
  RagRetrievalDiagnostics,
  RagMemoryCategory,
} from './IRetrievalAugmentor.js';

// ============================================================================
// Implementations
// ============================================================================

export { VectorStoreManager } from './VectorStoreManager.js';
export { EmbeddingManager } from './EmbeddingManager.js';
export { RetrievalAugmentor } from './RetrievalAugmentor.js';

// ============================================================================
// Vector Store Implementations
// ============================================================================

export { InMemoryVectorStore } from './implementations/vector_stores/InMemoryVectorStore.js';
export { SqlVectorStore, type SqlVectorStoreConfig } from './implementations/vector_stores/SqlVectorStore.js';
export { HnswlibVectorStore, type HnswlibVectorStoreConfig } from './implementations/vector_stores/HnswlibVectorStore.js';

// ============================================================================
// GraphRAG
// ============================================================================

export { GraphRAGEngine } from './graphrag/index.js';
export type {
  IGraphRAGEngine,
  GraphRAGConfig,
  GraphEntity,
  GraphRelationship,
  GraphCommunity,
  GraphRAGSearchOptions,
  GlobalSearchResult,
  LocalSearchResult,
} from './graphrag/index.js';


