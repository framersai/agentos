/**
 * @module rag/multimodal/types
 *
 * Type definitions for the multimodal RAG indexing system.
 *
 * The multimodal indexer extends the text-only RAG pipeline to handle
 * non-text content (images, audio) by converting them to text
 * representations (descriptions, transcripts) and embedding those
 * representations into the shared vector store.
 *
 * ## Modality architecture
 *
 * Each indexed document carries a `modality` metadata field:
 * - `'text'` — standard text documents (existing RAG pipeline)
 * - `'image'` — vision LLM-generated descriptions of images
 * - `'audio'` — STT-generated transcripts of audio files
 *
 * During search, results can be filtered by modality or searched
 * across all modalities simultaneously.
 *
 * @see {@link MultimodalIndexer} for the implementation.
 * @see {@link IVectorStore} for the underlying storage.
 * @see {@link IEmbeddingManager} for embedding generation.
 */
export {};
//# sourceMappingURL=types.js.map