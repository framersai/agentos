/**
 * @fileoverview Uncensored model catalog for policy-aware routing.
 *
 * Maps content policy tiers to curated lists of uncensored text and image
 * models available through OpenRouter (text) and Replicate (image). The
 * catalog is the single source of truth consumed by {@link PolicyAwareRouter}
 * and {@link PolicyAwareImageRouter} to select models that honour the
 * agent's content policy without imposing upstream safety filters.
 *
 * @module core/llm/routing/UncensoredModelCatalog
 */
/** Content policy tier governing model selection. */
export type PolicyTier = 'safe' | 'standard' | 'mature' | 'private-adult';
/** Finer-grained content intent hint within a policy tier. */
export type ContentIntent = 'general' | 'romantic' | 'erotic' | 'violent' | 'horror';
/** A single model entry in the uncensored catalog. */
export interface CatalogEntry {
    /** OpenRouter / Replicate model identifier. */
    modelId: string;
    /** Human-readable display name. */
    displayName: string;
    /** Provider that hosts this model (e.g. 'openrouter', 'replicate'). */
    providerId: string;
    /** Modality: 'text' for LLMs, 'image' for diffusion/GAN. */
    modality: 'text' | 'image';
    /** Quality tier used for preference ordering. */
    quality: 'high' | 'medium' | 'low';
    /** Content permission tags describing what the model allows. */
    contentPermissions: ContentIntent[];
    /** Provider-specific capability tags (e.g. 'face-consistency', 'video'). */
    capabilities: string[];
}
/** Read-only catalog of uncensored models. */
export interface UncensoredModelCatalog {
    /**
     * Return all text model entries, optionally filtered.
     * @param filter - Optional quality or content permission filter.
     */
    getTextModels(filter?: {
        quality?: CatalogEntry['quality'];
        contentPermissions?: ContentIntent[];
    }): CatalogEntry[];
    /**
     * Return all image model entries, optionally filtered.
     * @param filter - Optional capability filter.
     */
    getImageModels(filter?: {
        capabilities?: string[];
    }): CatalogEntry[];
    /**
     * Return the preferred text model for a given policy tier.
     * Returns null for safe/standard tiers (use default censored model).
     * @param tier - Content policy tier.
     * @param contentIntent - Optional content intent for finer selection.
     */
    getPreferredTextModel(tier: PolicyTier, contentIntent?: ContentIntent): CatalogEntry | null;
    /**
     * Return the preferred image model for a given policy tier.
     * Returns null for safe/standard tiers.
     * @param tier - Content policy tier.
     * @param capabilities - Optional required capabilities.
     */
    getPreferredImageModel(tier: PolicyTier, capabilities?: string[]): CatalogEntry | null;
}
/**
 * Create a default {@link UncensoredModelCatalog} populated with curated
 * OpenRouter text models and Replicate image models.
 */
export declare function createUncensoredModelCatalog(): UncensoredModelCatalog;
//# sourceMappingURL=UncensoredModelCatalog.d.ts.map