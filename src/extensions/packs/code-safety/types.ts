/**
 * @file types.ts
 * @description Core type definitions for the Code Safety Scanner extension pack.
 *
 * This module defines all shared types used across the code safety scanning system:
 * rule categories, violation shapes, scan results, pack configuration interfaces,
 * and stable default constants for severity actions and tool mappings.
 *
 * The code safety scanner is designed to detect security vulnerabilities in code
 * blocks produced or processed by agents — particularly before dangerous tool
 * calls such as `shell_execute` or `run_sql` are invoked.
 *
 * @module code-safety/types
 */

// ---------------------------------------------------------------------------
// Category union
// ---------------------------------------------------------------------------

/**
 * All OWASP-aligned security categories that the scanner can detect.
 *
 * Each category corresponds to a well-known class of vulnerability:
 * - `'injection'`       — arbitrary code execution via eval/exec/system etc.
 * - `'sql-injection'`   — SQL queries built with user-controlled strings
 * - `'xss'`             — Cross-Site Scripting via unsafe DOM writes
 * - `'path-traversal'`  — File path manipulation allowing directory escape
 * - `'secrets'`         — Hardcoded credentials, API keys, private keys
 * - `'crypto'`          — Weak hashing (MD5/SHA1) or insecure PRNG usage
 * - `'deserialization'` — Unsafe deserialization (pickle, yaml.load)
 * - `'ssrf'`            — Server-Side Request Forgery via unvalidated URLs
 * - `'permissions'`     — World-writable files, insecure temp directory usage
 * - `'other'`           — Catch-all for rules that don't fit above categories
 */
export type CodeSafetyCategory =
  | 'injection'
  | 'sql-injection'
  | 'xss'
  | 'path-traversal'
  | 'secrets'
  | 'crypto'
  | 'deserialization'
  | 'ssrf'
  | 'permissions'
  | 'other';

// ---------------------------------------------------------------------------
// Rule interface
// ---------------------------------------------------------------------------

/**
 * A single security rule in the code safety scanner.
 *
 * Rules encapsulate a named vulnerability pattern, the category and severity
 * it belongs to, and a map of language-keyed RegExp arrays that are tested
 * against code blocks.
 *
 * The wildcard key `'*'` in {@link patterns} matches any language (or code
 * with unknown language), while language-specific keys (e.g. `'python'`,
 * `'javascript'`) scope patterns to only that language to reduce false
 * positives.
 *
 * @example
 * ```ts
 * const evalRule: ICodeSafetyRule = {
 *   id: 'code-injection-eval',
 *   name: 'Unsafe eval() usage',
 *   description: 'Direct eval of dynamic string — arbitrary code execution risk.',
 *   category: 'injection',
 *   severity: 'critical',
 *   patterns: {
 *     '*': [/\beval\s*\(/],
 *     'python': [/\bexec\s*\(/, /\bcompile\s*\(/],
 *   },
 *   action: 'block',
 * };
 * ```
 */
export interface ICodeSafetyRule {
  /**
   * Stable, machine-readable identifier for this rule.
   * Format: `<category>-<descriptive-slug>`, e.g. `'code-injection-eval'`.
   */
  id: string;

  /** Human-readable short name displayed in violation reports. */
  name: string;

  /** Full explanation of why this pattern is dangerous and what to do instead. */
  description: string;

  /** OWASP-aligned category this rule belongs to. */
  category: CodeSafetyCategory;

  /**
   * How severe a violation of this rule is.
   * - `'critical'` — immediate danger, e.g. RCE or credential exposure
   * - `'high'`     — significant risk, e.g. SQLi, XSS, deserialization
   * - `'medium'`   — moderate risk, requires context to be exploitable
   * - `'low'`      — informational or low-likelihood risk
   */
  severity: 'critical' | 'high' | 'medium' | 'low';

  /**
   * Language-keyed RegExp arrays that are tested against code content.
   *
   * Key `'*'` applies to ALL languages (and to code with no detected language).
   * Other keys are matched against the normalised language name returned by
   * {@link CodeFenceExtractor.detectLanguage} (e.g. `'python'`, `'javascript'`,
   * `'bash'`, `'sql'`, `'ruby'`, `'php'`).
   *
   * A rule fires when ANY pattern in ANY applicable key finds a match.
   */
  patterns: Record<string, RegExp[]>;

