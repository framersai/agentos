/**
 * @fileoverview Policy-aware model router that selects uncensored LLMs for
 * mature/private-adult content policy tiers.
 *
 * For safe/standard tiers (or when no policy tier is specified), the router
 * delegates to an optional base router or returns null, letting the caller
 * fall back to its own default model. For mature/private-adult tiers, it
 * consults the {@link UncensoredModelCatalog} and returns an OpenRouter model
 * wrapped in a minimal {@link ModelRouteResult}.
 *
 * @module core/llm/routing/PolicyAwareRouter
 */
import type { IModelRouter, ModelRouteParams, ModelRouteResult } from './IModelRouter';
import type { ModelInfo } from '../providers/IProvider';
import type { UncensoredModelCatalog, PolicyTier } from './UncensoredModelCatalog';
/**
 * Manual override map: policyTier -> fixed modelId.
 * When provided, bypasses catalog lookup for the specified tier.
 */
export type PolicyOverrides = Partial<Record<PolicyTier, string>>;
/**
 * Policy-aware router that wraps an optional base router and injects
 * uncensored model selection for mature/private-adult policy tiers.
 */
export declare class PolicyAwareRouter implements IModelRouter {
    readonly routerId = "policy_aware_router_v1";
    private readonly catalog;
    private readonly baseRouter;
    private readonly overrides;
    private readonly defaultPolicyTier;
    /**
     * @param catalog - Uncensored model catalog for mature/private-adult lookup.
     * @param baseRouter - Optional delegate for safe/standard tiers.
     * @param overrides - Per-tier model ID overrides that bypass catalog lookup.
     * @param defaultPolicyTier - Fallback tier when params.policyTier is absent.
     */
    constructor(catalog: UncensoredModelCatalog, baseRouter?: IModelRouter | null, overrides?: PolicyOverrides, defaultPolicyTier?: PolicyTier);
    /**
     * No-op initialization. The PolicyAwareRouter is stateless beyond its
     * constructor arguments; it does not require async setup.
     */
    initialize(_config: Record<string, any>, _providerManager: any, _promptEngine?: any): Promise<void>;
    /**
     * Select a model based on the request's policy tier.
     *
     * - safe / standard / absent (no default): delegate to baseRouter or return null.
     * - mature / private-adult: check overrides, then catalog, return OpenRouter result.
     */
    selectModel(params: ModelRouteParams, availableModels?: ModelInfo[]): Promise<ModelRouteResult | null>;
    /**
     * Build a minimal {@link ModelRouteResult} with a stub provider.
     * The provider stub satisfies the interface contract while signalling to
     * upstream consumers that the actual provider instance must be resolved
     * from the provider manager using the returned providerId.
     */
    private buildResult;
}
//# sourceMappingURL=PolicyAwareRouter.d.ts.map