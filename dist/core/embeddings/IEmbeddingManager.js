/**
 * @fileoverview Defines the interface for the EmbeddingManager, responsible for
 * generating vector embeddings for textual content. It outlines the contract for
 * managing various embedding models, orchestrating embedding generation (potentially
 * with caching and dynamic model selection), and providing information about
 * available models.
 *
 * The EmbeddingManager relies on configurations defined in
 * `../config/EmbeddingManagerConfiguration.ts` and interacts with
 * `../core/llm/providers/AIModelProviderManager` to communicate with actual
 * Large Language Model (LLM) providers for embedding generation.
 *
 * @module backend/agentos/core/embeddings/IEmbeddingManager
 * @see ../../config/EmbeddingManagerConfiguration.ts
 * @see ../llm/providers/AIModelProviderManager.ts
 * @see ../../rag/EmbeddingManager.ts for a concrete implementation.
 */
export {};
//# sourceMappingURL=IEmbeddingManager.js.map