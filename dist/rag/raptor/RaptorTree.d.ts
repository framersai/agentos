/**
 * @fileoverview RAPTOR — Recursive Abstractive Processing for Tree-Organized Retrieval.
 *
 * Based on: Sarthi et al. 2024 "RAPTOR: Recursive Abstractive Processing for
 * Tree-Organized Retrieval"
 *
 * Builds a hierarchical summary tree over document chunks:
 * - **Layer 0**: Original chunks (leaf nodes)
 * - **Layer 1**: Summaries of 5-10 related chunks (cluster -> summarize)
 * - **Layer 2**: Summaries of layer 1 summaries
 * - **Layer N**: Single corpus-level summary (root)
 *
 * At retrieval time, ALL layers are searched simultaneously. This enables:
 * - Detail queries -> match leaf chunks (layer 0)
 * - Theme queries -> match cluster summaries (layer 1-2)
 * - "Big picture" queries -> match high-level summaries (layer N)
 *
 * The tree construction pipeline:
 * 1. **Cluster** similar chunks using k-means on embeddings
 * 2. **Summarize** each cluster using an LLM with chain-of-thought reasoning
 * 3. **Embed** each summary
 * 4. **Store** summaries in the vector store with layer metadata
 * 5. **Repeat** — treat summaries as new chunks, cluster and summarize again
 *
 * @module agentos/rag/raptor/RaptorTree
 * @see RetrievalAugmentor for integration with the RAG pipeline
 */
import type { IEmbeddingManager } from '../IEmbeddingManager.js';
import type { IVectorStore } from '../IVectorStore.js';
/**
 * Configuration for the RAPTOR tree.
 *
 * @interface RaptorTreeConfig
 */
export interface RaptorTreeConfig {
    /**
     * LLM caller for generating summaries.
     * Takes a prompt string and returns the LLM completion.
     *
     * @param {string} prompt - The full prompt including chain-of-thought instructions.
     * @returns {Promise<string>} The generated summary text.
     */
    llmCaller: (prompt: string) => Promise<string>;
    /** Embedding manager for generating embeddings for clustering and storage. */
    embeddingManager: IEmbeddingManager;
    /** Vector store for persisting all layers of the tree. */
    vectorStore: IVectorStore;
    /** Collection name in the vector store. Default: 'raptor-tree'. */
    collectionName?: string;
    /** Number of chunks per cluster. Default: 8. */
    clusterSize?: number;
    /** Maximum tree depth (layers above leaf). Default: 4. */
    maxDepth?: number;
    /** Minimum number of chunks required to form a new summary layer. Default: 3. */
    minChunksForLayer?: number;
}
/**
 * Input chunk for building the RAPTOR tree.
 *
 * @interface RaptorInputChunk
 */
export interface RaptorInputChunk {
    /** Unique chunk identifier. */
    id: string;
    /** Chunk text content. */
    text: string;
    /** Optional metadata to preserve in the tree. */
    metadata?: Record<string, unknown>;
}
/**
 * Statistics about the constructed RAPTOR tree.
 *
 * @interface RaptorTreeStats
 */
export interface RaptorTreeStats {
    /** Total number of layers (0 = leaf only, 1 = one summary layer, etc.). */
    totalLayers: number;
    /** Number of nodes (chunks + summaries) per layer. */
    nodesPerLayer: Record<number, number>;
    /** Total nodes across all layers. */
    totalNodes: number;
    /** Total number of clusters created. */
    totalClusters: number;
    /** Time taken to build the tree (ms). */
    buildTimeMs: number;
}
/**
 * A single RAPTOR search result with layer information.
 *
 * @interface RaptorResult
 */
export interface RaptorResult {
    /** Document/chunk identifier. */
    id: string;
    /** Text content. */
    text: string;
    /** Similarity score from vector search. */
    score: number;
    /** Layer in the RAPTOR tree (0 = leaf, higher = more abstract). */
    layer: number;
    /** Whether this is a summary node or an original leaf chunk. */
    isSummary: boolean;
    /** Optional metadata. */
    metadata?: Record<string, unknown>;
}
/**
 * RAPTOR — Recursive Abstractive Processing for Tree-Organized Retrieval.
 *
 * Builds a hierarchical summary tree over document chunks, enabling retrieval
 * at multiple levels of abstraction. Leaf nodes contain original chunks while
 * higher layers contain progressively more abstract summaries.
 *
 * @example Building and searching a RAPTOR tree
 * ```typescript
 * const raptor = new RaptorTree({
 *   llmCaller: async (prompt) => {
 *     const response = await openai.chat.completions.create({
 *       model: 'gpt-4o-mini',
 *       messages: [{ role: 'user', content: prompt }],
 *     });
 *     return response.choices[0].message.content ?? '';
 *   },
 *   embeddingManager: myEmbeddingManager,
 *   vectorStore: myVectorStore,
 *   clusterSize: 8,
 *   maxDepth: 3,
 * });
 *
 * // Build tree from 100 document chunks
 * const stats = await raptor.build(chunks);
 * console.log(`Built ${stats.totalLayers} layers with ${stats.totalNodes} total nodes`);
 *
 * // Search all layers simultaneously
 * const results = await raptor.search('What are the main themes?', 10);
 * for (const r of results) {
 *   console.log(`[Layer ${r.layer}] ${r.id}: ${r.score.toFixed(3)} — ${r.text.slice(0, 80)}...`);
 * }
 * ```
 */
