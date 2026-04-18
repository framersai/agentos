/**
 * @fileoverview Classify forge-rejection `errorReason` strings into a
 * small set of actionable categories.
 * @module @framers/agentos/emergent/ForgeRejectionClassifier
 *
 * Without categorization, the only way to answer "why are forges failing"
 * is to grep logs. With classification, an aggregator can emit a live
 * histogram of failure modes (schema-extra-field vs shape-check vs judge
 * correctness vs parse error) so operators see the failure-mode
 * distribution without log access.
 *
 * Categories are deliberately narrow. They split out the patterns that
 * appear in real production rejection text; anything unrecognized falls
 * into `other`. A growing `other` bucket is the signal to read raw
 * reasons and extend the pattern set.
 */

/**
 * Rejection-reason category produced by {@link classifyForgeRejection}.
 */
export type ForgeRejectionCategory =
  /**
   * Implementation returned output fields not declared in outputSchema
   * (violates `additionalProperties: false`). The most common forge
   * failure mode under a strict schema contract.
   */
  | 'schema_extra_field'
  /**
   * Pre-judge shape validator caught a malformed request (empty schema
   * properties, empty testCases, empty-input testCases).
   */
  | 'shape_check'
  /**
   * Judge LLM returned malformed JSON the engine could not parse.
   */
  | 'parse_error'
  /**
   * Judge flagged logic / correctness / safety concerns in the code
   * itself (division bugs, threshold inversions, unbounded outputs,
   * non-deterministic behavior).
   */
  | 'judge_correctness'
  /**
   * Everything else. A non-zero `other` bucket is a signal to inspect
   * the raw reasons and consider adding a new category.
   */
  | 'other';

const SCHEMA_EXTRA_FIELD_PATTERNS = [
  'additional properties',
  'additional property',
  'additionalproperties',
  'extra field',
  'extra fields',
  'extra property',
  'extra properties',
  'undeclared extra field',
  'undeclared field',
  'emits an additional',
  'emits extra',
  'returning an additional',
  'returning extra',
  'returns an additional',
  'returns extra',
  'returns additional',
  'returning an undeclared',
];

/**
 * Regex-based patterns for "extra <modifier> field" phrasings that
 * substring matching misses. Example: "extra recommendations field"
 * is clearly a schema-extra-field rejection but the contiguous string
 * "extra field" is absent. These regexes catch the general form.
 */
const SCHEMA_EXTRA_FIELD_REGEXES: RegExp[] = [
  /\bextra\s+\w+\s+field\b/,
  /\badditional\s+\w+\s+field\b/,
  /\bextra\s+\w+\s+property\b/,
  /\badditional\s+\w+\s+property\b/,
];

const SHAPE_CHECK_PATTERNS = [
  'shape check failed',
  'inputschema has no declared properties',
  'outputschema has no declared properties',
  'testcases use empty input',
  'testcase use empty input',
  'need at least 2 testcases',
  'every test needs real field values',
];

const PARSE_ERROR_PATTERNS = [
  'failed to parse llm response',
  'could not parse judge response',
  'judge response was not valid json',
];

const JUDGE_CORRECTNESS_PATTERNS = [
  'logic error',
  'threshold ordering',
  'clamped',
  'unclamped',
  'inconsistent risk grading',
  'division by zero',
  'unbounded output',
  'unbounded',
  'returns nan',
  'returns infinity',
  'infinite loop',
  'not deterministic',
  'nondeterministic',
  'correctness is questionable',
  'correctness concern',
  'fails safety',
  'safety concern',
];

/**
 * Classify a rejection reason string into a {@link ForgeRejectionCategory}.
 *
 * Case-insensitive substring match against pattern lists, evaluated in
 * order: schema_extra_field first (most common and most actionable),
 * then shape_check (local pre-validator), then parse_error, then
 * judge_correctness, then `other`.
 *
 * Order matters: "violates the declared output schema by returning an
 * additional field due to a logic error" matches BOTH schema_extra_field
 * and judge_correctness; the former wins because it is the more specific
 * and more actionable signal.
 *
 * @param errorReason Raw rejection reason text, typically the judge's
 *   verdict reasoning or the local shape-validator's joined error list.
 *   May be `undefined` when no reason was captured.
 * @returns One of the five category labels. Empty / `undefined` input
 *   returns `'other'`.
 */
export function classifyForgeRejection(errorReason: string | undefined): ForgeRejectionCategory {
  if (!errorReason) return 'other';
  const lower = errorReason.toLowerCase();

  for (const p of SCHEMA_EXTRA_FIELD_PATTERNS) {
    if (lower.includes(p)) return 'schema_extra_field';
  }
  for (const rx of SCHEMA_EXTRA_FIELD_REGEXES) {
    if (rx.test(lower)) return 'schema_extra_field';
  }
  for (const p of SHAPE_CHECK_PATTERNS) {
    if (lower.includes(p)) return 'shape_check';
  }
  for (const p of PARSE_ERROR_PATTERNS) {
    if (lower.includes(p)) return 'parse_error';
  }
  for (const p of JUDGE_CORRECTNESS_PATTERNS) {
    if (lower.includes(p)) return 'judge_correctness';
  }
  return 'other';
}
