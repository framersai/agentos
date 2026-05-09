/**
 * @file backend-costs.ts
 * @description Per-backend per-category cost-accuracy-latency points
 * measured on LongMemEval-S Phase B (N=500). The {@link MemoryRouter} uses
 * these to:
 *   - estimate the per-query USD cost of a routing decision before executing,
 *   - apply budget constraints (`hard` / `soft` / `cheapest-fallback`),
 *   - pick the cheapest backend that fits a budget when downgrading.
 *
 * Numbers come from the canonical Phase B run JSONs:
 *   - canonical-hybrid: results/runs/2026-04-20T20-03-14-675 (Tier 1)
 *   - observational-memory-v10: results/runs/2026-04-23T04-14-40-609 (Tier 2a v10)
 *   - observational-memory-v11: results/runs/2026-04-23T17-27-28-793 (Tier 2b v11)
 *
 * The per-tier `avgCostPerQuery` is the totalUsd-divided-by-n_cases
 * average; on routed configurations the actual per-call cost depends on
 * which backend the dispatcher picked and which category the call hit, so
 * the per-category breakdown below is what the router actually consumes.
 *
 * @module @framers/agentos/memory-router/backend-costs
 */

import type { MemoryBackendId, MemoryQueryCategory } from './routing-tables.js';

/**
 * Cost-accuracy-latency point for one backend across the six categories.
 * The router compares these to make budget-aware decisions.
 */
export interface MemoryBackendCostPoint {
  readonly backend: MemoryBackendId;
  /** Average USD per query across all categories (Phase B aggregate). */
  readonly avgCostPerQuery: number;
  /** Per-category accuracy at this backend (Phase B N=500). */
  readonly perCategoryAccuracy: Readonly<Record<MemoryQueryCategory, number>>;
  /** Per-category USD per query at this backend (Phase B N=500). */
  readonly perCategoryCostPerQuery: Readonly<Record<MemoryQueryCategory, number>>;
  /** Per-category average latency in ms at this backend (Phase B N=500). */
  readonly perCategoryLatencyMs: Readonly<Record<MemoryQueryCategory, number>>;
}

/**
 * canonical-hybrid: BM25 + dense + RRF + Cohere rerank-v3.5 over raw
 * memory traces. Phase B measured 73.2% [69.2, 77.0] aggregate at
 * $0.0213/correct.
 */
export const TIER_1_CANONICAL_COSTS: MemoryBackendCostPoint = Object.freeze({
  backend: 'canonical-hybrid' as const,
  avgCostPerQuery: 0.0156,
  perCategoryAccuracy: Object.freeze({
    'single-session-user': 0.971,
    'single-session-assistant': 0.893,
    'single-session-preference': 0.600,
    'knowledge-update': 0.868,
    'multi-session': 0.549,
    'temporal-reasoning': 0.702,
  }),
  perCategoryCostPerQuery: Object.freeze({
    'single-session-user': 0.0191,
    'single-session-assistant': 0.0175,
    'single-session-preference': 0.0206,
    'knowledge-update': 0.0189,
    'multi-session': 0.0196,
    'temporal-reasoning': 0.0202,
  }),
  perCategoryLatencyMs: Object.freeze({
    'single-session-user': 104837,
    'single-session-assistant': 55252,
    'single-session-preference': 58373,
    'knowledge-update': 82807,
    'multi-session': 131188,
    'temporal-reasoning': 100881,
  }),
}) as MemoryBackendCostPoint;

/**
 * observational-memory-v10: synthesized observation log + classifier-driven
 * dispatch inside the OM pipeline (no verbatim citation). Phase B measured
 * 74.6% [70.8, 78.4] aggregate at $0.3265/correct, 12s avg latency.
 */
export const TIER_2A_V10_COSTS: MemoryBackendCostPoint = Object.freeze({
  backend: 'observational-memory-v10' as const,
  avgCostPerQuery: 0.2436,
  perCategoryAccuracy: Object.freeze({
    'single-session-user': 0.971,
    'single-session-assistant': 0.839,
    'single-session-preference': 0.600,
    'knowledge-update': 0.859,
    'multi-session': 0.602,
    'temporal-reasoning': 0.710,
  }),
  perCategoryCostPerQuery: Object.freeze({
    'single-session-user': 0.0214,
    'single-session-assistant': 0.0195,
    'single-session-preference': 0.0206,
    'knowledge-update': 0.0306,
    'multi-session': 0.0308,
    'temporal-reasoning': 0.0206,
  }),
  perCategoryLatencyMs: Object.freeze({
    'single-session-user': 7649,
    'single-session-assistant': 5668,
    'single-session-preference': 4469,
    'knowledge-update': 19569,
    'multi-session': 21360,
    'temporal-reasoning': 4236,
  }),
}) as MemoryBackendCostPoint;

/**
 * observational-memory-v11: v10 + conditional verbatim citation rule for
 * knowledge-update and single-session-user categories. Phase B measured
 * 75.4% [71.6, 79.0] aggregate at $0.4362/correct, 14s avg latency.
 */
export const TIER_2B_V11_COSTS: MemoryBackendCostPoint = Object.freeze({
  backend: 'observational-memory-v11' as const,
  avgCostPerQuery: 0.3289,
  perCategoryAccuracy: Object.freeze({
    'single-session-user': 0.986,
    'single-session-assistant': 0.839,
    'single-session-preference': 0.633,
    'knowledge-update': 0.872,
    'multi-session': 0.617,
    'temporal-reasoning': 0.692,
  }),
  perCategoryCostPerQuery: Object.freeze({
    'single-session-user': 0.0212,
    'single-session-assistant': 0.0192,
    'single-session-preference': 0.0206,
    'knowledge-update': 0.0307,
    'multi-session': 0.0336,
    'temporal-reasoning': 0.0209,
  }),
  perCategoryLatencyMs: Object.freeze({
    'single-session-user': 6676,
    'single-session-assistant': 6879,
    'single-session-preference': 8822,
    'knowledge-update': 21085,
    'multi-session': 27423,
    'temporal-reasoning': 5025,
  }),
}) as MemoryBackendCostPoint;

/**
 * Default cost-points registry. Indexed by {@link MemoryBackendId} so the
 * router can look up the picked backend's cost on any category.
 *
 * Custom deployments can substitute their own cost-points by passing a
 * different `backendCosts` map into the {@link MemoryRouter} config —
 * useful when a workload diverges from the LongMemEval-S Phase B
 * distribution and the calibrator wants to plug in measurements from
 * their own benchmark.
 */
export const DEFAULT_MEMORY_BACKEND_COSTS: Readonly<
  Record<MemoryBackendId, MemoryBackendCostPoint>
> = Object.freeze({
  'canonical-hybrid': TIER_1_CANONICAL_COSTS,
  'observational-memory-v10': TIER_2A_V10_COSTS,
  'observational-memory-v11': TIER_2B_V11_COSTS,
});
