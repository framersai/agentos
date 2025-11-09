// File: backend/agentos/core/tools/ToolOrchestrator.ts
/**
 * @fileoverview Implements the ToolOrchestrator class, which serves as the central
 * hub for managing, discovering, authorizing, and orchestrating the execution of tools
 * within the AgentOS system.
 *
 * The ToolOrchestrator acts as a facade over the `ToolPermissionManager` and `ToolExecutor`.
 * It provides a unified and simplified interface for higher-level components, such as GMIs
 * (Generalized Mind Instances) or the main AgentOS orchestrator, to interact with the tool ecosystem.
 *
 * Key Responsibilities:
 * - Tool Registration: Manages an internal registry of available `ITool` instances.
 * - Tool Discovery: Provides methods like `listAvailableTools()` to get tool definitions
 * suitable for LLM consumption (e.g., for function calling).
 * - Permission Enforcement: Collaborates with `IToolPermissionManager` to authorize tool calls
 * based on Persona capabilities, user subscriptions, or other defined policies.
 * - Execution Delegation: Delegates the actual tool execution (including argument validation)
 * to the `ToolExecutor`.
 * - Result Formatting: Standardizes and returns tool execution results (`ToolCallResult` for GMIs).
 * - Lifecycle Management: Handles initialization and shutdown of itself and potentially registered tools.
 *
 * @module backend/agentos/core/tools/ToolOrchestrator
 * @see ./IToolOrchestrator.ts for the interface definition.
 * @see ./ITool.ts for the core tool contract and related types like ToolExecutionResult.
 * @see ./IToolPermissionManager.ts for permission management logic and related types.
 * @see ./ToolExecutor.ts for the component that directly executes tools.
 * @see ../../config/ToolOrchestratorConfig.ts for configuration options.
 * @see ../../cognitive_substrate/IGMI.ts for GMI-related types like ToolCallRequest, ToolCallResult, UserContext.
 */

import { v4 as uuidv4 } from 'uuid';
import {
  IToolOrchestrator,
  ToolDefinitionForLLM,
} from './IToolOrchestrator';
import { ITool, JSONSchemaObject, ToolExecutionResult } from './ITool';
import { IToolPermissionManager, PermissionCheckContext, PermissionCheckResult } from './permissions/IToolPermissionManager';
import { ToolExecutor, ToolExecutionRequestDetails } from './ToolExecutor';
import { ToolOrchestratorConfig } from '../../config/ToolOrchestratorConfig';
import { ToolCallRequest, ToolCallResult, UserContext } from '../../cognitive_substrate/IGMI'; // Added ToolCallRequest
import { GMIError, GMIErrorCode, createGMIErrorFromError } from '@agentos/core/utils/errors';

/**
 * @class ToolOrchestrator
 * @implements {IToolOrchestrator}
 * @description The central component responsible for the comprehensive management of tools.
 * It orchestrates their registration, discovery, permission-based authorization, and execution,
 * acting as a crucial facade for higher-level system components like GMIs.
 */
export class ToolOrchestrator implements IToolOrchestrator {
  /**
   * A unique identifier for this ToolOrchestrator instance, useful for logging and telemetry.
   * @public
   * @readonly
   * @type {string}
   */
  public readonly orchestratorId: string;

  /**
   * Holds the resolved configuration for this orchestrator instance, merging defaults with user-provided settings.
   * @private
   * @type {Readonly<Required<ToolOrchestratorConfig>>}
   */
  private config!: Readonly<Required<ToolOrchestratorConfig>>;

  /**
   * An instance of the permission manager used to authorize tool calls.
   * @private
   * @type {IToolPermissionManager}
   */
  private permissionManager!: IToolPermissionManager;

  /**
   * An instance of the tool executor responsible for the actual invocation of tool logic.
   * @private
   * @type {ToolExecutor}
   */
  private toolExecutor!: ToolExecutor;

  /**
   * A flag indicating whether the orchestrator has been successfully initialized and is ready for operation.
   * @private
   * @type {boolean}
   */
  private isInitialized: boolean = false;

