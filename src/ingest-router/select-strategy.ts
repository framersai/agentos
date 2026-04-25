/**
 * @file select-strategy.ts
 * @description Pure function that picks an ingest strategy from a
 * predicted content kind + routing table + budget policy.
 *
 * Stateless. Deterministic. No I/O. Same shape as
 * {@link selectBackend} in memory-router so the multi-stage guardrails
 * orchestrator can compose them uniformly.
 *
 * @module @framers/agentos/ingest-router/select-strategy
 */

import type { IngestStrategyCostPoint } from './costs.js';
import type {
  IngestContentKind,
  IngestRouterPreset,
  IngestRoutingTable,
  IngestStrategyId,
} from './routing-tables.js';

/**
 * Budget enforcement modes for ingest dispatch:
 *   - `hard`: throw {@link IngestRouterBudgetExceededError} if the
 *     routing-table pick exceeds the per-ingest USD ceiling.
 *   - `soft`: keep the picked strategy when the ceiling is exceeded
 *     (best-effort enforcement; flag exceeded in the decision).
 *   - `cheapest-fallback`: silently downgrade to the cheapest strategy
 *     that fits. If none fits, pick the absolute cheapest and flag.
 */
export type IngestBudgetMode = 'hard' | 'soft' | 'cheapest-fallback';

/**
 * Configuration object for {@link selectIngestStrategy}.
 */
export interface IngestRouterConfig {
  readonly table: IngestRoutingTable;
  readonly budgetPerIngestUsd: number | null;
  readonly budgetMode: IngestBudgetMode;
  readonly strategyCosts: Readonly<
    Record<IngestStrategyId, IngestStrategyCostPoint>
  >;
}

/**
 * Output of {@link selectIngestStrategy}. Carries the chosen strategy
 * plus full telemetry about how the decision was made.
 */
export interface IngestRoutingDecision {
  readonly predictedKind: IngestContentKind;
  /** Optional ground-truth kind (telemetry only; null in production). */
  readonly groundTruthKind: IngestContentKind | null;
  readonly chosenStrategy: IngestStrategyId;
  readonly chosenStrategyReason: string;
  readonly estimatedCostUsd: number;
  readonly budgetCeiling: number | null;
  readonly budgetExceeded: boolean;
  readonly preset: IngestRouterPreset;
}

export class IngestRouterUnknownKindError extends Error {
  constructor(public readonly kind: string) {
    super(`IngestRouter: kind '${kind}' not in routing table`);
    this.name = 'IngestRouterUnknownKindError';
  }
}

export class IngestRouterBudgetExceededError extends Error {
  constructor(
    public readonly strategy: IngestStrategyId,
    public readonly cost: number,
    public readonly budget: number,
  ) {
    super(
      `IngestRouter: strategy '${strategy}' cost $${cost.toFixed(4)} ` +
        `exceeds hard budget $${budget.toFixed(4)}`,
    );
    this.name = 'IngestRouterBudgetExceededError';
  }
}

/**
 * Pure ingest-strategy selection. Mirrors selectBackend (memory-router)
 * in structure for multi-stage composability.
 */
export function selectIngestStrategy(args: {
  predictedKind: IngestContentKind;
  groundTruthKind: IngestContentKind | null;
  config: IngestRouterConfig;
}): IngestRoutingDecision {
  const { predictedKind, groundTruthKind, config } = args;
  const { table, budgetPerIngestUsd, budgetMode, strategyCosts } = config;

  const picked = table.defaultMapping[predictedKind] as
    | IngestStrategyId
    | undefined;
  if (!picked) {
    throw new IngestRouterUnknownKindError(predictedKind);
  }

  const pickedCost = strategyCosts[picked].avgCostPerIngest;

  if (budgetPerIngestUsd === null || pickedCost <= budgetPerIngestUsd) {
    return {
      predictedKind,
      groundTruthKind,
      chosenStrategy: picked,
      chosenStrategyReason:
        budgetPerIngestUsd === null
          ? 'routing-table pick, no budget'
          : 'routing-table pick fits budget',
      estimatedCostUsd: pickedCost,
      budgetCeiling: budgetPerIngestUsd,
      budgetExceeded: false,
      preset: table.preset,
    };
  }

  if (budgetMode === 'hard') {
    throw new IngestRouterBudgetExceededError(
      picked,
      pickedCost,
      budgetPerIngestUsd,
    );
  }

  const candidates = (
    Object.values(strategyCosts) as IngestStrategyCostPoint[]
  ).map((c) => ({ strategy: c.strategy, cost: c.avgCostPerIngest }));
  const fits = candidates.filter((c) => c.cost <= budgetPerIngestUsd);
  const cheapestFits =
    fits.length > 0
      ? fits.reduce((a, b) => (a.cost <= b.cost ? a : b))
      : null;

  if (!cheapestFits) {
    const globallyCheapest = candidates.reduce((a, b) =>
      a.cost <= b.cost ? a : b,
    );
    return {
      predictedKind,
      groundTruthKind,
      chosenStrategy: globallyCheapest.strategy,
      chosenStrategyReason: 'no strategy fits budget; picking absolute cheapest',
      estimatedCostUsd: globallyCheapest.cost,
      budgetCeiling: budgetPerIngestUsd,
      budgetExceeded: true,
      preset: table.preset,
    };
  }

  if (budgetMode === 'cheapest-fallback') {
    return {
      predictedKind,
      groundTruthKind,
      chosenStrategy: cheapestFits.strategy,
      chosenStrategyReason: 'budget downgrade (cheapest-fallback mode)',
      estimatedCostUsd: cheapestFits.cost,
      budgetCeiling: budgetPerIngestUsd,
      budgetExceeded: false,
      preset: table.preset,
    };
  }

  // soft: keep the pick, flag exceeded.
  return {
    predictedKind,
    groundTruthKind,
    chosenStrategy: picked,
    chosenStrategyReason: 'soft exceed: keeping picked despite budget breach',
    estimatedCostUsd: pickedCost,
    budgetCeiling: budgetPerIngestUsd,
    budgetExceeded: true,
    preset: table.preset,
  };
}
