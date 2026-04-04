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
/**
 * Policy-aware router that wraps an optional base router and injects
 * uncensored model selection for mature/private-adult policy tiers.
 */
export class PolicyAwareRouter {
    /**
     * @param catalog - Uncensored model catalog for mature/private-adult lookup.
     * @param baseRouter - Optional delegate for safe/standard tiers.
     * @param overrides - Per-tier model ID overrides that bypass catalog lookup.
     * @param defaultPolicyTier - Fallback tier when params.policyTier is absent.
     */
    constructor(catalog, baseRouter, overrides, defaultPolicyTier) {
        this.routerId = 'policy_aware_router_v1';
        this.catalog = catalog;
        this.baseRouter = baseRouter ?? null;
        this.overrides = overrides ?? {};
        this.defaultPolicyTier = defaultPolicyTier;
    }
    /**
     * No-op initialization. The PolicyAwareRouter is stateless beyond its
     * constructor arguments; it does not require async setup.
     */
    async initialize(_config, _providerManager, _promptEngine) {
        // Intentionally empty: catalog is injected, no async work needed.
    }
    /**
     * Select a model based on the request's policy tier.
     *
     * - safe / standard / absent (no default): delegate to baseRouter or return null.
     * - mature / private-adult: check overrides, then catalog, return OpenRouter result.
     */
    async selectModel(params, availableModels) {
        const tier = params.policyTier ?? this.defaultPolicyTier;
        // Safe / standard / absent tier: delegate or return null
        if (!tier || tier === 'safe' || tier === 'standard') {
            if (this.baseRouter) {
                return this.baseRouter.selectModel(params, availableModels);
            }
            return null;
        }
        // Check per-tier override first
        const overrideModelId = this.overrides[tier];
        if (overrideModelId) {
            return this.buildResult(overrideModelId, 'openrouter', `Override for ${tier} tier`);
        }
        // Consult catalog
        const entry = this.catalog.getPreferredTextModel(tier, params.contentIntent);
        if (entry) {
            return this.buildResult(entry.modelId, entry.providerId, `Catalog selection for ${tier} tier (${entry.displayName})`);
        }
        return null;
    }
    /**
     * Build a minimal {@link ModelRouteResult} with a stub provider.
     * The provider stub satisfies the interface contract while signalling to
     * upstream consumers that the actual provider instance must be resolved
     * from the provider manager using the returned providerId.
     */
    buildResult(modelId, providerId, reasoning) {
        return {
            provider: {
                providerId,
                isInitialized: false,
                async initialize() { },
                async generateCompletion() {
                    throw new Error('Stub provider — resolve via AIModelProviderManager');
                },
                // eslint-disable-next-line require-yield
                async *generateCompletionStream() {
                    throw new Error('Stub provider — resolve via AIModelProviderManager');
                },
                async generateEmbeddings() {
                    throw new Error('Stub provider — resolve via AIModelProviderManager');
                },
                async listAvailableModels() {
                    return [];
                },
                async getModelInfo() {
                    return undefined;
                },
                async checkHealth() {
                    return { isHealthy: false };
                },
                async shutdown() { },
            },
            modelId,
            modelInfo: {
                modelId,
                providerId,
                capabilities: ['chat'],
            },
            reasoning,
            confidence: 0.85,
            metadata: { source: this.routerId, policyRouted: true },
        };
    }
}
//# sourceMappingURL=PolicyAwareRouter.js.map