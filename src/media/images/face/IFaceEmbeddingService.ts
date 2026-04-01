/**
 * @file IFaceEmbeddingService.ts
 * Interface for face embedding extraction and comparison services.
 *
 * Provides a provider-agnostic contract for extracting facial feature vectors
 * from images and computing similarity between two face embeddings.
 */

// ---------------------------------------------------------------------------
// Face embedding types
// ---------------------------------------------------------------------------

/** Bounding box coordinates for a detected face within an image. */
export interface FaceBoundingBox {
  /** X-coordinate of the top-left corner. */
  x: number;
  /** Y-coordinate of the top-left corner. */
  y: number;
  /** Width of the bounding box in pixels. */
  width: number;
  /** Height of the bounding box in pixels. */
  height: number;
}

/** Face embedding vector with optional detection metadata. */
export interface FaceEmbedding {
  /** High-dimensional vector representing facial features. */
  vector: number[];
  /** Bounding box of the detected face in the source image. */
  boundingBox?: FaceBoundingBox;
  /** Detection confidence score in [0, 1]. */
  confidence?: number;
}

/** Result of comparing two face embeddings. */
export interface FaceComparisonResult {
  /** Cosine similarity score in [-1, 1]. */
  similarity: number;
  /** Whether the two faces belong to the same identity (above threshold). */
  match: boolean;
}

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

/**
 * Provider-agnostic service for extracting face embeddings from images
 * and comparing them for identity consistency.
 */
export interface IFaceEmbeddingService {
  /**
   * Extract a face embedding vector from an image URL or data URI.
   *
   * @param imageUrl - Public URL or base64 data URI of the image.
   * @returns The extracted face embedding.
   */
  extractEmbedding(imageUrl: string): Promise<FaceEmbedding>;

  /**
   * Compare two face embeddings and return a similarity score.
   *
   * @param a - First face embedding vector.
   * @param b - Second face embedding vector.
   * @param threshold - Minimum similarity to consider a match (default 0.6).
   * @returns Comparison result with similarity and match flag.
   */
  compareFaces(a: number[], b: number[], threshold?: number): FaceComparisonResult;
}

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
export function cosineSimilarity(a: number[], b: number[]): number {
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
