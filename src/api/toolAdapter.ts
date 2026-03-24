/**
 * @file toolAdapter.ts
 * Adapts user-supplied tool definitions (plain objects, Zod schemas, or {@link ITool}
 * instances) into the canonical {@link ITool} shape expected by the AgentOS runtime.
 *
 * This module is used internally by {@link generateText} and {@link streamText} to
 * normalise the `tools` option before handing them to a provider.
 */
import type { ITool, ToolExecutionResult, ToolExecutionContext, JSONSchemaObject } from '../core/tools/ITool.js';

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
  parameters?: Record<string, unknown>;
  /**
   * Async function that receives the parsed tool arguments and returns any value.
   * Omit to create a no-op tool (returns `{ success: true }`).
   */
  execute?: (args: any) => Promise<any>;
}

/** Map of tool name → definition accepted by the high-level API. */
export type ToolDefinitionMap = Record<string, ToolDefinition | ITool>;

/**
 * Converts a {@link ToolDefinitionMap} into an array of {@link ITool} instances
 * suitable for use with the AgentOS provider layer.
 *
 * - Existing {@link ITool} instances (identified by `inputSchema` + `id` properties)
 *   are passed through unchanged.
 * - Plain {@link ToolDefinition} objects are wrapped in a minimal {@link ITool}
 *   implementation.  Zod schemas are converted to JSON Schema when `zod-to-json-schema`
 *   is available.
 *
 * @param tools - Optional map of tool names to definitions. Returns `[]` when falsy.
 * @returns Flat array of normalised {@link ITool} instances ready for provider dispatch.
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
export function adaptTools(tools: ToolDefinitionMap | undefined): ITool[] {
  if (!tools) return [];
  const result: ITool[] = [];

  for (const [name, def] of Object.entries(tools)) {
    // ITool pass-through (has inputSchema + execute as ITool signature)
    if ('inputSchema' in def && 'id' in def) {
      result.push(def as ITool);
      continue;
    }

    const td = def as ToolDefinition;
    let schema: JSONSchemaObject;

    if (td.parameters && '_def' in (td.parameters as any)) {
      // Zod schema — convert to JSON Schema
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { zodToJsonSchema } = require('zod-to-json-schema') as any;
        schema = zodToJsonSchema(td.parameters) as JSONSchemaObject;
      } catch {
        // zod-to-json-schema not installed — use basic extraction
        schema = { type: 'object', properties: {} };
      }
    } else {
      schema = (td.parameters ?? { type: 'object', properties: {} }) as JSONSchemaObject;
    }

    const executeFn = td.execute ?? (async () => ({ success: true }));

    result.push({
      id: `${name}-v1`,
      name,
      displayName: name.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase()).trim(),
      description: td.description ?? '',
      inputSchema: schema,
      hasSideEffects: false,
      async execute(args: any, _ctx: ToolExecutionContext): Promise<ToolExecutionResult> {
        try {
          const output = await executeFn(args);
          return { success: true, output };
        } catch (err: any) {
          return { success: false, error: err?.message ?? String(err) };
        }
      },
    });
  }

  return result;
}
