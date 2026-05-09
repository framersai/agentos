/**
 * @fileoverview Standalone per-run aggregator for forge reliability
 * telemetry. Composes with any cost/usage tracker the consumer already
 * has.
 * @module @framers/agentos/emergent/ForgeStatsAggregator
 *
 * Pinned shape: the {@link ForgeStats} snapshot must stay stable. It
 * ships through consumer telemetry endpoints that downstream dashboards
 * parse; renaming fields is a breaking change. Fold in new dimensions
 * by adding fields, not renaming existing ones.
 */

import {
  classifyForgeRejection,
  type ForgeRejectionCategory,
} from './ForgeRejectionClassifier.js';

/** Per-run forge reliability rollup snapshot. */
export interface ForgeStats {
  /** Total forge attempts (approved + rejected combined). */
  attempts: number;
  /** Attempts the judge approved. */
  approved: number;
  /** Attempts the judge or shape validator rejected. */
  rejected: number;
  /** Sum of confidence across approved attempts. Divide by `approved` for avg. */
  approvedConfidenceSum: number;
  /**
   * Count of unique tool names seen this run (union of approved + rejected).
   * A tool rejected then re-forged under the same name counts once.
   */
  uniqueNames: number;
  /** Count of unique tool names that landed approved at least once this run. */
  uniqueApproved: number;
  /**
   * Count of unique tool names that were ONLY rejected (never approved)
   * this run. The retry loop did not recover these. Actionable signal
   * for "real quality failures" vs retry churn.
   */
  uniqueTerminalRejections: number;
  /**
   * Histogram of rejection reasons, classified via
   * {@link classifyForgeRejection}. Keys match {@link ForgeRejectionCategory}.
   */
  rejectionReasons: Record<ForgeRejectionCategory, number>;
}

/**
 * Create a fresh, zeroed {@link ForgeStats} snapshot. Exposed for consumers
 * that want to seed their own state or compare against a baseline.
 */
export function emptyForgeStats(): ForgeStats {
  return {
    attempts: 0,
    approved: 0,
    rejected: 0,
    approvedConfidenceSum: 0,
    uniqueNames: 0,
    uniqueApproved: 0,
    uniqueTerminalRejections: 0,
    rejectionReasons: {
      schema_extra_field: 0,
      shape_check: 0,
      parse_error: 0,
      judge_correctness: 0,
      syntax_error: 0,
      other: 0,
    },
  };
}

/**
 * Aggregator for forge outcomes across a single run. No dependency on
 * the cost tracker or any consumer-specific types — consumers compose
 * it into whatever telemetry layer they already have.
 *
 * Typical wiring: the consumer's forge capture callback calls
 * {@link recordAttempt} with the outcome fields, then embeds
 * {@link snapshot} under a `forgeStats` key in whatever payload the
 * consumer ships to clients.
 */
export class ForgeStatsAggregator {
  private stats: ForgeStats = emptyForgeStats();
  private readonly approvedNames = new Set<string>();
  private readonly rejectedNames = new Set<string>();

  /**
   * Record one forge attempt's outcome.
   *
   * @param approved `true` when the judge approved; `false` for shape-check
   *   or judge rejections.
   * @param confidence Judge's confidence score for approved tools. Summed
   *   into `approvedConfidenceSum` (skipped for rejections so rejection
   *   confidence does not dilute the average).
   * @param toolName Optional tool name. When provided, tracks unique-tool
   *   metrics (eventually-approved vs terminally-rejected) rather than
   *   raw attempt counts.
   * @param errorReason Optional rejection-reason string. On a rejected
   *   attempt, passed through {@link classifyForgeRejection} and binned
   *   into `rejectionReasons`.
   */
  recordAttempt(
    approved: boolean,
    confidence: number,
    toolName?: string,
    errorReason?: string,
  ): void {
    this.stats.attempts += 1;
    if (approved) {
      this.stats.approved += 1;
      this.stats.approvedConfidenceSum += confidence;
      if (toolName) this.approvedNames.add(toolName);
    } else {
      this.stats.rejected += 1;
      if (toolName) this.rejectedNames.add(toolName);
      const category = classifyForgeRejection(errorReason);
      this.stats.rejectionReasons[category] += 1;
    }
    this.refreshUniqueCounts();
  }

  /**
   * Build a plain-object snapshot of current stats. Safe to JSON-serialize
   * and ship to clients. Returns a shallow copy so callers can mutate
   * without affecting the aggregator's internal state.
   */
  snapshot(): ForgeStats {
    return {
      ...this.stats,
      rejectionReasons: { ...this.stats.rejectionReasons },
    };
  }

  /**
   * Clear all accumulated state. Useful when the aggregator is reused
   * across multiple runs in one process.
   */
  reset(): void {
    this.stats = emptyForgeStats();
    this.approvedNames.clear();
    this.rejectedNames.clear();
  }

  /**
   * Recompute the three unique-tool counters from the name sets. Called
   * after every attempt so `snapshot()` never has to do the math itself.
   */
  private refreshUniqueCounts(): void {
    this.stats.uniqueApproved = this.approvedNames.size;
    let terminal = 0;
    for (const n of this.rejectedNames) {
      if (!this.approvedNames.has(n)) terminal += 1;
    }
    this.stats.uniqueTerminalRejections = terminal;
    const union = new Set<string>();
    for (const n of this.approvedNames) union.add(n);
    for (const n of this.rejectedNames) union.add(n);
    this.stats.uniqueNames = union.size;
  }
}
