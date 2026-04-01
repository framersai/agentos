/**
 * @fileoverview Semantic text chunker that splits on natural boundaries instead
 * of fixed character counts.
 *
 * Three-tier splitting strategy:
 * 1. **Heading boundaries** — Markdown headings (`# ## ###` etc.) start new chunks
 * 2. **Paragraph boundaries** — Double newlines are the preferred split point
 * 3. **Sentence boundaries** — Period/exclamation/question followed by whitespace
 * 4. **Fixed-size fallback** — Only when paragraphs/sentences exceed `maxSize`
 *
 * Each chunk preserves complete sentences/paragraphs and includes configurable
 * overlap context from the previous chunk for retrieval continuity.
 *
 * Special handling:
 * - **Code blocks** (fenced with triple backticks) are kept intact when possible
 * - **Markdown headings** always start new chunks for better section-level retrieval
 * - **Small fragments** below `minSize` are merged with the previous chunk
 *
 * @module agentos/rag/chunking/SemanticChunker
 * @see RetrievalAugmentor for integration with the RAG pipeline
 */
/**
 * Configuration for the semantic chunker.
 *
 * @interface SemanticChunkerConfig
 */
export interface SemanticChunkerConfig {
    /** Target chunk size in characters. Default: 1000. */
    targetSize?: number;
    /** Maximum chunk size — hard limit before forced splitting. Default: 2000. */
    maxSize?: number;
    /** Minimum chunk size — fragments below this merge with previous. Default: 200. */
    minSize?: number;
    /** Overlap characters from previous chunk prepended for context. Default: 100. */
    overlap?: number;
    /** Whether to detect and preserve fenced code blocks intact. Default: true. */
    preserveCodeBlocks?: boolean;
    /** Whether to detect markdown headings as chunk-start boundaries. Default: true. */
    respectHeadings?: boolean;
}
/**
 * A semantically coherent text chunk produced by the chunker.
 *
 * @interface SemanticChunk
 * @property {string} text - The chunk text content (may include overlap prefix).
 * @property {number} index - 0-based sequence index within the chunked document.
 * @property {number} startOffset - Character offset in the original text where this chunk begins.
 * @property {number} endOffset - Character offset in the original text where this chunk ends.
 * @property {BoundaryType} boundaryType - Type of boundary that determined this chunk's split.
 * @property {Record<string, unknown>} [metadata] - Pass-through metadata from the caller.
 */
export interface SemanticChunk {
    /** The chunk text content (may include overlap prefix from previous chunk). */
    text: string;
    /** 0-based sequence index within the chunked document. */
    index: number;
    /** Character offset in the original text where this chunk begins (before overlap). */
    startOffset: number;
    /** Character offset in the original text where this chunk ends. */
    endOffset: number;
    /** Type of boundary that determined this chunk's split point. */
    boundaryType: BoundaryType;
    /** Pass-through metadata from the caller. */
    metadata?: Record<string, unknown>;
}
/**
 * The type of boundary used to split a chunk.
 */
export type BoundaryType = 'paragraph' | 'sentence' | 'heading' | 'code-block' | 'fixed';
/**
 * Semantic text chunker that splits on natural boundaries instead of
 * fixed character counts.
 *
 * Produces chunks that are more semantically coherent than fixed-size
 * splitting, improving retrieval quality by keeping related ideas together.
 *
 * @example Basic usage
 * ```typescript
 * const chunker = new SemanticChunker({ targetSize: 800, overlap: 50 });
 * const chunks = chunker.chunk(markdownDocument);
 * for (const c of chunks) {
 *   console.log(`Chunk ${c.index} (${c.boundaryType}): ${c.text.length} chars`);
 * }
 * ```
 *
 * @example Preserving code blocks
 * ```typescript
 * const chunker = new SemanticChunker({
 *   targetSize: 1000,
 *   maxSize: 3000, // Allow larger chunks for code blocks
 *   preserveCodeBlocks: true,
 * });
 * const chunks = chunker.chunk(technicalDoc);
 * ```
 */
