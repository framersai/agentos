import { GMIErrorCode } from '../../core/utils/errors.js';
import { AgentOSServiceError } from '../errors.js';
const temporaryExternalToolRefs = new WeakMap();
export function normalizeOptionalString(value) {
    if (typeof value !== 'string') {
        return undefined;
    }
    const trimmed = value.trim();
    return trimmed || undefined;
}
export function buildScopedExternalToolContextParts(input) {
    const organizationId = normalizeOptionalString(input.organizationId);
    const userContext = {
        ...(input.userContext ?? {}),
        userId: input.userId,
    };
    if (organizationId) {
        userContext.organizationId = organizationId;
    }
    const sessionData = {};
    const sessionId = normalizeOptionalString(input.sessionId);
    const conversationId = normalizeOptionalString(input.conversationId);
    if (sessionId) {
        sessionData.sessionId = sessionId;
    }
    if (conversationId) {
        sessionData.conversationId = conversationId;
    }
    if (organizationId) {
        sessionData.organizationId = organizationId;
    }
    return { userContext, sessionData };
}
function isIterableRegistry(value) {
    return (value !== null &&
        value !== undefined &&
        typeof value !== 'string' &&
        typeof value[Symbol.iterator] === 'function');
}
function isFunctionEntry(value) {
    return typeof value === 'function';
}
function isRecordRegistry(value) {
    return (value !== null && value !== undefined && !isIterableRegistry(value) && !(value instanceof Map));
}
function createDisplayName(name) {
    return name
        .replace(/[_-]+/g, ' ')
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/\b\w/g, (char) => char.toUpperCase());
}
function normalizeToolName(name) {
    if (typeof name !== 'string') {
        return undefined;
    }
    const trimmed = name.trim();
    return trimmed || undefined;
}
function resolveExternalToolRegistryEntries(registry) {
    if (!registry) {
        return [];
    }
    if (registry instanceof Map) {
        return Array.from(registry.entries()).map(([name, entry]) => ({ name, entry }));
    }
    if (isIterableRegistry(registry)) {
        const resolved = [];
        for (const entry of registry) {
            resolved.push({
                name: entry.name,
                entry,
            });
        }
        return resolved;
    }
    if (!isRecordRegistry(registry)) {
        return [];
    }
    return Object.entries(registry).map(([name, entry]) => ({ name, entry }));
}
function resolveRegistryEntry(registry, toolName) {
    for (const resolved of resolveExternalToolRegistryEntries(registry)) {
        if (resolved.name === toolName) {
            return resolved.entry;
        }
    }
    return undefined;
}
export function normalizeExternalToolRegistry(registry) {
    const normalized = new Map();
    for (const resolved of resolveExternalToolRegistryEntries(registry)) {
        const toolName = normalizeToolName(resolved.name);
        if (!toolName) {
            continue;
        }
        normalized.set(toolName, resolved.entry);
    }
    return normalized.size > 0 ? normalized : undefined;
}
export function mergeExternalToolRegistries(...registries) {
    const merged = new Map();
    for (const registry of registries) {
        const normalized = normalizeExternalToolRegistry(registry);
        if (!normalized) {
            continue;
        }
        for (const [toolName, entry] of normalized.entries()) {
            merged.set(toolName, entry);
        }
    }
    return merged.size > 0 ? merged : undefined;
}
function getEntryExecutor(entry) {
    return isFunctionEntry(entry) ? entry : entry.execute.bind(entry);
}
function isPromptAwareEntry(name, entry) {
    if (isFunctionEntry(entry)) {
        return false;
    }
    return (typeof name === 'string' &&
        name.trim().length > 0 &&
        typeof entry.description === 'string' &&
        entry.description.trim().length > 0 &&
        typeof entry.inputSchema === 'object' &&
        entry.inputSchema !== null);
}
export function listPromptAwareExternalTools(registry) {
    return resolveExternalToolRegistryEntries(registry)
        .filter((resolved) => isPromptAwareEntry(resolved.name, resolved.entry))
        .map(({ name, entry }) => ({
        name,
        execute: getEntryExecutor(entry),
        displayName: typeof entry.displayName === 'string' && entry.displayName.trim().length > 0
            ? entry.displayName
            : createDisplayName(name),
        description: entry.description,
        inputSchema: entry.inputSchema,
        outputSchema: entry.outputSchema,
        requiredCapabilities: entry.requiredCapabilities,
        category: entry.category,
        version: entry.version,
        hasSideEffects: entry.hasSideEffects,
    }));
}
export function listExternalToolDefinitionsForLLM(registry) {
    return listPromptAwareExternalTools(registry).map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        outputSchema: tool.outputSchema,
    }));
}
export function formatToolDefinitionsForOpenAI(definitions) {
    return definitions.map((definition) => ({
        type: 'function',
        function: {
            name: definition.name,
            description: definition.description,
            parameters: definition.inputSchema,
        },
    }));
}
export function formatExternalToolsForOpenAI(registry) {
    return formatToolDefinitionsForOpenAI(listExternalToolDefinitionsForLLM(registry));
}
export function createExternalToolProxyTool(entry) {
    return {
        id: `external-tool-proxy-${entry.name}`,
        name: entry.name,
        displayName: entry.displayName ?? createDisplayName(entry.name),
        description: entry.description,
        inputSchema: entry.inputSchema,
        outputSchema: entry.outputSchema,
        requiredCapabilities: entry.requiredCapabilities,
        category: entry.category,
        version: entry.version ?? 'external-proxy',
        hasSideEffects: entry.hasSideEffects,
        execute: entry.execute,
    };
}
export async function registerTemporaryExternalTools(toolOrchestrator, registry) {
    const acquiredRegistrations = [];
    const orchestratorKey = toolOrchestrator;
    let orchestratorRefs = temporaryExternalToolRefs.get(orchestratorKey);
    if (!orchestratorRefs) {
        orchestratorRefs = new Map();
        temporaryExternalToolRefs.set(orchestratorKey, orchestratorRefs);
    }
    try {
        for (const promptAwareTool of listPromptAwareExternalTools(registry)) {
            const existingTool = await toolOrchestrator.getTool(promptAwareTool.name);
            const existingRef = orchestratorRefs.get(promptAwareTool.name);
            if (existingRef) {
                existingRef.count += 1;
                acquiredRegistrations.push({
                    name: promptAwareTool.name,
                    managesLifecycle: true,
                });
                continue;
            }
            if (existingTool) {
                acquiredRegistrations.push({
                    name: promptAwareTool.name,
                    managesLifecycle: false,
                });
                continue;
            }
            await toolOrchestrator.registerTool(createExternalToolProxyTool(promptAwareTool));
            orchestratorRefs.set(promptAwareTool.name, { count: 1 });
            acquiredRegistrations.push({
                name: promptAwareTool.name,
                managesLifecycle: true,
            });
        }
    }
    catch (error) {
        for (const registration of acquiredRegistrations.reverse()) {
            if (!registration.managesLifecycle) {
                continue;
            }
            const refState = orchestratorRefs.get(registration.name);
            if (!refState) {
                continue;
            }
            if (refState.count > 1) {
                refState.count -= 1;
                continue;
            }
            orchestratorRefs.delete(registration.name);
            await toolOrchestrator.unregisterTool(registration.name).catch(() => false);
        }
        throw error;
    }
    return async () => {
        for (const registration of acquiredRegistrations.reverse()) {
            if (!registration.managesLifecycle) {
                continue;
            }
            const refState = orchestratorRefs.get(registration.name);
            if (!refState) {
                continue;
            }
            if (refState.count > 1) {
                refState.count -= 1;
                continue;
            }
            orchestratorRefs.delete(registration.name);
            await toolOrchestrator.unregisterTool(registration.name).catch(() => false);
        }
        if (orchestratorRefs.size === 0) {
            temporaryExternalToolRefs.delete(orchestratorKey);
        }
    };
}
export async function executeExternalToolFromRegistry(registry, toolName, args, context, options) {
    const entry = resolveRegistryEntry(registry, toolName);
    if (!entry) {
        return undefined;
    }
    const executor = getEntryExecutor(entry);
    try {
        const execution = await executor(args, context);
        return {
            toolOutput: execution.output,
            isSuccess: execution.success,
            errorMessage: execution.error,
        };
    }
    catch (error) {
        throw AgentOSServiceError.wrap(error, GMIErrorCode.TOOL_ERROR, options.failureMessage, options.errorOrigin);
    }
}
//# sourceMappingURL=externalToolRegistry.js.map