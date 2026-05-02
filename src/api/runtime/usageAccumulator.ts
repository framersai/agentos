/**
 * @file usageAccumulator.ts
 * @description In-memory usage tally helpers used by the lightweight
 * `agent()` factory. The persisted JSONL ledger is opt-in
 * (`AgentOSUsageLedgerOptions.enabled`); these helpers let `agent.usage()`
 * and `session.usage()` return real numbers in the default case where no
 * ledger is configured.
 *
 * The accumulator is intentionally side-effecting: callers fold each
 * `result.usage` into a running aggregate held by closure scope so reads
 * are O(1). The public read paths in `agent.ts` merge the in-memory tally
 * with the persisted ledger so cross-process history rolls up correctly.
 */
import type { AgentOSUsageAggregate } from './usageLedger.js';

/**
 * Build a zeroed usage aggregate. Pass `sessionId` to seed a per-session tally.
 */
export function createEmptyUsageAggregate(sessionId?: string): AgentOSUsageAggregate {
  return {
    sessionId,
    personaId: undefined,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    costUSD: 0,
    calls: 0,
  };
}

/**
 * Fold a single generation's `TokenUsage` into a running aggregate. Mutates
 * the target. Cost is summed when the source provides it.
 *
 * - Increments `calls` by 1 per fold (one call = one generation).
 * - Recomputes `totalTokens` from `promptTokens + completionTokens` when the
 *   source omits the explicit total, matching how providers report partials.
 */
export function accumulateUsage(
  target: AgentOSUsageAggregate,
  usage: { promptTokens?: number; completionTokens?: number; totalTokens?: number; costUSD?: number } | undefined,
): void {
  if (!usage) return;
  if (typeof usage.promptTokens === 'number') target.promptTokens += usage.promptTokens;
  if (typeof usage.completionTokens === 'number') target.completionTokens += usage.completionTokens;
  if (typeof usage.totalTokens === 'number') {
    target.totalTokens += usage.totalTokens;
  } else {
    target.totalTokens += (usage.promptTokens ?? 0) + (usage.completionTokens ?? 0);
  }
  if (typeof usage.costUSD === 'number') target.costUSD = (target.costUSD ?? 0) + usage.costUSD;
  target.calls += 1;
}

/**
 * Merge two aggregates field-wise into a fresh object. Used at read time to
 * combine the in-memory tally with the persisted ledger total so callers see
 * one coherent number that includes both this process and prior process runs.
 */
export function mergeAggregates(a: AgentOSUsageAggregate, b: AgentOSUsageAggregate): AgentOSUsageAggregate {
  return {
    sessionId: a.sessionId ?? b.sessionId,
    personaId: a.personaId ?? b.personaId,
    promptTokens: a.promptTokens + b.promptTokens,
    completionTokens: a.completionTokens + b.completionTokens,
    totalTokens: a.totalTokens + b.totalTokens,
    costUSD: (a.costUSD ?? 0) + (b.costUSD ?? 0),
    calls: a.calls + b.calls,
  };
}
