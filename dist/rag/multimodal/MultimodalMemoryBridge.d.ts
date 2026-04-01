/**
 * @module rag/multimodal/MultimodalMemoryBridge
 *
 * Bridges multimodal content (images, audio, video, PDFs) into both
 * the RAG vector store AND the cognitive memory system.
 *
 * Without this bridge, multimodal content only exists in RAG search.
 * With it, agents can form long-term memories from visual/audio content
 * and recall them during conversation — enabling genuine multimodal recall.
 *
 * ## Architecture
 *
 * ```
 *   Image ──► Vision LLM ──► Description ──┬──► RAG Vector Store
 *                                           └──► Cognitive Memory (semantic trace)
 *
 *   Audio ──► STT ──► Transcript ──┬──► RAG Vector Store
 *                                  └──► Cognitive Memory (episodic trace)
 *
 *   Video ──► ffmpeg (frames + audio) ──► Vision + STT ──┬──► RAG Vector Store
 *                                                        └──► Cognitive Memory
 *
 *   PDF ──► Text extraction + chunking ──┬──► RAG Vector Store (per-chunk)
 *                                        └──► Cognitive Memory (semantic trace)
 * ```
 *
 * ## Dependencies
 *
 * - {@link MultimodalIndexer} — handles vision/STT → embedding → vector store
 * - {@link ICognitiveMemoryManager} — (optional) encodes traces into long-term memory
 *
 * When no memory manager is provided, content is still indexed into RAG
 * but no memory traces are created. This makes the bridge usable in
 * configurations where cognitive memory is disabled.
 *
 * @see {@link MultimodalIndexer} for the underlying RAG indexing.
 * @see {@link ICognitiveMemoryManager} for the memory encoding interface.
 *
 * @example
 * ```typescript
 * const bridge = new MultimodalMemoryBridge(indexer, memoryManager);
 *
 * // Image → vision description → RAG index + episodic memory
 * await bridge.ingestImage(imageBuffer, { source: 'user-upload' });
 *
 * // Audio → transcript → RAG index + episodic memory
 * await bridge.ingestAudio(audioBuffer, { language: 'en' });
 *
 * // Video → frame extraction + audio → RAG index + memory
 * await bridge.ingestVideo(videoBuffer, { extractFrames: true });
 *
 * // PDF → text + embedded images → RAG index + memory
 * await bridge.ingestPDF(pdfBuffer, { extractImages: true });
 * ```
 */
import type { MultimodalIndexer } from './MultimodalIndexer.js';
import type { ICognitiveMemoryManager } from '../../memory/CognitiveMemoryManager.js';
import type { PADState } from '../../memory/core/config.js';
/**
 * Metadata attached to ingested content for both RAG and memory storage.
 *
 * Common fields like `source` and `tags` are strongly typed; additional
 * arbitrary metadata can be passed via the index signature.
 *
 * @example
 * ```typescript
 * const meta: IngestMetadata = {
 *   source: 'user-upload',
 *   tags: ['meeting', 'Q4'],
 *   collection: 'project-notes',
 *   meetingDate: '2025-12-01',
 * };
 * ```
 */
export interface IngestMetadata {
    /** Where the content originated (e.g. 'user-upload', 'web-scrape') */
    source?: string;
    /** Tags for categorization and filtering */
    tags?: string[];
    /** Vector store collection to index into */
    collection?: string;
    /** Arbitrary additional metadata */
    [key: string]: unknown;
}
/**
 * Result returned after ingesting multimodal content.
 *
 * Contains IDs for both the RAG documents and memory traces created,
 * plus the extracted text and processing details for transparency.
 *
 * @example
 * ```typescript
 * const result = await bridge.ingestImage(buf, { source: 'camera' });
 * console.log(result.ragDocumentIds);   // ['uuid-1']
 * console.log(result.memoryTraceIds);   // ['trace-uuid-1']
 * console.log(result.extractedText);    // 'A cat sitting on a keyboard...'
 * ```
 */
