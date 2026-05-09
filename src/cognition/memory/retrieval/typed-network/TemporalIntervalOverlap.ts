/**
 * @file TemporalIntervalOverlap.ts
 * @description Temporal-overlap ranking signal for the 4-way RRF
 * fusion. Given a query timestamp and a set of typed facts, ranks the
 * facts by how tightly their occurrence intervals (`τs, τe`) bracket
 * the query timestamp, with a graceful fallback to mention-timestamp
 * distance for facts without a full interval.
 *
 * Hindsight Eq. 12 weighs temporal edges by `exp(−Δt / σt)`. This
 * file's `rankByTemporalOverlap` produces the same monotone signal in
 * a form suitable for the BM25 / semantic / spreading-activation /
 * temporal four-way RRF fusion (see {@link FourWayRrf}).
 *
 * @module @framers/agentos/memory/retrieval/typed-network/TemporalIntervalOverlap
 */

import type { TypedFact } from './types.js';

/** One day in milliseconds — used as the natural unit for distance penalties. */
const DAY_MS = 86_400_000;

/**
 * Rank an array of typed facts by their temporal proximity to a query
 * timestamp. Facts whose `(start, end)` interval contains the query
 * rank highest, with tighter intervals (smaller width) scoring higher
 * within the contained set. Facts whose interval lies outside the
 * query rank by the minimum endpoint distance. Facts with only a
 * mention timestamp fall back to mention-distance.
 *
 * Returns a new array; the input is not mutated. Stable ordering
 * within tied scores follows JavaScript's `Array.prototype.sort`
 * insertion order.
 *
 * @param facts - Typed facts to rank.
 * @param queryTimestamp - ISO 8601 string. Invalid timestamps fall
 *   back to original ordering.
 */
export function rankByTemporalOverlap(
  facts: TypedFact[],
  queryTimestamp: string,
): TypedFact[] {
  const queryMs = Date.parse(queryTimestamp);
  if (Number.isNaN(queryMs)) return [...facts];

  const scored = facts.map((f) => ({
    fact: f,
    score: scoreOverlap(f, queryMs),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.fact);
}

/**
 * Score a single fact against the query timestamp. Higher = more
 * relevant.
 *
 * Score scale:
 * - In-interval facts produce scores in (1.0, 2.0] — every in-interval
 *   fact outranks every out-of-interval fact regardless of width vs
 *   endpoint-distance. Tighter intervals score closer to 2.0.
 * - Out-of-interval facts produce scores in (0, 1.0) — closer
 *   endpoint distances score nearer to 1.0.
 * - Mention-only facts produce scores in (0, 1.0) — same scale as
 *   out-of-interval (the mention timestamp is treated as a degenerate
 *   point-interval).
 *
 * The +1.0 boost on in-interval guarantees the order semantics the
 * Hindsight paper §2.4.1 implies: temporal containment is a
 * categorical match; width breaks ties within that category. Without
 * the boost, a wide containing interval can score below a narrow non-
 * containing one (which is geometrically wrong).
 */
function scoreOverlap(fact: TypedFact, queryMs: number): number {
  const start = fact.temporal.start ? Date.parse(fact.temporal.start) : NaN;
  const end = fact.temporal.end ? Date.parse(fact.temporal.end) : NaN;
  const mention = Date.parse(fact.temporal.mention);

  if (!Number.isNaN(start) && !Number.isNaN(end)) {
    if (queryMs >= start && queryMs <= end) {
      // Query inside interval — score by inverse interval width,
      // boosted by +1.0 so it outranks all out-of-interval facts.
      const width = Math.max(1, end - start);
      return 1.0 + 1.0 / (1 + width / DAY_MS);
    }
    // Query outside — penalize by distance to nearest endpoint.
    const dist = Math.min(Math.abs(queryMs - start), Math.abs(queryMs - end));
    return 1.0 / (1 + dist / DAY_MS);
  }

  // Fall back to mention-timestamp distance.
  if (Number.isNaN(mention)) return 0;
  const dist = Math.abs(queryMs - mention);
  return 1.0 / (1 + dist / DAY_MS);
}
