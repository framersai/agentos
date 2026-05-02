/**
 * @file openaiResponseFormat.ts
 * @description Helpers for building OpenAI's `response_format: json_schema`
 * payload from a lowered JSON Schema.
 *
 * OpenAI's strict structured-outputs mode (added with `gpt-4o-2024-08-06`)
 * guarantees the model produces JSON that conforms to a provided schema. It
 * has stricter requirements than the looser `json_object` mode:
 *
 *  - Every object must declare `additionalProperties: false`.
 *  - Every property of every object must appear in the `required` array.
 *  - Unsupported keywords (`format`, `pattern`, `minLength`, etc.) are stripped.
 *
 * This module wraps a lowered JSON Schema (from {@link lowerZodToJsonSchema})
 * into a strict-compatible payload. When the lowered schema is empty (the
 * Zod v3 case where the lowering helper returns `{}` because it only knows
 * v4 internals), the caller should fall back to `json_object` mode.
 *
 * @see https://platform.openai.com/docs/guides/structured-outputs
 */

/**
 * Returns true when the schema is concrete enough to be wrapped in OpenAI's
 * strict json_schema mode. A schema with no `type` and no `properties` is
 * treated as "unknown / untyped" and won't satisfy strict mode.
 */
export function canUseStrictJsonSchema(jsonSchema: Record<string, unknown> | undefined): boolean {
  if (!jsonSchema) return false;
  if (Object.keys(jsonSchema).length === 0) return false;
  // Strict mode demands an object root with declared properties.
  return jsonSchema.type === 'object' && typeof jsonSchema.properties === 'object';
}

/**
 * Recursively prepares a JSON Schema for OpenAI strict mode:
 *  - On every object node, sets `additionalProperties: false` and lifts every
 *    declared property name into `required`.
 *  - Walks into `properties` and `items` so nested arrays-of-objects are
 *    handled correctly (the most common reason callers hit this code path).
 *  - Returns a fresh object; does not mutate the input.
 */
export function makeStrictJsonSchema(node: unknown): unknown {
  if (!node || typeof node !== 'object') return node;
  const obj = node as Record<string, unknown>;
  const out: Record<string, unknown> = { ...obj };

  if (out.type === 'object' && out.properties && typeof out.properties === 'object') {
    const props = out.properties as Record<string, unknown>;
    const newProps: Record<string, unknown> = {};
    const required: string[] = [];
    for (const key of Object.keys(props)) {
      newProps[key] = makeStrictJsonSchema(props[key]);
      required.push(key);
    }
    out.properties = newProps;
    out.required = required;
    out.additionalProperties = false;
  }

  if (out.type === 'array' && out.items) {
    out.items = makeStrictJsonSchema(out.items);
  }

  return out;
}

/**
 * Build OpenAI's full `response_format` payload from a lowered JSON Schema.
 *
 * @param jsonSchema - The lowered JSON Schema (from `lowerZodToJsonSchema`).
 * @param schemaName - Name passed to OpenAI for trace/debug purposes.
 *                    Falls back to `"response"` when omitted.
 */
export function buildOpenAIJsonSchemaResponseFormat(
  jsonSchema: Record<string, unknown>,
  schemaName: string = 'response',
): Record<string, unknown> {
  return {
    type: 'json_schema',
    json_schema: {
      name: sanitizeSchemaName(schemaName),
      schema: makeStrictJsonSchema(jsonSchema),
      strict: true,
    },
  };
}

/**
 * OpenAI requires `name` to match `^[a-zA-Z0-9_-]+$` and be ≤ 64 chars.
 * Replace anything outside that set with `_` and clip to length.
 */
function sanitizeSchemaName(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
  // If the cleaned name carries no real signal (empty, or all-underscores
  // because every input character was illegal), fall back to a stable
  // generic name rather than passing OpenAI a string of placeholders.
  const hasRealChars = /[a-zA-Z0-9-]/.test(cleaned);
  return hasRealChars ? cleaned : 'response';
}