  /**
   * Default configuration values for the ToolOrchestrator.
   * These are applied if specific values are not provided during initialization, ensuring robust default behavior.
   * @private
   * @static
   * @readonly
   */
  private static readonly DEFAULT_CONFIG: Required<ToolOrchestratorConfig> = {
    orchestratorId: '', 
    defaultToolCallTimeoutMs: 30000, 
    maxConcurrentToolCalls: 10, 
    logToolCalls: true, 
    globalDisabledTools: [], 
    toolRegistrySettings: {
      allowDynamicRegistration: true, 
      persistRegistry: false, 
      persistencePath: undefined, 
    },
    customParameters: {}, 
  };

  /**
   * Constructs a ToolOrchestrator instance.
   * The orchestrator is not operational until the `initialize` method has been successfully called.
   * An `orchestratorId` is generated upon construction.
   */
  constructor() {
    this.orchestratorId = `tool-orch-${uuidv4()}`;
    this.config = { ...ToolOrchestrator.DEFAULT_CONFIG, orchestratorId: this.orchestratorId };
  }

  /**
   * @inheritdoc
   */
  public async initialize(
    config: ToolOrchestratorConfig | undefined, // Can be undefined
    permissionManager: IToolPermissionManager,
    toolExecutor: ToolExecutor,
    initialTools?: ITool[],
  ): Promise<void> {
    if (this.isInitialized) {
      console.warn(
        `ToolOrchestrator (ID: ${this.orchestratorId}): Attempting to re-initialize an already initialized instance. Existing tools will be cleared and re-registered if provided.`,
      );
      await this.shutdownRegisteredTools();
    }

    const baseConfig = { ...ToolOrchestrator.DEFAULT_CONFIG, orchestratorId: this.orchestratorId };
    this.config = Object.freeze({
        ...baseConfig,
        ...(config || {}), // Handle undefined config
        toolRegistrySettings: {
            ...baseConfig.toolRegistrySettings,
            ...(config?.toolRegistrySettings || {}),
        }
    });

    if (!permissionManager) {
        throw new GMIError('IToolPermissionManager dependency is required for ToolOrchestrator initialization.', GMIErrorCode.DEPENDENCY_ERROR, { orchestratorId: this.orchestratorId, missingDependency: 'IToolPermissionManager' });
    }
    if (!toolExecutor) {
        throw new GMIError('ToolExecutor dependency is required for ToolOrchestrator initialization.', GMIErrorCode.DEPENDENCY_ERROR, { orchestratorId: this.orchestratorId, missingDependency: 'ToolExecutor' });
    }

    this.permissionManager = permissionManager;
    this.toolExecutor = toolExecutor;

    if (initialTools && initialTools.length > 0) {
      console.log(`ToolOrchestrator (ID: ${this.orchestratorId}): Registering ${initialTools.length} initial tool(s)...`);
      for (const tool of initialTools) {
        try {
          await this.registerTool(tool);
        } catch (registrationError: any) {
            const errorMsg = `Failed to register initial tool '${tool.name || tool.id}': ${registrationError.message}`;
            console.error(`ToolOrchestrator (ID: ${this.orchestratorId}): ${errorMsg}`, registrationError.details || registrationError);
        }
      }
    }

    this.isInitialized = true;
    console.log(
      `ToolOrchestrator (ID: ${this.orchestratorId}) initialized. Registered tools: ${this.toolExecutor.listAvailableTools().length}. Logging tool calls: ${this.config.logToolCalls}.`,
    );
  }

  /**
   * Ensures the ToolOrchestrator instance has been initialized before allowing operations.
   * @private
   * @throws {GMIError} if the orchestrator is not initialized (`GMIErrorCode.NOT_INITIALIZED`).
   */
  private ensureInitialized(): void {
    if (!this.isInitialized) {
      throw new GMIError(
        `ToolOrchestrator (ID: ${this.orchestratorId}) is not initialized. Please call the initialize() method with valid configuration and dependencies.`,
        GMIErrorCode.NOT_INITIALIZED,
        { component: 'ToolOrchestrator', orchestratorId: this.orchestratorId }
      );
    }
  }

