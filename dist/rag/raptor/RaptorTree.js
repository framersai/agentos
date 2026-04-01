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
// ── K-Means Clustering ──────────────────────────────────────────────────
/**
 * Simple k-means clustering implementation for grouping embeddings.
 *
 * Uses random centroid initialization with iterative Lloyd's algorithm.
 * Converges when centroids stop moving or max iterations reached.
 *
 * @param {number[][]} embeddings - Array of embedding vectors.
 * @param {number} k - Number of clusters.
 * @param {number} [maxIterations=20] - Maximum iterations before stopping.
 * @returns {number[][]} Array of cluster assignments — each inner array contains
 *   the indices of embeddings assigned to that cluster.
 */
function kMeansClustering(embeddings, k, maxIterations = 20) {
    if (embeddings.length === 0 || k <= 0)
        return [];
    if (embeddings.length <= k) {
        // Each embedding is its own cluster
        return embeddings.map((_, i) => [i]);
    }
    const dim = embeddings[0].length;
    // Initialize centroids using random selection (without replacement)
    const centroidIndices = new Set();
    while (centroidIndices.size < k) {
        centroidIndices.add(Math.floor(Math.random() * embeddings.length));
    }
    const centroids = Array.from(centroidIndices).map((i) => [...embeddings[i]]);
    let assignments = new Array(embeddings.length).fill(0);
    for (let iter = 0; iter < maxIterations; iter++) {
        // Assignment step: assign each point to nearest centroid
        const newAssignments = [];
        for (const embedding of embeddings) {
            let bestCluster = 0;
            let bestDist = Infinity;
            for (let c = 0; c < centroids.length; c++) {
                const dist = euclideanDistanceSq(embedding, centroids[c]);
                if (dist < bestDist) {
                    bestDist = dist;
                    bestCluster = c;
                }
            }
            newAssignments.push(bestCluster);
        }
        // Check for convergence
        let changed = false;
        for (let i = 0; i < newAssignments.length; i++) {
            if (newAssignments[i] !== assignments[i]) {
                changed = true;
                break;
            }
        }
        assignments = newAssignments;
        if (!changed)
            break;
        // Update step: recompute centroids
        for (let c = 0; c < k; c++) {
            const members = assignments
                .map((a, i) => (a === c ? i : -1))
                .filter((i) => i >= 0);
            if (members.length === 0)
                continue;
            const newCentroid = new Array(dim).fill(0);
            for (const mi of members) {
                for (let d = 0; d < dim; d++) {
                    newCentroid[d] += embeddings[mi][d];
                }
            }
            for (let d = 0; d < dim; d++) {
                newCentroid[d] /= members.length;
            }
            centroids[c] = newCentroid;
        }
    }
    // Build cluster groups
    const clusters = Array.from({ length: k }, () => []);
    for (let i = 0; i < assignments.length; i++) {
        clusters[assignments[i]].push(i);
    }
    // Filter out empty clusters
    return clusters.filter((c) => c.length > 0);
}
/**
 * Squared Euclidean distance between two vectors (avoids sqrt for comparison).
 *
 * @param {number[]} a - First vector.
 * @param {number[]} b - Second vector.
 * @returns {number} Squared Euclidean distance.
 */