  /**
   * Override action for this rule, taking precedence over severity-derived
   * defaults from {@link DEFAULT_SEVERITY_ACTIONS}.
   *
   * - `'flag'`  — mark the violation but allow execution to proceed
   * - `'block'` — halt execution and surface the violation as a hard error
   *
   * When omitted the action is resolved from {@link DEFAULT_SEVERITY_ACTIONS}
   * based on the rule's {@link severity}.
   */
  action?: 'flag' | 'block';
}

// ---------------------------------------------------------------------------
// CodeBlock interface
// ---------------------------------------------------------------------------

/**
 * A single code block extracted from a Markdown-fenced text, or a bare code
 * string synthesised from a tool-call argument.
 *
 * Offset values (`start`, `end`) are zero-based UTF-16 code-unit positions
 * within the original full text, matching the semantics of
 * `String.prototype.slice`.
 */
export interface CodeBlock {
  /** The raw code string inside the fence (without the backtick delimiters). */
  code: string;

  /**
   * Normalised programming language identifier, e.g. `'python'`, `'javascript'`.
   * `null` when the fence has no language tag and {@link CodeFenceExtractor.detectLanguage}
   * cannot identify the language with confidence.
   */
  language: string | null;

  /**
   * Zero-based start offset (inclusive) of the block in the original text.
   * Points at the opening ```` ``` ```` of the fence.
   */
  start: number;

  /**
   * Zero-based end offset (exclusive) of the block in the original text.
   * Points just past the closing ```` ``` ```` of the fence.
   */
  end: number;
}

// ---------------------------------------------------------------------------
// Violation interface
// ---------------------------------------------------------------------------

/**
 * A single security violation detected within a code block.
 *
 * Each violation corresponds to a rule that matched one or more patterns in
 * a scanned code block.  The `matchedText` field captures the exact substring
 * that triggered the match (the first match found if multiple exist).
 */
export interface CodeSafetyViolation {
  /** Identifier of the {@link ICodeSafetyRule} that fired. */
  ruleId: string;

  /** Human-readable name of the rule that fired. */
  ruleName: string;

  /** Category of the matched rule. */
  category: CodeSafetyCategory;

  /** Severity of the matched rule. */
  severity: 'critical' | 'high' | 'medium' | 'low';

  /**
   * The actual substring from the code that triggered the pattern match.
   * Useful for surfacing the exact offending code to the agent or user.
   */
  matchedText: string;

  /**
   * Normalised language of the block in which the violation was found.
   * `null` when the language could not be determined.
   */
  language: string | null;

  /**
   * Resolved action for this violation — either from the rule's own `action`
   * field, or derived from {@link DEFAULT_SEVERITY_ACTIONS} by severity.
   */
  action: 'flag' | 'block';
}

// ---------------------------------------------------------------------------
// Scan result interface
// ---------------------------------------------------------------------------

/**
 * The complete output of a {@link CodeSafetyScanner.scan} call over a text.
 *
 * Aggregates all violations found across every code block in the input,
 * sorted by severity (critical → high → medium → low), with a human-readable
 * summary string.
 */
export interface CodeSafetyScanResult {
  /**
   * `true` when no violations were found (or when all violations have action
   * `'flag'` and the caller considers flagged content acceptable).
   *
   * This flag is `false` when at least one violation with action `'block'` is
   * present.
   */
  safe: boolean;

  /** All violations detected, sorted by severity (critical first). */
  violations: CodeSafetyViolation[];

  /** Number of code blocks that were extracted and scanned. */
  blocksScanned: number;

  /**
   * Human-readable summary, e.g.
   * `"2 violations found: 1×critical, 1×high — BLOCKED"`.
   * Suitable for logging or surfacing in agent responses.
   */
  summary: string;
}

// ---------------------------------------------------------------------------
// Pack options interface
// ---------------------------------------------------------------------------

/**
 * Top-level configuration object for the code safety scanner extension pack.
 *
 * All properties are optional.  Sensible defaults allow a zero-config setup
 * to work out of the box using {@link DEFAULT_RULES} and
 * {@link DEFAULT_SEVERITY_ACTIONS}.
 */