  /**
   * @inheritdoc
   */
  public async registerTool(tool: ITool): Promise<void> {
    this.ensureInitialized();
    if (!this.config.toolRegistrySettings.allowDynamicRegistration) {
      throw new GMIError(
        "Dynamic tool registration is disabled by the current ToolOrchestrator configuration.",
        GMIErrorCode.PERMISSION_DENIED,
        { toolName: tool?.name, orchestratorId: this.orchestratorId },
      );
    }
    if (!tool || typeof tool.name !== 'string' || !tool.name.trim() || typeof tool.id !== 'string' || !tool.id.trim()) {
      throw new GMIError(
        "Tool registration failed: The provided tool object is invalid or missing required 'id' or 'name' properties.",
        GMIErrorCode.INVALID_ARGUMENT,
        { receivedToolDetails: { id: tool?.id, name: tool?.name } },
      );
    }
    if (this.config.globalDisabledTools?.includes(tool.name) || this.config.globalDisabledTools?.includes(tool.id)) {
      console.warn(
        `ToolOrchestrator (ID: ${this.orchestratorId}): Registering tool '${tool.name}' (ID: '${tool.id}'), but it is listed as globally disabled. It may not be executable.`,
      );
    }
    await this.toolExecutor.registerTool(tool);
    console.log(
      `ToolOrchestrator (ID: ${this.orchestratorId}): Tool '${tool.name}' (ID: '${tool.id}', Version: ${tool.version || 'N/A'}) successfully registered.`,
    );
  }

  /**
   * @inheritdoc
   */
  public async unregisterTool(toolName: string): Promise<boolean> {
    this.ensureInitialized();
    if (!this.config.toolRegistrySettings.allowDynamicRegistration) {
      throw new GMIError(
        "Dynamic tool unregistration is disabled by the current ToolOrchestrator configuration.",
        GMIErrorCode.PERMISSION_DENIED,
        { toolName, orchestratorId: this.orchestratorId },
      );
    }
    const success = await this.toolExecutor.unregisterTool(toolName);
    if (success) {
      console.log(
        `ToolOrchestrator (ID: ${this.orchestratorId}): Tool '${toolName}' successfully unregistered.`,
      );
    } else {
      console.warn(
        `ToolOrchestrator (ID: ${this.orchestratorId}): Attempted to unregister tool '${toolName}', but it was not found in the registry.`,
      );
    }
    return success;
  }

  /**
   * @inheritdoc
   */
  public async getTool(toolName: string): Promise<ITool | undefined> {
    this.ensureInitialized();
    return this.toolExecutor.getTool(toolName);
  }

