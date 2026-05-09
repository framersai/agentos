/**
 * @file costs.ts
 * @description Per-strategy cost-points for ReadRouter budget logic.
 * Numbers are illustrative averages on gpt-4o reader; consumers should
 * override with measurements from their own workload.
 *
 * @module @framers/agentos/read-router/costs
 */

import type { ReadStrategyId } from './routing-tables.js';

export interface ReadStrategyCostPoint {
  readonly strategy: ReadStrategyId;
  readonly avgCostPerReadUsd: number;
  readonly avgLatencyMs: number;
  readonly callCount: number;
  readonly description: string;
}

export const SINGLE_CALL_COST: ReadStrategyCostPoint = Object.freeze({
  strategy: 'single-call' as const,
  avgCostPerReadUsd: 0.0150,
  avgLatencyMs: 1500,
  callCount: 1,
  description: 'one reader.invoke call',
}) as ReadStrategyCostPoint;

export const TWO_CALL_EXTRACT_ANSWER_COST: ReadStrategyCostPoint = Object.freeze({
  strategy: 'two-call-extract-answer' as const,
  avgCostPerReadUsd: 0.0280,
  avgLatencyMs: 2900,
  callCount: 2,
  description: 'extract-then-answer: claim extraction call + answer call',
}) as ReadStrategyCostPoint;

export const COMMIT_VS_ABSTAIN_COST: ReadStrategyCostPoint = Object.freeze({
  strategy: 'commit-vs-abstain' as const,
  avgCostPerReadUsd: 0.0220,
  avgLatencyMs: 2200,
  callCount: 2,
  description: 'binary commit/abstain decision + answer-or-refuse call',
}) as ReadStrategyCostPoint;

export const VERBATIM_CITATION_COST: ReadStrategyCostPoint = Object.freeze({
  strategy: 'verbatim-citation' as const,
  avgCostPerReadUsd: 0.0170,
  avgLatencyMs: 1700,
  callCount: 1,
  description: 'single call with verbatim-citation prompt rule',
}) as ReadStrategyCostPoint;

export const SCRATCHPAD_COST: ReadStrategyCostPoint = Object.freeze({
  strategy: 'scratchpad-then-answer' as const,
  avgCostPerReadUsd: 0.0190,
  avgLatencyMs: 1900,
  callCount: 1,
  description: 'single call with explicit scratchpad-before-answer scaffold',
}) as ReadStrategyCostPoint;

export const DEFAULT_READ_COSTS: Readonly<
  Record<ReadStrategyId, ReadStrategyCostPoint>
> = Object.freeze({
  'single-call': SINGLE_CALL_COST,
  'two-call-extract-answer': TWO_CALL_EXTRACT_ANSWER_COST,
  'commit-vs-abstain': COMMIT_VS_ABSTAIN_COST,
  'verbatim-citation': VERBATIM_CITATION_COST,
  'scratchpad-then-answer': SCRATCHPAD_COST,
});
