/**
 * @file routing-tables.ts
 * @description Preset routing tables for {@link MemoryRouter}.
 *
 * The MemoryRouter dispatches each query to one of the available
 * {@link MemoryBackendId} backends based on the classifier-predicted
 * {@link MemoryQueryCategory}. The mapping from category to backend is a
 * "routing table" — a frozen object that callers can pass through unchanged
 * for the shipping defaults, or override per-category for custom workloads.
 *
 * Three preset tables ship out of the box, each calibrated from Phase B
 * N=500 LongMemEval-S measurements:
 *
 * - {@link MINIMIZE_COST_TABLE}: cheapest Pareto-dominant backend per
 *   category. Pays the OM premium only on multi-session and
 *   single-session-preference (the categories where the architectural lift
 *   exceeds the cost premium).
 * - {@link BALANCED_TABLE}: trades modest cost for large latency wins on
 *   knowledge-update and temporal-reasoning.
 * - {@link MAXIMIZE_ACCURACY_TABLE}: highest-accuracy backend per category;
 *   ties broken by cost. v2 (post-Phase-B-2026-04-24) routes
 *   temporal-reasoning back to canonical-hybrid after Phase B revealed the
 *   v1 routing's accuracy gain was within CI noise but paid OM ingest cost.
 *
 * @module @framers/agentos/memory-router/routing-tables
 */

// ============================================================================
// Public types
// ============================================================================

/**
 * The six question categories the LLM-as-judge classifier produces.
 * Calibrated from LongMemEval-S categories; mappings to other benchmark
 * taxonomies (e.g. LOCOMO single-hop / multi-hop / temporal /
 * open-domain / adversarial) are handled at adapter boundaries.
 */
export const MEMORY_QUERY_CATEGORIES = [
  'single-session-user',
  'single-session-assistant',
  'single-session-preference',
  'knowledge-update',
  'multi-session',
  'temporal-reasoning',
] as const;

/**
 * The six question categories the LLM-as-judge classifier produces.
 */
export type MemoryQueryCategory = (typeof MEMORY_QUERY_CATEGORIES)[number];

/**
 * The retrieval architecture identifiers the router can dispatch to.
 *
 * - `canonical-hybrid`: BM25 + dense + RRF fusion + Cohere rerank-v3.5
 *   over the raw memory traces. The default cheapest-and-fastest path.
 * - `observational-memory-v10`: synthesized observation log fed to the
 *   reader, with classifier-driven routing inside the OM pipeline. No
 *   verbatim citation rule.
 * - `observational-memory-v11`: same as v10 but with conditional
 *   verbatim citation appended for knowledge-update and
 *   single-session-user categories. Wins on multi-session and
 *   single-session-preference.
 *
 * Backend execution itself lives in {@link MemoryDispatcher}; this type
 * is the contract between the routing decision and the dispatcher.
 */
export type MemoryBackendId =
  | 'canonical-hybrid'
  | 'observational-memory-v10'
  | 'observational-memory-v11';

/**
 * The three shipping presets. Each preset corresponds to a distinct point
 * on the Phase B-measured cost-accuracy Pareto frontier.
 */
export type MemoryRouterPreset =
  | 'minimize-cost'
  | 'balanced'
  | 'maximize-accuracy';

/**
 * A routing table maps every {@link MemoryQueryCategory} to its preferred
 * {@link MemoryBackendId} for the given preset. Tables ship frozen so
 * consumers cannot mutate the routing surface from outside the module.
 */
export interface RoutingTable {
  readonly preset: MemoryRouterPreset;
  readonly defaultMapping: Readonly<Record<MemoryQueryCategory, MemoryBackendId>>;
}

// ============================================================================
// Preset tables
// ============================================================================

