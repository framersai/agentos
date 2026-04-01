// File: backend/agentos/core/llm/routing/ModelRouter.ts
/**
 * Custom error class for ModelRouter specific operational errors.
 * @class ModelRouterError
 * @extends {Error}
 */
export class ModelRouterError extends Error {
    /**
     * Creates an instance of ModelRouterError.
     * @param {string} message - A human-readable description of the error.
     * @param {string} code - A unique code identifying the type of error.
     * @param {unknown} [details] - Optional details or context about the error.
     */
    constructor(message, code, details) {
        super(message);
        this.name = 'ModelRouterError';
        this.code = code;
        this.details = details;
        Object.setPrototypeOf(this, ModelRouterError.prototype);
    }
}
/**
 * @class ModelRouter
 * @implements {IModelRouter}
 * A rule-based implementation of `IModelRouter`. It selects an AI model by evaluating
 * a configured set of rules in order of priority. This router is designed to be
 * flexible and extensible through declarative rules and custom condition evaluators.
 */
export class ModelRouter {
    /**
     * Constructs a ModelRouter instance.
     * The router must be initialized via `initialize()` before use.
     */
    constructor() {
        /** @inheritdoc */
        this.routerId = 'rule_based_router_v1.1'; // Version incremented
        this.isInitialized = false;
    }
    /**
     * Ensures the router has been properly initialized.
     * @private
     * @throws {ModelRouterError} If not initialized.
     */
    ensureInitialized() {
        if (!this.isInitialized) {
            throw new ModelRouterError('ModelRouter is not initialized. Call initialize() first.', 'NOT_INITIALIZED');
        }
    }
    /** @inheritdoc */
    async initialize(config, // Using the more specific ModelRouterConfig
    providerManager, 
    // PromptEngine is not used by this rule-based router implementation, but kept for interface compliance if needed elsewhere.
    _promptEngine) {
        if (!config) {
            throw new ModelRouterError("Configuration object is required for ModelRouter initialization.", 'INIT_CONFIG_MISSING');
        }
        if (!config.rules || !Array.isArray(config.rules)) {
            throw new ModelRouterError("Configuration 'rules' array is required.", 'INIT_RULES_MISSING');
        }
        if (!config.defaultProviderId || !config.defaultModelId) {
            throw new ModelRouterError("Configuration requires 'defaultProviderId' and 'defaultModelId'.", 'INIT_DEFAULTS_MISSING');
        }
        if (!providerManager) {
            throw new ModelRouterError('AIModelProviderManager instance is required for ModelRouter initialization.', 'INIT_PROVIDER_MANAGER_MISSING');
        }
        this.config = {
            ...config,
            rules: [...config.rules].sort((a, b) => (a.priority || 0) - (b.priority || 0)), // Sort rules by priority
            customConditionEvaluators: config.customConditionEvaluators || {},
            defaultReasoning: config.defaultReasoning || 'Default model selection as no specific rules matched.',
        };
        this.providerManager = providerManager;
        this.isInitialized = true;
        console.log(`ModelRouter (${this.routerId}) initialized with ${this.config.rules.length} rules.`);
    }
    /** @inheritdoc */
    async selectModel(params, availableModels // Router can use this or fetch its own
    ) {
        this.ensureInitialized();
        const allKnownModels = availableModels || await this.providerManager.listAllAvailableModels();
        if (allKnownModels.length === 0) {
            console.warn("ModelRouter: No models available from AIModelProviderManager. Cannot route.");
            return null;
        }
        const contextQuery = params.query?.toLowerCase() || '';
        const contextTaskHint = params.taskHint?.toLowerCase() || '';
        const combinedSearchText = `${contextQuery} ${contextTaskHint}`.trim();
        for (const rule of this.config.rules) {
            let conditionsMet = true;
            // Check queryOrTaskHintContains
            if (rule.conditions.queryOrTaskHintContains) {
                if (!combinedSearchText || !rule.conditions.queryOrTaskHintContains.some(keyword => combinedSearchText.includes(keyword.toLowerCase()))) {
                    conditionsMet = false;
                }
            }
            // Check requestingAgentId
            if (conditionsMet && rule.conditions.requestingAgentId && rule.conditions.requestingAgentId !== params.requestingAgentId) {
                conditionsMet = false;
            }
            // Check personaId
            if (conditionsMet && rule.conditions.personaId && rule.conditions.personaId !== params.personaId) {
                conditionsMet = false;
            }
            // Check optimizationPreference
            if (conditionsMet && rule.conditions.optimizationPreference && rule.conditions.optimizationPreference !== params.optimizationPreference) {
                conditionsMet = false;
            }
            // Check language
            if (conditionsMet && rule.conditions.language && rule.conditions.language.toLowerCase() !== params.language?.toLowerCase()) {
                conditionsMet = false;
            }
            // If basic conditions met, fetch target model info to check capabilities
            let targetModelInfo;
            if (conditionsMet) {
                targetModelInfo = allKnownModels.find(m => m.modelId === rule.action.modelId && m.providerId === rule.action.providerId);
                if (!targetModelInfo) {
                    conditionsMet = false; // Target model specified in rule not found/available
                }
            }
            // Check requiredCapabilities against the targetModelInfo
            if (conditionsMet && targetModelInfo && rule.conditions.requiredCapabilities) {
                if (!rule.conditions.requiredCapabilities.every(reqCap => targetModelInfo.capabilities.includes(reqCap))) {
                    conditionsMet = false;
                }
            }
            // Check customCondition
            if (conditionsMet && rule.conditions.customCondition) {
                const evaluator = this.config.customConditionEvaluators[rule.conditions.customCondition];
                if (evaluator) {
                    try {
                        if (!(await evaluator(params, rule.conditions.customConditionParams || {}))) {
                            conditionsMet = false;
                        }
                    }
                    catch (evalError) {
                        console.error(`ModelRouter: Error evaluating custom condition '${rule.conditions.customCondition}' for rule '${rule.id}':`, evalError);
                        conditionsMet = false; // Treat evaluation error as condition not met
                    }
                }
                else {
                    console.warn(`ModelRouter: Custom condition evaluator '${rule.conditions.customCondition}' not found for rule '${rule.id}'. Rule skipped.`);
                    conditionsMet = false; // Skip rule if evaluator is missing
                }
            }
            if (conditionsMet && targetModelInfo) {
                const provider = this.providerManager.getProvider(targetModelInfo.providerId);
                if (provider?.isInitialized) {
                    console.log(`ModelRouter (${this.routerId}): Rule '${rule.id}' matched. Selecting model '${targetModelInfo.modelId}' on provider '${targetModelInfo.providerId}'.`);
                    return {
                        provider: provider,
                        modelId: targetModelInfo.modelId,
                        modelInfo: targetModelInfo,
                        reasoning: rule.action.reasoning || rule.description || `Matched rule '${rule.id}'`,
                        estimatedCostTier: rule.action.estimatedCostTier,
                        confidence: 0.9, // High confidence for explicit rule match
                        metadata: { matchedRuleId: rule.id, source: this.routerId },
                    };
                }
                else {
                    console.warn(`ModelRouter (${this.routerId}): Rule '${rule.id}' matched, but provider '${targetModelInfo.providerId}' for model '${targetModelInfo.modelId}' is not available or initialized.`);
                }
            }
        }
        // If no rules matched, use defaults
        const defaultProvider = this.providerManager.getProvider(this.config.defaultProviderId);
        if (defaultProvider?.isInitialized) {
            const defaultModelInfo = allKnownModels.find(m => m.modelId === this.config.defaultModelId && m.providerId === this.config.defaultProviderId);
            if (defaultModelInfo) {
                console.log(`ModelRouter (${this.routerId}): No specific rules matched. Using default model '${defaultModelInfo.modelId}' on provider '${defaultModelInfo.providerId}'.`);
                return {
                    provider: defaultProvider,
                    modelId: defaultModelInfo.modelId,
                    modelInfo: defaultModelInfo,
                    reasoning: this.config.defaultReasoning,
                    confidence: 0.5, // Lower confidence for default
                    metadata: { usingDefaults: true, source: this.routerId },
                };
            }
            else {
                console.warn(`ModelRouter (${this.routerId}): Default model '${this.config.defaultModelId}' on provider '${this.config.defaultProviderId}' not found in available models.`);
            }
        }
        else {
            console.warn(`ModelRouter (${this.routerId}): Default provider '${this.config.defaultProviderId}' not found or not initialized.`);
        }
        console.error(`ModelRouter (${this.routerId}): No rules matched AND default model/provider configuration is invalid or unavailable. Cannot select a model.`);
        return null; // No model could be selected
    }
}
//# sourceMappingURL=ModelRouter.js.map