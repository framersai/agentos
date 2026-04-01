/**
 * @fileoverview Shared vector distance and similarity functions.
 * @module rag/utils/vectorMath
 *
 * Single source of truth for vector math across the entire AgentOS codebase.
 * Replaces 6+ duplicate implementations scattered across SqlVectorStore,
 * InMemoryVectorStore, KnowledgeGraph, SqliteKnowledgeGraph,
 * ConsolidationLoop, ProspectiveMemoryManager, and ChunkingEngine.
 *
 * Optimized for hot-loop performance:
 * - Single-pass accumulation (dot, normA, normB computed together)
 * - Early bail on dimension mismatch or zero-length
 * - Accepts both number[] and Float32Array for zero-copy interop with binary blobs
 */
// ---------------------------------------------------------------------------
// Cosine Similarity
// ---------------------------------------------------------------------------
/**
 * Compute cosine similarity between two vectors.
 *
 * Returns a value in [-1, 1]:
 * - `1.0`  = identical direction
 * - `0.0`  = orthogonal (no linear similarity)
 * - `-1.0` = opposite direction
 *
 * Returns `0` for empty arrays, mismatched dimensions, or zero-magnitude vectors.
 *
 * @param a - First vector.
 * @param b - Second vector (must have same length as `a`).
 * @returns Cosine similarity in [-1, 1].
 */
export function cosineSimilarity(a, b) {
    if (a.length !== b.length || a.length === 0)
        return 0;
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
        const ai = a[i];
        const bi = b[i];
        dot += ai * bi;
        normA += ai * ai;
        normB += bi * bi;
    }
    if (normA === 0 || normB === 0)
        return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
// ---------------------------------------------------------------------------
// Dot Product
// ---------------------------------------------------------------------------
/**
 * Compute the dot product (inner product) of two vectors.
 *
 * Higher values indicate more similar vectors (for normalized vectors,
 * dot product equals cosine similarity).
 *
 * Returns `0` for empty arrays or mismatched dimensions.
 *
 * @param a - First vector.
 * @param b - Second vector (must have same length as `a`).
 * @returns The scalar dot product.
 */
export function dotProduct(a, b) {
    if (a.length !== b.length || a.length === 0)
        return 0;
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
        sum += a[i] * b[i];
    }
    return sum;
}
// ---------------------------------------------------------------------------
// Euclidean Distance
// ---------------------------------------------------------------------------
/**
 * Compute the Euclidean (L2) distance between two vectors.
 *
 * Lower values indicate more similar vectors:
 * - `0.0` = identical vectors
 * - Increases with divergence
 *
 * Returns `0` for empty arrays or mismatched dimensions.
 *
 * @param a - First vector.
 * @param b - Second vector (must have same length as `a`).
 * @returns Non-negative L2 distance.
 */
export function euclideanDistance(a, b) {
    if (a.length !== b.length || a.length === 0)
        return 0;
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
        const diff = a[i] - b[i];
        sum += diff * diff;
    }
    return Math.sqrt(sum);
}
// ---------------------------------------------------------------------------
// Binary blob helpers
// ---------------------------------------------------------------------------
/**
 * Serialize a number[] embedding to a compact Float32Array Buffer.
 * ~50% smaller than JSON.stringify and avoids JSON.parse on read.
 *
 * @param embedding - The embedding vector.
 * @returns Buffer containing raw float32 bytes.
 */
export function embeddingToBlob(embedding) {
    return Buffer.from(new Float32Array(embedding).buffer);
}
/**
 * Deserialize a Buffer back to number[].
 * Creates a Float32Array view over the buffer without copying.
 *
 * @param blob - Buffer containing raw float32 bytes.
 * @returns The embedding as a number array.
 */
export function blobToEmbedding(blob) {
    const f32 = new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4);
    return Array.from(f32);
}
/**
 * Create a Float32Array view over a Buffer without copying.
 * Use this when you want to pass directly to distance functions
 * without converting to number[] first (avoids allocation).
 *
 * @param blob - Buffer containing raw float32 bytes.
 * @returns Float32Array view.
 */
export function blobToFloat32(blob) {
    return new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4);
}
/**
 * Detect whether a stored blob is legacy JSON text or binary format.
 * JSON blobs start with `[` (0x5B); binary blobs start with raw float bytes.
 *
 * @param blob - The stored embedding data.
 * @returns True if the blob is legacy JSON-encoded text.
 */
export function isLegacyJsonBlob(blob) {
    if (typeof blob === 'string')
        return true;
    return blob.length > 0 && blob[0] === 0x5B; // '[' character
}
//# sourceMappingURL=vectorMath.js.map