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
import { uuidv4 } from '../../core/utils/uuid.js';
import { GMIError, GMIErrorCode, createGMIErrorFromError } from '../../core/utils/errors.js';
import { DEFAULT_EMERGENT_CONFIG } from '../../emergent/types.js';
import { DEFAULT_SELF_IMPROVEMENT_CONFIG } from '../../emergent/SelfImprovementConfig.js';
import { EmergentCapabilityEngine } from '../../emergent/EmergentCapabilityEngine.js';
import { ComposableToolBuilder } from '../../emergent/ComposableToolBuilder.js';
import { SandboxedToolForge } from '../../emergent/SandboxedToolForge.js';
import { EmergentJudge } from '../../emergent/EmergentJudge.js';
import { EmergentToolRegistry } from '../../emergent/EmergentToolRegistry.js';
import { ForgeToolMetaTool } from '../../emergent/ForgeToolMetaTool.js';
/**
 * @class ToolOrchestrator
 * @implements {IToolOrchestrator}
 * @description The central component responsible for the comprehensive management of tools.
 * It orchestrates their registration, discovery, permission-based authorization, and execution,
 * acting as a crucial facade for higher-level system components like GMIs.
 */
export class ToolOrchestrator {
    /**
     * Constructs a ToolOrchestrator instance.
     * The orchestrator is not operational until the `initialize` method has been successfully called.
     * An `orchestratorId` is generated upon construction.
     */
    constructor() {
        /**
         * A flag indicating whether the orchestrator has been successfully initialized and is ready for operation.
         * @private
         * @type {boolean}
         */
        this.isInitialized = false;
        this.orchestratorId = `tool-orch-${uuidv4()}`;
        this.config = { ...ToolOrchestrator.DEFAULT_CONFIG, orchestratorId: this.orchestratorId };
    }
    /**
     * @inheritdoc
     */
    async initialize(config, // Can be undefined
    permissionManager, toolExecutor, initialTools, hitlManager, emergentOptions) {
        if (this.isInitialized) {
            console.warn(`ToolOrchestrator (ID: ${this.orchestratorId}): Attempting to re-initialize an already initialized instance. Existing tools will be cleared and re-registered if provided.`);
            await this.shutdownRegisteredTools();
        }
        const baseConfig = { ...ToolOrchestrator.DEFAULT_CONFIG, orchestratorId: this.orchestratorId };
        this.config = Object.freeze({
            ...baseConfig,
            ...(config || {}), // Handle undefined config
            toolRegistrySettings: {
                ...baseConfig.toolRegistrySettings,
                ...(config?.toolRegistrySettings || {}),
            },
            hitl: {
                ...baseConfig.hitl,
                ...(config?.hitl || {}),
            },
        });
        if (!permissionManager) {
            throw new GMIError('IToolPermissionManager dependency is required for ToolOrchestrator initialization.', GMIErrorCode.DEPENDENCY_ERROR, { orchestratorId: this.orchestratorId, missingDependency: 'IToolPermissionManager' });
        }
        if (!toolExecutor) {
            throw new GMIError('ToolExecutor dependency is required for ToolOrchestrator initialization.', GMIErrorCode.DEPENDENCY_ERROR, { orchestratorId: this.orchestratorId, missingDependency: 'ToolExecutor' });
        }
        this.permissionManager = permissionManager;
        this.toolExecutor = toolExecutor;
        this.hitlManager = hitlManager;
        if (initialTools && initialTools.length > 0) {
            console.log(`ToolOrchestrator (ID: ${this.orchestratorId}): Registering ${initialTools.length} initial tool(s)...`);
            for (const tool of initialTools) {
                try {
                    // Initial tools are part of bootstrapping and should be registered even if
                    // dynamic registration is disabled. We also allow this while uninitialized.
                    await this.registerInitialTool(tool);
                }
                catch (registrationError) {
                    const errorMsg = `Failed to register initial tool '${tool.name || tool.id}': ${registrationError.message}`;
                    console.error(`ToolOrchestrator (ID: ${this.orchestratorId}): ${errorMsg}`, registrationError.details || registrationError);
                }
            }
        }
        // -----------------------------------------------------------------------
        // Emergent Capability Engine (optional — only when emergent: true)
        // -----------------------------------------------------------------------
        if (emergentOptions?.enabled) {
            const selfImprovementConfig = emergentOptions.config?.selfImprovement
                ? {
                    ...DEFAULT_SELF_IMPROVEMENT_CONFIG,
                    ...emergentOptions.config.selfImprovement,
                    personality: {
                        ...DEFAULT_SELF_IMPROVEMENT_CONFIG.personality,
                        ...(emergentOptions.config.selfImprovement.personality ?? {}),
                    },
                    skills: {
                        ...DEFAULT_SELF_IMPROVEMENT_CONFIG.skills,
                        ...(emergentOptions.config.selfImprovement.skills ?? {}),
                    },
                    workflows: {
                        ...DEFAULT_SELF_IMPROVEMENT_CONFIG.workflows,
                        ...(emergentOptions.config.selfImprovement.workflows ?? {}),
                    },
                    selfEval: {
                        ...DEFAULT_SELF_IMPROVEMENT_CONFIG.selfEval,
                        ...(emergentOptions.config.selfImprovement.selfEval ?? {}),
                    },
                }
                : undefined;
            const emergentConfig = {
                ...DEFAULT_EMERGENT_CONFIG,
                ...(emergentOptions.config ?? {}),
                ...(selfImprovementConfig ? { selfImprovement: selfImprovementConfig } : {}),
                enabled: true,
            };
            // ComposableToolBuilder — wired to this orchestrator's own tool execution
            // so that composed tools can invoke any registered tool.
            const composableBuilder = new ComposableToolBuilder(async (toolName, args, context) => {
                const tool = await this.getTool(toolName);
                if (!tool) {
                    return { success: false, error: `Tool "${toolName}" not found in orchestrator.` };
                }
                return tool.execute(args, context);
            });
            // SandboxedToolForge — uses config-driven resource limits.
            const sandboxForge = new SandboxedToolForge({
                memoryMB: emergentConfig.sandboxMemoryMB,
                timeoutMs: emergentConfig.sandboxTimeoutMs,
            });
            // EmergentJudge — wired to the provided generateText callback, or a
            // no-op stub that rejects all tools when no LLM is configured.
            const generateText = emergentOptions.generateText ??
                (async () => {
                    throw new Error('No LLM provider configured for the emergent judge.');
                });
            const judge = new EmergentJudge({
                judgeModel: emergentConfig.judgeModel,
                promotionModel: emergentConfig.promotionJudgeModel,
                generateText,
            });
            const registry = new EmergentToolRegistry(emergentConfig, emergentOptions.storageAdapter);
            await registry.ensureSchema();
            // Assemble the engine.
            this.emergentEngine = new EmergentCapabilityEngine({
                config: emergentConfig,
                composableBuilder,
                sandboxForge,
                judge,
                registry,
                onToolForged: async (_tool, executable) => {
                    await this.registerInitialTool(executable);
                },
                onToolPromoted: async (tool) => {
                    await this.emergentDiscoveryIndexer?.([tool]);
                },
            });
            // Create and register the forge_tool meta-tool.
            const forgeMetaTool = new ForgeToolMetaTool(this.emergentEngine);
            await this.registerInitialTool(forgeMetaTool);
            console.log(`ToolOrchestrator (ID: ${this.orchestratorId}): Emergent capability engine initialized. ` +
                `forge_tool meta-tool registered.`);
            // -----------------------------------------------------------------
            // Self-improvement tools (conditional on selfImprovement.enabled)
            // -----------------------------------------------------------------
            // Creates up to 4 tools: adapt_personality, manage_skills,
            // create_workflow, self_evaluate. Each tool is individually
            // try-caught inside the engine so missing modules are gracefully
            // skipped. Registration uses the same registerInitialTool path as
            // forge_tool above.
            if (emergentConfig.selfImprovement?.enabled && emergentOptions.selfImprovementDeps) {
                try {
                    const selfImprovementTools = await this.emergentEngine.createSelfImprovementTools(emergentOptions.selfImprovementDeps);
                    for (const tool of selfImprovementTools) {
                        await this.registerInitialTool(tool);
                    }
                    if (selfImprovementTools.length > 0) {
                        console.log(`ToolOrchestrator (ID: ${this.orchestratorId}): Self-improvement tools registered: ` +
                            `${selfImprovementTools.map((t) => t.name).join(', ')}.`);
                    }
                }
                catch (selfImprovementError) {
                    // Non-fatal — the agent operates without self-improvement.
                    console.warn(`ToolOrchestrator (ID: ${this.orchestratorId}): Failed to create self-improvement tools: ` +
                        `${selfImprovementError.message ?? selfImprovementError}`);
                }
            }
        }
        this.isInitialized = true;
        console.log(`ToolOrchestrator (ID: ${this.orchestratorId}) initialized. Registered tools: ${this.toolExecutor.listAvailableTools().length}. Logging tool calls: ${this.config.logToolCalls}.`);
    }
    async registerInitialTool(tool) {
        if (!tool ||
            typeof tool.name !== 'string' ||
            !tool.name.trim() ||
            typeof tool.id !== 'string' ||
            !tool.id.trim()) {
            throw new GMIError("Tool registration failed: The provided tool object is invalid or missing required 'id' or 'name' properties.", GMIErrorCode.INVALID_ARGUMENT, { receivedToolDetails: { id: tool?.id, name: tool?.name } });
        }
        if (this.config.globalDisabledTools?.includes(tool.name) ||
            this.config.globalDisabledTools?.includes(tool.id)) {
            console.warn(`ToolOrchestrator (ID: ${this.orchestratorId}): Registering tool '${tool.name}' (ID: '${tool.id}'), but it is listed as globally disabled. It may not be executable.`);
        }
        await this.toolExecutor.registerTool(tool);
        console.log(`ToolOrchestrator (ID: ${this.orchestratorId}): Tool '${tool.name}' (ID: '${tool.id}', Version: ${tool.version || 'N/A'}) successfully registered.`);
    }
    classifySideEffectCategory(tool) {
        const raw = String(tool.category || '').toLowerCase();
        if (raw.includes('finance') || raw.includes('billing') || raw.includes('payment'))
            return 'financial';
        if (raw.includes('comm') || raw.includes('email') || raw.includes('sms'))
            return 'communication';
        if (raw.includes('file') ||
            raw.includes('storage') ||
            raw.includes('db') ||
            raw.includes('data'))
            return 'data_modification';
        if (raw.includes('network') || raw.includes('api') || raw.includes('web'))
            return 'external_api';
        if (raw.includes('system') || raw.includes('admin'))
            return 'system';
        return 'other';
    }
    /**
     * Ensures the ToolOrchestrator instance has been initialized before allowing operations.
     * @private
     * @throws {GMIError} if the orchestrator is not initialized (`GMIErrorCode.NOT_INITIALIZED`).
     */
    ensureInitialized() {
        if (!this.isInitialized) {
            throw new GMIError(`ToolOrchestrator (ID: ${this.orchestratorId}) is not initialized. Please call the initialize() method with valid configuration and dependencies.`, GMIErrorCode.NOT_INITIALIZED, { component: 'ToolOrchestrator', orchestratorId: this.orchestratorId });
        }
    }
    /**
     * @inheritdoc
     */
    async registerTool(tool) {
        this.ensureInitialized();
        if (!this.config.toolRegistrySettings.allowDynamicRegistration) {
            throw new GMIError('Dynamic tool registration is disabled by the current ToolOrchestrator configuration.', GMIErrorCode.PERMISSION_DENIED, { toolName: tool?.name, orchestratorId: this.orchestratorId });
        }
        if (!tool ||
            typeof tool.name !== 'string' ||
            !tool.name.trim() ||
            typeof tool.id !== 'string' ||
            !tool.id.trim()) {
            throw new GMIError("Tool registration failed: The provided tool object is invalid or missing required 'id' or 'name' properties.", GMIErrorCode.INVALID_ARGUMENT, { receivedToolDetails: { id: tool?.id, name: tool?.name } });
        }
        if (this.config.globalDisabledTools?.includes(tool.name) ||
            this.config.globalDisabledTools?.includes(tool.id)) {
            console.warn(`ToolOrchestrator (ID: ${this.orchestratorId}): Registering tool '${tool.name}' (ID: '${tool.id}'), but it is listed as globally disabled. It may not be executable.`);
        }
        await this.toolExecutor.registerTool(tool);
        console.log(`ToolOrchestrator (ID: ${this.orchestratorId}): Tool '${tool.name}' (ID: '${tool.id}', Version: ${tool.version || 'N/A'}) successfully registered.`);
    }
    /**
     * @inheritdoc
     */
    async unregisterTool(toolName) {
        this.ensureInitialized();
        if (!this.config.toolRegistrySettings.allowDynamicRegistration) {
            throw new GMIError('Dynamic tool unregistration is disabled by the current ToolOrchestrator configuration.', GMIErrorCode.PERMISSION_DENIED, { toolName, orchestratorId: this.orchestratorId });
        }
        const success = await this.toolExecutor.unregisterTool(toolName);
        if (success) {
            console.log(`ToolOrchestrator (ID: ${this.orchestratorId}): Tool '${toolName}' successfully unregistered.`);
        }
        else {
            console.warn(`ToolOrchestrator (ID: ${this.orchestratorId}): Attempted to unregister tool '${toolName}', but it was not found in the registry.`);
        }
        return success;
    }
    /**
     * @inheritdoc
     */
    async getTool(toolName) {
        this.ensureInitialized();
        return this.toolExecutor.getTool(toolName);
    }
    /**
     * @inheritdoc
     */
    async listAvailableTools(context) {
        this.ensureInitialized();
        const availableToolsLLM = [];
        const activeTools = this.toolExecutor.listAvailableTools();
        for (const toolSummary of activeTools) {
            const tool = await this.getTool(toolSummary.name);
            if (!tool) {
                continue;
            }
            if (this.config.globalDisabledTools?.includes(tool.name) ||
                this.config.globalDisabledTools?.includes(tool.id)) {
                if (this.config.logToolCalls) {
                    console.log(`ToolOrchestrator (ID: ${this.orchestratorId}): Tool '${tool.name}' (ID: '${tool.id}') skipped from listing as it is globally disabled.`);
                }
                continue;
            }
            if (context && context.personaId && context.userContext && context.personaCapabilities) {
                const permissionContext = {
                    tool,
                    personaId: context.personaId,
                    personaCapabilities: context.personaCapabilities,
                    userContext: context.userContext,
                };
                try {
                    const permissionResult = await this.permissionManager.isExecutionAllowed(permissionContext);
                    if (!permissionResult.isAllowed) {
                        if (this.config.logToolCalls) {
                            console.log(`ToolOrchestrator (ID: ${this.orchestratorId}): Tool '${tool.name}' filtered out for persona '${context.personaId}' due to permission policy. Reason: ${permissionResult.reason || 'N/A'}.`);
                        }
                        continue;
                    }
                }
                catch (permissionError) {
                    console.error(`ToolOrchestrator (ID: ${this.orchestratorId}): Error while evaluating permissions for tool '${tool.name}'.`, permissionError);
                    continue;
                }
            }
            availableToolsLLM.push({
                name: tool.name,
                description: tool.description,
                inputSchema: tool.inputSchema,
                outputSchema: tool.outputSchema,
            });
        }
        return availableToolsLLM;
    }
    /**
     * Lists only the tools that appear in a CapabilityDiscoveryResult.
     * Filters the full tool registry to only include tools whose names
     * match capabilities in the Tier 1 or Tier 2 results.
     *
     * This dramatically reduces the tool list sent to the LLM,
     * preventing context rot from unused tool schemas.
     */
    async listDiscoveredTools(discoveryResult, context) {
        this.ensureInitialized();
        // Collect tool names from Tier 1 and Tier 2 results
        const discoveredToolNames = new Set();
        for (const item of discoveryResult.tier1) {
            if (item.capability.kind === 'tool') {
                discoveredToolNames.add(item.capability.name);
            }
        }
        for (const item of discoveryResult.tier2) {
            if (item.capability.kind === 'tool') {
                discoveredToolNames.add(item.capability.name);
            }
        }
        // Always include the discovery meta-tools
        discoveredToolNames.add('discover_capabilities');
        discoveredToolNames.add('load_capability_extension');
        // Get all available tools and filter to discovered ones
        const allTools = await this.listAvailableTools(context);
        return allTools.filter((tool) => discoveredToolNames.has(tool.name));
    }
    /**
     * @inheritdoc
     */
    async processToolCall(requestDetails) {
        this.ensureInitialized();
        const { toolCallRequest, gmiId, personaId, personaCapabilities, userContext } = requestDetails;
        // Check if toolCallRequest and toolCallRequest.name are valid
        if (!toolCallRequest || !toolCallRequest.name || typeof toolCallRequest.name !== 'string') {
            const errorMsg = "Invalid ToolCallRequest: 'name' is missing or not a string.";
            console.error(`ToolOrchestrator (ID: ${this.orchestratorId}): ${errorMsg}`, {
                requestDetails,
            });
            return {
                toolCallId: toolCallRequest?.id || `invalid-call-${uuidv4()}`,
                toolName: 'unknown',
                output: null,
                isError: true,
                errorDetails: { message: errorMsg, code: GMIErrorCode.VALIDATION_ERROR },
            };
        }
        const toolName = toolCallRequest.name;
        const llmProvidedCallId = toolCallRequest.id;
        const logPrefix = `ToolOrchestrator (ID: ${this.orchestratorId}, GMI: ${gmiId}, Persona: ${personaId}, LLMCallID: ${llmProvidedCallId}, Tool: ${toolName}):`;
        if (this.config.logToolCalls) {
            const argsPreview = JSON.stringify(toolCallRequest.arguments).substring(0, 200) +
                (JSON.stringify(toolCallRequest.arguments).length > 200 ? '...' : '');
            console.log(`${logPrefix} Received tool call request. Arguments preview: ${argsPreview}`);
        }
        if (this.config.globalDisabledTools?.includes(toolName)) {
            const errorMsg = `Attempted to execute globally disabled tool '${toolName}'. Execution denied.`;
            console.warn(`${logPrefix} ${errorMsg}`);
            return {
                toolCallId: llmProvidedCallId,
                toolName,
                output: null,
                isError: true,
                errorDetails: {
                    message: errorMsg,
                    code: GMIErrorCode.PERMISSION_DENIED,
                    reason: 'Tool is globally disabled.',
                },
            };
        }
        const tool = await this.getTool(toolName);
        if (!tool) {
            const errorMsg = `Tool '${toolName}' not found in orchestrator's tool registry.`;
            console.error(`${logPrefix} ${errorMsg}`);
            return {
                toolCallId: llmProvidedCallId,
                toolName,
                output: null,
                isError: true,
                errorDetails: { message: errorMsg, code: GMIErrorCode.TOOL_NOT_FOUND },
            };
        }
        if (this.config.globalDisabledTools?.includes(tool.name) ||
            this.config.globalDisabledTools?.includes(tool.id)) {
            const errorMsg = `Attempted to execute globally disabled tool '${toolName}' (ID: '${tool.id}'). Execution denied.`;
            console.warn(`${logPrefix} ${errorMsg}`);
            return {
                toolCallId: llmProvidedCallId,
                toolName,
                output: null,
                isError: true,
                errorDetails: {
                    message: errorMsg,
                    code: GMIErrorCode.PERMISSION_DENIED,
                    reason: 'Tool is globally disabled.',
                },
            };
        }
        const permissionContext = {
            tool,
            personaId,
            personaCapabilities,
            userContext,
            gmiId,
        };
        let permissionResult;
        try {
            permissionResult = await this.permissionManager.isExecutionAllowed(permissionContext);
        }
        catch (permError) {
            const errorMsg = `An unexpected error occurred during permission check for tool '${toolName}'.`;
            console.error(`${logPrefix} ${errorMsg}`, permError);
            const wrappedError = createGMIErrorFromError(permError, GMIErrorCode.PERMISSION_DENIED, permissionContext, errorMsg);
            return {
                toolCallId: llmProvidedCallId,
                toolName,
                output: null,
                isError: true,
                errorDetails: {
                    message: wrappedError.message,
                    code: wrappedError.code,
                    details: wrappedError.details,
                },
            };
        }
        if (!permissionResult.isAllowed) {
            const errorMsg = permissionResult.reason ||
                `Permission denied by ToolPermissionManager for tool '${toolName}'.`;
            console.warn(`${logPrefix} ${errorMsg}`, permissionResult.details);
            return {
                toolCallId: llmProvidedCallId,
                toolName,
                output: null,
                isError: true,
                errorDetails: {
                    message: errorMsg,
                    code: GMIErrorCode.PERMISSION_DENIED,
                    details: permissionResult.details,
                },
            };
        }
        // Optional HITL gating for side-effect tools.
        const hitlConfig = this.config.hitl;
        const requiresSideEffectsApproval = Boolean(hitlConfig?.enabled) &&
            (hitlConfig?.requireApprovalForSideEffects ?? true) &&
            tool.hasSideEffects === true;
        if (requiresSideEffectsApproval) {
            if (!this.hitlManager) {
                const autoApprove = Boolean(hitlConfig?.autoApproveWhenNoManager);
                if (!autoApprove) {
                    const errorMsg = `Tool '${toolName}' has side effects and requires approval, but no HITL manager is configured.`;
                    console.warn(`${logPrefix} ${errorMsg}`);
                    return {
                        toolCallId: llmProvidedCallId,
                        toolName,
                        output: null,
                        isError: true,
                        errorDetails: {
                            message: errorMsg,
                            code: GMIErrorCode.PERMISSION_DENIED,
                            reason: 'HITL manager missing',
                            details: { hitlEnabled: true, toolHasSideEffects: true },
                        },
                    };
                }
            }
            else {
                const actionId = `tool:${gmiId}:${personaId}:${toolName}:${llmProvidedCallId || uuidv4()}`;
                const severity = (hitlConfig?.defaultSideEffectsSeverity ?? 'high');
                const argsPreview = (() => {
                    try {
                        const raw = JSON.stringify(toolCallRequest.arguments);
                        return raw.length > 800 ? raw.slice(0, 800) + '...' : raw;
                    }
                    catch {
                        return '[unserializable args]';
                    }
                })();
                const pending = {
                    actionId,
                    description: `Execute tool '${toolName}' (side effects)`,
                    severity,
                    category: this.classifySideEffectCategory(tool),
                    agentId: personaId,
                    context: {
                        toolName: tool.name,
                        toolId: tool.id,
                        toolCategory: tool.category,
                        toolRequiredCapabilities: tool.requiredCapabilities,
                        argsPreview,
                        userContext: { userId: userContext?.userId },
                        gmiId,
                        personaId,
                        llmProvidedCallId,
                    },
                    reversible: false,
                    requestedAt: new Date(),
                    timeoutMs: hitlConfig?.approvalTimeoutMs,
                };
                if (this.config.logToolCalls) {
                    console.log(`${logPrefix} Awaiting human approval (actionId='${actionId}', severity='${severity}').`);
                }
                try {
                    const decision = await this.hitlManager.requestApproval(pending);
                    if (!decision.approved) {
                        const errorMsg = decision.rejectionReason || `Human rejected tool '${toolName}'.`;
                        console.warn(`${logPrefix} ${errorMsg}`);
                        return {
                            toolCallId: llmProvidedCallId,
                            toolName,
                            output: null,
                            isError: true,
                            errorDetails: {
                                message: errorMsg,
                                code: GMIErrorCode.PERMISSION_DENIED,
                                reason: 'HITL rejected',
                                details: decision,
                            },
                        };
                    }
                }
                catch (hitlError) {
                    const errorMsg = `Approval request failed: ${hitlError?.message ?? String(hitlError)}`;
                    console.warn(`${logPrefix} ${errorMsg}`);
                    return {
                        toolCallId: llmProvidedCallId,
                        toolName,
                        output: null,
                        isError: true,
                        errorDetails: {
                            message: errorMsg,
                            code: GMIErrorCode.PERMISSION_DENIED,
                            reason: 'HITL error',
                        },
                    };
                }
            }
        }
        if (this.config.logToolCalls) {
            console.log(`${logPrefix} Permissions granted for tool '${toolName}'. Delegating execution to ToolExecutor.`);
        }
        let coreExecutorResult;
        try {
            coreExecutorResult = await this.toolExecutor.executeTool(requestDetails);
        }
        catch (executorPipelineError) {
            const errorMsg = `Critical error within ToolExecutor's internal pipeline while processing '${toolName}'. This is not an error from the tool's execute method itself.`;
            console.error(`${logPrefix} ${errorMsg}`, executorPipelineError);
            const wrappedError = createGMIErrorFromError(executorPipelineError, GMIErrorCode.TOOL_EXECUTION_FAILED, requestDetails, errorMsg);
            return {
                toolCallId: llmProvidedCallId,
                toolName,
                output: null,
                isError: true,
                errorDetails: {
                    message: wrappedError.message,
                    code: wrappedError.code,
                    details: wrappedError.details,
                },
            };
        }
        if (this.config.logToolCalls) {
            const outputPreview = coreExecutorResult.output
                ? JSON.stringify(coreExecutorResult.output).substring(0, 150) +
                    (JSON.stringify(coreExecutorResult.output).length > 150 ? '...' : '')
                : 'N/A';
            console.log(`${logPrefix} Tool '${toolName}' execution completed by executor. Success: ${coreExecutorResult.success}. Output Preview: ${outputPreview}. Error: ${coreExecutorResult.error || 'N/A'}`);
        }
        return {
            toolCallId: llmProvidedCallId,
            toolName: toolName,
            output: coreExecutorResult.success ? coreExecutorResult.output : null,
            isError: !coreExecutorResult.success,
            errorDetails: !coreExecutorResult.success
                ? {
                    message: coreExecutorResult.error ||
                        `Tool '${toolName}' reported failure without a specific error message.`,
                    details: coreExecutorResult.details,
                }
                : undefined,
        };
    }
    // --------------------------------------------------------------------------
    // EMERGENT CAPABILITY HELPERS
    // --------------------------------------------------------------------------
    /**
     * Returns the underlying emergent capability engine instance, or
     * `undefined` if emergent capabilities were not enabled at initialization.
     *
     * Callers can use this to access engine methods like `getSessionTools()`,
     * `getAgentTools()`, or `checkPromotion()` that are not exposed through
     * the orchestrator's own API.
     *
     * @returns The engine instance, or `undefined`.
     */
    getEmergentEngine() {
        return this.emergentEngine;
    }
    /**
     * Clean up all emergent session-scoped tools for a given session.
     *
     * Delegates to the emergent engine's `cleanupSession()` method. This should
     * be called when a conversation/session ends to free session-tier tools.
     *
     * No-op if emergent capabilities are not enabled.
     *
     * @param sessionId - The session identifier to clean up.
     */
    cleanupEmergentSession(sessionId) {
        if (this.emergentEngine) {
            const removedTools = this.emergentEngine.cleanupSession(sessionId);
            void Promise.allSettled(removedTools.map((tool) => this.unregisterTool(tool.name)));
            console.log(`ToolOrchestrator (ID: ${this.orchestratorId}): Cleaned up emergent session "${sessionId}".`);
        }
    }
    /**
     * Register a dynamically forged emergent tool with the orchestrator so the
     * agent can use it in subsequent turns within the same session.
     *
     * This is the bridge between the emergent capability engine (which
     * stores tool metadata) and the `ToolOrchestrator` (which the LLM
     * tool-call pipeline queries). After forge_tool produces a new tool, call
     * this method to make it appear in `listAvailableTools()`.
     *
     * @param tool - An `ITool` instance wrapping the emergent tool.
     */
    async registerForgedTool(tool) {
        this.ensureInitialized();
        await this.registerInitialTool(tool);
        console.log(`ToolOrchestrator (ID: ${this.orchestratorId}): Forged tool '${tool.name}' registered dynamically.`);
    }
    setEmergentDiscoveryIndexer(indexer) {
        this.emergentDiscoveryIndexer = indexer;
    }
    /**
     * Dynamically load an extension at runtime and register its tools.
     *
     * Used by the discovery engine when the agent encounters a request
     * outside its loaded toolset. The extension is loaded for the current
     * session only — it does not persist to config.
     *
     * @param extensionId - The extension ID from the tool catalog (e.g., 'omdb').
     * @returns The names of newly registered tools, or empty array on failure.
     */
    async loadExtensionAtRuntime(extensionId) {
        this.ensureInitialized();
        const logPrefix = `ToolOrchestrator (ID: ${this.orchestratorId})`;
        try {
            const registry = await import('@framers/agentos-extensions-registry');
            const catalog = registry.TOOL_CATALOG ?? [];
            const entry = catalog.find((e) => e.name === extensionId);
            if (!entry) {
                console.warn(`${logPrefix}: Runtime load — extension "${extensionId}" not found in catalog.`);
                return [];
            }
            if (!entry.createPack) {
                console.warn(`${logPrefix}: Runtime load — extension "${extensionId}" has no createPack factory.`);
                return [];
            }
            const envMap = registry.SECRET_ENV_MAP ?? {};
            const pack = await entry.createPack({
                options: {},
                getSecret: (id) => {
                    const mapping = envMap[id];
                    return mapping ? process.env[mapping.envVar] : undefined;
                },
                logger: console,
            });
            if (!pack?.descriptors)
                return [];
            const registered = [];
            for (const desc of pack.descriptors) {
                if (desc.kind === 'tool' && desc.payload) {
                    await this.registerTool(desc.payload);
                    registered.push(desc.payload.name ?? desc.id);
                }
            }
            if (typeof pack.onActivate === 'function') {
                await pack.onActivate({ logger: console });
            }
            if (registered.length > 0) {
                console.log(`${logPrefix}: Runtime loaded "${extensionId}": ${registered.join(', ')}.`);
            }
            return registered;
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.warn(`${logPrefix}: Runtime load failed for "${extensionId}": ${msg}`);
            return [];
        }
    }
    /**
     * @inheritdoc
     */
    async checkHealth() {
        this.ensureInitialized();
        let pmHealth = {
            isHealthy: true,
            details: 'ToolPermissionManager: Health not explicitly checked or no checkHealth method available.',
        };
        if (this.permissionManager &&
            typeof this.permissionManager.checkHealth === 'function') {
            try {
                pmHealth = await this.permissionManager.checkHealth();
            }
            catch (e) {
                pmHealth = {
                    isHealthy: false,
                    details: `Failed to retrieve ToolPermissionManager health: ${e.message}`,
                };
            }
        }
        let execHealth = {
            isHealthy: true,
            details: 'ToolExecutor: Health not explicitly checked or no checkHealth method available.',
        };
        if (this.toolExecutor && typeof this.toolExecutor.checkHealth === 'function') {
            try {
                execHealth = await this.toolExecutor.checkHealth();
            }
            catch (e) {
                execHealth = {
                    isHealthy: false,
                    details: `Failed to retrieve ToolExecutor health: ${e.message}`,
                };
            }
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
    async shutdownRegisteredTools() {
        console.log(`ToolOrchestrator (ID: ${this.orchestratorId}): Initiating shutdown for registered tools via ToolExecutor.`);
        if (this.toolExecutor && typeof this.toolExecutor.shutdownAllTools === 'function') {
            try {
                await this.toolExecutor.shutdownAllTools();
                console.log(`ToolOrchestrator (ID: ${this.orchestratorId}): ToolExecutor successfully completed shutdownAllTools.`);
            }
            catch (e) {
                console.error(`ToolOrchestrator (ID: ${this.orchestratorId}): Error during ToolExecutor.shutdownAllTools: ${e.message}`, e);
            }
        }
    }
    /**
     * @inheritdoc
     */
    async shutdown() {
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
/**
 * Default configuration values for the ToolOrchestrator.
 * These are applied if specific values are not provided during initialization, ensuring robust default behavior.
 * @private
 * @static
 * @readonly
 */
ToolOrchestrator.DEFAULT_CONFIG = {
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
    hitl: {
        enabled: false,
        requireApprovalForSideEffects: true,
        defaultSideEffectsSeverity: 'high',
        approvalTimeoutMs: undefined,
        autoApproveWhenNoManager: false,
    },
    customParameters: {},
};
//# sourceMappingURL=ToolOrchestrator.js.map