/**
 * @fileoverview Synthesize missing forge input/output schema properties
 * from testCase values.
 * @module @framers/agentos/emergent/ForgeSchemaInference
 *
 * Problem: LLMs routinely emit concrete testCases with real field values
 * but forget to declare `inputSchema.properties` / `outputSchema.properties`.
 * The shape validator then rejects every such forge even though the
 * intent is clearly legitimate.
 *
 * Solution: when a schema lacks declared properties but the testCases
 * carry field values, synthesize properties from the testCase data so
 * the shape check passes. This is NOT a relaxation of schema discipline
 * — the tool code still has to handle whatever inputs come in. It is a
 * correction of a common LLM oversight (examples without formalization).
 *
 * Pure function, mutates the request in place. No dependencies.
 */

/** Request fragment carrying the three fields we may mutate. */
export interface ForgeSchemaInferenceRequest {
  inputSchema?: unknown;
  outputSchema?: unknown;
  testCases?: unknown;
}

/**
 * Derive a JSON-Schema primitive type from a concrete testCase value.
 * Handles the types the sandbox forge returns: number, string, boolean,
 * object, array. Falls back to `'string'` for anything else so the
 * schema stays well-formed.
 */
function inferTypeFromValue(v: unknown): string {
  if (typeof v === 'number') return 'number';
  if (typeof v === 'boolean') return 'boolean';
  if (typeof v === 'string') return 'string';
  if (Array.isArray(v)) return 'array';
  if (v !== null && typeof v === 'object') return 'object';
  return 'string';
}

/**
 * Populate missing inputSchema / outputSchema properties from testCase
 * data. Mutates `req` in place. Fields are scanned as a union across
 * every testCase so a single incomplete case does not narrow the
 * inferred schema.
 *
 * A schema that already has declared properties is left alone. Only
 * the missing-properties case is upgraded. `additionalProperties: false`
 * is added to the synthesized schema so the strict-schema discipline is
 * preserved for the generated shape.
 *
 * @param req Forge request fragment. Mutated in place.
 */
export function inferSchemaFromTestCases(req: ForgeSchemaInferenceRequest): void {
  const tcArr = Array.isArray(req.testCases)
    ? (req.testCases as Array<{ input?: unknown; expectedOutput?: unknown }>)
    : [];
  if (tcArr.length === 0) return;

  const inferProperties = (key: 'input' | 'expectedOutput') => {
    const props: Record<string, { type: string }> = {};
    for (const tc of tcArr) {
      const data = tc?.[key];
      if (!data || typeof data !== 'object' || Array.isArray(data)) continue;
      for (const [field, value] of Object.entries(data as Record<string, unknown>)) {
        if (props[field]) continue;
        props[field] = { type: inferTypeFromValue(value) };
      }
    }
    return props;
  };

  const maybeUpgrade = (
    schemaKey: 'inputSchema' | 'outputSchema',
    testCaseKey: 'input' | 'expectedOutput',
  ) => {
    const schema = req[schemaKey];
    const current = (schema && typeof schema === 'object' ? schema : {}) as {
      type?: string;
      properties?: Record<string, unknown>;
      required?: string[];
      additionalProperties?: boolean;
    };
    const hasProps =
      current.properties &&
      typeof current.properties === 'object' &&
      Object.keys(current.properties).length > 0;
    if (hasProps) return;

    const inferred = inferProperties(testCaseKey);
    if (Object.keys(inferred).length === 0) return;

    req[schemaKey] = {
      type: 'object',
      properties: inferred,
      required: Object.keys(inferred),
      additionalProperties: false,
    };
  };

  maybeUpgrade('inputSchema', 'input');
  maybeUpgrade('outputSchema', 'expectedOutput');
}
