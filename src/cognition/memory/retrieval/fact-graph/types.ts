/**
 * @file types.ts
 * @description `Fact` + `FactStoreEntry` interfaces for the Step 9
 * fact-graph. See the Step 9 design spec §4.2 for rationale behind the
 * closed predicate schema + literal-object contract.
 *
 * @module agentos/memory/retrieval/fact-graph/types
 */

/**
 * A single extracted fact tuple. `object` MUST be a literal span from
 * the source turn (never paraphrased); this contract is the design
 * delta from Steps 5/7/8 whose summary-based approaches erased
 * specific-value tokens.
 */
export interface Fact {
  /** Canonical subject ("user" for first-person, lowercase otherwise). */
  subject: string;
  /** Predicate from the closed schema (see {@link PREDICATE_SCHEMA}). */
  predicate: string;
  /** Literal object span from the source turn — NEVER paraphrased. */
  object: string;
  /** ms since epoch. */
  timestamp: number;
  /** Trace or session IDs this fact was extracted from. */
  sourceTraceIds: string[];
  /** The full sentence the fact came from (for audit, not retrieval). */
  sourceSpan: string;
}

/**
 * Time-sorted-ascending list of facts for a single (subject, predicate)
 * pair. The latest fact supersedes earlier ones for `getLatest`
 * queries; all of them are visible to temporal queries via
 * `getAllTimeOrdered`.
 */
export interface FactStoreEntry {
  facts: Fact[];
}