export interface IngestResult {
    /** IDs of documents created in RAG vector store */
    ragDocumentIds: string[];
    /** IDs of memory traces created (empty if no memory manager) */
    memoryTraceIds: string[];
    /** Content type detected or specified */
    contentType: 'image' | 'audio' | 'video' | 'pdf' | 'text';
    /** Text extracted from the content (description, transcript, or raw text) */
    extractedText: string;
    /** Processing details for each modality */
    details: {
        /** Vision LLM descriptions (for images and video frames) */
        visionDescriptions?: string[];
        /** Audio transcript (for audio and video) */
        audioTranscript?: string;
        /** Number of pages (for PDFs) */
        pageCount?: number;
        /** Number of frames extracted (for video) */
        frameCount?: number;
        /** Number of embedded images extracted (for PDFs) */
        embeddedImages?: number;
    };
}
/**
 * Configuration options for the multimodal memory bridge.
 *
 * @example
 * ```typescript
 * const bridge = new MultimodalMemoryBridge(indexer, memMgr, {
 *   enableMemory: true,
 *   defaultMood: { valence: 0, arousal: 0.3, dominance: 0 },
 *   defaultChunkSize: 800,
 * });
 * ```
 */
export interface MultimodalBridgeOptions {
    /**
     * Default mood for memory encoding (PAD model).
     * Used when no mood context is available from the conversation.
     * Neutral mood by default: { valence: 0, arousal: 0.3, dominance: 0 }
     */
    defaultMood?: PADState;
    /**
     * Whether to create memory traces (requires memoryManager).
     * When false or when no memoryManager is provided, only RAG indexing occurs.
     * @default true
     */
    enableMemory?: boolean;
    /**
     * Default chunk size in characters for text splitting (PDF ingestion).
     * @default 1000
     */
    defaultChunkSize?: number;
    /**
     * Default overlap in characters between adjacent text chunks.
     * Ensures context continuity across chunk boundaries.
     * @default 200
     */
    defaultChunkOverlap?: number;
}
/**
 * Bridges multimodal content (images, audio, video, PDFs) into both
 * the RAG vector store AND the cognitive memory system.
 *
 * Without this bridge, multimodal content only exists in RAG search.
 * With it, agents can form long-term memories from visual/audio content
 * and recall them during conversation.
 *
 * The bridge delegates RAG indexing to the existing {@link MultimodalIndexer}
 * and memory encoding to the {@link ICognitiveMemoryManager}. It adds:
 *
 * - **Video support**: frame extraction via ffmpeg + audio track transcription
 * - **PDF support**: text extraction + optional embedded image descriptions
 * - **Unified ingest()**: auto-detects content type from magic bytes or extension
 * - **Dual-write**: every piece of content enters both RAG and long-term memory
 *
 * @example
 * ```typescript
 * const bridge = new MultimodalMemoryBridge(indexer, memoryManager);
 *
 * // Image → vision description → RAG index + semantic memory
 * await bridge.ingestImage(imageBuffer, { source: 'user-upload' });
 *
 * // Audio → transcript → RAG index + episodic memory
 * await bridge.ingestAudio(audioBuffer, { language: 'en' });
 *
 * // Video → frame extraction + audio → RAG index + memory
 * await bridge.ingestVideo(videoBuffer, { extractFrames: true });
 *
 * // PDF → text + embedded images → RAG index + memory
 * await bridge.ingestPDF(pdfBuffer, { extractImages: true });
 * ```
 */
