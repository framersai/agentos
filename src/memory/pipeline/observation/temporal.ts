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

// ---------------------------------------------------------------------------
// Temporal metadata interface (stored in MemoryTrace.metadata.temporal)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Day-of-week names
// ---------------------------------------------------------------------------

const DAY_NAMES = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday',
  'Thursday', 'Friday', 'Saturday',
] as const;

// ---------------------------------------------------------------------------
// relativeTimeLabel
// ---------------------------------------------------------------------------

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
export function relativeTimeLabel(timestamp: number, now?: number): string {
  const reference = now ?? Date.now();
  const diffMs = reference - timestamp;

  // Future timestamps
  if (diffMs < 0) return 'in the future';

  const SECOND = 1_000;
  const MINUTE = 60 * SECOND;
  const HOUR = 60 * MINUTE;
  const DAY = 24 * HOUR;

  // Just now (< 60 seconds)
  if (diffMs < MINUTE) return 'just now';

  // Minutes ago (< 1 hour)
  if (diffMs < HOUR) {
    const mins = Math.floor(diffMs / MINUTE);
    return mins === 1 ? '1 minute ago' : `${mins} minutes ago`;
  }

  // Check calendar-day boundaries for "earlier today" / "yesterday"
  const nowDate = new Date(reference);
  const tsDate = new Date(timestamp);

  const isSameDay =
    nowDate.getFullYear() === tsDate.getFullYear() &&
    nowDate.getMonth() === tsDate.getMonth() &&
    nowDate.getDate() === tsDate.getDate();

  if (isSameDay) {
    const hours = Math.floor(diffMs / HOUR);
    if (hours < 2) return '1 hour ago';
    return 'earlier today';
  }

  // Yesterday check (previous calendar day)
  const yesterday = new Date(reference);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday =
    yesterday.getFullYear() === tsDate.getFullYear() &&
    yesterday.getMonth() === tsDate.getMonth() &&
    yesterday.getDate() === tsDate.getDate();

  if (isYesterday) return 'yesterday';

  const diffDays = Math.floor(diffMs / DAY);

  // 2-6 days ago — use day name ("last Tuesday")
  if (diffDays >= 2 && diffDays <= 6) {
    const dayName = DAY_NAMES[tsDate.getDay()];
    return `last ${dayName}`;
  }

  // 7-13 days — "last week"
  if (diffDays >= 7 && diffDays <= 13) return 'last week';

  // 14-27 days — "N weeks ago"
  if (diffDays >= 14 && diffDays <= 27) {
    const weeks = Math.floor(diffDays / 7);
    return `${weeks} weeks ago`;
  }

  // 28-59 days — "last month"
  if (diffDays >= 28 && diffDays <= 59) return 'last month';

  // 60-364 days — "N months ago"
  if (diffDays >= 60 && diffDays <= 364) {
    const months = Math.floor(diffDays / 30);
    return months === 1 ? '1 month ago' : `${months} months ago`;
  }

  // 365-729 days — "last year"
  if (diffDays >= 365 && diffDays <= 729) return 'last year';

  // 730+ days — "N years ago"
  const years = Math.floor(diffDays / 365);
  return `${years} years ago`;
}
