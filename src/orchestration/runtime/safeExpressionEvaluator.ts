/**
 * @fileoverview Safe expression evaluator for graph routing conditions.
 * @module orchestration/runtime/safeExpressionEvaluator
 *
 * Replaces the previous `new Function()` approach that was vulnerable to
 * arbitrary code injection. This evaluator resolves partition dot-path
 * references against graph state and supports only simple comparisons
 * (`===`, `!==`, `==`, `!=`, `>`, `<`, `>=`, `<=`) and boolean connectives
 * (`&&`, `||`). No arbitrary JS execution is possible.
 *
 * @example
 * ```ts
 * const state = { scratch: { decision: 'yes' }, input: { count: 5 } };
 * safeEvaluateExpression('scratch.decision', state);           // → 'yes'
 * safeEvaluateExpression('scratch.decision === "yes"', state); // → 'true'
 * safeEvaluateExpression('input.count > 3', state);            // → 'true'
 * ```
 */

import type { GraphState } from '../ir/types.js';

/** Allowed partitions that can be referenced in expressions. */
const ALLOWED_PARTITIONS = new Set(['scratch', 'input', 'artifacts', 'memory', 'diagnostics']);

/** Pattern matching `partition.path.to.value` references. */
const PARTITION_REF_PATTERN = /\b(scratch|input|artifacts|memory|diagnostics)(?:\.(\w+(?:\.\w+)*))?/g;

/**
 * Resolve a dot-separated path against a nested object.
 *
 * @param root - The root object to traverse.
 * @param path - Dot-separated field path (e.g. `'foo.bar.baz'`).
 * @returns The resolved value, or `undefined` if any segment is missing.
 */
function resolvePath(root: unknown, path: string): unknown {
  let current = root;
  for (const key of path.split('.')) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/**
 * Resolve all partition references in an expression to their actual values.
 *
 * @param expr  - The expression string with partition references.
 * @param state - Current graph state.
 * @returns A map of original references to their resolved values.
 */
function resolveAllRefs(expr: string, state: Partial<GraphState>): Map<string, unknown> {
  const refs = new Map<string, unknown>();
  let match: RegExpExecArray | null;
  const pattern = new RegExp(PARTITION_REF_PATTERN.source, 'g');

  while ((match = pattern.exec(expr)) !== null) {
    const [fullMatch, partition, path] = match;
    if (!ALLOWED_PARTITIONS.has(partition)) continue;
    const partitionObj = (state as Record<string, unknown>)[partition];
    const value = path ? resolvePath(partitionObj, path) : partitionObj;
    refs.set(fullMatch, value);
  }

  return refs;
}

/**
 * Parse a quoted string literal from an expression fragment.
 * Supports both single and double quotes.
 *
 * @param s - The string fragment to parse.
 * @returns The unquoted string value, or null if not a string literal.
 */
function parseStringLiteral(s: string): string | null {
  const trimmed = s.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return null;
}

/**
 * Parse a value token from an expression (after partition references are resolved).
 *
 * @param token  - The token string.
 * @param refs   - Resolved partition references.
 * @returns The parsed value.
 */
function parseToken(token: string, refs: Map<string, unknown>): unknown {
  const trimmed = token.trim();

  // Check if this token is a resolved partition reference
  if (refs.has(trimmed)) return refs.get(trimmed);

  // String literal
  const str = parseStringLiteral(trimmed);
  if (str !== null) return str;

  // Boolean literals
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed === 'null') return null;
  if (trimmed === 'undefined') return undefined;

  // Number literal
  const num = Number(trimmed);
  if (!isNaN(num) && trimmed !== '') return num;

  // Fallback: return as string (e.g. route names)
  return trimmed;
}

/** Supported comparison operators. */
type ComparisonOp = '===' | '!==' | '==' | '!=' | '>=' | '<=' | '>' | '<';

const COMPARISON_OPS: ComparisonOp[] = ['===', '!==', '==', '!=', '>=', '<=', '>', '<'];

/**
 * Evaluate a single comparison expression (no boolean connectives).
 *
 * @param expr - Expression like `'scratch.x === "yes"'` or just `'scratch.x'`.
 * @param refs - Resolved partition references.
 * @returns The result as a primitive value.
 */
function evaluateSingleComparison(expr: string, refs: Map<string, unknown>): unknown {
  const trimmed = expr.trim();

  // Try each comparison operator (longest first to avoid partial matches)
  for (const op of COMPARISON_OPS) {
    const idx = trimmed.indexOf(op);
    if (idx === -1) continue;

    // Make sure it's not a substring of a longer operator
    const before = trimmed.slice(0, idx);
    const after = trimmed.slice(idx + op.length);

    const left = parseToken(before, refs);
    const right = parseToken(after, refs);

    switch (op) {
      case '===': return left === right;
      case '!==': return left !== right;
      case '==': return left == right; // eslint-disable-line eqeqeq
      case '!=': return left != right; // eslint-disable-line eqeqeq
      case '>=': return Number(left) >= Number(right);
      case '<=': return Number(left) <= Number(right);
      case '>': return Number(left) > Number(right);
      case '<': return Number(left) < Number(right);
    }
  }

  // No comparison operator found — just resolve the value
  return parseToken(trimmed, refs);
}

/**
 * Safely evaluate a graph routing expression against state.
 *
 * Supports:
 * - Partition references: `scratch.foo.bar`, `input.x`, `artifacts.result`
 * - Comparisons: `===`, `!==`, `==`, `!=`, `>`, `<`, `>=`, `<=`
 * - Boolean connectives: `&&`, `||`
 * - String/number/boolean/null literals
 *
 * Does NOT support:
 * - Function calls, property access on resolved values, `new`, `delete`, etc.
 * - Nested parentheses (evaluated left-to-right with `||` then `&&` precedence)
 *
 * @param expr  - The DSL expression string from a graph condition.
 * @param state - Current graph state whose partitions are accessible.
 * @returns The resolved value as a string. Returns `'false'` on any error.
 */
export function safeEvaluateExpression(expr: string, state: Partial<GraphState>): string {
  try {
    const refs = resolveAllRefs(expr, state);

    // Split on `||` first (lower precedence), then `&&` (higher precedence)
    const orParts = expr.split('||').map(s => s.trim());
    for (const orPart of orParts) {
      const andParts = orPart.split('&&').map(s => s.trim());
      const allTrue = andParts.every(part => {
        const result = evaluateSingleComparison(part, refs);
        return Boolean(result);
      });
      if (allTrue) {
        // If the expression was a simple value (no operators), return the resolved value
        if (orParts.length === 1 && andParts.length === 1) {
          const result = evaluateSingleComparison(expr, refs);
          return String(result ?? 'false');
        }
        return 'true';
      }
    }
    return 'false';
  } catch {
    return 'false';
  }
}
