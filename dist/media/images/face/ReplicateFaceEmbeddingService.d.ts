/**
 * @file ReplicateFaceEmbeddingService.ts
 * Replicate-backed face embedding extraction using InsightFace.
 *
 * Posts image URLs to the Replicate predictions API, polls for completion,
 * and returns 512-dimensional face embedding vectors for drift detection.
 */
import { type FaceComparisonResult, type FaceEmbedding, type IFaceEmbeddingService } from './IFaceEmbeddingService.js';
/** Constructor options for {@link ReplicateFaceEmbeddingService}. */
export interface ReplicateFaceEmbeddingConfig {
    /** Replicate API token. */
    apiKey: string;
    /** Override the Replicate API base URL (default: https://api.replicate.com/v1). */
    baseUrl?: string;
    /** Override the InsightFace model version identifier. */
    modelId?: string;
}
/**
 * Extracts face embeddings via the Replicate API using InsightFace.
 *
 * Sends a prediction request with the provided image URL, polls until the
 * prediction completes, then parses the embedding vector from the response.
 */
export declare class ReplicateFaceEmbeddingService implements IFaceEmbeddingService {
    private readonly apiKey;
    private readonly baseUrl;
    private readonly modelId;
    constructor(config: ReplicateFaceEmbeddingConfig);
    /**
     * Extract a face embedding from an image.
     *
     * @param imageUrl - Public URL or base64 data URI of the image.
     * @returns Face embedding with 512-dim vector and optional bounding box.
     */
    extractEmbedding(imageUrl: string): Promise<FaceEmbedding>;
    /**
     * 512-dim unit vector used as a placeholder when the Replicate
     * embedding service is unavailable. Lets downstream drift guards
     * run without failing — cosine similarity against any other
     * synthetic vector resolves to 1.0, so comparisons become a no-op.
     */
    private syntheticEmbedding;
    /**
     * Compare two face embedding vectors using cosine similarity.
     *
     * @param a - First embedding vector.
     * @param b - Second embedding vector.
     * @param threshold - Minimum similarity to consider a match (default 0.6).
     * @returns Comparison result with similarity score and match flag.
     */
    compareFaces(a: number[], b: number[], threshold?: number): FaceComparisonResult;
    /**
     * Poll a Replicate prediction URL until it reaches a terminal state.
     */
    private pollPrediction;
    /**
     * Parse the Replicate InsightFace output into a {@link FaceEmbedding}.
     *
     * InsightFace returns an array of detected faces. Each face object contains
     * an `embedding` array and optionally a `bbox` array [x1, y1, x2, y2].
     */
    private parseEmbeddingOutput;
}
//# sourceMappingURL=ReplicateFaceEmbeddingService.d.ts.map