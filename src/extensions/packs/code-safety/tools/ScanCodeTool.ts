/**
 * @file ScanCodeTool.ts
 * @description An AgentOS tool that exposes the code safety scanner as a callable
 * tool, enabling agents and users to perform on-demand security scans of arbitrary
 * code snippets.
 *
 * ## Overview
 *
 * {@link ScanCodeTool} implements {@link ITool} and wraps {@link CodeSafetyScanner}
 * so that the scanner can be invoked directly from agent conversations or tool
 * orchestration pipelines — without needing to route through the guardrail layer.
 *
 * This is useful for:
 * - Agents that want to self-check code before writing it to a file.
 * - Users who want to audit a snippet they are about to share.
 * - CI/CD integrations that drive AgentOS to scan code and gate on results.
 *
 * ### Input
 *
 * | Field      | Type   | Required | Description                                           |
 * |------------|--------|----------|-------------------------------------------------------|
 * | `code`     | string | Yes      | Raw source code to scan.                              |
 * | `language` | string | No       | Language hint (e.g. `'python'`, `'bash'`). Auto-detected if omitted. |
 *
 * ### Output
 *
 * Returns a {@link CodeSafetyScanResult}:
 * - `safe`          — `true` if no blocking violations were found.
 * - `violations`    — Full list of violations (may include flagged items even when safe).
 * - `blocksScanned` — Always 1 (the input code is treated as a single synthetic block).
 * - `summary`       — Human-readable summary suitable for agent responses.
 *
 * @module code-safety/tools/ScanCodeTool
 */

import type { ITool, ToolExecutionContext, ToolExecutionResult } from '../../../../core/tools/ITool';
import type { CodeSafetyScanResult, CodeSafetyViolation } from '../types';
import type { CodeSafetyScanner } from '../CodeSafetyScanner';

// ---------------------------------------------------------------------------
// Input type
// ---------------------------------------------------------------------------

/**
 * Input arguments accepted by {@link ScanCodeTool}.
 *
 * @interface ScanCodeInput
 */
export interface ScanCodeInput {
  /**
   * The raw source code string to scan for security vulnerabilities.
   *
   * This can be a complete file, a function body, a shell command, a SQL query,
   * or any other code string that needs evaluation.
   */
  code: string;

  /**
   * Optional programming language hint.
   *
   * When provided, the scanner uses this language to apply language-specific
   * security rules in addition to the universal (`'*'`) rules.
   *
   * Accepted values include: `'python'`, `'javascript'`, `'typescript'`,
   * `'bash'`, `'sql'`, `'ruby'`, `'php'`, `'go'`, `'java'`, etc.
   *
   * When omitted, the scanner attempts to auto-detect the language using
   * {@link CodeFenceExtractor.detectLanguage}.
   */
  language?: string;
}

// ---------------------------------------------------------------------------
// ScanCodeTool
// ---------------------------------------------------------------------------

/**
 * An AgentOS tool that scans a code snippet for security vulnerabilities.
 *
 * Wraps {@link CodeSafetyScanner.scanCode} for use in tool pipelines and
 * direct agent invocations.
 *
 * ### ITool metadata
 *
 * - `id` / `name`: `'scan_code'`
 * - `category`: `'security'`
 * - `hasSideEffects`: `false` — purely read-only scan, no external calls
 * - `version`: `'1.0.0'`
 *
 * ### Example agent invocation
 *
 * ```json
 * {
 *   "name": "scan_code",
 *   "arguments": {
 *     "code": "import pickle\nobj = pickle.loads(data)",
 *     "language": "python"
 *   }
 * }
 * ```
 *
 * @implements {ITool<ScanCodeInput, CodeSafetyScanResult>}
 */
export class ScanCodeTool implements ITool<ScanCodeInput, CodeSafetyScanResult> {
  // -----------------------------------------------------------------------
  // ITool metadata
  // -----------------------------------------------------------------------

  /**
   * Stable, globally unique identifier for this tool.
   * Uses underscore naming to match AgentOS built-in tool conventions.
   */
  readonly id = 'scan_code';

  /**
   * The name presented to the LLM in tool call requests.
   * Must match the `id` so orchestrators can resolve the tool by name.
   */
  readonly name = 'scan_code';

  /**
   * Human-readable display name shown in UIs and logs.
   */
  readonly displayName = 'Code Safety Scanner';

  /**
   * Natural language description used by the LLM when deciding whether to
   * invoke this tool.  Should clearly describe what the tool does and when
   * to use it.
   */
  readonly description =
    'Scan code for security vulnerabilities using language-aware pattern rules. ' +
    'Returns a list of detected violations (injection, SQLi, XSS, secrets, etc.) ' +
    'and an overall safe/unsafe determination. Use this tool before writing or ' +
    'executing code to catch dangerous patterns early.';

  /**
   * The tool category.  `'security'` groups this with other safety-related tools
   * in the capability discovery system.
   */
  readonly category = 'security';

  /**
   * Semantic version of this tool implementation.
   */
  readonly version = '1.0.0';