function euclideanDistanceSq(a, b) {
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
        const diff = a[i] - b[i];
        sum += diff * diff;
    }
    return sum;
}
// ── RAPTOR Tree ───────────────────────────────────────────────────────────
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
export class RaptorTree {
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
    constructor(config) {
        this.llmCaller = config.llmCaller;
        this.embeddingManager = config.embeddingManager;
        this.vectorStore = config.vectorStore;
        this.collectionName = config.collectionName ?? 'raptor-tree';
        this.clusterSize = config.clusterSize ?? 8;
        this.maxDepth = config.maxDepth ?? 4;
        this.minChunksForLayer = config.minChunksForLayer ?? 3;
        this.stats = {
            totalLayers: 0,
            nodesPerLayer: {},
            totalNodes: 0,
            totalClusters: 0,
            buildTimeMs: 0,
        };
    }
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
    async build(chunks) {
        const startTime = Date.now();
        this.stats = {
            totalLayers: 0,
            nodesPerLayer: {},
            totalNodes: 0,
            totalClusters: 0,
            buildTimeMs: 0,
        };
        if (chunks.length === 0) {
            this.stats.buildTimeMs = Date.now() - startTime;
            return this.stats;
        }
        // Layer 0: Store original leaf chunks
        await this.storeChunks(chunks, 0, false);
        this.stats.nodesPerLayer[0] = chunks.length;
        this.stats.totalNodes += chunks.length;
        this.stats.totalLayers = 1;
        // Build subsequent layers
        let currentLayerChunks = [...chunks];
        let layerIndex = 1;
        while (layerIndex <= this.maxDepth &&
            currentLayerChunks.length >= this.minChunksForLayer) {
            // Step 1: Embed current layer chunks
            const embeddingResponse = await this.embeddingManager.generateEmbeddings({
                texts: currentLayerChunks.map((c) => c.text),
            });
            if (!embeddingResponse.embeddings || embeddingResponse.embeddings.length === 0) {
                console.warn(`RaptorTree: Failed to embed layer ${layerIndex - 1} chunks. Stopping tree construction.`);
                break;
            }
            // Step 2: Cluster
            const numClusters = Math.max(1, Math.ceil(currentLayerChunks.length / this.clusterSize));
            const clusters = kMeansClustering(embeddingResponse.embeddings, numClusters);
            this.stats.totalClusters += clusters.length;
            // Step 3: Summarize each cluster
            const summaries = [];
            for (let ci = 0; ci < clusters.length; ci++) {
                const clusterIndices = clusters[ci];
                const clusterTexts = clusterIndices.map((idx) => currentLayerChunks[idx].text);
                const summary = await this.summarizeCluster(clusterTexts, layerIndex, ci);
                summaries.push({
                    id: `raptor-l${layerIndex}-c${ci}-${Date.now()}`,
                    text: summary,
                    metadata: {
                        raptorLayer: layerIndex,
                        raptorCluster: ci,
                        childCount: clusterIndices.length,
                        childIds: clusterIndices.map((idx) => currentLayerChunks[idx].id),
                    },
                });
            }
            if (summaries.length === 0)
                break;
            // Step 4: Store summaries
            await this.storeChunks(summaries, layerIndex, true);
            this.stats.nodesPerLayer[layerIndex] = summaries.length;
            this.stats.totalNodes += summaries.length;
            this.stats.totalLayers = layerIndex + 1;
            // Step 5: Repeat with summaries as next input
            currentLayerChunks = summaries;
            layerIndex++;
            // Stop if we've condensed to a single summary (root)
            if (summaries.length <= 1)
                break;
        }
        this.stats.buildTimeMs = Date.now() - startTime;
        return { ...this.stats };
    }
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
    async search(query, topK = 10) {
        // Embed the query
        const embeddingResponse = await this.embeddingManager.generateEmbeddings({
            texts: [query],
        });
        if (!embeddingResponse.embeddings?.[0] ||
            embeddingResponse.embeddings[0].length === 0) {
            return [];
        }
        const queryEmbedding = embeddingResponse.embeddings[0];
        // Search all layers by querying the vector store (all nodes are in the same collection)
        // Fetch more candidates than topK to ensure good coverage across layers
        const result = await this.vectorStore.query(this.collectionName, queryEmbedding, {
            topK: topK * 2,
            includeTextContent: true,
            includeMetadata: true,
        });
        // Convert to RaptorResult with layer information
        const raptorResults = result.documents.map((doc) => ({
            id: doc.id,
            text: doc.textContent ?? '',
            score: doc.similarityScore,
            layer: doc.metadata?.raptorLayer ?? 0,
            isSummary: doc.metadata?.raptorIsSummary === true,
            metadata: doc.metadata,
        }));
        // Sort by score descending and return top K
        raptorResults.sort((a, b) => b.score - a.score);
        return raptorResults.slice(0, topK);
    }
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
    getStats() {
        return { ...this.stats };
    }
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
    async summarizeCluster(texts, layer, clusterIndex) {
        const combinedTexts = texts
            .map((t, i) => `--- Document ${i + 1} ---\n${t}`)
            .join('\n\n');
        const prompt = [
            'Read the following documents carefully. Think step by step about:',
            '',
            '1. What are the key themes across these documents?',
            '2. What information would be lost if these were summarized?',
            '3. What relationships exist between these documents?',
            '4. What terminology and concepts are shared?',
            '',
            'Then write a comprehensive summary that:',
            '- Preserves the most important information and key details',
            '- Captures the main themes and relationships between documents',
            '- Uses the same technical vocabulary as the source documents',
            '- Is suitable for semantic search retrieval',
            `- Is concise but thorough (aim for ${Math.min(texts.length * 50, 500)} words)`,
            '',
            `This is a Layer ${layer} summary (clustering ${texts.length} related documents).`,
            '',
            combinedTexts,
            '',
            'Comprehensive summary:',
        ].join('\n');
        return (await this.llmCaller(prompt)).trim();
    }
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
    async storeChunks(chunks, layer, isSummary) {
        if (chunks.length === 0)
            return;
        // Generate embeddings
        const embeddingResponse = await this.embeddingManager.generateEmbeddings({
            texts: chunks.map((c) => c.text),
        });
        if (!embeddingResponse.embeddings || embeddingResponse.embeddings.length === 0) {
            console.warn(`RaptorTree: Failed to embed ${chunks.length} chunks for layer ${layer}.`);
            return;
        }
        // Build vector documents
        const vectorDocs = chunks
            .map((chunk, i) => {
            const embedding = embeddingResponse.embeddings[i];
            if (!embedding || embedding.length === 0)
                return null;
            return {
                id: chunk.id,
                embedding,
                textContent: chunk.text,
                metadata: {
                    ...chunk.metadata,
                    raptorLayer: layer,
                    raptorIsSummary: isSummary,
                },
            };
        })
            .filter(Boolean);
        if (vectorDocs.length > 0) {
            await this.vectorStore.upsert(this.collectionName, vectorDocs);
        }
    }
}
//# sourceMappingURL=RaptorTree.js.map