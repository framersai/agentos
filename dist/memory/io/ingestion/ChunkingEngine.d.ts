/**
 * @fileoverview ChunkingEngine — splits raw document text into `DocumentChunk`
 * slices ready for embedding and vector-store ingestion.
 *
 * Four strategies are supported:
 *
 * - **fixed**       — split at a fixed character count with word-boundary
 *                     awareness and configurable overlap.
 * - **semantic**    — embed individual sentences and split where cosine
 *                     similarity drops below a threshold (topic boundaries).
 *                     Falls back to `fixed` when no `embedFn` is supplied.
 * - **hierarchical**— honour Markdown heading structure; each heading creates
 *                     a new chunk boundary with the heading stored in metadata.
 *                     Long sections are sub-split with `fixed`.
 * - **layout**      — preserve fenced code blocks and pipe-delimited tables as
 *                     atomic chunks; surrounding prose is split with `fixed`.
 *
 * @module memory/ingestion/ChunkingEngine
 */
import type { DocumentChunk } from '../../io/facade/types.js';
/**
 * The four supported chunking strategies.
 *
 * - `'fixed'`       — character-count split with overlap.
 * - `'semantic'`    — embedding-guided topic-boundary split.
 * - `'hierarchical'`— Markdown heading-aware split.
 * - `'layout'`      — code/table-aware split that preserves special blocks.
 */
export type ChunkStrategy = 'fixed' | 'semantic' | 'hierarchical' | 'layout';
/**
 * Options controlling how the `ChunkingEngine` splits a document.
 *
 * All fields except `strategy` are optional and fall back to sensible defaults.
 */
export interface ChunkOptions {
    /**
     * Algorithm used to split the content.
     * @see ChunkStrategy
     */
    strategy: ChunkStrategy;
    /**
     * Target character count for each produced chunk.
     * @default 512
     */
    chunkSize?: number;
    /**
     * Number of characters to overlap between consecutive chunks.
     * Prevents context loss at split boundaries.
     * @default 64
     */
    chunkOverlap?: number;
    /**
     * Async function that embeds a batch of strings into dense vectors.
     * Required for the `'semantic'` strategy; ignored by all others.
     * When omitted and `strategy` is `'semantic'`, the engine falls back to
     * the `'fixed'` strategy.
     *
     * @param texts - Batch of strings to embed.
     * @returns Promise resolving to one vector (number[]) per input string.
     */
    embedFn?: (texts: string[]) => Promise<number[][]>;
}
/**
 * Splits raw document text into an ordered array of `DocumentChunk` objects
 * suitable for embedding and storage in a vector index.
 *
 * @example
 * ```typescript
 * const engine = new ChunkingEngine();
 * const chunks = await engine.chunk(content, { strategy: 'fixed', chunkSize: 512 });
 * ```
 */
export declare class ChunkingEngine {
    /**
     * Chunks the provided `content` string according to the given `options`.
     *
     * All strategy implementations are async to accommodate the optional
     * `embedFn` used by the semantic strategy.
     *
     * @param content - Full document text to split.
     * @param options - Chunking strategy and tuning parameters.
     * @returns Ordered array of `DocumentChunk` objects with sequential indices.
     */
    chunk(content: string, options: ChunkOptions): Promise<DocumentChunk[]>;
    /**
     * Splits content at a fixed character count with word-boundary awareness
     * and configurable overlap between consecutive chunks.
     *
     * @param content      - Text to split.
     * @param chunkSize    - Target character count per chunk.
     * @param chunkOverlap - Overlap in characters between consecutive chunks.
     * @returns Ordered `DocumentChunk[]`.
     */
    private _chunkFixed;
    /**
     * Embeds individual sentences and inserts split points wherever the cosine
     * similarity between consecutive sentence embeddings drops below
     * {@link SEMANTIC_SPLIT_THRESHOLD} (topic boundary heuristic).
     *
     * When `embedFn` is not supplied the method falls back to `_chunkFixed`.
     *
     * Any resulting group that exceeds `2 × chunkSize` characters is further
     * sub-split with the fixed strategy.
     *
     * @param content      - Text to split.
     * @param chunkSize    - Target character count per chunk.
     * @param chunkOverlap - Overlap used when sub-splitting oversized groups.
     * @param embedFn      - Optional batch embedding function.
     * @returns Ordered `DocumentChunk[]`.
     */
    private _chunkSemantic;
    /**
     * Recognises Markdown heading lines (`# H1`, `## H2`, …, `###### H6`) and
     * creates a new chunk boundary at each heading.  The heading text is stored
     * in `DocumentChunk.heading` and its level in `metadata.headingLevel`.
     *
     * Sections whose text exceeds `chunkSize` are sub-split with the fixed
     * strategy while preserving the heading metadata.
     *
     * @param content      - Markdown-formatted text.
     * @param chunkSize    - Maximum characters per output chunk.
     * @param chunkOverlap - Overlap used when sub-splitting oversized sections.
     * @returns Ordered `DocumentChunk[]`.
     */
    private _chunkHierarchical;
    /**
     * Detects fenced code blocks (``` … ```) and pipe-delimited tables and
     * emits each as an atomic chunk (never split mid-block).  Surrounding prose
     * is split with the fixed strategy.
     *
     * Chunk metadata:
     * - Code blocks:  `{ type: 'code' }`
     * - Tables:       `{ type: 'table' }`
     * - Prose:        no special metadata.
     *
     * @param content      - Text potentially containing code blocks and tables.
     * @param chunkSize    - Target character count for prose chunks.
     * @param chunkOverlap - Overlap for prose fixed-splits.
     * @returns Ordered `DocumentChunk[]`.
     */
    private _chunkLayout;
}
//# sourceMappingURL=ChunkingEngine.d.ts.map