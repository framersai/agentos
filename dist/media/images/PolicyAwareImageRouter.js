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
// ---------------------------------------------------------------------------
// Default provider chains
// ---------------------------------------------------------------------------
/** Default provider ordering for safe/standard content. */
const DEFAULT_PROVIDER_CHAIN = [
    'replicate',
    'fal',
    'openai',
    'stability',
];
/** Provider ordering for mature/private-adult content (uncensored first). */
const UNCENSORED_PROVIDER_CHAIN = [
    'replicate',
    'fal',
    'stable-diffusion-local',
];
// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
/**
 * Policy-aware image provider router. Selects the preferred image generation
 * provider and model based on the session's content policy tier.
 */
export class PolicyAwareImageRouter {
    /**
     * @param catalog - Uncensored model catalog for mature/private-adult lookup.
     */
    constructor(catalog) {
        this.catalog = catalog;
    }
    /**
     * Get the preferred image provider and model for a given policy tier.
     *
     * @param policyTier - Content policy tier.
     * @param capabilities - Optional required capabilities (e.g. ['face-consistency']).
     * @returns Provider preference, or null for safe/standard tiers.
     */
    getPreferredProvider(policyTier, capabilities) {
        if (policyTier === 'safe' || policyTier === 'standard') {
            return null;
        }
        const entry = this.catalog.getPreferredImageModel(policyTier, capabilities);
        if (!entry) {
            return null;
        }
        return {
            providerId: entry.providerId,
            modelId: entry.modelId,
            displayName: entry.displayName,
        };
    }
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
    getProviderChain(policyTier, capabilities) {
        const base = policyTier === 'safe' || policyTier === 'standard'
            ? [...DEFAULT_PROVIDER_CHAIN]
            : [...UNCENSORED_PROVIDER_CHAIN];
        if (!capabilities || capabilities.length === 0) {
            return base;
        }
        return base.filter((id) => {
            const caps = PROVIDER_CAPABILITIES[id];
            if (!caps)
                return false;
            return capabilities.every((cap) => caps.has(cap));
        });
    }
}
// ---------------------------------------------------------------------------
// Provider capability registry
// ---------------------------------------------------------------------------
/** Known capabilities per image provider. */
const PROVIDER_CAPABILITIES = {
    replicate: new Set(['character-consistency', 'controlnet', 'style-transfer']),
    fal: new Set(['character-consistency']),
    'stable-diffusion-local': new Set(['character-consistency', 'controlnet']),
    openai: new Set([]),
    stability: new Set([]),
    openrouter: new Set([]),
    bfl: new Set([]),
};
//# sourceMappingURL=PolicyAwareImageRouter.js.map