function defaultObjectSchema() {
    return { type: 'object', properties: {} };
}
function humanizeToolName(name) {
    return name
        .replace(/[_-]+/g, ' ')
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/\b\w/g, (char) => char.toUpperCase());
}
function isIterableInput(value) {
    return (value !== null &&
        value !== undefined &&
        typeof value !== 'string' &&
        !Array.isArray(value) &&
        typeof value[Symbol.iterator] === 'function');
}
function isITool(value) {
    return (typeof value === 'object' &&
        value !== null &&
        'id' in value &&
        'inputSchema' in value &&
        typeof value.execute === 'function');
}
function isToolDefinitionForLLM(value) {
    return (typeof value === 'object' &&
        value !== null &&
        typeof value.name === 'string' &&
        typeof value.description === 'string' &&
        typeof value.inputSchema === 'object' &&
        value.inputSchema !== null &&
        !('execute' in value));
}
function isNamedExternalToolEntry(value) {
    return (typeof value === 'object' &&
        value !== null &&
        typeof value.name === 'string' &&
        ('execute' in value ||
            'inputSchema' in value ||
            'description' in value ||
            'displayName' in value));
}
function isExternalRegistryObjectEntry(value) {
    return (typeof value === 'object' &&
        value !== null &&
        typeof value.execute === 'function' &&
        !('parameters' in value));
}
function normalizeExecutionResult(output) {
    if (typeof output === 'object' &&
        output !== null &&
        'success' in output &&
        typeof output.success === 'boolean') {
        return output;
    }
    return {
        success: true,
        output,
    };
}
function createPromptOnlyTool(definition) {
    return {
        id: `${definition.name}-prompt-only-v1`,
        name: definition.name,
        displayName: humanizeToolName(definition.name),
        description: definition.description,
        inputSchema: definition.inputSchema,
        outputSchema: definition.outputSchema,
        hasSideEffects: false,
        async execute() {
            return {
                success: false,
                error: `No executor configured for prompt-only tool "${definition.name}".`,
            };
        },
    };
}
function createToolFromDefinition(name, def) {
    let schema;
    if (def.parameters && '_def' in def.parameters) {
        try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { zodToJsonSchema } = require('zod-to-json-schema');
            schema = zodToJsonSchema(def.parameters);
        }
        catch {
            schema = defaultObjectSchema();
        }
    }
    else {
        schema = (def.parameters ?? defaultObjectSchema());
    }
    const executeFn = def.execute ?? (async () => ({ success: true }));
    return {
        id: `${name}-v1`,
        name,
        displayName: humanizeToolName(name),
        description: def.description ?? '',
        inputSchema: schema,
        hasSideEffects: false,
        async execute(args, _ctx) {
            try {
                return normalizeExecutionResult(await executeFn(args));
            }
            catch (err) {
                return { success: false, error: err?.message ?? String(err) };
            }
        },
    };
}
function createToolFromExternalEntry(name, entry) {
    const displayName = entry.displayName ?? humanizeToolName(name);
    const description = typeof entry.description === 'string' && entry.description.trim().length > 0
        ? entry.description
        : displayName;
    const executeFn = typeof entry.execute === 'function'
        ? entry.execute
        : async () => ({
            success: false,
            error: `No executor configured for external tool "${name}".`,
        });
    return {
        id: `${name}-external-v1`,
        name,
        displayName,
        description,
        inputSchema: entry.inputSchema ?? defaultObjectSchema(),
        outputSchema: entry.outputSchema,
        requiredCapabilities: entry.requiredCapabilities,
        category: entry.category,
        version: entry.version,
        hasSideEffects: entry.hasSideEffects ?? false,
        async execute(args, context) {
            try {
                return normalizeExecutionResult(await executeFn(args, context));
            }
            catch (err) {
                return { success: false, error: err?.message ?? String(err) };
            }
        },
    };
}
function adaptNamedEntries(entries) {
    const result = [];
    for (const [name, def] of entries) {
        if (isITool(def)) {
            result.push(def);
            continue;
        }
        if (typeof def === 'function') {
            result.push(createToolFromExternalEntry(name, {
                name,
                execute: def,
            }));
            continue;
        }
        if (isExternalRegistryObjectEntry(def)) {
            result.push(createToolFromExternalEntry(name, def));
            continue;
        }
        result.push(createToolFromDefinition(name, def));
    }
    return result;
}
/**
 * Converts supported tool inputs into an array of `ITool` instances
 * suitable for use with the AgentOS provider layer.
 *
 * - Existing `ITool` instances (identified by `inputSchema` + `id` properties)
 *   are passed through unchanged.
 * - Plain `ToolDefinition` objects are wrapped in a minimal `ITool`
 *   implementation.  Zod schemas are converted to JSON Schema when `zod-to-json-schema`
 *   is available.
 * - {@link ExternalToolRegistry} inputs are adapted into executable `ITool`
 *   instances, preserving any prompt metadata they expose.
 * - `ToolDefinitionForLLM[]` arrays are treated as prompt-only schemas and
 *   produce tools that fail explicitly when invoked without an executor.
 *
 * @param tools - Optional map of tool names to definitions. Returns `[]` when falsy.
 * @returns Flat array of normalised `ITool` instances ready for provider dispatch.
 *
 * @example
 * ```ts
 * const tools = adaptTools({
 *   getWeather: {
 *     description: 'Returns current weather for a city.',
 *     parameters: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] },
 *     execute: async ({ city }) => fetchWeather(city),
 *   },
 * });
 * ```
 */
export function adaptTools(tools) {
    if (!tools)
        return [];
    if (Array.isArray(tools)) {
        if (tools.every(isToolDefinitionForLLM)) {
            return tools.map((definition) => createPromptOnlyTool(definition));
        }
        if (tools.every(isNamedExternalToolEntry)) {
            return adaptNamedEntries(tools.map((entry) => [entry.name, entry]));
        }
        return [];
    }
    if (tools instanceof Map) {
        return adaptNamedEntries(tools.entries());
    }
    if (isIterableInput(tools)) {
        const namedEntries = Array.from(tools).filter(isNamedExternalToolEntry);
        return adaptNamedEntries(namedEntries.map((entry) => [entry.name, entry]));
    }
    return adaptNamedEntries(Object.entries(tools));
}
/**
 * Converts any supported tool input into a named tool map.
 *
 * Later helpers such as `agent()` / `agency()` use this to safely merge tool
 * inputs that may arrive as records, `Map` registries, or prompt-only schemas.
 * The returned map always contains executable `ITool` instances keyed by
 * tool name.
 *
 * @param tools - Optional high-level tool input.
 * @returns A name-keyed tool map. Returns `{}` when no tools are supplied.
 */
export function adaptToolsToMap(tools) {
    if (!tools)
        return {};
    const map = {};
    for (const tool of adaptTools(tools)) {
        map[tool.name] = tool;
    }
    return map;
}
/**
 * Merges supported tool inputs with later inputs taking precedence by tool name.
 *
 * This normalizes each input first, which means agency-level defaults can be
 * combined safely with per-agent maps, external registries, or prompt-only tool
 * schemas without relying on object spread semantics.
 *
 * @param inputs - Tool inputs ordered from lowest to highest precedence.
 * @returns A merged tool map, or `undefined` when no tools were supplied.
 */
export function mergeAdaptableTools(...inputs) {
    const merged = {};
    for (const input of inputs) {
        Object.assign(merged, adaptToolsToMap(input));
    }
    return Object.keys(merged).length > 0 ? merged : undefined;
}
//# sourceMappingURL=toolAdapter.js.map