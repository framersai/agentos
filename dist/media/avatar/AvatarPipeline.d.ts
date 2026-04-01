/**
 * @file AvatarPipeline.ts
 * Core orchestrator for staged avatar image generation.
 *
 * Executes the avatar pipeline stages in order — neutral portrait, face
 * embedding extraction, expression sheet, animated emotes, full body —
 * with cosine-similarity drift checking against the anchor face embedding.
 * Images that drift too far from the anchor are regenerated up to a
 * configurable maximum number of attempts.
 */
import type { IFaceEmbeddingService } from '../images/face/IFaceEmbeddingService.js';
import type { PolicyTier } from '../../core/llm/routing/UncensoredModelCatalog.js';
import type { AvatarGenerationRequest, AvatarGenerationResult } from './types.js';
/**
 * Function that generates an image from a text prompt.
 *
 * Abstracts away the underlying provider (Replicate, Stability, etc.)
 * so the pipeline does not depend on a concrete image provider.
 *
 * @param prompt - Text prompt describing the desired image.
 * @param options - Generation options forwarded to the provider.
 * @returns URL of the generated image.
 */
export type ImageGeneratorFn = (prompt: string, options: {
    seed?: number;
    negativePrompt?: string;
    stylePreset?: string;
    policyTier?: PolicyTier;
    /** Optional reference image URL for InstantID / IP-Adapter consistency. */
    referenceImageUrl?: string;
}) => Promise<string>;
/**
 * Orchestrates multi-stage avatar image generation with drift detection.
 *
 * Stages run in dependency order. The expression sheet and animated emote
 * stages drift-check each generated image against the anchor face embedding
 * and regenerate on low similarity.
 */
export declare class AvatarPipeline {
    private readonly faceService;
    private readonly generateImage;
    /**
     * @param faceService - Face embedding extraction and comparison service.
     * @param generateImage - Image generation function (prompt → URL).
     */
    constructor(faceService: IFaceEmbeddingService, generateImage: ImageGeneratorFn);
    /**
     * Execute the avatar generation pipeline.
     *
     * @param request - Generation request with identity, stages, and config.
     * @returns Result containing the identity package, job records, and drift report.
     */
    generate(request: AvatarGenerationRequest): Promise<AvatarGenerationResult>;
    private createJob;
}
//# sourceMappingURL=AvatarPipeline.d.ts.map