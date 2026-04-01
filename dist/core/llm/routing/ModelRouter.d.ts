/**
 * @fileoverview Implements a rule-based model router for AgentOS.
 * This router selects an AI model and provider by evaluating a prioritized list of configurable rules
 * against the provided `ModelRouteParams`. It supports conditions based on task hints,
 * agent IDs, required capabilities, optimization preferences, language, and custom evaluators.
 * If no rules match, it falls back to a configured default model and provider.
 *
 * This implementation aims for clarity, extensibility through custom conditions, and adherence
 * to the `IModelRouter` interface.
 *
 * @module backend/agentos/core/llm/routing/ModelRouter
 * @implements {IModelRouter}
 */
import { IModelRouter, ModelRouteParams, ModelRouteResult } from './IModelRouter';
import { ModelInfo } from '../providers/IProvider';
import { AIModelProviderManager } from '../providers/AIModelProviderManager';
/**
 * Custom error class for ModelRouter specific operational errors.
 * @class ModelRouterError
 * @extends {Error}
 */
export declare class ModelRouterError extends Error {
    /**
     * A unique code identifying the type of error.
     * @example 'INITIALIZATION_FAILED', 'RULE_EVALUATION_ERROR', 'NO_MODEL_MATCHED'
     */
    readonly code: string;
    /** Optional details or context about the error. */
    readonly details?: unknown;
    /**
     * Creates an instance of ModelRouterError.
     * @param {string} message - A human-readable description of the error.
     * @param {string} code - A unique code identifying the type of error.
     * @param {unknown} [details] - Optional details or context about the error.
     */
    constructor(message: string, code: string, details?: unknown);
}
/**
 * Defines a single routing rule that determines model selection based on conditions.
 * Rules are evaluated in order of priority.
 */
export interface RoutingRule {
    /** A unique identifier for the rule, useful for logging and debugging. */
    id: string;
    /** An optional description of the rule's purpose and logic. */
    description?: string;
    /**
     * Priority of the rule. Lower numbers are evaluated first.
     * @default 0
     */
    priority?: number;
    /**
     * A set of conditions that must ALL be met for this rule's action to be applied.
     * If a condition field is omitted, it is not checked.
     */
    conditions: {
        /** Keywords or regex patterns to match in `ModelRouteParams.query` or `ModelRouteParams.taskHint`. Case-insensitive. */
        queryOrTaskHintContains?: string[];
        /** Matches `ModelRouteParams.requestingAgentId`. */
        requestingAgentId?: string;
        /** Matches `ModelRouteParams.personaId`. */
        personaId?: string;
        /**
         * All specified capabilities must be present in the candidate model's `ModelInfo.capabilities`.
         * @example ["tool_use", "json_mode"]
         */
        requiredCapabilities?: string[];
        /** Matches `ModelRouteParams.optimizationPreference`. */
        optimizationPreference?: ModelRouteParams['optimizationPreference'];
        /** Matches `ModelRouteParams.language`. */
        language?: string;
        /**
         * Name of a custom condition evaluator function registered with the router.
         * Allows for complex, programmatic condition checking.
         * @example "isUserPremiumTier"
         */
        customCondition?: string;
        /** Parameters to be passed to the `customCondition` evaluator function. */
        customConditionParams?: Record<string, unknown>;
    };
    /** The action to take if all conditions are met, specifying the target model and provider. */
    action: {
        /** ID of the provider to use (must be configured in `AIModelProviderManager`). */
        providerId: string;
        /** ID of the model to use on that provider. */
        modelId: string;
        /** Optional reasoning for this choice, to be included in `ModelRouteResult.reasoning`. */
        reasoning?: string;
        /** Optional classification of the estimated cost tier (e.g., "low", "medium", "high"). */
        estimatedCostTier?: ModelRouteResult['estimatedCostTier'];
    };
}
/**
 * Configuration for the `ModelRouter`.
 */
export interface ModelRouterConfig {
    /**
     * An array of routing rules. These are sorted by priority before evaluation.
     * @see {@link RoutingRule}
     */
    rules: RoutingRule[];
    /**
     * Default provider ID to use if no rules match or if a matched rule's provider is unavailable.
     * This provider must be configured in the `AIModelProviderManager`.
     */
    defaultProviderId: string;
    /**
     * Default model ID to use if no rules match.
     * This model must be available on the `defaultProviderId`.
     */
    defaultModelId: string;
    /** Optional reasoning to use when the default model is selected. */
    defaultReasoning?: string;
    /**
     * A map of custom condition evaluator functions.
     * The key is the `customCondition` string specified in a rule's conditions,
     * and the value is the evaluator function.
     * The function receives `ModelRouteParams` and the rule's `customConditionParams`,
     * and should return `true` if the condition is met, `false` otherwise.
     * @example
     * customConditionEvaluators: {
     * "isUserPremiumTier": async (params, ruleParams) => params.userSubscriptionTier?.isPremium || false
     * }
     */
    customConditionEvaluators?: Record<string, (params: ModelRouteParams, conditionParams: Record<string, unknown>) => Promise<boolean> | boolean>;
}
/**
 * @class ModelRouter
 * @implements {IModelRouter}
 * A rule-based implementation of `IModelRouter`. It selects an AI model by evaluating
 * a configured set of rules in order of priority. This router is designed to be
 * flexible and extensible through declarative rules and custom condition evaluators.
 */
export declare class ModelRouter implements IModelRouter {
    /** @inheritdoc */
    readonly routerId = "rule_based_router_v1.1";
    private config;
    private providerManager;
    private isInitialized;
    /**
     * Constructs a ModelRouter instance.
     * The router must be initialized via `initialize()` before use.
     */
    constructor();
    /**
     * Ensures the router has been properly initialized.
     * @private
     * @throws {ModelRouterError} If not initialized.
     */
    private ensureInitialized;
    /** @inheritdoc */
    initialize(config: ModelRouterConfig, // Using the more specific ModelRouterConfig
    providerManager: AIModelProviderManager, _promptEngine?: any): Promise<void>;
    /** @inheritdoc */
    selectModel(params: ModelRouteParams, availableModels?: ModelInfo[]): Promise<ModelRouteResult | null>;
}
//# sourceMappingURL=ModelRouter.d.ts.map