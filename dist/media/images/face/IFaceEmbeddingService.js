/**
 * @file IFaceEmbeddingService.ts
 * Interface for face embedding extraction and comparison services.
 *
 * Provides a provider-agnostic contract for extracting facial feature vectors
 * from images and computing similarity between two face embeddings.
 */
// ---------------------------------------------------------------------------
// Cosine similarity
// ---------------------------------------------------------------------------
/**
 * Compute the cosine similarity between two equal-length numeric vectors.
 *
 * Returns a value in [-1, 1] where 1 means identical direction, 0 means
 * orthogonal, and -1 means opposite direction. Returns 0 for zero-magnitude
 * vectors to avoid division-by-zero.
 *
 * @param a - First vector.
 * @param b - Second vector.
 * @returns Cosine similarity score.
 */
export function cosineSimilarity(a, b) {
    if (a.length !== b.length) {
        throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
    }
    let dotProduct = 0;
    let magnitudeA = 0;
    let magnitudeB = 0;
    for (let i = 0; i < a.length; i++) {
        dotProduct += a[i] * b[i];
        magnitudeA += a[i] * a[i];
        magnitudeB += b[i] * b[i];
    }
    const denominator = Math.sqrt(magnitudeA) * Math.sqrt(magnitudeB);
    if (denominator === 0) {
        return 0;
    }
    return dotProduct / denominator;
}
//# sourceMappingURL=IFaceEmbeddingService.js.map