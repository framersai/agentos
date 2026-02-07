/**
 * @fileoverview Implements the ToolExecutor class, responsible for the direct
 * execution of tools conforming to the ITool interface. It handles critical
 * aspects like input argument validation against JSON schemas and invoking
 * the tool's core logic.
 *
 * @module backend/agentos/core/tools/ToolExecutor
 * @see ./ITool.ts for ITool, ToolExecutionResult, ToolExecutionContext.
 * @see ../cognitive_substrate/IGMI.ts for ToolCallRequest, UserContext.
 * @see @framers/agentos/utils/errors.ts for GMIError, GMIErrorCode, createGMIErrorFromError.
 */
import { ITool, ToolExecutionResult } from './ITool';
import { ToolCallRequest, UserContext } from '../../cognitive_substrate/IGMI';
import type { IAuthService, ISubscriptionService } from '../../services/user_auth/types';
import { ExtensionRegistry } from '../../extensions';
/**
 * @interface ToolExecutionRequestDetails
 * @description Encapsulates all necessary information for the `ToolExecutor` to execute a tool.
 * This includes the specific tool call request (typically originating from an LLM),
 * and crucial contextual information about the invoking GMI, Persona, and User.
 *
 * @property {ToolCallRequest} toolCallRequest - The raw tool call request containing the target tool's
 * function name and its arguments (usually as a JSON string or pre-parsed object).
 * @property {string} gmiId - The ID of the GMI (Generalized Mind Instance) initiating the tool call.
 * @property {string} personaId - The ID of the active Persona within the GMI.
 * @property {string[]} personaCapabilities - Capabilities of the active Persona, used for preliminary checks.
 * @property {UserContext} userContext - Contextual information about the end-user.
 * @property {string} [correlationId] - Optional ID for tracing this specific execution across logs and systems.
 */
export interface ToolExecutionRequestDetails {
    toolCallRequest: ToolCallRequest;
    gmiId: string;
    personaId: string;
    personaCapabilities: string[];
    userContext: UserContext;
    correlationId?: string;
}
/**
 * @class ToolExecutor
 * @description Manages a registry of `ITool` instances and robustly handles their execution.
 * Key responsibilities include validating input arguments against each tool's defined JSON schema
 * using Ajv, and then invoking the tool's `execute` method with the appropriate `ToolExecutionContext`.
 * It ensures that tools are called correctly and their outputs (or errors) are processed consistently.
 */
export declare class ToolExecutor {
    private readonly toolRegistry;
    private readonly directRegistrations;
    private readonly authService?;
    private readonly subscriptionService?;
    /**
     * Instance of Ajv for JSON schema validation.
     * Note: The TS2709 error "Cannot use namespace 'Ajv' as a type" might indicate
     * an issue with TypeScript configuration (e.g., esModuleInterop) or Ajv's type
     * definitions version mismatch if it persists. The `import Ajv from 'ajv';`
     * and `ajv: Ajv` usage with `new Ajv()` is standard for Ajv v8+.
     * @private
     * @type {InstanceType<typeof Ajv>}
     */
    private readonly ajv;
    /**
    * Creates an instance of ToolExecutor.
    * Initializes an empty tool registry and configures an Ajv instance for JSON schema validation.
    * Default tools can be registered via `registerDefaultTools` or explicitly.
    *
    * @constructor
    * @param {IAuthService} [authService] - Optional. An instance of an authentication service.
    * Used for potential future integration with more complex user-specific permission checks directly within the executor,
    * though primary permission logic resides in `ToolPermissionManager`.
    * @param {ISubscriptionService} [subscriptionService] - Optional. An instance of a subscription service.
    * Similarly used for potential future feature-based tool access control at the executor level.
    */
    constructor(authService?: IAuthService, subscriptionService?: ISubscriptionService, toolRegistry?: ExtensionRegistry<ITool>);
    /**
    * Registers a tool with the executor, making it available for subsequent execution.
    * Tools are indexed by their functional `name` property, which must be unique within the registry.
    *
    * @public
    * @param {ITool} tool - The tool instance to register. It must conform to the `ITool` interface.
    * @returns {void}
    * @throws {GMIError} If the tool is invalid (e.g., missing `id` or `name` - `GMIErrorCode.INVALID_ARGUMENT`),
    * or if a tool with the same functional `name` is already registered (`GMIErrorCode.ALREADY_EXISTS`).
    */
    registerTool(tool: ITool): Promise<void>;
    /**
    * Retrieves a registered tool instance by its functional name.
    *
    * @public
    * @param {string} toolName - The `name` of the tool (as specified in `ITool.name` and used in `ToolCallRequest.name`).
    * @returns {ITool | undefined} The `ITool` instance if found in the registry; otherwise, `undefined`.
    */
    getTool(toolName: string): ITool | undefined;
    /**
    * Unregisters a tool from the executor using its functional name.
    * If the tool has a `shutdown` method, it is called prior to removal from the registry.
    *
    * @public
    * @async
    * @param {string} toolName - The `name` of the tool to unregister.
    * @returns {Promise<boolean>} A promise resolving to `true` if the tool was found and successfully unregistered (including its shutdown, if applicable), `false` otherwise.
    */
    unregisterTool(toolName: string): Promise<boolean>;
    /**
    * Returns an array of definitions for all currently registered tools.
    * This list typically includes essential information like the tool's name, description,
    * input/output schemas, category, and required capabilities, making it suitable for
    * LLM consumption for function calling or for UI display.
    *
    * @public
    * @returns {Array<Pick<ITool, 'name' | 'description' | 'inputSchema' | 'outputSchema' | 'displayName' | 'category' | 'requiredCapabilities'>>}
    * An array of partial tool information objects.
    */
    listAvailableTools(): Array<Pick<ITool, 'name' | 'description' | 'inputSchema' | 'outputSchema' | 'displayName' | 'category' | 'requiredCapabilities'>>;
    /**
    * Executes a specified tool based on the details provided in a `ToolExecutionRequestDetails` object.
    * This is the core method of the executor, orchestrating validation, context preparation,
    * actual tool invocation, and result packaging.
    *
    * @public
    * @async
    * @param {ToolExecutionRequestDetails} requestDetails - An object containing all necessary details for the tool execution,
    * including the `ToolCallRequest` from the LLM and contextual GMI/user information.
    * @returns {Promise<ToolExecutionResult>} A promise that resolves with the `ToolExecutionResult` object.
    * This result indicates the success or failure of the execution and provides the tool's output or error details.
    */
    executeTool(requestDetails: ToolExecutionRequestDetails): Promise<ToolExecutionResult>;
    /** @private
    * Registers example tools. In a production system, tools would be loaded dynamically or via configuration.
    */
    private createDescriptorFromTool;
    private registerDefaultTools;
    /**
    * Gracefully shuts down all registered tools that implement the optional `shutdown` method.
    * This is typically called when the ToolExecutor itself is being shut down as part of a larger
    * application termination sequence.
    *
    * @public
    * @async
    * @returns {Promise<void[]>} A promise that resolves when all tool shutdown attempts are complete.
    * Individual tool shutdown errors are logged but do not prevent other tools from attempting shutdown.
    */
    shutdownAllTools(): Promise<void[]>;
}
//# sourceMappingURL=ToolExecutor.d.ts.map