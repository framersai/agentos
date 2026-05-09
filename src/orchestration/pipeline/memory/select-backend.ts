/**
 * @file select-backend.ts
 * @description Pure function that turns a classifier-predicted category
 * + a {@link MemoryRouterConfig} into a {@link MemoryRoutingDecision}.
 *
 * Stateless. Deterministic. No I/O. Suitable for use inside hot dispatch
 * loops and inside cache-key construction (the function's output is a
 * pure function of its inputs).
 *
 * The decision carries:
 *   - the chosen {@link MemoryBackendId},
 *   - the predicted category (and optional ground-truth for telemetry),
 *   - the estimated USD cost of the routing pick,
 *   - the budget ceiling (if any) and whether the pick exceeded it,
 *   - a human-readable reason explaining the routing path taken.
 *
 * @module @framers/agentos/memory-router/select-backend
 */

import type { MemoryBackendCostPoint } from './backend-costs.js';
import type {
  MemoryBackendId,
  MemoryQueryCategory,
  MemoryRouterPreset,
  RoutingTable,
} from './routing-tables.js';

/**
 * Budget enforcement modes:
 *   - `hard`: throw {@link MemoryRouterBudgetExceededError} if the
 *     routing-table pick exceeds the per-query USD budget. Lets callers
 *     escalate at the application layer (e.g. fall back to a reduced
 *     pipeline or surface a 402-style error).
 *   - `soft`: exceed the budget only when the picked backend has a
 *     better USD-per-correct ratio than the cheapest backend that fits.
 *     Prefers accuracy-economical overflows.
 *   - `cheapest-fallback`: silently downgrade to the cheapest backend
 *     that fits the budget. Suitable for cost-strict workloads where
 *     correctness gracefully degrades.
 */
export type MemoryBudgetMode = 'hard' | 'soft' | 'cheapest-fallback';

/**
 * Configuration object for {@link selectBackend}. Bundles the routing
 * table, cost data, and budget policy into a single value the function
 * can reason about deterministically.
 */
export interface MemoryRouterConfig {
  readonly table: RoutingTable;
  readonly budgetPerQuery: number | null;
  readonly budgetMode: MemoryBudgetMode;
  readonly backendCosts: Readonly<Record<MemoryBackendId, MemoryBackendCostPoint>>;
}

/**
 * Output of {@link selectBackend}. The chosen backend plus full telemetry
 * about how the routing decision was made.
 */
export interface MemoryRoutingDecision {
  readonly predictedCategory: MemoryQueryCategory;
  /**
   * Optional ground-truth category, for telemetry only. When the caller
   * has access to gold labels (e.g. during benchmarking), passing them
   * through here lets downstream analysis distinguish classifier
   * misroutes from architectural misses without needing a second pass.
   */
  readonly groundTruthCategory: MemoryQueryCategory | null;
  readonly chosenBackend: MemoryBackendId;
  readonly chosenBackendReason: string;
  readonly estimatedCostUsd: number;
  readonly budgetCeiling: number | null;
  readonly budgetExceeded: boolean;
  readonly preset: MemoryRouterPreset;
}

/**
 * Thrown when the predicted category is not in the routing table. Should
 * never fire with the three shipping presets (each covers all six
 * categories) but guards custom-table misuse.
 */
export class MemoryRouterUnknownCategoryError extends Error {
  constructor(public readonly category: string) {
    super(`MemoryRouter: category '${category}' not in routing table`);
    this.name = 'MemoryRouterUnknownCategoryError';
  }
}

/**
 * Thrown by `hard` budget mode when the routing-table pick exceeds the
 * per-query USD ceiling. Carries the picked backend + cost + budget so
 * application-layer fallbacks can decide what to do (fall back to a
 * different memory architecture, return a typed 402 to the user, etc).
 */
export class MemoryRouterBudgetExceededError extends Error {
  constructor(
    public readonly backend: MemoryBackendId,
    public readonly cost: number,
    public readonly budget: number,
  ) {
    super(
      `MemoryRouter: backend '${backend}' cost $${cost.toFixed(4)} ` +
        `exceeds hard budget $${budget.toFixed(4)}`,
    );
    this.name = 'MemoryRouterBudgetExceededError';
  }
}

interface BackendCostCandidate {
  readonly backend: MemoryBackendId;
  readonly cost: number;
}

/**
 * Pure routing decision: maps a predicted category to a backend choice
 * given a routing table + budget policy + cost-points data.
 *
 * Algorithm:
 *   1. Look up the table's preferred backend for the predicted category.
 *      Throw if missing (custom-table misuse).
 *   2. If no budget is set, return the table's pick.
 *   3. If the pick fits the budget, return it.
 *   4. If the pick exceeds:
 *      - `hard`: throw {@link MemoryRouterBudgetExceededError}.
 *      - `cheapest-fallback`: pick the cheapest backend that fits;
 *        if none fits, pick the absolute cheapest and flag exceeded.
 *      - `soft`: keep the pick if its $/correct beats the cheapest fits;
 *        otherwise downgrade to the cheapest fits. Globally-no-fit case
 *        falls through to absolute-cheapest with budgetExceeded=true.
 *
 * @param args
 * @param args.predictedCategory - Category predicted by the LLM-as-judge classifier.
 * @param args.groundTruthCategory - Gold-label category for telemetry, or null in production.
 * @param args.config - Routing table + budget policy + cost-points map.
 *
 * @returns A {@link MemoryRoutingDecision} describing the chosen backend.
 *
 * @throws {@link MemoryRouterUnknownCategoryError} when the table does not
 *   cover `predictedCategory`.
 * @throws {@link MemoryRouterBudgetExceededError} when `budgetMode === 'hard'`
 *   and the routing-table pick exceeds the budget.
 *
 * @example
 * ```ts
 * const decision = selectBackend({
 *   predictedCategory: 'multi-session',
 *   groundTruthCategory: null,
 *   config: {
 *     table: MINIMIZE_COST_TABLE,
 *     budgetPerQuery: 0.05,
 *     budgetMode: 'cheapest-fallback',
 *     backendCosts: DEFAULT_MEMORY_BACKEND_COSTS,
 *   },
 * });
 * console.log(decision.chosenBackend); // 'observational-memory-v11' (fits)
 * ```
 */
