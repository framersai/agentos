/**
 * @module rag/multimodal/MultimodalIndexer
 *
 * Indexes non-text content (images, audio) into the RAG vector store by
 * generating text representations and embedding them. This bridges the gap
 * between multimodal content and the text-embedding pipeline, enabling
 * cross-modal semantic search.
 *
 * ## Architecture
 *
 * ```
 *   Image ──► Vision LLM ──► Description ──► Embedding ──► Vector Store
 *   Audio ──► STT Provider ──► Transcript ──► Embedding ──► Vector Store
 *   Text ─────────────────────────────────► Embedding ──► Vector Store
 *                                                               │
 *   Query ─────────────────────────────────► Embedding ──► Search ◄──┘
 * ```
 *
 * Each indexed document carries a `modality` metadata field ('text', 'image',
 * or 'audio') enabling modality-filtered search.
 *
 * ## Dependencies
 *
 * The indexer receives its dependencies via constructor injection:
 * - {@link IEmbeddingManager} — generates vector embeddings from text
 * - {@link IVectorStore} — stores and queries document embeddings
 * - {@link IVisionProvider} — describes images as text (optional, required for images)
 * - {@link ISpeechToTextProvider} — transcribes audio to text (optional, required for audio)
 *
 * This decoupled design allows swapping vision (GPT-4o, Gemini, LLaVA)
 * or STT (Whisper, Deepgram, AssemblyAI) providers without touching the
 * indexer logic.
 *
 * @see {@link ContentModality} for supported modalities.
 * @see {@link MultimodalSearchResult} for search result shape.
 * @see {@link RetrievalAugmentor} for the text-only RAG pipeline.
 */
import type { IEmbeddingManager } from '../IEmbeddingManager.js';
import type { IVectorStore } from '../IVectorStore.js';
import type { ImageIndexOptions, ImageIndexResult, AudioIndexOptions, AudioIndexResult, MultimodalSearchOptions, MultimodalSearchResult, IVisionProvider, ISpeechToTextProvider, MultimodalIndexerConfig } from './types.js';
import type { VisionPipeline } from '../../vision/VisionPipeline.js';
import type { HydeRetriever } from '../HydeRetriever.js';
/**
 * Indexes non-text content (images, audio) into the vector store by
 * generating text descriptions and embeddings.
 *
 * ## Image indexing flow
 * 1. If the image is a Buffer, convert to base64 data URL.
 * 2. Send to the vision LLM to generate a text description.
 * 3. Embed the description via the embedding manager.
 * 4. Store in the vector store with `modality: 'image'` metadata.
 *
 * ## Audio indexing flow
 * 1. Send the audio buffer to the STT provider for transcription.
 * 2. Embed the transcript via the embedding manager.
 * 3. Store in the vector store with `modality: 'audio'` metadata.
 *
 * ## Cross-modal search
 * 1. Embed the text query via the embedding manager.
 * 2. Query the vector store with optional modality filters.
 * 3. Return results annotated with their source modality.
 *
 * @example
 * ```typescript
 * import { MultimodalIndexer } from '../../rag/multimodal';
 *
 * const indexer = new MultimodalIndexer({
 *   embeddingManager,
 *   vectorStore,
 *   visionProvider,
 *   sttProvider,
 * });
 *
 * // Index an image
 * const imgResult = await indexer.indexImage({
 *   image: fs.readFileSync('./photo.jpg'),
 *   metadata: { source: 'upload' },
 * });
 *
 * // Index audio
 * const audioResult = await indexer.indexAudio({
 *   audio: fs.readFileSync('./meeting.wav'),
 *   language: 'en',
 * });
 *
 * // Search across all modalities
 * const results = await indexer.search('cats on a beach');
 * ```
 */
