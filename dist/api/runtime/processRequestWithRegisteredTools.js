import { AgentOSServiceError } from '../errors.js';
import { GMIErrorCode } from '../../core/utils/errors.js';
import { executeExternalToolFromRegistry, mergeExternalToolRegistries, registerTemporaryExternalTools, } from './externalToolRegistry.js';
import { processRequestWithExternalTools, } from './processRequestWithExternalTools.js';
function normalizeOptionalString(value) {
    if (typeof value !== 'string') {
        return undefined;
    }
    const trimmed = value.trim();
    return trimmed || undefined;
}
function resolveExternalToolsForRuntime(agentos, registry) {
    return mergeExternalToolRegistries(agentos.getExternalToolRegistry?.(), registry);
}
/**
 * Builds the `ToolExecutionContext` for a host-managed external tool call that
 * should execute against AgentOS's registered tool registry during a live
 * `processRequest(...)` stream.
 */
export function buildRegisteredExternalToolExecutionContext(input, context, options = {}) {
    const userContext = {
        ...(options.userContext ?? {}),
        userId: input.userId,
    };
    const organizationId = normalizeOptionalString(options.organizationId ??
        context.requestChunk.metadata?.organizationId ??
        input.organizationId ??
        userContext.organizationId);
    if (organizationId) {
        userContext.organizationId = organizationId;
    }
    const sessionId = normalizeOptionalString(context.requestChunk.metadata?.sessionId) ??
        normalizeOptionalString(input.sessionId) ??
        undefined;
    const conversationId = normalizeOptionalString(context.requestChunk.metadata?.conversationId) ??
        normalizeOptionalString(input.conversationId) ??
        sessionId;
    const sessionData = {};
    if (sessionId) {
        sessionData.sessionId = sessionId;
    }
    if (conversationId) {
        sessionData.conversationId = conversationId;
    }
    if (organizationId) {
        sessionData.organizationId = organizationId;
    }
    return {
        gmiId: context.requestChunk.gmiInstanceId,
        personaId: context.requestChunk.personaId,
        userContext,
        correlationId: normalizeOptionalString(options.correlationId) ?? context.toolCall.id,
        ...(Object.keys(sessionData).length > 0 ? { sessionData } : {}),
    };
}
/**
 * Creates an external-tool handler that executes AgentOS-registered tools with
 * the correct live-turn execution context, then optionally falls back to a
 * host-provided external tool registry or dynamic callback.
 */
export function createRegisteredExternalToolHandler(agentos, input, options = {}) {
    const externalTools = resolveExternalToolsForRuntime(agentos, options.externalTools);
    return async ({ agentos: runtime, streamId, requestChunk, toolCall }) => {
        const tool = await agentos.getToolOrchestrator().getTool(toolCall.name);
        if (!tool) {
            const executionContext = buildRegisteredExternalToolExecutionContext(input, { requestChunk, toolCall }, options);
            const registryExecution = await executeExternalToolFromRegistry(externalTools, toolCall.name, toolCall.arguments, executionContext, {
                errorOrigin: 'createRegisteredExternalToolHandler',
                failureMessage: `Failed to execute external tool '${toolCall.name}' from externalTools registry`,
            });
            if (registryExecution) {
                return registryExecution;
            }
            if (options.fallbackExternalToolHandler) {
                try {
                    return await options.fallbackExternalToolHandler({
                        agentos: runtime,
                        streamId,
                        requestChunk,
                        toolCall,
                    });
                }
                catch (error) {
                    throw AgentOSServiceError.wrap(error, GMIErrorCode.TOOL_ERROR, `Failed to execute fallback external tool '${toolCall.name}'`, 'createRegisteredExternalToolHandler');
                }
            }
            throw new AgentOSServiceError(`Registered external tool '${toolCall.name}' is not available.`, GMIErrorCode.RESOURCE_NOT_FOUND, {
                streamId: requestChunk.streamId,
                toolCallId: toolCall.id,
                toolName: toolCall.name,
            }, 'createRegisteredExternalToolHandler');
        }
        try {
            const execution = await tool.execute(toolCall.arguments, buildRegisteredExternalToolExecutionContext(input, { requestChunk, toolCall }, options));
            return {
                toolOutput: execution.output,
                isSuccess: execution.success,
                errorMessage: execution.error,
            };
        }
        catch (error) {
            throw AgentOSServiceError.wrap(error, GMIErrorCode.TOOL_ERROR, `Failed to execute registered external tool '${toolCall.name}'`, 'createRegisteredExternalToolHandler');
        }
    };
}
/**
 * Runs a full `AgentOS.processRequest(...)` turn and executes any actionable
 * external tool pauses against AgentOS's registered tools automatically.
 * Missing tool names can optionally fall back to `externalTools` or
 * `fallbackExternalToolHandler`.
 */
export async function* processRequestWithRegisteredTools(agentos, input, options = {}) {
    const externalTools = resolveExternalToolsForRuntime(agentos, options.externalTools);
    const cleanup = await registerTemporaryExternalTools(agentos.getToolOrchestrator(), externalTools);
    try {
        yield* processRequestWithExternalTools(agentos, input, createRegisteredExternalToolHandler(agentos, input, {
            ...options,
            externalTools,
        }));
    }
    finally {
        await cleanup();
    }
}
//# sourceMappingURL=processRequestWithRegisteredTools.js.map