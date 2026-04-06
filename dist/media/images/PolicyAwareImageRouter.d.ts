/**
 * @fileoverview Policy-aware image provider router for selecting uncensored
 * image generation backends based on content policy tier.
 *
 * Safe/standard tiers return null or the default provider chain, signalling
 * the caller to use its normal image generation pipeline. Mature/private-adult
 * tiers route through Replicate and other uncensored providers from the
 * {@link UncensoredModelCatalog}.
 *
 * @module media/images/PolicyAwareImageRouter
 */
import type { UncensoredModelCatalog, PolicyTier } from '../../core/llm/routing/UncensoredModelCatalog';
/** Preference result returned by the image router. */
export interface ImageProviderPreference {
    /** Recommended provider ID (e.g. 'replicate'). */
    providerId: string;
    /** Recommended model ID on that provider. */
    modelId: string;
    /** Human-readable display name of the model. */
    displayName: string;
}
/**
 * Policy-aware image provider router. Selects the preferred image generation
 * provider and model based on the session's content policy tier.
 */
export declare class PolicyAwareImageRouter {
    private readonly catalog;
    /**
     * @param catalog - Uncensored model catalog for mature/private-adult lookup.
     */
    constructor(catalog: UncensoredModelCatalog);
    /**
     * Get the preferred image provider and model for a given policy tier.
     *
     * @param policyTier - Content policy tier.
     * @param capabilities - Optional required capabilities (e.g. ['face-consistency']).
     * @returns Provider preference, or null for safe/standard tiers.
     */
    getPreferredProvider(policyTier: PolicyTier, capabilities?: string[]): ImageProviderPreference | null;
    /**
     * Get the ordered provider chain for a given policy tier,
     * optionally filtered by required capabilities.
     *
     * Safe/standard returns the default chain (OpenAI-first).
     * Mature/private-adult returns the uncensored chain (Replicate-first).
     *
     * When `capabilities` is provided, only providers supporting ALL listed
     * capabilities are included. Known capabilities:
     * - `'character-consistency'` — Replicate (Pulid, IP-Adapter), Fal (IP-Adapter), SD-Local (ControlNet)
     * - `'controlnet'` — Replicate (Canny, Depth), SD-Local (ControlNet extensions)
     * - `'style-transfer'` — Replicate (Flux Redux)
     *
     * @param policyTier - Content policy tier.
     * @param capabilities - Optional required capabilities to filter the chain.
     * @returns Ordered array of provider IDs to try in sequence.
     */
    getProviderChain(policyTier: PolicyTier, capabilities?: string[]): string[];
}
//# sourceMappingURL=PolicyAwareImageRouter.d.ts.map