export interface CodeSafetyPackOptions {
  /**
   * Additional custom rules to include beyond the default ruleset.
   * Custom rules are merged with {@link DEFAULT_RULES} (unless
   * {@link includeDefaultRules} is `false`).
   */
  customRules?: ICodeSafetyRule[];

  /**
   * Whether to load the built-in {@link DEFAULT_RULES}.
   * Set to `false` to use only {@link customRules}.
   * @default true
   */
  includeDefaultRules?: boolean;

  /**
   * Rule IDs from the default ruleset to skip entirely.
   * Useful for disabling rules that produce false positives in a specific
   * domain (e.g. disabling `command-injection-backtick` in a Ruby-heavy
   * agent).
   *
   * @example `['command-injection-backtick', 'insecure-random']`
   */
  disabledRules?: string[];

  /**
   * Per-severity override for the default action mapping.
   * Keys are severity strings; values are `'flag'` or `'block'`.
   *
   * @example `{ medium: 'block' }` — treat medium-severity violations as blockers
   */
  severityActions?: Record<string, 'flag' | 'block'>;

  /**
   * List of tool names whose arguments should be scanned for unsafe code.
   * When an agent calls one of these tools the argument identified by
   * {@link codeArgumentMapping} is extracted and scanned before execution.
   *
   * @default {@link DEFAULT_CODE_EXECUTING_TOOLS}
   */
  codeExecutingTools?: string[];

  /**
   * Mapping of tool name → `{ argKey, language }` that describes which
   * argument of each tool contains the code to scan, and what language to
   * treat that code as.
   *
   * - `argKey`    — key in the tool's argument object that holds the code string
   * - `language`  — hint for language-aware rule matching; `null` means auto-detect
   *
   * @default {@link DEFAULT_CODE_ARGUMENT_MAPPING}
   */
  codeArgumentMapping?: Record<string, { argKey: string; language: string | null }>;

  /**
   * Limits which agent messages the guardrail evaluates.
   * Currently only `'output'` is supported (scanning assistant-produced code
   * before it is sent back to the user or executed as a tool call).
   *
   * @default 'output'
   */
  guardrailScope?: 'output';
}

// ---------------------------------------------------------------------------
// Default constants
// ---------------------------------------------------------------------------

/**
 * Default mapping from severity level to the action taken when a violation is
 * detected.
 *
 * - `critical` and `high` violations are **blocked** by default — the scanner
 *   will refuse to allow the code to be executed.
 * - `medium` and `low` violations are **flagged** — they appear in the scan
 *   result but do not prevent execution.
 *
 * These defaults can be overridden per-pack via
 * {@link CodeSafetyPackOptions.severityActions}.
 */
export const DEFAULT_SEVERITY_ACTIONS: Record<string, 'flag' | 'block'> = {
  critical: 'block',
  high: 'block',
  medium: 'flag',
  low: 'flag',
} as const;

/**
 * Default set of tool names whose invocations trigger a code safety scan.
 *
 * These are the AgentOS built-in tools most likely to execute or persist
 * code that could be dangerous if it contains injected commands or secrets.
 */
export const DEFAULT_CODE_EXECUTING_TOOLS: string[] = [
  'shell_execute',
  'run_sql',
  'write_file',
  'create_file',
  'edit_file',
];

/**
 * Default mapping of tool name → code argument descriptor.
 *
 * Describes which argument in each default code-executing tool holds the
 * code string to scan, and what language to treat that argument as.
 *
 * `language: null` means the scanner will attempt auto-detection via
 * {@link CodeFenceExtractor.detectLanguage}.
 */
export const DEFAULT_CODE_ARGUMENT_MAPPING: Record<
  string,
  { argKey: string; language: string | null }
> = {
  /** The `command` argument of `shell_execute` is treated as Bash. */
  shell_execute: { argKey: 'command', language: 'bash' },

  /** The `query` argument of `run_sql` is treated as SQL. */
  run_sql: { argKey: 'query', language: 'sql' },

  /** The `content` argument of `write_file` has no predetermined language. */
  write_file: { argKey: 'content', language: null },

  /** The `content` argument of `create_file` has no predetermined language. */
  create_file: { argKey: 'content', language: null },

  /** The `content` argument of `edit_file` has no predetermined language. */
  edit_file: { argKey: 'content', language: null },
} as const;