  /**
   * @inheritdoc
   */
  public async listAvailableTools(context?: {
    personaId?: string;
    personaCapabilities?: string[];
    userContext?: UserContext;
  }): Promise<ToolDefinitionForLLM[]> {
    this.ensureInitialized();
    const availableToolsLLM: ToolDefinitionForLLM[] = [];
    const activeTools = this.toolExecutor.listAvailableTools();

    for (const toolSummary of activeTools) {
      const tool = await this.getTool(toolSummary.name);
      if (!tool) {
        continue;
      }

      if (
        this.config.globalDisabledTools?.includes(tool.name) ||
        this.config.globalDisabledTools?.includes(tool.id)
      ) {
        if (this.config.logToolCalls) {
          console.log(
            `ToolOrchestrator (ID: ${this.orchestratorId}): Tool '${tool.name}' (ID: '${tool.id}') skipped from listing as it is globally disabled.`,
          );
        }
        continue;
      }

      if (context && context.personaId && context.userContext && context.personaCapabilities) {
        const permissionContext: PermissionCheckContext = {
          tool,
          personaId: context.personaId,
          personaCapabilities: context.personaCapabilities,
          userContext: context.userContext,
        };
        try {
          const permissionResult = await this.permissionManager.isExecutionAllowed(permissionContext);
          if (!permissionResult.isAllowed) {
            if (this.config.logToolCalls) {
              console.log(
                `ToolOrchestrator (ID: ${this.orchestratorId}): Tool '${tool.name}' filtered out for persona '${context.personaId}' due to permission policy. Reason: ${permissionResult.reason || 'N/A'}.`,
              );
            }
            continue;
          }
        } catch (permissionError: any) {
          console.error(
            `ToolOrchestrator (ID: ${this.orchestratorId}): Error while evaluating permissions for tool '${tool.name}'.`,
            permissionError,
          );
          continue;
        }
      }

      availableToolsLLM.push({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema as JSONSchemaObject,
        outputSchema: tool.outputSchema as JSONSchemaObject | undefined,
      });
    }

    return availableToolsLLM;
  }
/**
   * @inheritdoc
   */
  public async processToolCall(requestDetails: ToolExecutionRequestDetails): Promise<ToolCallResult> {
    this.ensureInitialized();
    const { toolCallRequest, gmiId, personaId, personaCapabilities, userContext } = requestDetails;
    
    // Check if toolCallRequest and toolCallRequest.name are valid
    if (!toolCallRequest || !toolCallRequest.name || typeof toolCallRequest.name !== 'string') {
      const errorMsg = "Invalid ToolCallRequest: 'name' is missing or not a string.";
      console.error(`ToolOrchestrator (ID: ${this.orchestratorId}): ${errorMsg}`, { requestDetails });
      return { toolCallId: toolCallRequest?.id || `invalid-call-${uuidv4()}`, toolName: "unknown", output: null, isError: true, errorDetails: { message: errorMsg, code: GMIErrorCode.VALIDATION_ERROR } };
    }
    const toolName = toolCallRequest.name;
    const llmProvidedCallId = toolCallRequest.id;

    const logPrefix = `ToolOrchestrator (ID: ${this.orchestratorId}, GMI: ${gmiId}, Persona: ${personaId}, LLMCallID: ${llmProvidedCallId}, Tool: ${toolName}):`;

    if (this.config.logToolCalls) {
      const argsPreview = JSON.stringify(toolCallRequest.arguments).substring(0, 200) + (JSON.stringify(toolCallRequest.arguments).length > 200 ? '...' : '');
      console.log(`${logPrefix} Received tool call request. Arguments preview: ${argsPreview}`);
    }

    const tool = await this.getTool(toolName);
    if (!tool) {
      const errorMsg = `Tool '${toolName}' not found in orchestrator's tool registry.`;
      console.error(`${logPrefix} ${errorMsg}`);
      return { toolCallId: llmProvidedCallId, toolName, output: null, isError: true, errorDetails: { message: errorMsg, code: GMIErrorCode.TOOL_NOT_FOUND } };
    }
    
    if (this.config.globalDisabledTools?.includes(tool.name) || this.config.globalDisabledTools?.includes(tool.id)) {
      const errorMsg = `Attempted to execute globally disabled tool '${toolName}' (ID: '${tool.id}'). Execution denied.`;
      console.warn(`${logPrefix} ${errorMsg}`);
      return { toolCallId: llmProvidedCallId, toolName, output: null, isError: true, errorDetails: { message: errorMsg, code: GMIErrorCode.PERMISSION_DENIED, reason: "Tool is globally disabled." } };
    }

    const permissionContext: PermissionCheckContext = { tool, personaId, personaCapabilities, userContext, gmiId };
    let permissionResult: PermissionCheckResult;
    try {
      permissionResult = await this.permissionManager.isExecutionAllowed(permissionContext);
    } catch (permError: any) {
      const errorMsg = `An unexpected error occurred during permission check for tool '${toolName}'.`;
      console.error(`${logPrefix} ${errorMsg}`, permError);
      const wrappedError = createGMIErrorFromError(permError, GMIErrorCode.PERMISSION_DENIED, permissionContext, errorMsg);
      return { toolCallId: llmProvidedCallId, toolName, output: null, isError: true, errorDetails: { message: wrappedError.message, code: wrappedError.code, details: wrappedError.details } };
    }

    if (!permissionResult.isAllowed) {
      const errorMsg = permissionResult.reason || `Permission denied by ToolPermissionManager for tool '${toolName}'.`;
      console.warn(`${logPrefix} ${errorMsg}`, permissionResult.details);
      return { toolCallId: llmProvidedCallId, toolName, output: null, isError: true, errorDetails: { message: errorMsg, code: GMIErrorCode.PERMISSION_DENIED, details: permissionResult.details } };
    }

    if (this.config.logToolCalls) {
      console.log(`${logPrefix} Permissions granted for tool '${toolName}'. Delegating execution to ToolExecutor.`);
    }

    let coreExecutorResult: ToolExecutionResult;
    try {
      coreExecutorResult = await this.toolExecutor.executeTool(requestDetails);
    } catch (executorPipelineError: any) {
      const errorMsg = `Critical error within ToolExecutor's internal pipeline while processing '${toolName}'. This is not an error from the tool's execute method itself.`;
      console.error(`${logPrefix} ${errorMsg}`, executorPipelineError);
      const wrappedError = createGMIErrorFromError(executorPipelineError, GMIErrorCode.TOOL_EXECUTION_FAILED, requestDetails, errorMsg);
      return { toolCallId: llmProvidedCallId, toolName, output: null, isError: true, errorDetails: { message: wrappedError.message, code: wrappedError.code, details: wrappedError.details } };
    }

    if (this.config.logToolCalls) {
      const outputPreview = coreExecutorResult.output ? JSON.stringify(coreExecutorResult.output).substring(0, 150) + (JSON.stringify(coreExecutorResult.output).length > 150 ? '...' : '') : 'N/A';
      console.log(`${logPrefix} Tool '${toolName}' execution completed by executor. Success: ${coreExecutorResult.success}. Output Preview: ${outputPreview}. Error: ${coreExecutorResult.error || 'N/A'}`);
    }
    
    return {
      toolCallId: llmProvidedCallId,
      toolName: toolName,
      output: coreExecutorResult.success ? coreExecutorResult.output : null,
      isError: !coreExecutorResult.success,
      errorDetails: !coreExecutorResult.success ? {
        message: coreExecutorResult.error || `Tool '${toolName}' reported failure without a specific error message.`,
        details: coreExecutorResult.details,
      } : undefined,
    };
  }

