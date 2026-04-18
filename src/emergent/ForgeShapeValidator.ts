/**
 * @fileoverview Pre-judge shape validator for forge requests.
 * @module @framers/agentos/emergent/ForgeShapeValidator
 *
 * Catches the failure modes that dominate cheap-tier forge rejections
 * (empty schema properties, too-few testCases, empty-input testCases)
 * BEFORE the judge LLM sees the request. Every shape-check rejection
 * saves one judge invocation plus the sandbox round-trip that would
 * have followed it.
 *
 * Pure function, no dependencies.
 */

/**
 * Minimal forge request shape the validator needs. Accepts `unknown`
 * for the schema fields so callers can pass raw LLM output without
 * pre-shaping.
 */
export interface ForgeShapeRequest {
  inputSchema?: unknown;
  outputSchema?: unknown;
  testCases?: unknown;
}

/**
 * Validate a forge request's shape against the rules that dominate
 * cheap-tier failures. Every violation is reported at once (no
 * short-circuit) so the caller can build one comprehensive error
 * message to show the LLM.
 *
 * Rules enforced:
 * - `inputSchema.properties` must declare at least one field.
 * - `outputSchema.properties` must declare at least one field.
 * - `testCases` must have at least 2 entries.
 * - Every testCase must have a non-empty `input` object.
 *
 * @param req Request fragment. Only the three fields are inspected;
 *   other fields on the forge request are ignored.
 * @returns Array of human-readable error strings. Empty means the
 *   request's shape is well-formed enough to forward to the judge.
 */
export function validateForgeShape(req: ForgeShapeRequest): string[] {
  const errors: string[] = [];
  const inputSchema = req.inputSchema as { properties?: Record<string, unknown> } | null;
  const outputSchema = req.outputSchema as { properties?: Record<string, unknown> } | null;
  const inputProps =
    inputSchema && typeof inputSchema.properties === 'object' ? inputSchema.properties : null;
  const outputProps =
    outputSchema && typeof outputSchema.properties === 'object' ? outputSchema.properties : null;
  if (!inputProps || Object.keys(inputProps).length === 0) {
    errors.push('inputSchema has no declared properties; add at least two typed fields');
  }
  if (!outputProps || Object.keys(outputProps).length === 0) {
    errors.push('outputSchema has no declared properties; add at least one typed output field');
  }
  const tcArr = Array.isArray(req.testCases)
    ? (req.testCases as Array<{ input?: unknown; expectedOutput?: unknown }>)
    : [];
  if (tcArr.length < 2) {
    errors.push(`need at least 2 testCases, got ${tcArr.length}`);
  }
  const emptyInputs = tcArr.filter(tc => {
    const inp = tc?.input;
    return !inp || typeof inp !== 'object' || Object.keys(inp as Record<string, unknown>).length === 0;
  }).length;
  if (emptyInputs > 0) {
    errors.push(
      `${emptyInputs} testCase${emptyInputs === 1 ? '' : 's'} use empty input; every test needs real field values`,
    );
  }
  return errors;
}
