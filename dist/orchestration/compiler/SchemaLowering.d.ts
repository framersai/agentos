/**
 * @file SchemaLowering.ts
 * @description Minimal Zod-to-JSON-Schema converter for the AgentOS orchestration layer.
 *
 * Intentionally hand-rolled to avoid adding `zod-to-json-schema` as a dependency.
 * Handles the subset of Zod types used in node input/output schemas across the codebase:
 * z.string, z.number, z.boolean, z.null, z.object, z.array, z.enum, z.optional, z.default.
 *
 * Targets Zod v4 `_def` internals:
 * - Discriminant field: `_def.type` (string literal, e.g. `"string"`, `"object"`)
 * - Array inner schema: `_def.element`
 * - Object shape: `_def.shape` (plain Record, NOT a function as in Zod v3)
 * - Enum values: `_def.entries` (Record<string, string> — keys and values are the same)
 * - Optional/Default inner schema: `_def.innerType`
 *
 * Unsupported types fall through to an empty object `{}` — callers should treat that as
 * an "unknown / untyped" schema rather than an error.
 */
import type { ZodType } from 'zod';
/**
 * Converts a Zod schema instance to a plain JSON Schema object.
 *
 * Recursively descends into ZodObject shapes, ZodArray item types, ZodOptional and
 * ZodDefault wrappers, transparently unwrapping them so the produced JSON Schema
 * is clean and does not contain Zod-specific metadata.
 *
 * @param schema - Any Zod schema instance.
 * @returns A JSON Schema-compatible plain object.
 *
 * @example
 * ```ts
 * const jsonSchema = lowerZodToJsonSchema(z.object({ name: z.string(), age: z.number().optional() }));
 * // → { type: 'object', properties: { name: { type: 'string' }, age: { type: 'number' } }, required: ['name'] }
 * ```
 */
export declare function lowerZodToJsonSchema(schema: ZodType): Record<string, unknown>;
//# sourceMappingURL=SchemaLowering.d.ts.map