  /**
   * @inheritdoc
   */
  public async checkHealth(): Promise<{ isHealthy: boolean; details?: any }> {
    this.ensureInitialized();
    let pmHealth = { isHealthy: true, details: "ToolPermissionManager: Health not explicitly checked or no checkHealth method available." };
    if(this.permissionManager && typeof (this.permissionManager as any).checkHealth === 'function') {
      try { pmHealth = await (this.permissionManager as any).checkHealth(); }
      catch (e: any) { pmHealth = {isHealthy: false, details: `Failed to retrieve ToolPermissionManager health: ${e.message}`}; }
    }

    let execHealth = { isHealthy: true, details: "ToolExecutor: Health not explicitly checked or no checkHealth method available." };
    if(this.toolExecutor && typeof (this.toolExecutor as any).checkHealth === 'function') {
      try { execHealth = await (this.toolExecutor as any).checkHealth(); }
      catch (e: any) { execHealth = {isHealthy: false, details: `Failed to retrieve ToolExecutor health: ${e.message}`}; }
    }

    const isOverallHealthy = this.isInitialized && pmHealth.isHealthy && execHealth.isHealthy;
    return {
      isHealthy: isOverallHealthy,
      details: {
        orchestratorId: this.orchestratorId,
        status: this.isInitialized ? 'INITIALIZED' : 'NOT_INITIALIZED',
        registeredToolCount: this.toolExecutor.listAvailableTools().length,
        configSnapshot: {
          logToolCalls: this.config.logToolCalls,
          allowDynamicRegistration: this.config.toolRegistrySettings.allowDynamicRegistration,
          globalDisabledToolsCount: this.config.globalDisabledTools.length,
        },
        permissionManagerStatus: pmHealth,
        toolExecutorStatus: execHealth,
      },
    };
  }
  
  /**
   * Shuts down all registered tools that implement the `shutdown` method.
   * Prefers using `ToolExecutor.shutdownAllTools()` if available.
   * @private
   * @async
   */
  private async shutdownRegisteredTools(): Promise<void> {
    console.log(
      `ToolOrchestrator (ID: ${this.orchestratorId}): Initiating shutdown for registered tools via ToolExecutor.`,
    );
    if (this.toolExecutor && typeof this.toolExecutor.shutdownAllTools === 'function') {
      try {
        await this.toolExecutor.shutdownAllTools();
        console.log(
          `ToolOrchestrator (ID: ${this.orchestratorId}): ToolExecutor successfully completed shutdownAllTools.`,
        );
      } catch (e: any) {
        console.error(
          `ToolOrchestrator (ID: ${this.orchestratorId}): Error during ToolExecutor.shutdownAllTools: ${e.message}`,
          e,
        );
      }
    }
  }

  /**
   * @inheritdoc
   */
  public async shutdown(): Promise<void> {
    if (!this.isInitialized) {
      console.log(`ToolOrchestrator (ID: ${this.orchestratorId}): Shutdown called, but orchestrator was not initialized or already shut down.`);
      return;
    }
    console.log(`ToolOrchestrator (ID: ${this.orchestratorId}): Initiating shutdown sequence...`);
    
    await this.shutdownRegisteredTools();
    
    this.isInitialized = false; 
    console.log(`ToolOrchestrator (ID: ${this.orchestratorId}) shut down complete. All tools processed for shutdown and registry cleared.`);
  }
}