  /**
   * This tool performs only read-only analysis — it never writes files,
   * executes commands, or makes network requests.
   */
  readonly hasSideEffects = false;

  /**
   * JSON Schema for the tool's input arguments.
   *
   * Validated by the ToolExecutor before `execute()` is called.
   */
  readonly inputSchema = {
    type: 'object' as const,
    properties: {
      code: {
        type: 'string' as const,
        description:
          'The raw source code string to scan for security vulnerabilities.',
      },
      language: {
        type: 'string' as const,
        description:
          "Programming language of the code (e.g. 'python', 'bash', 'sql'). " +
          'Auto-detected if omitted.',
      },
    },
    required: ['code'],
  };

  // -----------------------------------------------------------------------
  // Private fields
  // -----------------------------------------------------------------------

  /**
   * The {@link CodeSafetyScanner} instance used for all scanning operations.
   * Injected at construction time; shared and stateless.
   */
  private readonly scanner: CodeSafetyScanner;

  // -----------------------------------------------------------------------
  // Constructor
  // -----------------------------------------------------------------------

  /**
   * Create a new ScanCodeTool.
   *
   * @param scanner - Configured {@link CodeSafetyScanner} instance.  The scanner
   *                  is shared across calls and must be safe for concurrent use
   *                  (which it is, as it holds no mutable state).
   *
   * @example
   * ```ts
   * import { CodeSafetyScanner } from '../CodeSafetyScanner';
   * import { ScanCodeTool } from './ScanCodeTool';
   *
   * const scanner = new CodeSafetyScanner();
   * const tool = new ScanCodeTool(scanner);
   * ```
   */
  constructor(scanner: CodeSafetyScanner) {
    this.scanner = scanner;
  }

  // -----------------------------------------------------------------------
  // ITool.execute
  // -----------------------------------------------------------------------

  /**
   * Execute a code safety scan against the provided `code` argument.
   *
   * ### Algorithm
   *
   * 1. Delegate to {@link CodeSafetyScanner.scanCode} with `args.code` and
   *    `args.language` (or `null` for auto-detection when omitted).
   * 2. Determine `safe`: `false` when any violation has action `'block'`.
   * 3. Build a human-readable summary string.
   * 4. Return the structured {@link CodeSafetyScanResult} as tool output.
   *
   * This method never throws — internal errors from the scanner are caught and
   * returned as a failed {@link ToolExecutionResult} so the orchestrator can
   * handle them gracefully.
   *
   * @param args    - Validated input arguments containing `code` and optional `language`.
   * @param context - Execution context (unused by this read-only tool, but required
   *                  by the {@link ITool} contract).
   * @returns Promise resolving to a {@link ToolExecutionResult} wrapping the scan result.
   */
  async execute(
    args: ScanCodeInput,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult<CodeSafetyScanResult>> {
    try {
      // Resolve the language hint: undefined → null (scanner convention).
      const language = args.language ?? null;

      // Run the scan against the synthetic single-block code string.
      const violations = this.scanner.scanCode(args.code, language);

      // safe = false when at least one violation requires a block action.
      const safe = !violations.some((v) => v.action === 'block');

      // Build a human-readable summary string.
      const summary = buildSummary(violations);

      return {
        success: true,
        output: {
          safe,
          violations,
          // scanCode always processes a single synthetic block.
          blocksScanned: 1,
          summary,
        },
      };
    } catch (err: unknown) {
      // Surface scanner errors as a failed tool result rather than a thrown exception.
      const message =
        err instanceof Error ? err.message : 'Unknown error during code scan';

      return {
        success: false,
        error: `Code safety scan failed: ${message}`,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Build a human-readable summary string from a list of violations produced by
 * {@link CodeSafetyScanner.scanCode}.
 *
 * Because `scanCode` always operates on a single synthetic block the wording is
 * slightly different from the multi-block {@link buildSummary} in CodeSafetyScanner:
 * we always say "1 block".
 *
 * @param violations - Violations returned by `scanner.scanCode()`.
 * @returns Human-readable summary suitable for agent responses and logs.
 *
 * @example
 * ```
 * "No violations found in 1 block(s)."
 * "2 violation(s) in 1 block(s): 1×critical, 1×high — BLOCKED"
 * "1 violation(s) in 1 block(s): 1×medium — FLAGGED"
 * ```
 *
 * @internal
 */
function buildSummary(violations: CodeSafetyViolation[]): string {
  // Fast path: nothing found.
  if (violations.length === 0) {
    return 'No violations found in 1 block(s).';
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
    if (n && n > 0) {
      severityParts.push(`${n}×${level}`);
    }
  }

  // Determine overall status: blocked when any violation requires blocking.
  const hasBlocker = violations.some((v) => v.action === 'block');
  const status = hasBlocker ? 'BLOCKED' : 'FLAGGED';

  return (
    `${violations.length} violation(s) in 1 block(s): ` +
    `${severityParts.join(', ')} — ${status}`
  );
}
