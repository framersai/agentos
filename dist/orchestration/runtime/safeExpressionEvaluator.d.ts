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
export declare function safeEvaluateExpression(expr: string, state: Partial<GraphState>): string;
//# sourceMappingURL=safeExpressionEvaluator.d.ts.map