/**
 * @module rag/multimodal
 *
 * Multimodal RAG (Retrieval Augmented Generation) extension for AgentOS.
 *
 * Extends the text-only RAG pipeline to support indexing and searching
 * across images and audio content by converting them to text representations
 * (vision LLM descriptions and STT transcripts) before embedding.
 *
 * @example
 * ```typescript
 * import {
 *   MultimodalIndexer,
 *   type MultimodalSearchResult,
 *   type ContentModality,
 * } from '@framers/agentos/rag/multimodal';
 * ```
 */

export { MultimodalIndexer } from './MultimodalIndexer.js';

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
