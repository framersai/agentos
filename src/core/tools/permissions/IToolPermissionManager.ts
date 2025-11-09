// File: backend/agentos/core/tools/permissions/IToolPermissionManager.ts
/**
 * @fileoverview Defines the IToolPermissionManager interface, responsible for
 * determining if a tool execution is authorized based on various criteria such as
 * Persona capabilities, user subscriptions, and potentially other contextual rules.
 *
 * @module backend/agentos/core/tools/IToolPermissionManager
 * @see ./ITool.ts for ITool definition (which includes requiredCapabilities).
 * @see ../cognitive_substrate/IGMI.ts for UserContext.
 * @see ../../../../services/user_auth/IAuthService.ts for authentication context.
 * @see ../../../../services/user_auth/SubscriptionService.ts for subscription and feature flags.
 */

import { ITool } from '../ITool';
import { UserContext } from '../../../cognitive_substrate/IGMI'; // Path from core/tools/ to cognitive_substrate/
import type { IAuthService, ISubscriptionService } from '../../../services/user_auth/types';

/**
 * @interface FeatureFlag
 * @description Defines the structure for a feature flag, used to gate access to tools
 * based on user subscriptions or specific entitlements.
 *
 * @property {string} flag - The unique string identifier for the feature flag (e.g., "CAN_USE_ADVANCED_SEARCH_TOOL").
 * @property {string} [description] - Optional. A human-readable description of the feature.
 */
export interface FeatureFlag {
  flag: string;
  description?: string;
}

/**
 * Represents the context required for making a permission decision for tool usage.
 * This object aggregates all necessary information that the `IToolPermissionManager`
 * needs to evaluate whether a tool call should be allowed.
 *
 * @interface PermissionCheckContext
 * @property {ITool} tool - The actual `ITool` instance for which permission is being checked.
 * This provides access to tool metadata like `id`, `name`, and `requiredCapabilities`.
 * @property {string} personaId - The unique identifier of the active Persona within the GMI
 * that is attempting to use the tool.
 * @property {string[]} personaCapabilities - An array of capability strings (e.g., "filesystem:read", "api:weather")
 * currently possessed by the active Persona.
 * @property {UserContext} userContext - The context of the end-user associated with the current request,
 * which may include `userId`, preferences, skill level, etc.
 * @property {string} [gmiId] - Optional. The unique identifier of the GMI instance making the request.
 * Useful for logging or more granular GMI-specific rules.
 */
export interface PermissionCheckContext {
  tool: ITool;
  personaId: string;
  personaCapabilities: string[];
  userContext: UserContext;
  gmiId?: string;
}

/**
 * Represents the result of a permission check performed by the `IToolPermissionManager`.
 *
 * @interface PermissionCheckResult
 * @property {boolean} isAllowed - `true` if the tool execution is permitted based on the evaluated context, `false` otherwise.
 * @property {string} [reason] - An optional human-readable string explaining why the permission was
 * granted or denied. This is useful for logging, debugging, or providing feedback to users/developers.
 * @property {Record<string, any>} [details] - An optional object for any additional details or metadata
 * related to the permission decision (e.g., specific capability missing, subscription feature lacking, policy rule invoked).
 */
export interface PermissionCheckResult {
  isAllowed: boolean;
  reason?: string;
  details?: Record<string, any>;
}

/**
 * Configuration options for the `ToolPermissionManager`.
 * This allows administrators to fine-tune how tool permissions are evaluated and enforced.
 *
 * @interface ToolPermissionManagerConfig
 * @property {boolean} [strictCapabilityChecking=true] - If `true` (default), the Persona must possess *all*
 * capabilities listed in the `tool.requiredCapabilities` array. If `false`, this check might be bypassed
 * or handled with more leniency (though generally not recommended for tools accessing sensitive resources).
 * @property {Record<string, FeatureFlag[]>} [toolToSubscriptionFeatures] - Optional. A mapping where keys are
 * tool IDs (`ITool.id`) or tool names (`ITool.name`), and values are arrays of `FeatureFlag` objects (or their string identifiers).
 * This allows linking specific tools to subscription features, meaning a user must have the corresponding
 * features enabled via their subscription tier to use the tool.
 * @property {boolean} [logToolCalls=false] - If true, detailed information about permission checks for tool calls will be logged. Defaults to false.
 * @example
 * // Example: Only users with "AdvancedAnalysisTools" and "PremiumSupport" features can use "financial_data_analyzer_v2"
 * const config: ToolPermissionManagerConfig = {
 * strictCapabilityChecking: true,
 * logToolCalls: true,
 * toolToSubscriptionFeatures: {
 * "financial_data_analyzer_v2": [
 * { flag: "FEATURE_ADVANCED_ANALYSIS", description: "Access to advanced analysis tools" },
 * { flag: "FEATURE_PREMIUM_SUPPORT_TOOLS", description: "Access to tools included with premium support" }
 * ]
 * }
 * };
 */
export interface ToolPermissionManagerConfig {
  strictCapabilityChecking?: boolean;
  toolToSubscriptionFeatures?: Record<string, FeatureFlag[]>;
  logToolCalls?: boolean; // Added this line
}