/**
 * Preset: minimize-cost.
 *
 * Pareto-dominant cheapest backend per category. Pays the OM premium only
 * on the two categories where the architectural lift earns it
 * (multi-session +6.8pp, single-session-preference +3.3pp). Every other
 * category routes to canonical-hybrid where Phase B measurements show the
 * cheaper backend either dominates or matches within CI noise.
 *
 * Phase B simulation: 73.9% accuracy at $0.092/correct; oracle ceiling
 * 76.0% at $0.157/correct. **Pareto-dominates the all-Tier-2b flat
 * baseline by 4.77x cost reduction at +0.5pp accuracy** on the
 * LongMemEval-S Phase B distribution.
 *
 * Recommended default for cost-sensitive workloads.
 */
export const MINIMIZE_COST_TABLE: RoutingTable = Object.freeze({
  preset: 'minimize-cost' as const,
  defaultMapping: Object.freeze({
    'single-session-assistant': 'canonical-hybrid',
    'single-session-user': 'canonical-hybrid',
    'temporal-reasoning': 'canonical-hybrid',
    'knowledge-update': 'canonical-hybrid',
    'multi-session': 'observational-memory-v11',
    'single-session-preference': 'observational-memory-v11',
  }),
}) as RoutingTable;

/**
 * Preset: balanced.
 *
 * Trades 1.6x cost for >10x latency reductions on knowledge-update and
 * temporal-reasoning. Phase B measurements show Tier 2a v10 ties Tier 1
 * canonical on accuracy for these two categories at much lower latency
 * (4-19s vs 80-100s) — the latency win comes from skipping per-turn
 * cognitive replay in favor of synthesized observations.
 *
 * Phase B simulation: 74.5% accuracy at $0.205/correct; 2.12x cheaper
 * than Tier 2b flat with comparable accuracy.
 *
 * Recommended for interactive workloads where latency matters and the
 * cost premium over minimize-cost is acceptable.
 */
export const BALANCED_TABLE: RoutingTable = Object.freeze({
  preset: 'balanced' as const,
  defaultMapping: Object.freeze({
    'single-session-assistant': 'canonical-hybrid',
    'single-session-user': 'canonical-hybrid',
    'temporal-reasoning': 'observational-memory-v10',
    'knowledge-update': 'observational-memory-v10',
    'multi-session': 'observational-memory-v11',
    'single-session-preference': 'observational-memory-v11',
  }),
}) as RoutingTable;

/**
 * Preset: maximize-accuracy (v2).
 *
 * Highest-accuracy backend per category, ties broken by cost. v2
 * (2026-04-24, post-Phase-B) routes temporal-reasoning back to
 * canonical-hybrid after Phase B revealed:
 *   - v1 routing (TR -> Tier 2a) paid OM ingest cost for a within-CI
 *     accuracy gain (71.0% Tier 2a vs 70.2% Tier 1) on a hold-out slice;
 *   - combined with classifier misroutes the aggregate fell below the
 *     74% acceptance floor at 73.8%.
 * v2 keeps TR on canonical-hybrid where it's cheapest and
 * accuracy-equivalent.
 *
 * Phase B measured: 75.6% [71.8, 79.2] at $0.2434/correct, 65.6s avg
 * latency.
 */
export const MAXIMIZE_ACCURACY_TABLE: RoutingTable = Object.freeze({
  preset: 'maximize-accuracy' as const,
  defaultMapping: Object.freeze({
    'single-session-assistant': 'canonical-hybrid',
    'single-session-user': 'observational-memory-v11',
    'temporal-reasoning': 'canonical-hybrid',
    'knowledge-update': 'observational-memory-v11',
    'multi-session': 'observational-memory-v11',
    'single-session-preference': 'observational-memory-v11',
  }),
}) as RoutingTable;

/**
 * Convenience registry of all three preset tables, keyed by preset name.
 * Useful when surfacing presets through a CLI flag or config field where
 * the preset name is a string and the consumer needs the table object.
 */
export const PRESET_TABLES: Readonly<Record<MemoryRouterPreset, RoutingTable>> =
  Object.freeze({
    'minimize-cost': MINIMIZE_COST_TABLE,
    'balanced': BALANCED_TABLE,
    'maximize-accuracy': MAXIMIZE_ACCURACY_TABLE,
  });
