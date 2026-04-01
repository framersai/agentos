/**
 * @file toolAdapter.ts
 * Adapts user-supplied tool definitions (plain objects, Zod schemas, or `ITool`
 * instances) into the canonical `ITool` shape expected by the AgentOS runtime.
 *
 * This module is used internally by {@link generateText} and {@link streamText} to
 * normalise the `tools` option before handing them to a provider.
 */
import type { ITool } from '../../core/tools/ITool.js';
import type { ToolDefinitionForLLM } from '../../core/tools/IToolOrchestrator.js';
import type { ExternalToolRegistry } from './externalToolRegistry.js';
/**
 * Loose tool definition accepted by the high-level API.
 * Consumers may supply a plain object with an optional Zod or JSON Schema
 * `parameters` shape plus an `execute` callback.
 */
export interface ToolDefinition {
    /** Human-readable description forwarded to the model in the tool schema. */
    description?: string;
    /**
     * Parameter schema for the tool. Accepts a JSON Schema object or a Zod schema.
     * When a Zod schema is detected (`_def` property present) the adapter attempts
     * to convert it via `zod-to-json-schema`, falling back to an empty object schema
     * if that package is not installed.
     */
    parameters?: Record<string, unknown> | object;
    /**
     * Async function that receives the parsed tool arguments and returns any value.
     * Omit to create a no-op tool (returns `{ success: true }`).
     */
    execute?: (args: any) => Promise<any>;
}
/** Map of tool name → definition accepted by the high-level API. */
export type ToolDefinitionMap = Record<string, ToolDefinition | ITool>;
/**
 * Additional tool inputs accepted by the high-level API.
 *
 * - `ExternalToolRegistry`: host-managed external tools, including `Map` and iterable forms.
 * - `ToolDefinitionForLLM[]`: prompt-only schemas with no attached executor.
 */
export type AdaptableToolInput = ToolDefinitionMap | ExternalToolRegistry | ReadonlyArray<ToolDefinitionForLLM>;
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
export declare function adaptTools(tools: AdaptableToolInput | undefined): ITool[];
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
export declare function adaptToolsToMap(tools: AdaptableToolInput | undefined): ToolDefinitionMap;
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
export declare function mergeAdaptableTools(...inputs: Array<AdaptableToolInput | undefined>): ToolDefinitionMap | undefined;
//# sourceMappingURL=toolAdapter.d.ts.map