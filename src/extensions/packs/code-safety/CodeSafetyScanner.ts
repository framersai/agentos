/**
 * @file CodeSafetyScanner.ts
 * @description Core scanning engine for the code safety extension pack.
 *
 * ## Overview
 *
 * {@link CodeSafetyScanner} ties together the code-fence extraction
 * ({@link extractCodeBlocks} / {@link detectLanguage}) and the rule registry
 * ({@link DEFAULT_RULES}) into a single scanning API:
 *
 * ```
 * scanner.scan(text)         — extract all code fences → scan each block
 * scanner.scanBlock(block)   — scan one CodeBlock against all active rules
 * scanner.scanCode(code, lang) — convenience: build a synthetic block → scanBlock
 * ```
 *
 * ### Language-aware matching
 *
 * Each rule in {@link ICodeSafetyRule.patterns} may have:
 * - A `'*'` key — patterns that apply to ALL languages (and to unknown-language blocks)
 * - Language-specific keys (e.g. `'python'`, `'bash'`) — patterns that only apply
 *   when the block's language matches
 *
 * The scanner resolves the effective language by:
 * 1. Using `block.language` if it was explicitly set by the code fence tag.
 * 2. Falling back to {@link detectLanguage} on the raw code content.
 * 3. Leaving language as `null` when neither source provides a hint — in that
 *    case only `'*'` patterns are applied.
 *
 * ### Severity ordering
 *
 * Violations are sorted by severity in descending order (critical → high → medium → low)
 * so the most dangerous issues are always surfaced first.
 *
 * @module code-safety/CodeSafetyScanner
 */

import type { CodeBlock, CodeSafetyScanResult, CodeSafetyViolation, ICodeSafetyRule } from './types';
import { DEFAULT_SEVERITY_ACTIONS } from './types';
import { DEFAULT_RULES } from './DefaultRules';
import { detectLanguage, extractCodeBlocks } from './CodeFenceExtractor';

// ---------------------------------------------------------------------------
// Internal constants
// ---------------------------------------------------------------------------

/**
 * Numeric weight for each severity level used when sorting violations so
 * that critical issues appear before high, medium, and low.
 */
const SEVERITY_ORDER: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

// ---------------------------------------------------------------------------
// CodeSafetyScanner
// ---------------------------------------------------------------------------

/**
 * Stateless scanner that evaluates code blocks against a set of security rules
 * and returns structured violation reports.
 *
 * ### Construction
 *
 * ```ts
 * // Zero-config: uses DEFAULT_RULES and DEFAULT_SEVERITY_ACTIONS
 * const scanner = new CodeSafetyScanner();
 *
 * // Custom rules only:
 * const scanner = new CodeSafetyScanner(myRules, { medium: 'block' });
 *
 * // Mix custom + default rules (merge them before passing):
 * const scanner = new CodeSafetyScanner([...DEFAULT_RULES, ...myRules]);
 * ```
 *
 * ### Thread safety
 *
 * The scanner holds no mutable instance state — all scanning state is local to
 * each method call, so it is safe to share a single instance across concurrent
 * requests.
 */
export class CodeSafetyScanner {
  // -----------------------------------------------------------------------
  // Private fields
  // -----------------------------------------------------------------------

  /**
   * Active rule set used by this scanner instance.
   * Immutable after construction.
   */
  private readonly rules: ICodeSafetyRule[];

  /**
   * Effective severity → action map.
   * Merges caller-supplied overrides on top of {@link DEFAULT_SEVERITY_ACTIONS}.
   */
  private readonly severityActions: Record<string, 'flag' | 'block'>;

  // -----------------------------------------------------------------------
  // Constructor
  // -----------------------------------------------------------------------

