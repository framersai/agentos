/**
 * @fileoverview Human-readable formatters for citation verification results.
 *
 * Kept out of {@link VerifiedResponse} so the result type stays purely
 * machine-readable. Use these helpers when emitting log lines, CLI output,
 * or any other place a human will read the result.
 *
 * @module agentos/rag/citation/format
 */

import type { VerifiedResponse } from './types.js';

/**
 * Render a one-line human summary like `"3/4 claims verified (75%)"`.
 *
 * @example
 *   const result = await verifier.verify(text, sources);
 *   console.log(formatVerifiedResponse(result));
 *   // → "3/4 claims verified (75%)"
 */
export function formatVerifiedResponse(result: VerifiedResponse): string {
  if (result.totalClaims === 0) return 'No verifiable claims found.';
  const pct = Math.round((result.supportedCount / result.totalClaims) * 100);
  return `${result.supportedCount}/${result.totalClaims} claims verified (${pct}%)`;
}