/**
 * @interface IToolPermissionManager
 * @description Defines the contract for a service responsible for managing and enforcing
 * permissions related to tool execution within the AgentOS ecosystem. Implementations of this
 * interface will centralize the logic for checking Persona capabilities, user subscription
 * features, and any other custom authorization rules before a tool is allowed to execute.
 */
export interface IToolPermissionManager {
  /**
   * Initializes the ToolPermissionManager with its specific configuration and any
   * necessary service dependencies (like authentication or subscription services).
   * This method must be called successfully before the manager can process permission checks.
   *
   * @public
   * @async
   * @param {ToolPermissionManagerConfig} config - The configuration object for the permission manager,
   * defining its operational parameters and rules.
   * @param {IAuthService} [authService] - Optional. An instance of the authentication service. This might be used
   * for more complex permission rules based on user roles, identity verification status, or other authentication attributes.
   * @param {ISubscriptionService} [subscriptionService] - Optional. An instance of the subscription service. This is
   * crucial if tool access is tied to user subscription tiers or specific feature flags defined in `ToolPermissionManagerConfig`.
   * @returns {Promise<void>} A promise that resolves upon successful initialization of the manager.
   * @throws {GMIError | Error} If initialization fails due to invalid configuration or issues with dependencies.
   */
  initialize(
    config: ToolPermissionManagerConfig,
    authService?: IAuthService,
    subscriptionService?: ISubscriptionService,
  ): Promise<void>;

  /**
   * Checks if the execution of a given tool is permitted based on the comprehensive context provided.
   * This is the primary method for authorizing tool calls. It should consolidate all relevant checks, including:
   * - Persona capabilities against `tool.requiredCapabilities`.
   * - User subscription features against `config.toolToSubscriptionFeatures`.
   * - Any other custom rules or policies defined within the implementation.
   *
   * @public
   * @async
   * @param {PermissionCheckContext} context - The context object containing all necessary information
   * for the permission decision (the tool instance, persona details, user context, etc.).
   * @returns {Promise<PermissionCheckResult>} A promise that resolves with a `PermissionCheckResult` object,
   * which includes a boolean `isAllowed` flag and an optional `reason` and `details` for the decision.
   *
   * @example
   * const permissionContext = {
   * tool: myCalculatorTool,
   * personaId: "calculator-persona",
   * personaCapabilities: ["execute_basic_math"],
   * userContext: { userId: "user-test-123" }
   * };
   * const result = await permissionManager.isExecutionAllowed(permissionContext);
   * if (result.isAllowed) {
   * console.log("Calculator tool execution permitted.");
   * } else {
   * console.warn(`Calculator tool execution denied: ${result.reason}`, result.details);
   * }
   */
  isExecutionAllowed(context: PermissionCheckContext): Promise<PermissionCheckResult>;

  /**
   * Performs a specific check to determine if a Persona possesses all the capabilities
   * explicitly listed as required by a tool.
   *
   * @public
   * @param {string[]} personaCapabilities - An array of capability strings currently held by the Persona.
   * @param {string[] | undefined} toolRequiredCapabilities - An array of capability strings defined as required by the tool.
   * If `undefined` or empty, this check inherently passes (tool requires no specific capabilities).
   * @returns {boolean} `true` if the Persona possesses all capabilities required by the tool, `false` otherwise.
   */
  hasRequiredCapabilities(
    personaCapabilities: string[],
    toolRequiredCapabilities: string[] | undefined,
  ): boolean;

  /**
   * Performs a specific check to determine if a user's subscription plan includes the
   * necessary features or flags that are configured as prerequisites for using a particular tool.
   * This relies on the `ISubscriptionService` and the `toolToSubscriptionFeatures` mapping
   * in the `ToolPermissionManagerConfig`.
   *
   * @public
   * @async
   * @param {string} userId - The ID of the user whose subscription is being checked.
   * @param {string} toolIdOrName - The unique ID (`ITool.id`) or functional name (`ITool.name`) of the tool.
   * @returns {Promise<{isAllowed: boolean, missingFeatures?: FeatureFlag[], reason?: string}>}
   * An object indicating if access is allowed by subscription. If `isAllowed` is `false`,
   * `missingFeatures` (if applicable) will list the specific subscription features the user lacks,
   * and `reason` may provide additional context.
   * @throws {GMIError} If the `ISubscriptionService` is not configured but this check is invoked
   * for a tool that has required features (`GMIErrorCode.CONFIGURATION_ERROR` or `EXTERNAL_SERVICE_ERROR`).
   */
  checkToolSubscriptionAccess(
    userId: string,
    toolIdOrName: string
  ): Promise<{isAllowed: boolean, missingFeatures?: FeatureFlag[], reason?: string}>;

  /**
   * Retrieves the list of `FeatureFlag`s that are configured as being required for a specific tool.
   * This information is sourced from the `toolToSubscriptionFeatures` mapping in the manager's configuration.
   *
   * @public
   * @param {string} toolIdOrName - The ID or name of the tool.
   * @returns {FeatureFlag[] | undefined} An array of `FeatureFlag` objects required for the tool,
   * or `undefined` if no specific features are mapped as required for this tool.
   */
  getRequiredFeaturesForTool(toolIdOrName: string): FeatureFlag[] | undefined;
}