  /**
   * Create a new CodeSafetyScanner.
   *
   * @param rules           - Rules to scan against.  Defaults to {@link DEFAULT_RULES}.
   * @param severityActions - Per-severity action overrides.  Entries are merged on
   *                          top of {@link DEFAULT_SEVERITY_ACTIONS}, so only the
   *                          levels you want to override need to be specified.
   *
   * @example
   * ```ts
   * // Make medium violations blockers too:
   * const scanner = new CodeSafetyScanner(DEFAULT_RULES, { medium: 'block' });
   * ```
   */
  constructor(
    rules: ICodeSafetyRule[] = DEFAULT_RULES,
    severityActions: Record<string, 'flag' | 'block'> = {},
  ) {
    this.rules = rules;

    // Merge caller-supplied overrides on top of the defaults.
    // The spread order is intentional: DEFAULT_SEVERITY_ACTIONS provides the base,
    // and the caller's entries override individual keys.
    this.severityActions = { ...DEFAULT_SEVERITY_ACTIONS, ...severityActions };
  }

  // -----------------------------------------------------------------------
  // Public API — scan
  // -----------------------------------------------------------------------

  /**
   * Scan all Markdown code fences in `text` against the active rule set.
   *
   * ### Algorithm
   * 1. Extract code blocks from Markdown fences using {@link extractCodeBlocks}.
   * 2. For each block, call {@link scanBlock} to collect violations.
   * 3. Merge all violations, deduplicate (same rule + same matched text), sort
   *    by severity, and build a human-readable summary.
   * 4. `safe` is `false` when at least one violation has action `'block'`.
   *
   * @param text - Raw text that may contain Markdown-fenced code blocks.
   * @returns A {@link CodeSafetyScanResult} describing what was found.
   *
   * @example
   * ```ts
   * const result = scanner.scan('```python\nimport pickle\nobj = pickle.loads(data)\n```');
   * // result.safe === false
   * // result.violations[0].ruleId === 'insecure-pickle'
   * ```
   */
  scan(text: string): CodeSafetyScanResult {
    // Extract all code fences from the text.
    const blocks = extractCodeBlocks(text);

    if (blocks.length === 0) {
      // Fast path: no code blocks found — nothing to scan.
      return {
        safe: true,
        violations: [],
        blocksScanned: 0,
        summary: 'No code blocks found.',
      };
    }

    // Scan each block and collect all violations.
    const allViolations: CodeSafetyViolation[] = [];
    for (const block of blocks) {
      const blockViolations = this.scanBlock(block);
      allViolations.push(...blockViolations);
    }

    // Sort by severity (critical first).
    allViolations.sort(
      (a, b) =>
        (SEVERITY_ORDER[a.severity] ?? 99) - (SEVERITY_ORDER[b.severity] ?? 99),
    );

    // Determine whether the result is safe: unsafe if any violation is a blocker.
    const hasBlocker = allViolations.some((v) => v.action === 'block');

    // Build a descriptive summary.
    const summary = buildSummary(allViolations, blocks.length);

    return {
      safe: !hasBlocker,
      violations: allViolations,
      blocksScanned: blocks.length,
      summary,
    };
  }

  // -----------------------------------------------------------------------
  // Public API — scanBlock
  // -----------------------------------------------------------------------