export declare class MultimodalIndexer {
    /** Embedding manager for generating vector representations. */
    private readonly _embeddingManager;
    /** Vector store for persistent document storage and search. */
    private readonly _vectorStore;
    /**
     * Vision LLM provider for generating image descriptions.
     * Optional — an error is thrown if image indexing is attempted without it.
     */
    private readonly _visionProvider?;
    /**
     * Speech-to-text provider for transcribing audio.
     * Optional — an error is thrown if audio indexing is attempted without it.
     */
    private readonly _sttProvider?;
    /** Resolved configuration. */
    private readonly _config;
    /**
     * Optional HyDE retriever for hypothesis-driven multimodal search.
     *
     * When set, the `search()` method can accept `hyde: { enabled: true }`
     * in its options to embed a hypothetical answer instead of the raw query,
     * improving recall for exploratory or vague queries.
     *
     * @see HydeRetriever
     */
    private _hydeRetriever?;
    /**
     * Create a new multimodal indexer.
     *
     * @param deps - Dependency injection container.
     * @param deps.embeddingManager - Manager for generating text embeddings.
     * @param deps.vectorStore - Vector store for document storage and search.
     * @param deps.visionProvider - Optional vision LLM for image description.
     * @param deps.visionPipeline - Optional full vision pipeline with OCR, handwriting,
     *   document understanding, CLIP embeddings, and cloud fallback. When provided,
     *   it is wrapped as an `IVisionProvider` via `PipelineVisionProvider`,
     *   overriding any `visionProvider` passed alongside it.
     * @param deps.sttProvider - Optional STT provider for audio transcription.
     * @param deps.config - Optional configuration overrides.
     *
     * @throws {Error} If embeddingManager or vectorStore is missing.
     *
     * @example
     * ```typescript
     * // With a simple vision LLM provider
     * const indexer = new MultimodalIndexer({
     *   embeddingManager,
     *   vectorStore,
     *   visionProvider: myVisionLLM,
     *   sttProvider: myWhisperService,
     *   config: { defaultCollection: 'knowledge' },
     * });
     *
     * // With the full vision pipeline (recommended)
     * const indexer = new MultimodalIndexer({
     *   embeddingManager,
     *   vectorStore,
     *   visionPipeline: myVisionPipeline,
     * });
     * ```
     */
    constructor(deps: {
        embeddingManager: IEmbeddingManager;
        vectorStore: IVectorStore;
        visionProvider?: IVisionProvider;
        visionPipeline?: VisionPipeline;
        sttProvider?: ISpeechToTextProvider;
        config?: MultimodalIndexerConfig;
    });
    /**
     * Attach a HyDE retriever to enable hypothesis-driven multimodal search.
     *
     * Once set, pass `hyde: { enabled: true }` in the `search()` options to
     * activate HyDE for that query. The retriever generates a hypothetical
     * answer using an LLM, then embeds that answer instead of the raw query
     * text, which typically yields better recall for exploratory queries.
     *
     * @param retriever - A pre-configured HydeRetriever instance.
     *
     * @example
     * ```typescript
     * indexer.setHydeRetriever(new HydeRetriever({
     *   llmCaller: myLlmCaller,
     *   embeddingManager: myEmbeddingManager,
     *   config: { enabled: true },
     * }));
     *
     * const results = await indexer.search('cats on a beach', {
     *   hyde: { enabled: true },
     * });
     * ```
     */
    setHydeRetriever(retriever: HydeRetriever): void;
    /**
     * Index an image by generating a text description via vision LLM,
     * then embedding and storing the description.
     *
     * @param opts - Image data, metadata, and collection options.
     * @returns The document ID and generated description.
     *
     * @throws {Error} If no vision provider is configured.
     * @throws {Error} If the vision LLM fails to describe the image.
     * @throws {Error} If embedding generation or vector store upsert fails.
     *
     * @example
     * ```typescript
     * const result = await indexer.indexImage({
     *   image: 'https://example.com/photo.jpg',
     *   metadata: { source: 'web-scrape', url: 'https://example.com' },
     * });
     * console.log(result.description); // "A golden retriever playing fetch..."
     * ```
     */
    indexImage(opts: ImageIndexOptions): Promise<ImageIndexResult>;
    /**
     * Index an audio file by transcribing via STT, then embedding and
     * storing the transcript.
     *
     * @param opts - Audio data, metadata, collection, and language options.
     * @returns The document ID and generated transcript.
     *
     * @throws {Error} If no STT provider is configured.
     * @throws {Error} If the STT provider fails to transcribe.
     * @throws {Error} If embedding generation or vector store upsert fails.
     *
     * @example
     * ```typescript
     * const result = await indexer.indexAudio({
     *   audio: fs.readFileSync('./podcast.mp3'),
     *   metadata: { source: 'podcast', episode: 42 },
     *   language: 'en',
     * });
     * console.log(result.transcript); // "Welcome to episode 42..."
     * ```
     */
    indexAudio(opts: AudioIndexOptions): Promise<AudioIndexResult>;
    /**
     * Search across all modalities (text + image descriptions + audio transcripts).
     *
     * The query text is embedded, then the vector store is searched with
     * optional modality filtering. Results are returned with their source
     * modality indicated.
     *
     * @param query - Natural language search query.
     * @param opts - Optional search parameters (topK, modalities, collection).
     * @returns Array of search results sorted by relevance score (descending).
     *
     * @throws {Error} If embedding generation fails.
     *
     * @example
     * ```typescript
     * // Search only image descriptions
     * const imageResults = await indexer.search('cats playing', {
     *   modalities: ['image'],
     *   topK: 10,
     * });
     *
     * // Search across all modalities
     * const allResults = await indexer.search('machine learning tutorial');
     * ```
     */
    search(query: string, opts?: MultimodalSearchOptions): Promise<MultimodalSearchResult[]>;
    /**
     * Create a `MultimodalMemoryBridge` using this indexer's providers.
     *
     * The bridge extends this indexer's RAG capabilities with cognitive memory
     * integration, enabling multimodal content to be stored in both the vector
     * store (for search) and long-term memory (for recall during conversation).
     *
     * @param memoryManager - Optional cognitive memory manager for memory trace creation.
     *   When omitted, the bridge still indexes into RAG but creates no memory traces.
     * @param options - Bridge configuration overrides (mood, chunk sizes, etc.)
     * @returns A configured multimodal memory bridge instance.
     *
     * @example
     * ```typescript
     * const bridge = indexer.createMemoryBridge(memoryManager, {
     *   enableMemory: true,
     *   defaultChunkSize: 800,
     * });
     *
     * await bridge.ingestImage(imageBuffer, { source: 'user-upload' });
     * ```
     *
     * See `MultimodalMemoryBridge` for full documentation.
     */
    createMemoryBridge(memoryManager?: import('../../memory/CognitiveMemoryManager.js').ICognitiveMemoryManager, options?: import('./MultimodalMemoryBridge.js').MultimodalBridgeOptions): import('./MultimodalMemoryBridge.js').MultimodalMemoryBridge;
}
//# sourceMappingURL=MultimodalIndexer.d.ts.map