export declare class MultimodalMemoryBridge {
    /** The RAG indexer that handles vision/STT and vector store writes. */
    private readonly _indexer;
    /** Optional cognitive memory manager for long-term memory encoding. */
    private readonly _memoryManager?;
    /** Resolved configuration with defaults applied. */
    private readonly _options;
    /**
     * Create a new multimodal memory bridge.
     *
     * @param indexer - The multimodal indexer for RAG vector store operations
     * @param memoryManager - Optional cognitive memory manager for memory trace creation
     * @param options - Bridge configuration overrides
     *
     * @throws {Error} If indexer is not provided
     *
     * @example
     * ```typescript
     * const bridge = new MultimodalMemoryBridge(
     *   indexer,
     *   memoryManager,
     *   { enableMemory: true, defaultChunkSize: 800 }
     * );
     * ```
     */
    constructor(indexer: MultimodalIndexer, memoryManager?: ICognitiveMemoryManager, options?: MultimodalBridgeOptions);
    /**
     * Ingest an image into both RAG and memory.
     *
     * Processing pipeline:
     * 1. Vision LLM generates a text description of the image
     * 2. Description is embedded into the RAG vector store via the indexer
     * 3. If memory is enabled, description is encoded as a semantic memory trace
     *    (factual knowledge derived from visual input)
     *
     * @param image - Image as a URL string or Buffer
     * @param metadata - Optional metadata for categorization and filtering
     * @returns Ingest result with RAG document IDs and memory trace IDs
     *
     * @throws {Error} If the underlying indexer has no vision provider
     * @throws {Error} If the vision LLM returns an empty description
     *
     * @example
     * ```typescript
     * const result = await bridge.ingestImage(
     *   fs.readFileSync('./photo.jpg'),
     *   { source: 'camera', tags: ['landscape'] }
     * );
     * console.log(result.extractedText); // 'Mountains at sunset with...'
     * ```
     */
    ingestImage(image: string | Buffer, metadata?: IngestMetadata): Promise<IngestResult>;
    /**
     * Ingest audio into both RAG and memory.
     *
     * Processing pipeline:
     * 1. STT provider transcribes the audio to text
     * 2. Transcript is embedded into the RAG vector store via the indexer
     * 3. If memory is enabled, transcript is encoded as an episodic memory trace
     *    (audio represents a time-bound event or conversation)
     *
     * @param audio - Audio data as a Buffer (WAV, MP3, OGG, etc.)
     * @param metadata - Optional metadata; `language` provides a BCP-47 hint to STT
     * @returns Ingest result with RAG document IDs and memory trace IDs
     *
     * @throws {Error} If the underlying indexer has no STT provider
     * @throws {Error} If the STT provider returns an empty transcript
     *
     * @example
     * ```typescript
     * const result = await bridge.ingestAudio(
     *   audioBuffer,
     *   { source: 'meeting-recording', language: 'en' }
     * );
     * console.log(result.details.audioTranscript);
     * ```
     */
    ingestAudio(audio: Buffer, metadata?: IngestMetadata & {
        language?: string;
    }): Promise<IngestResult>;
    /**
     * Ingest a video into both RAG and memory.
     *
     * Processing pipeline:
     * 1. Extract audio track → transcribe via STT
     * 2. Extract keyframes at intervals → describe via vision LLM
     * 3. Combine transcript + frame descriptions into a unified text
     * 4. Index combined text in RAG + encode as episodic memory
     *
     * NOTE: Video frame extraction uses ffprobe/ffmpeg if available.
     * If ffmpeg is NOT installed, the bridge falls back to audio-only
     * extraction from the raw buffer (limited to common containers like
     * MP4). A warning is logged recommending ffmpeg for full video support.
     *
     * @param video - Video data as a Buffer
     * @param metadata - Optional metadata; includes video-specific options
     * @param metadata.extractFrames - Extract keyframes for vision analysis (default: true)
     * @param metadata.frameIntervalSec - Seconds between extracted frames (default: 10)
     * @param metadata.extractAudio - Extract and transcribe audio track (default: true)
     * @returns Ingest result with all extracted content
     *
     * @example
     * ```typescript
     * const result = await bridge.ingestVideo(videoBuffer, {
     *   extractFrames: true,
     *   frameIntervalSec: 5,
     *   source: 'screen-recording',
     * });
     * console.log(result.details.frameCount);     // 12
     * console.log(result.details.audioTranscript); // 'Welcome to...'
     * ```
     */
    ingestVideo(video: Buffer, metadata?: IngestMetadata & {
        extractFrames?: boolean;
        frameIntervalSec?: number;
        extractAudio?: boolean;
    }): Promise<IngestResult>;
    /**
     * Ingest a PDF into both RAG and memory.
     *
     * Processing pipeline:
     * 1. Extract text content from the PDF (page by page)
     * 2. Optionally extract embedded images and describe via vision LLM
     * 3. Chunk text into segments based on configured chunk size/overlap
     * 4. Index each chunk in RAG as a separate document
     * 5. Encode the combined text as a semantic memory trace
     *
     * Uses dynamic import of `pdf-parse` if available for robust extraction.
     * Falls back to regex-based raw text extraction from the PDF buffer
     * (limited but works for text-heavy PDFs without complex encoding).
     *
     * @param pdf - PDF file data as a Buffer
     * @param metadata - Optional metadata; includes PDF-specific options
     * @param metadata.extractImages - Extract embedded images for vision analysis (default: false)
     * @param metadata.chunkSize - Characters per text chunk (default: 1000)
     * @param metadata.chunkOverlap - Overlap between chunks (default: 200)
     * @returns Ingest result with all extracted content
     *
     * @throws {Error} If no text can be extracted from the PDF
     *
     * @example
     * ```typescript
     * const result = await bridge.ingestPDF(pdfBuffer, {
     *   extractImages: true,
     *   chunkSize: 500,
     *   source: 'research-paper',
     * });
     * console.log(result.details.pageCount); // 12
     * ```
     */
    ingestPDF(pdf: Buffer, metadata?: IngestMetadata & {
        extractImages?: boolean;
        chunkSize?: number;
        chunkOverlap?: number;
    }): Promise<IngestResult>;
    /**
     * Auto-detect content type and route to the correct handler.
     *
     * Detection priority:
     * 1. Explicit `mimeType` if provided
     * 2. File extension from `fileName` if provided
     * 3. Magic bytes from the buffer header
     *
     * @param content - Raw content buffer
     * @param options - Detection hints and metadata
     * @param options.fileName - Original file name for extension-based detection
     * @param options.mimeType - Explicit MIME type override
     * @param options.metadata - Metadata to pass through to the handler
     * @returns Ingest result from the appropriate handler
     *
     * @throws {Error} If content type cannot be determined
     * @throws {Error} If the detected content type is unsupported
     *
     * @example
     * ```typescript
     * // Auto-detect from file name
     * const result = await bridge.ingest(buffer, {
     *   fileName: 'presentation.pdf',
     *   metadata: { source: 'email-attachment' },
     * });
     *
     * // Auto-detect from magic bytes
     * const result2 = await bridge.ingest(buffer, {});
     * ```
     */
    ingest(content: Buffer, options: {
        fileName?: string;
        mimeType?: string;
        metadata?: IngestMetadata;
    }): Promise<IngestResult>;
    /**
     * Ingest raw text into memory only (no RAG — the standard pipeline handles that).
     *
     * @param text - Raw text content
     * @param metadata - Optional metadata
     * @returns Ingest result with memory trace IDs only
     */
    private _ingestText;
    /**
     * Encode text into a cognitive memory trace if memory is enabled.
     *
     * Uses the ICognitiveMemoryManager.encode() method which creates a
     * proper MemoryTrace with emotional context, decay parameters, etc.
     *
     * @param text - Text content to encode as a memory trace
     * @param type - Memory type (semantic for factual, episodic for events)
     * @param sourceType - How the content was produced
     * @param metadata - Optional metadata for tags and source info
     * @returns Array of memory trace IDs (empty if memory is disabled)
     */
    private _encodeMemoryTrace;
    /**
     * Extract audio track from video buffer using ffmpeg.
     *
     * Writes the video to a temp file, runs ffmpeg to extract audio as WAV,
     * reads the result back into a Buffer, and cleans up temp files.
     *
     * @param video - Video data buffer
     * @returns Audio data buffer in WAV format
     * @throws {Error} If ffmpeg extraction fails
     */
    private _extractAudioWithFfmpeg;
    /**
     * Extract keyframes from video at fixed intervals using ffmpeg.
     *
     * Writes the video to a temp file, runs ffmpeg to extract JPEG frames
     * at the specified interval, reads each frame back into a Buffer.
     *
     * @param video - Video data buffer
     * @param intervalSec - Seconds between extracted frames
     * @returns Array of image Buffers (JPEG format)
     * @throws {Error} If ffmpeg extraction fails
     */
    private _extractFramesWithFfmpeg;
    /**
     * Attempt to dynamically import the pdf-parse package.
     *
     * pdf-parse is an optional peer dependency — it's not bundled with agentos
     * to keep the core lightweight. Returns null if the package is not installed.
     *
     * @returns The pdf-parse default export function, or null if unavailable
     */
    private _tryImportPdfParse;
    /**
     * Fallback PDF text extraction using regex on the raw buffer.
     *
     * Scans the PDF byte stream for text objects (between BT/ET markers)
     * and string literals (parenthesized and hex-encoded). This works for
     * simple text PDFs but misses content in complex encodings, CID fonts,
     * or image-only PDFs.
     *
     * @param buf - Raw PDF buffer
     * @returns Extracted text (may be empty for non-text PDFs)
     */
    private _extractTextFromPdfBuffer;
}
//# sourceMappingURL=MultimodalMemoryBridge.d.ts.map