  /**
   * Scan a single {@link CodeBlock} against all active rules and return the
   * list of {@link CodeSafetyViolation}s found.
   *
   * ### Language resolution
   *
   * The effective language used for rule matching is resolved in order:
   * 1. `block.language` — set by the code-fence language tag.
   * 2. `detectLanguage(block.code)` — heuristic detection when no tag present.
   * 3. `null` — applied only `'*'` (universal) patterns.
   *
   * ### Rule matching
   *
   * For each rule, the scanner tests:
   * - All `patterns['*']` entries (universal, language-agnostic)
   * - All `patterns[effectiveLanguage]` entries (when language is known)
   *
   * If any pattern matches, a {@link CodeSafetyViolation} is created capturing
   * the first matching substring and the resolved action.
   *
   * Each rule can produce at most one violation per block (the first pattern
   * match wins).
   *
   * @param block - Code block to evaluate.
   * @returns Array of violations found in this block (may be empty).
   */
  scanBlock(block: CodeBlock): CodeSafetyViolation[] {
    const { code } = block;

    // Resolve the effective language for this block.
    // Prefer the explicit language tag; fall back to heuristic detection.
    const effectiveLanguage: string | null =
      block.language ?? detectLanguage(code);

    const violations: CodeSafetyViolation[] = [];

    for (const rule of this.rules) {
      // Collect the pattern arrays that apply to this language.
      // Always include '*' (universal) patterns.
      const applicablePatterns: RegExp[] = [
        ...(rule.patterns['*'] ?? []),
        // Add language-specific patterns when we have a known language.
        ...(effectiveLanguage && rule.patterns[effectiveLanguage]
          ? rule.patterns[effectiveLanguage]
          : []),
      ];

      if (applicablePatterns.length === 0) {
        // This rule has no applicable patterns for the detected language — skip.
        continue;
      }

      // Test each pattern; stop on the first match to emit a single violation
      // per rule per block.
      let matchedText: string | null = null;
      for (const pattern of applicablePatterns) {
        // Reset lastIndex to ensure we search from the beginning of the code.
        // This guards against stale state if the regex has the `g` flag.
        pattern.lastIndex = 0;
        const match = pattern.exec(code);
        if (match !== null) {
          matchedText = match[0];
          break;
        }
      }

      if (matchedText === null) {
        // No pattern matched for this rule — no violation.
        continue;
      }

      // Resolve the action: rule-level override takes priority, otherwise
      // fall back to severity-based default from severityActions map.
      const action: 'flag' | 'block' =
        rule.action ?? this.severityActions[rule.severity] ?? 'flag';

      violations.push({
        ruleId: rule.id,
        ruleName: rule.name,
        category: rule.category,
        severity: rule.severity,
        matchedText,
        language: effectiveLanguage,
        action,
      });
    }

    return violations;
  }

  // -----------------------------------------------------------------------
  // Public API — scanCode
  // -----------------------------------------------------------------------

  /**
   * Convenience method to scan a raw code string without wrapping it in a
   * Markdown fence.
   *
   * A synthetic {@link CodeBlock} is constructed from the provided `code` and
   * `language` values, then passed to {@link scanBlock}.
   *
   * This is useful for scanning tool-call argument values (e.g. the `command`
   * argument of `shell_execute`) before execution.
   *
   * @param code     - Raw source code or command string to scan.
   * @param language - Language hint for rule matching (e.g. `'bash'`, `'sql'`).
   *                   Pass `null` to rely on heuristic auto-detection.
   * @returns Array of violations found in the code (may be empty).
   *
   * @example
   * ```ts
   * const violations = scanner.scanCode("SELECT * FROM users WHERE name = '" + name + "'", 'sql');
   * ```
   */
  scanCode(code: string, language: string | null): CodeSafetyViolation[] {
    // Construct a synthetic CodeBlock representing the raw code string.
    // Start/end offsets are set to 0 since there is no enclosing text context.
    const syntheticBlock: CodeBlock = {
      code,
      language,
      start: 0,
      end: code.length,
    };

    return this.scanBlock(syntheticBlock);
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Build a human-readable summary string from the list of violations and the
 * number of blocks scanned.
 *
 * @param violations   - All violations collected across all scanned blocks.
 * @param blocksScanned - Number of code blocks that were evaluated.
 * @returns Summary string suitable for logging or agent output.
 *
 * @example
 * ```
 * "2 violations in 1 block(s): 1×critical, 1×high — BLOCKED"
 * "No violations found in 3 block(s)."
 * ```
 *
 * @internal
 */
function buildSummary(violations: CodeSafetyViolation[], blocksScanned: number): string {
  if (violations.length === 0) {
    return `No violations found in ${blocksScanned} block(s).`;
  }

  // Count violations by severity.
  const counts: Record<string, number> = {};
  for (const v of violations) {
    counts[v.severity] = (counts[v.severity] ?? 0) + 1;
  }

  // Build the severity breakdown string (critical first, only non-zero levels).
  const severityParts: string[] = [];
  for (const level of ['critical', 'high', 'medium', 'low']) {
    const n = counts[level];
    if (n && n > 0) severityParts.push(`${n}×${level}`);
  }

  // Determine overall status.
  const hasBlocker = violations.some((v) => v.action === 'block');
  const status = hasBlocker ? 'BLOCKED' : 'FLAGGED';

  return (
    `${violations.length} violation(s) in ${blocksScanned} block(s): ` +
    `${severityParts.join(', ')} — ${status}`
  );
}