export declare class SemanticChunker {
    /** Resolved configuration with defaults applied. */
    private config;
    /**
     * Creates a new SemanticChunker.
     *
     * @param {SemanticChunkerConfig} [config] - Chunking configuration.
     * @param {number} [config.targetSize=1000] - Target chunk size in characters.
     * @param {number} [config.maxSize=2000] - Maximum chunk size (hard limit).
     * @param {number} [config.minSize=200] - Minimum chunk size before merging.
     * @param {number} [config.overlap=100] - Overlap characters from previous chunk.
     * @param {boolean} [config.preserveCodeBlocks=true] - Keep code blocks intact.
     * @param {boolean} [config.respectHeadings=true] - Start new chunks at headings.
     *
     * @example
     * ```typescript
     * const chunker = new SemanticChunker({
     *   targetSize: 800,
     *   maxSize: 1500,
     *   overlap: 80,
     * });
     * ```
     */
    constructor(config?: SemanticChunkerConfig);
    /**
     * Splits text into semantically coherent chunks.
     *
     * Pipeline:
     * 1. Pre-process: extract code blocks (if `preserveCodeBlocks`)
     * 2. Split by headings (if `respectHeadings`) — each heading starts a new section
     * 3. Within sections, split by paragraphs (double newline)
     * 4. If a paragraph exceeds `maxSize`, split by sentences
     * 5. If a sentence exceeds `maxSize`, split at word boundaries (fixed fallback)
     * 6. Merge small fragments (< `minSize`) with the previous chunk
     * 7. Add overlap from the end of the previous chunk to each chunk
     *
     * @param {string} text - The full text to chunk.
     * @param {Record<string, unknown>} [metadata] - Optional metadata attached to all chunks.
     * @returns {SemanticChunk[]} Array of chunks in order.
     * @throws {Error} If text is empty.
     *
     * @example
     * ```typescript
     * const chunks = chunker.chunk(
     *   '# Introduction\n\nFirst paragraph.\n\n## Details\n\nSecond paragraph.',
     *   { source: 'docs/readme.md' },
     * );
     * // chunks[0].boundaryType === 'heading'
     * // chunks[0].text includes "# Introduction\n\nFirst paragraph."
     * ```
     */
    chunk(text: string, metadata?: Record<string, unknown>): SemanticChunk[];
    /**
     * Splits text into structural segments based on headings and code blocks.
     *
     * This is the first pass that identifies major structural boundaries:
     * - Markdown headings always start new segments
     * - Fenced code blocks are kept as single segments when possible
     * - Remaining text is split by paragraphs (double newline)
     *
     * @param {string} text - Full document text.
     * @returns {Array<{ text: string; offset: number; boundary: BoundaryType }>} Segments.
     */
    private splitByStructure;
    /**
     * Further splits an oversized segment by paragraph and sentence boundaries.
     *
     * Called when a structural segment exceeds `maxSize`. Tries progressively
     * smaller split granularity:
     * 1. Paragraph splits (double newline)
     * 2. Sentence splits (period/exclamation/question + space + uppercase)
     * 3. Word boundary splits (fixed-size fallback)
     *
     * @param {string} text - Oversized segment text.
     * @param {number} baseOffset - Character offset of this segment in the original text.
     * @returns {Array<{ text: string; offset: number; boundary: BoundaryType }>} Sub-segments.
     */
    private splitOversizedSegment;
    /**
     * Splits text by sentence boundaries.
     *
     * Detects sentence endings (`.` `!` `?` followed by whitespace) and accumulates
     * sentences until reaching `targetSize`. Falls back to word-boundary splitting
     * for sentences exceeding `maxSize`.
     *
     * @param {string} text - Text to split by sentences.
     * @param {number} baseOffset - Character offset in the original text.
     * @returns {Array<{ text: string; offset: number; boundary: BoundaryType }>} Sentence-split chunks.
     */
    private splitBySentences;
    /**
     * Last-resort fixed-size splitting at word boundaries.
     *
     * Splits text at the last space before `targetSize` to avoid breaking words.
     * This is only used when no paragraph or sentence boundaries are available
     * within a segment that exceeds `maxSize`.
     *
     * @param {string} text - Text to split at word boundaries.
     * @param {number} baseOffset - Character offset in the original text.
     * @returns {Array<{ text: string; offset: number; boundary: BoundaryType }>} Fixed-size chunks.
     */
    private splitFixed;
    /**
     * Merges fragments smaller than `minSize` with the previous chunk.
     *
     * Small trailing fragments (e.g., a short concluding sentence) are merged
     * backwards to prevent creating chunks that are too small for meaningful
     * embedding.
     *
     * @param {Array<{ text: string; offset: number; boundary: BoundaryType }>} segments - Input segments.
     * @returns {Array<{ text: string; offset: number; boundary: BoundaryType }>} Segments with small ones merged.
     */
    private mergeSmallFragments;
}
//# sourceMappingURL=SemanticChunker.d.ts.map