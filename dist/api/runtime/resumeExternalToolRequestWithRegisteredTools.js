import { AgentOSServiceError } from '../errors.js';
import { GMIErrorCode } from '../../core/utils/errors.js';
import { executeExternalToolFromRegistry, mergeExternalToolRegistries, registerTemporaryExternalTools, } from './externalToolRegistry.js';
function normalizeOptionalString(value) {
    if (typeof value !== 'string') {
        return undefined;
    }
    const trimmed = value.trim();
    return trimmed || undefined;
}
function buildResumeOptions(options) {
    const resumeOptions = {};
    if (options.userApiKeys) {
        resumeOptions.userApiKeys = options.userApiKeys;
    }
    if (options.preferredModelId) {
        resumeOptions.preferredModelId = options.preferredModelId;
    }
    if (options.preferredProviderId) {
        resumeOptions.preferredProviderId = options.preferredProviderId;
    }
    if (options.organizationId) {
        resumeOptions.organizationId = options.organizationId;
    }
    return resumeOptions;
}
function resolveExternalToolsForRuntime(agentos, registry) {
    return mergeExternalToolRegistries(agentos.getExternalToolRegistry?.(), registry);
}
/**
 * Builds the `ToolExecutionContext` that a host should use when it wants to
 * execute a persisted external tool pause against AgentOS's registered tool
 * registry after restart.
 */
export function buildPendingExternalToolExecutionContext(pendingRequest, options = {}) {
    const userContext = {
        ...(options.userContext ?? {}),
        userId: pendingRequest.userId,
    };
    const organizationId = normalizeOptionalString(options.organizationId ?? userContext.organizationId);
    if (organizationId) {
        userContext.organizationId = organizationId;
    }
    const sessionData = {
        sessionId: pendingRequest.sessionId,
        conversationId: pendingRequest.conversationId,
    };
    if (organizationId) {
        sessionData.organizationId = organizationId;
    }
    return {
        gmiId: pendingRequest.gmiInstanceId,
        personaId: pendingRequest.personaId,
        userContext,
        correlationId: normalizeOptionalString(options.correlationId) ?? pendingRequest.streamId,
        sessionData,
    };
}
/**
 * Executes one pending external tool call through AgentOS's registered tool
 * registry using the correct resume-time execution context, then optionally
 * falls back to a host-provided external tool registry or dynamic callback.
 */
export async function executePendingExternalToolCall(agentos, pendingRequest, toolCall, options = {}) {
    const externalTools = resolveExternalToolsForRuntime(agentos, options.externalTools);
    const tool = await agentos.getToolOrchestrator().getTool(toolCall.name);
    if (!tool) {
        const executionContext = buildPendingExternalToolExecutionContext(pendingRequest, {
            ...options,
            correlationId: options.correlationId ?? toolCall.id,
        });
        const registryExecution = await executeExternalToolFromRegistry(externalTools, toolCall.name, toolCall.arguments, executionContext, {
            errorOrigin: 'executePendingExternalToolCall',
            failureMessage: `Failed to execute external tool '${toolCall.name}' from externalTools registry`,
        });
        if (registryExecution) {
            return {
                toolCallId: toolCall.id,
                toolName: toolCall.name,
                toolOutput: registryExecution.toolOutput,
                isSuccess: registryExecution.isSuccess ?? true,
                errorMessage: registryExecution.errorMessage,
            };
        }
        if (options.fallbackExternalToolHandler) {
            try {
                const execution = await options.fallbackExternalToolHandler({
                    agentos,
                    pendingRequest,
                    toolCall,
                });
                return {
                    toolCallId: toolCall.id,
                    toolName: toolCall.name,
                    toolOutput: execution.toolOutput,
                    isSuccess: execution.isSuccess ?? true,
                    errorMessage: execution.errorMessage,
                };
            }
            catch (error) {
                throw AgentOSServiceError.wrap(error, GMIErrorCode.TOOL_ERROR, `Failed to execute fallback external tool '${toolCall.name}'`, 'executePendingExternalToolCall');
            }
        }
        throw new AgentOSServiceError(`Pending external tool '${toolCall.name}' is not registered.`, GMIErrorCode.RESOURCE_NOT_FOUND, {
            conversationId: pendingRequest.conversationId,
            streamId: pendingRequest.streamId,
            toolCallId: toolCall.id,
            toolName: toolCall.name,
        }, 'executePendingExternalToolCall');
    }
    try {
        const execution = await tool.execute(toolCall.arguments, buildPendingExternalToolExecutionContext(pendingRequest, {
            ...options,
            correlationId: options.correlationId ?? toolCall.id,
        }));
        return {
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            toolOutput: execution.output,
            isSuccess: execution.success,
            errorMessage: execution.error,
        };
    }
    catch (error) {
        throw AgentOSServiceError.wrap(error, GMIErrorCode.TOOL_ERROR, `Failed to execute pending external tool '${toolCall.name}'`, 'executePendingExternalToolCall');
    }
}
/**
 * Executes all tool calls from a persisted external-tool pause, in order,
 * through AgentOS's registered tool registry.
 */
export async function executePendingExternalToolCalls(agentos, pendingRequest, options = {}) {
    const toolResults = [];
    for (const toolCall of pendingRequest.toolCalls) {
        toolResults.push(await executePendingExternalToolCall(agentos, pendingRequest, toolCall, options));
    }
    return toolResults;
}
/**
 * Executes all pending registered tool calls from a persisted external-tool
 * pause and immediately resumes the AgentOS stream on the caller's behalf.
 * Missing tool names can optionally fall back to `externalTools` or
 * `fallbackExternalToolHandler`.
 */
export async function* resumeExternalToolRequestWithRegisteredTools(agentos, pendingRequest, options = {}) {
    const externalTools = resolveExternalToolsForRuntime(agentos, options.externalTools);
    const toolResults = await executePendingExternalToolCalls(agentos, pendingRequest, {
        ...options,
        externalTools,
    });
    const cleanup = await registerTemporaryExternalTools(agentos.getToolOrchestrator(), externalTools);
    try {
        yield* agentos.resumeExternalToolRequest(pendingRequest, toolResults, buildResumeOptions(options));
    }
    finally {
        await cleanup();
    }
}
//# sourceMappingURL=resumeExternalToolRequestWithRegisteredTools.js.map