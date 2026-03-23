// packages/agentos/src/api/tool-adapter.ts
import type { ITool, ToolExecutionResult, ToolExecutionContext, JSONSchemaObject } from '../core/tools/ITool.js';

export interface ToolDefinition {
  description?: string;
  parameters?: Record<string, unknown>;
  execute?: (args: any) => Promise<any>;
}

export type ToolDefinitionMap = Record<string, ToolDefinition | ITool>;

/**
 * Adapts Zod schemas, JSON Schema objects, and ITool instances into ITool[].
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