export declare class RaptorTree {
    /** LLM caller for summarization. */
    private llmCaller;
    /** Embedding manager for generating embeddings. */
    private embeddingManager;
    /** Vector store for persisting tree nodes. */
    private vectorStore;
    /** Collection name in the vector store. */
    private collectionName;
    /** Number of chunks per cluster. */
    private clusterSize;
    /** Maximum tree depth. */
    private maxDepth;
    /** Minimum chunks to form a new layer. */
    private minChunksForLayer;
    /** Cached statistics from the last build. */
    private stats;
    /**
     * Creates a new RaptorTree.
     *
     * @param {RaptorTreeConfig} config - Configuration including LLM caller,
     *   embedding manager, vector store, and clustering parameters.
     *
     * @example
     * ```typescript
     * const raptor = new RaptorTree({
     *   llmCaller: myLlm,
     *   embeddingManager: myEmbeddings,
     *   vectorStore: myStore,
     *   clusterSize: 8,
     *   maxDepth: 4,
     * });
     * ```
     */
    constructor(config: RaptorTreeConfig);
    /**
     * Builds the RAPTOR tree from a set of leaf chunks.
     *
     * Pipeline for each layer:
     * 1. Embed all current-layer chunks
     * 2. Cluster similar chunks using k-means
     * 3. Summarize each cluster using the LLM with chain-of-thought
     * 4. Embed summaries and store in vector store with layer metadata
     * 5. Treat summaries as the next layer's input and repeat
     *
     * Stops when:
     * - Fewer than `minChunksForLayer` summaries were produced
     * - Maximum depth is reached
     * - Only one cluster remains (root summary)
     *
     * @param {RaptorInputChunk[]} chunks - Leaf chunks to build the tree from.
     * @returns {Promise<RaptorTreeStats>} Statistics about the constructed tree.
     * @throws {Error} If embedding or storage fails critically.
     *
     * @example
     * ```typescript
     * const chunks = documents.map((doc, i) => ({
     *   id: `chunk-${i}`,
     *   text: doc.content,
     *   metadata: { source: doc.source },
     * }));
     * const stats = await raptor.build(chunks);
     * console.log(`Tree has ${stats.totalLayers} layers`);
     * ```
     */
    build(chunks: RaptorInputChunk[]): Promise<RaptorTreeStats>;
    /**
     * Searches ALL layers of the RAPTOR tree simultaneously.
     *
     * This is the key advantage of RAPTOR: a detail query will match leaf
     * chunks, while a thematic query will match higher-layer summaries.
     * Both types of results are returned together, sorted by relevance.
     *
     * @param {string} query - The search query.
     * @param {number} [topK=10] - Maximum number of results across all layers.
     * @returns {Promise<RaptorResult[]>} Results from all layers, sorted by score.
     * @throws {Error} If embedding or vector search fails.
     *
     * @example
     * ```typescript
     * const results = await raptor.search('authentication architecture', 10);
     * // May return:
     * // - Layer 0 chunks about specific auth implementations
     * // - Layer 1 summaries about auth patterns
     * // - Layer 2 high-level summary about security architecture
     * ```
     */
    search(query: string, topK?: number): Promise<RaptorResult[]>;
    /**
     * Returns statistics about the last tree build.
     *
     * @returns {RaptorTreeStats} Tree statistics including layer counts, node counts,
     *   cluster counts, and build time.
     *
     * @example
     * ```typescript
     * const stats = raptor.getStats();
     * console.log(`Layers: ${stats.totalLayers}, Nodes: ${stats.totalNodes}`);
     * ```
     */
    getStats(): RaptorTreeStats;
    /**
     * Generates a summary of a cluster of documents using chain-of-thought reasoning.
     *
     * The prompt instructs the LLM to:
     * 1. Identify key themes across the documents
     * 2. Consider what information would be lost in summarization
     * 3. Note relationships between documents
     * 4. Write a comprehensive summary preserving the most important information
     *
     * @param {string[]} texts - Texts in the cluster to summarize.
     * @param {number} layer - Current layer index (for context in the prompt).
     * @param {number} clusterIndex - Cluster index within the layer.
     * @returns {Promise<string>} The generated summary.
     */
    private summarizeCluster;
    /**
     * Stores chunks/summaries in the vector store with layer metadata.
     *
     * Generates embeddings for all texts, then upserts them into the vector
     * store with metadata indicating their layer and summary status.
     *
     * @param {RaptorInputChunk[]} chunks - Chunks to store.
     * @param {number} layer - Layer index in the RAPTOR tree.
     * @param {boolean} isSummary - Whether these are summary nodes.
     */
    private storeChunks;
}
//# sourceMappingURL=RaptorTree.d.ts.map