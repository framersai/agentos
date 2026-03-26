/**
 * @module rag/multimodal
 *
 * Multimodal RAG (Retrieval Augmented Generation) extension for AgentOS.
 *
 * Extends the text-only RAG pipeline to support indexing and searching
 * across images, audio, video, and PDF content by converting them to text
 * representations (vision LLM descriptions, STT transcripts, PDF text
 * extraction) before embedding into the vector store and cognitive memory.
 *
 * @example
 * ```typescript
 * import {
 *   MultimodalIndexer,
 *   MultimodalMemoryBridge,
 *   type MultimodalSearchResult,
 *   type ContentModality,
 *   type IngestResult,
 * } from '@framers/agentos/rag/multimodal';
 * ```
 */

export { MultimodalIndexer } from './MultimodalIndexer.js';
export { MultimodalMemoryBridge } from './MultimodalMemoryBridge.js';

export type {
  ContentModality,
  ImageIndexOptions,
  ImageIndexResult,
  AudioIndexOptions,
  AudioIndexResult,
  MultimodalSearchOptions,
  MultimodalSearchResult,
  IVisionProvider,
  ISpeechToTextProvider,
  MultimodalIndexerConfig,
} from './types.js';

export type {
  IngestMetadata,
  IngestResult,
  MultimodalBridgeOptions,
} from './MultimodalMemoryBridge.js';