export function selectBackend(args: {
  predictedCategory: MemoryQueryCategory;
  groundTruthCategory: MemoryQueryCategory | null;
  config: MemoryRouterConfig;
}): MemoryRoutingDecision {
  const { predictedCategory, groundTruthCategory, config } = args;
  const { table, budgetPerQuery, budgetMode, backendCosts } = config;

  // 1. Validate: category must be in routing table.
  const picked = table.defaultMapping[predictedCategory] as
    | MemoryBackendId
    | undefined;
  if (!picked) {
    throw new MemoryRouterUnknownCategoryError(predictedCategory);
  }

  // 2. Compute per-query cost for the picked backend on this category.
  const pickedCost =
    backendCosts[picked].perCategoryCostPerQuery[predictedCategory];

  // 3. Budget pass-through: no budget OR pick fits.
  if (budgetPerQuery === null || pickedCost <= budgetPerQuery) {
    return {
      predictedCategory,
      groundTruthCategory,
      chosenBackend: picked,
      chosenBackendReason:
        budgetPerQuery === null
          ? 'routing-table pick, no budget'
          : 'routing-table pick fits budget',
      estimatedCostUsd: pickedCost,
      budgetCeiling: budgetPerQuery,
      budgetExceeded: false,
      preset: table.preset,
    };
  }

  // 4. Budget exceeded. Hard mode bails immediately.
  if (budgetMode === 'hard') {
    throw new MemoryRouterBudgetExceededError(picked, pickedCost, budgetPerQuery);
  }

  // Find the cheapest backend that fits the budget on this category.
  const candidates: BackendCostCandidate[] = (
    Object.values(backendCosts) as MemoryBackendCostPoint[]
  ).map((c) => ({
    backend: c.backend,
    cost: c.perCategoryCostPerQuery[predictedCategory],
  }));
  const fits = candidates.filter((c) => c.cost <= budgetPerQuery);
  const cheapestFits =
    fits.length > 0
      ? fits.reduce((a, b) => (a.cost <= b.cost ? a : b))
      : null;

  // No backend fits at all -> globally cheapest with budgetExceeded=true.
  if (!cheapestFits) {
    const globallyCheapest = candidates.reduce((a, b) =>
      a.cost <= b.cost ? a : b,
    );
    return {
      predictedCategory,
      groundTruthCategory,
      chosenBackend: globallyCheapest.backend,
      chosenBackendReason: 'no backend fits budget; picking absolute cheapest',
      estimatedCostUsd: globallyCheapest.cost,
      budgetCeiling: budgetPerQuery,
      budgetExceeded: true,
      preset: table.preset,
    };
  }

  // cheapest-fallback: silently downgrade.
  if (budgetMode === 'cheapest-fallback') {
    return {
      predictedCategory,
      groundTruthCategory,
      chosenBackend: cheapestFits.backend,
      chosenBackendReason: 'budget downgrade (cheapest-fallback mode)',
      estimatedCostUsd: cheapestFits.cost,
      budgetCeiling: budgetPerQuery,
      budgetExceeded: false,
      preset: table.preset,
    };
  }

  // soft: keep the pick only if it's better $/correct than cheapest-fits.
  const pickedAcc = backendCosts[picked].perCategoryAccuracy[predictedCategory];
  const cheapestAcc =
    backendCosts[cheapestFits.backend].perCategoryAccuracy[predictedCategory];

  // Edge case: picked has zero accuracy -> always downgrade.
  if (pickedAcc === 0) {
    return {
      predictedCategory,
      groundTruthCategory,
      chosenBackend: cheapestFits.backend,
      chosenBackendReason: 'soft budget downgrade: picked has 0 acc on category',
      estimatedCostUsd: cheapestFits.cost,
      budgetCeiling: budgetPerQuery,
      budgetExceeded: false,
      preset: table.preset,
    };
  }

  // Edge case: cheapest has zero accuracy -> stay with picked even though exceeded.
  if (cheapestAcc === 0) {
    return {
      predictedCategory,
      groundTruthCategory,
      chosenBackend: picked,
      chosenBackendReason: 'soft exceed: cheapest has 0 acc',
      estimatedCostUsd: pickedCost,
      budgetCeiling: budgetPerQuery,
      budgetExceeded: true,
      preset: table.preset,
    };
  }

  const pickedCPC = pickedCost / pickedAcc;
  const cheapestCPC = cheapestFits.cost / cheapestAcc;

  if (pickedCPC <= cheapestCPC) {
    return {
      predictedCategory,
      groundTruthCategory,
      chosenBackend: picked,
      chosenBackendReason: 'soft exceed: better $/correct',
      estimatedCostUsd: pickedCost,
      budgetCeiling: budgetPerQuery,
      budgetExceeded: true,
      preset: table.preset,
    };
  }

  return {
    predictedCategory,
    groundTruthCategory,
    chosenBackend: cheapestFits.backend,
    chosenBackendReason: 'soft budget downgrade: cheaper $/correct',
    estimatedCostUsd: cheapestFits.cost,
    budgetCeiling: budgetPerQuery,
    budgetExceeded: false,
    preset: table.preset,
  };
}
