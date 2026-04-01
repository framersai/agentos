/**
 * @fileoverview Temporal reasoning utilities for the observation system.
 *
 * Provides a three-date model (observedAt, referencedAt, relativeLabel) and a
 * human-friendly `relativeTimeLabel()` function that converts Unix-ms timestamps
 * into natural-language labels such as "just now", "earlier today", "last Tuesday",
 * "3 days ago", "last week", etc.
 *
 * @module agentos/memory/observation/temporal
 */
/**
 * Three-date temporal model attached to memory traces.
 *
 * - `referencedAt` — when the event the memory refers to actually occurred.
 * - `relativeLabel` — human-friendly relative time description.
 * - `span` — optional time range if the memory covers a period.
 */
export interface TemporalMetadata {
    /** When the event this memory refers to actually happened (Unix ms). */
    referencedAt?: number;
    /** Human-friendly relative time label, e.g. "last Tuesday". */
    relativeLabel?: string;
    /** Time span if this covers a period: [startMs, endMs]. */
    span?: [number, number];
}
/**
 * Produce a human-friendly label describing how long ago `timestamp` was
 * relative to `now` (defaults to `Date.now()`).
 *
 * Examples:
 * - "just now"       (< 60 s)
 * - "5 minutes ago"  (< 1 h)
 * - "2 hours ago"    (< today boundary, but > 1 h)
 * - "earlier today"  (same calendar day, > 1 h)
 * - "yesterday"      (previous calendar day)
 * - "last Tuesday"   (2-6 days ago, uses day name)
 * - "3 days ago"     (2-6 days ago, alternative when day name would be confusing)
 * - "last week"      (7-13 days)
 * - "2 weeks ago"    (14-20 days)
 * - "3 weeks ago"    (21-27 days)
 * - "last month"     (28-59 days)
 * - "2 months ago"   (60-89 days)
 * - "N months ago"   (90-364 days)
 * - "last year"      (365-729 days)
 * - "N years ago"    (730+ days)
 *
 * Future timestamps return "in the future".
 *
 * @param timestamp - Unix ms timestamp to describe.
 * @param now - Reference timestamp (defaults to Date.now()).
 * @returns Human-friendly relative time string.
 */
export declare function relativeTimeLabel(timestamp: number, now?: number): string;
//# sourceMappingURL=temporal.d.ts.map