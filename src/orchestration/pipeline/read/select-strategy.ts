/**
 * @file select-strategy.ts
 * @description Pure selection function for ReadRouter. Mirrors the
 * memory-router and ingest-router patterns.
 *
 * @module @framers/agentos/read-router/select-strategy
 */

import type { ReadStrategyCostPoint } from './costs.js';
import type {
  ReadIntent,
  ReadRouterPreset,
  ReadRoutingTable,
  ReadStrategyId,
} from './routing-tables.js';

export type ReadBudgetMode = 'hard' | 'soft' | 'cheapest-fallback';

export interface ReadRouterConfig {
  readonly table: ReadRoutingTable;
  readonly budgetPerReadUsd: number | null;
  readonly budgetMode: ReadBudgetMode;
  readonly strategyCosts: Readonly<Record<ReadStrategyId, ReadStrategyCostPoint>>;
}

export interface ReadRoutingDecision {
  readonly predictedIntent: ReadIntent;
  readonly groundTruthIntent: ReadIntent | null;
  readonly chosenStrategy: ReadStrategyId;
  readonly chosenStrategyReason: string;
  readonly estimatedCostUsd: number;
  readonly budgetCeiling: number | null;
  readonly budgetExceeded: boolean;
  readonly preset: ReadRouterPreset;
}

export class ReadRouterUnknownIntentError extends Error {
  constructor(public readonly intent: string) {
    super(`ReadRouter: intent '${intent}' not in routing table`);
    this.name = 'ReadRouterUnknownIntentError';
  }
}

export class ReadRouterBudgetExceededError extends Error {
  constructor(
    public readonly strategy: ReadStrategyId,
    public readonly cost: number,
    public readonly budget: number,
  ) {
    super(
      `ReadRouter: strategy '${strategy}' cost $${cost.toFixed(4)} ` +
        `exceeds hard budget $${budget.toFixed(4)}`,
    );
    this.name = 'ReadRouterBudgetExceededError';
  }
}

export function selectReadStrategy(args: {
  predictedIntent: ReadIntent;
  groundTruthIntent: ReadIntent | null;
  config: ReadRouterConfig;
}): ReadRoutingDecision {
  const { predictedIntent, groundTruthIntent, config } = args;
  const { table, budgetPerReadUsd, budgetMode, strategyCosts } = config;

  const picked = table.defaultMapping[predictedIntent] as
    | ReadStrategyId
    | undefined;
  if (!picked) {
    throw new ReadRouterUnknownIntentError(predictedIntent);
  }

  const pickedCost = strategyCosts[picked].avgCostPerReadUsd;

  if (budgetPerReadUsd === null || pickedCost <= budgetPerReadUsd) {
    return {
      predictedIntent,
      groundTruthIntent,
      chosenStrategy: picked,
      chosenStrategyReason:
        budgetPerReadUsd === null
          ? 'routing-table pick, no budget'
          : 'routing-table pick fits budget',
      estimatedCostUsd: pickedCost,
      budgetCeiling: budgetPerReadUsd,
      budgetExceeded: false,
      preset: table.preset,
    };
  }

  if (budgetMode === 'hard') {
    throw new ReadRouterBudgetExceededError(
      picked,
      pickedCost,
      budgetPerReadUsd,
    );
  }

  const candidates = (Object.values(strategyCosts) as ReadStrategyCostPoint[]).map((c) => ({
    strategy: c.strategy,
    cost: c.avgCostPerReadUsd,
  }));
  const fits = candidates.filter((c) => c.cost <= budgetPerReadUsd);
  const cheapestFits =
    fits.length > 0 ? fits.reduce((a, b) => (a.cost <= b.cost ? a : b)) : null;

  if (!cheapestFits) {
    const globallyCheapest = candidates.reduce((a, b) =>
      a.cost <= b.cost ? a : b,
    );
    return {
      predictedIntent,
      groundTruthIntent,
      chosenStrategy: globallyCheapest.strategy,
      chosenStrategyReason: 'no strategy fits budget; picking absolute cheapest',
      estimatedCostUsd: globallyCheapest.cost,
      budgetCeiling: budgetPerReadUsd,
      budgetExceeded: true,
      preset: table.preset,
    };
  }

  if (budgetMode === 'cheapest-fallback') {
    return {
      predictedIntent,
      groundTruthIntent,
      chosenStrategy: cheapestFits.strategy,
      chosenStrategyReason: 'budget downgrade (cheapest-fallback mode)',
      estimatedCostUsd: cheapestFits.cost,
      budgetCeiling: budgetPerReadUsd,
      budgetExceeded: false,
      preset: table.preset,
    };
  }

  return {
    predictedIntent,
    groundTruthIntent,
    chosenStrategy: picked,
    chosenStrategyReason: 'soft exceed: keeping picked despite budget breach',
    estimatedCostUsd: pickedCost,
    budgetCeiling: budgetPerReadUsd,
    budgetExceeded: true,
    preset: table.preset,
  };
}
