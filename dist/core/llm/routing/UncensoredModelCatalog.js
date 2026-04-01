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
// ---------------------------------------------------------------------------
// Built-in catalog data
// ---------------------------------------------------------------------------
/** Curated text models available via OpenRouter. */
const TEXT_MODELS = [
    {
        modelId: 'nousresearch/hermes-3-llama-3.1-405b',
        displayName: 'Hermes 3 405B',
        providerId: 'openrouter',
        modality: 'text',
        quality: 'high',
        contentPermissions: ['general', 'romantic', 'erotic', 'violent', 'horror'],
        capabilities: ['chat', 'tool_use', 'json_mode'],
    },
    {
        modelId: 'cognitivecomputations/dolphin-mixtral-8x22b',
        displayName: 'Dolphin Mixtral 8x22B',
        providerId: 'openrouter',
        modality: 'text',
        quality: 'high',
        contentPermissions: ['general', 'romantic', 'erotic', 'violent', 'horror'],
        capabilities: ['chat', 'tool_use'],
    },
    {
        modelId: 'nousresearch/hermes-3-llama-3.1-70b',
        displayName: 'Hermes 3 70B',
        providerId: 'openrouter',
        modality: 'text',
        quality: 'medium',
        contentPermissions: ['general', 'romantic', 'erotic', 'violent', 'horror'],
        capabilities: ['chat', 'tool_use', 'json_mode'],
    },
    {
        modelId: 'undi95/toppy-m-7b',
        displayName: 'Toppy M 7B',
        providerId: 'openrouter',
        modality: 'text',
        quality: 'low',
        contentPermissions: ['general', 'romantic', 'erotic'],
        capabilities: ['chat'],
    },
    {
        modelId: 'gryphe/mythomax-l2-13b',
        displayName: 'MythoMax L2 13B',
        providerId: 'openrouter',
        modality: 'text',
        quality: 'low',
        contentPermissions: ['general', 'romantic', 'violent', 'horror'],
        capabilities: ['chat'],
    },
];
/** Curated image models available via Replicate. */
const IMAGE_MODELS = [
    {
        modelId: 'lucataco/realvisxl-v4.0',
        displayName: 'RealVisXL v4.0',
        providerId: 'replicate',
        modality: 'image',
        quality: 'high',
        contentPermissions: ['general', 'romantic', 'erotic'],
        capabilities: ['txt2img', 'img2img', 'photorealistic'],
    },
    {
        modelId: 'stability-ai/sdxl',
        displayName: 'SDXL',
        providerId: 'replicate',
        modality: 'image',
        quality: 'high',
        contentPermissions: ['general', 'romantic', 'erotic', 'violent', 'horror'],
        capabilities: ['txt2img', 'img2img'],
    },
    {
        modelId: 'zsxkib/instant-id',
        displayName: 'Instant ID',
        providerId: 'replicate',
        modality: 'image',
        quality: 'medium',
        contentPermissions: ['general', 'romantic'],
        capabilities: ['txt2img', 'face-consistency'],
    },
    {
        modelId: 'lucataco/ip-adapter-faceid-sdxl',
        displayName: 'IP-Adapter FaceID SDXL',
        providerId: 'replicate',
        modality: 'image',
        quality: 'medium',
        contentPermissions: ['general', 'romantic', 'erotic'],
        capabilities: ['txt2img', 'img2img', 'face-consistency'],
    },
    {
        modelId: 'lucataco/animate-diff',
        displayName: 'AnimateDiff',
        providerId: 'replicate',
        modality: 'image',
        quality: 'medium',
        contentPermissions: ['general', 'romantic', 'violent'],
        capabilities: ['txt2img', 'video'],
    },
    {
        modelId: 'stability-ai/stable-video-diffusion',
        displayName: 'Stable Video Diffusion',
        providerId: 'replicate',
        modality: 'image',
        quality: 'high',
        contentPermissions: ['general', 'romantic'],
        capabilities: ['img2video', 'video'],
    },
];
// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------
/**
 * Create a default {@link UncensoredModelCatalog} populated with curated
 * OpenRouter text models and Replicate image models.
 */
export function createUncensoredModelCatalog() {
    return {
        getTextModels(filter) {
            let results = [...TEXT_MODELS];
            if (filter?.quality) {
                results = results.filter((e) => e.quality === filter.quality);
            }
            if (filter?.contentPermissions?.length) {
                results = results.filter((e) => filter.contentPermissions.every((p) => e.contentPermissions.includes(p)));
            }
            return results;
        },
        getImageModels(filter) {
            let results = [...IMAGE_MODELS];
            if (filter?.capabilities?.length) {
                results = results.filter((e) => filter.capabilities.every((c) => e.capabilities.includes(c)));
            }
            return results;
        },
        getPreferredTextModel(tier, contentIntent) {
            if (tier === 'safe' || tier === 'standard') {
                return null;
            }
            let candidates = [...TEXT_MODELS];
            // Filter by content intent when provided
            if (contentIntent) {
                candidates = candidates.filter((e) => e.contentPermissions.includes(contentIntent));
            }
            // For private-adult tier, prioritize models known to be truly uncensored.
            // Hermes/Dolphin claim to be uncensored but still refuse some content.
            // MythoMax and Toppy are consistently permissive.
            if (tier === 'private-adult') {
                const trulyUncensored = ['gryphe/mythomax-l2-13b', 'undi95/toppy-m-7b', 'cognitivecomputations/dolphin-mixtral-8x22b'];
                candidates.sort((a, b) => {
                    const aIdx = trulyUncensored.indexOf(a.modelId);
                    const bIdx = trulyUncensored.indexOf(b.modelId);
                    if (aIdx !== -1 && bIdx !== -1)
                        return aIdx - bIdx;
                    if (aIdx !== -1)
                        return -1;
                    if (bIdx !== -1)
                        return 1;
                    return 0;
                });
                return candidates[0] ?? null;
            }
            // For mature tier, prefer higher quality (Hermes works for non-explicit content)
            const qualityOrder = {
                high: 0,
                medium: 1,
                low: 2,
            };
            candidates.sort((a, b) => qualityOrder[a.quality] - qualityOrder[b.quality]);
            return candidates[0] ?? null;
        },
        getPreferredImageModel(tier, capabilities) {
            if (tier === 'safe' || tier === 'standard') {
                return null;
            }
            let candidates = [...IMAGE_MODELS];
            if (capabilities?.length) {
                candidates = candidates.filter((e) => capabilities.every((c) => e.capabilities.includes(c)));
            }
            // Sort: high > medium > low
            const qualityOrder = {
                high: 0,
                medium: 1,
                low: 2,
            };
            candidates.sort((a, b) => qualityOrder[a.quality] - qualityOrder[b.quality]);
            return candidates[0] ?? null;
        },
    };
}
//# sourceMappingURL=UncensoredModelCatalog.js.map