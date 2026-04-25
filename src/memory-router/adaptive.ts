/**
 * @file adaptive.ts
 * @description Self-calibrating routing-table generator.
 *
 * The shipping {@link MINIMIZE_COST_TABLE} / {@link BALANCED_TABLE} /
 * {@link MAXIMIZE_ACCURACY_TABLE} are calibrated from LongMemEval-S
 * Phase B N=500 measurements. For workloads whose cost-accuracy profile
 * diverges from that distribution, those tables are not optimal.
 *
 * AdaptiveMemoryRouter takes a workload-specific calibration dataset
 * (a list of {category, backend, costUsd, correct} samples) and derives
 * a routing table from it. Same MemoryRouter API; different table
 * source.
 *
 * Calibration workflow:
 *   1. Run a Phase A sweep on your workload (a few hundred queries
 *      across a small subset of expected categories, dispatched to all
 *      candidate backends).
 *   2. Each sample contributes one (category, backend, costUsd, correct)
 *      data point.
 *   3. AdaptiveMemoryRouter aggregates these into per-(category, backend)
 *      mean cost + mean accuracy.
 *   4. Apply a preset selection rule:
 *        - 'minimize-cost': cheapest backend within 2pp of best accuracy;
 *          if none within tolerance, pick best accuracy.
 *        - 'maximize-accuracy': highest accuracy; ties broken by cost.
 *        - 'balanced': best $/correct (mean cost divided by mean
 *          accuracy).
 *   5. Categories with insufficient samples fall back to the static
 *      preset table.
 *
 * The router is otherwise identical to {@link MemoryRouter} — same
 * decide() / decideAndDispatch() / budget-aware dispatch.
 *
 * @module @framers/agentos/memory-router/adaptive
 */

import { MemoryRouter, type MemoryRouterOptions } from './MemoryRouter.js';
import {
  PRESET_TABLES,
  type MemoryBackendId,
  type MemoryQueryCategory,
  type MemoryRouterPreset,
  type RoutingTable,
} from './routing-tables.js';

// ============================================================================
// Public types
// ============================================================================

/**
 * One calibration sample. Caller produces these from running their own
 * workload through each candidate backend and recording the outcome.
 */
export interface CalibrationSample {
  readonly category: MemoryQueryCategory;
  readonly backend: MemoryBackendId;
  readonly costUsd: number;
  /** 1 = correct, 0 = incorrect (or score in [0,1] for soft graders). */
  readonly correct: number;
}

/**
 * Aggregated calibration cell: one (category, backend) → mean cost +
 * mean accuracy + sample count.
 */
export interface CalibrationCell {
  readonly n: number;
  readonly meanCost: number;
  readonly meanAccuracy: number;
}

/**
 * Map of (category, backend) → CalibrationCell. Categories or backends
 * with no samples are simply absent from the map.
 */
export type AggregatedCalibration = Partial<
  Record<MemoryQueryCategory, Partial<Record<MemoryBackendId, CalibrationCell>>>
>;

/**
 * Preset selection rules for {@link selectByPreset}.
 *
 * - `minimize-cost`: pick the cheapest backend whose meanAccuracy is
 *   within `accuracyTolerance` (default 0.02 = 2pp) of the best
 *   meanAccuracy on this category. If no backend is within tolerance,
 *   pick the best-accuracy backend (the gap exceeds the tolerance,
 *   meaning accuracy gain justifies cost).
 * - `maximize-accuracy`: pick the highest-meanAccuracy backend;
 *   ties broken by lower meanCost.
 * - `balanced`: pick the lowest meanCost / meanAccuracy ratio
 *   ($/correct). Backends with zero meanAccuracy are skipped (would
 *   produce divide-by-zero).
 */
export type AdaptivePresetRule =
  | 'minimize-cost'
  | 'balanced'
  | 'maximize-accuracy';

export interface SelectByPresetArgs {
  readonly category: MemoryQueryCategory;
  readonly agg: AggregatedCalibration;
  readonly preset: AdaptivePresetRule;
  /**
   * Minimum sample count per (category, backend) cell required for
   * adaptive selection. Cells below this threshold are ignored. Default
   * 1 (any sample qualifies). Increase for noisier workloads.
   */
  readonly minSamplesPerCell?: number;
  /**
   * For `minimize-cost`: max accuracy gap from the best-accuracy backend
   * tolerated when picking the cheaper alternative. Default 0.02 (2pp).
   */
  readonly accuracyTolerance?: number;
}

export interface BuildAdaptiveRoutingTableArgs {
  readonly samples: readonly CalibrationSample[];
  readonly preset: AdaptivePresetRule;
  readonly minSamplesPerCell?: number;
  readonly accuracyTolerance?: number;
  /**
   * Fallback static table for categories with insufficient calibration.
   * Defaults to the preset's shipping static table.
   */
  readonly fallbackTable?: RoutingTable;
}

export interface AdaptiveMemoryRouterOptions
  extends Omit<MemoryRouterOptions, 'routingTable' | 'preset'> {
  readonly calibrationSamples: readonly CalibrationSample[];
  readonly preset: AdaptivePresetRule;
  readonly minSamplesPerCell?: number;
  readonly accuracyTolerance?: number;
}

// ============================================================================
// Aggregation
// ============================================================================

/**
 * Roll up raw calibration samples into per-(category, backend) cells.
 * Each cell carries n, meanCost, meanAccuracy.
 */
export function aggregateCalibration(
  samples: readonly CalibrationSample[],
): AggregatedCalibration {
  const acc: Record<string, Record<string, { n: number; sumCost: number; sumCorrect: number }>> = {};

  for (const s of samples) {
    if (!acc[s.category]) acc[s.category] = {};
    if (!acc[s.category]![s.backend]) {
      acc[s.category]![s.backend] = { n: 0, sumCost: 0, sumCorrect: 0 };
    }
    const cell = acc[s.category]![s.backend]!;
    cell.n += 1;
    cell.sumCost += s.costUsd;
    cell.sumCorrect += s.correct;
  }

  const out: AggregatedCalibration = {};
  for (const cat of Object.keys(acc) as MemoryQueryCategory[]) {
    out[cat] = {};
    const inner = out[cat]!;
    for (const backend of Object.keys(acc[cat]!) as MemoryBackendId[]) {
      const cell = acc[cat]![backend]!;
      inner[backend] = {
        n: cell.n,
        meanCost: cell.sumCost / cell.n,
        meanAccuracy: cell.sumCorrect / cell.n,
      };
    }
  }
  return out;
}

// ============================================================================
// Per-category selection
// ============================================================================

/**
 * Select a backend for one category from aggregated calibration data
 * using the named preset rule. Falls back to the preset's static table
 * when calibration is insufficient.
 */
export function selectByPreset(args: SelectByPresetArgs): MemoryBackendId {
  const {
    category,
    agg,
    preset,
    minSamplesPerCell = 1,
    accuracyTolerance = 0.02,
  } = args;

  const fallbackTable = PRESET_TABLES[preset];
  const fallback = fallbackTable.defaultMapping[category];

  const cells = agg[category];
  if (!cells) return fallback;

  // Filter cells meeting min-sample threshold.
  const eligible = (Object.entries(cells) as [MemoryBackendId, CalibrationCell][])
    .filter(([, cell]) => cell.n >= minSamplesPerCell);

  if (eligible.length === 0) return fallback;

  if (preset === 'maximize-accuracy') {
    return eligible.reduce((best, [backend, cell]) => {
      const [bestBackend, bestCell] = best;
      if (cell.meanAccuracy > bestCell.meanAccuracy) return [backend, cell];
      if (cell.meanAccuracy === bestCell.meanAccuracy) {
        return cell.meanCost < bestCell.meanCost ? [backend, cell] : best;
      }
      return best;
    }, eligible[0]!)[0];
  }

  if (preset === 'balanced') {
    // best $/correct (skip zero-accuracy cells to avoid div-by-zero)
    const valid = eligible.filter(([, cell]) => cell.meanAccuracy > 0);
    if (valid.length === 0) return fallback;
    return valid.reduce((best, [backend, cell]) => {
      const [bestBackend, bestCell] = best;
      const cellCpc = cell.meanCost / cell.meanAccuracy;
      const bestCpc = bestCell.meanCost / bestCell.meanAccuracy;
      return cellCpc < bestCpc ? [backend, cell] : best;
    }, valid[0]!)[0];
  }

  // minimize-cost: cheapest within accuracyTolerance of best accuracy.
  const bestAccuracy = Math.max(
    ...eligible.map(([, cell]) => cell.meanAccuracy),
  );
  const withinTolerance = eligible.filter(
    ([, cell]) => bestAccuracy - cell.meanAccuracy <= accuracyTolerance,
  );

  if (withinTolerance.length === 0) {
    // No candidates within tolerance is impossible (the best-accuracy
    // backend itself qualifies), but guard anyway.
    return fallback;
  }

  return withinTolerance.reduce((best, [backend, cell]) => {
    const [bestBackend, bestCell] = best;
    return cell.meanCost < bestCell.meanCost ? [backend, cell] : best;
  }, withinTolerance[0]!)[0];
}

// ============================================================================
// Table construction
// ============================================================================

const ALL_CATEGORIES: readonly MemoryQueryCategory[] = [
  'single-session-user',
  'single-session-assistant',
  'single-session-preference',
  'knowledge-update',
  'multi-session',
  'temporal-reasoning',
];

/**
 * Build a complete frozen routing table from calibration samples + a
 * preset rule. Categories without enough calibration fall back to the
 * preset's static table.
 */
export function buildAdaptiveRoutingTable(
  args: BuildAdaptiveRoutingTableArgs,
): RoutingTable {
  const {
    samples,
    preset,
    minSamplesPerCell,
    accuracyTolerance,
    fallbackTable,
  } = args;

  const agg = aggregateCalibration(samples);
  const fb = fallbackTable ?? PRESET_TABLES[preset];

  const mapping: Record<MemoryQueryCategory, MemoryBackendId> = {} as Record<
    MemoryQueryCategory,
    MemoryBackendId
  >;
  for (const cat of ALL_CATEGORIES) {
    mapping[cat] = selectByPreset({
      category: cat,
      agg,
      preset,
      minSamplesPerCell,
      accuracyTolerance,
    });
    // selectByPreset falls back to the preset's STATIC default mapping,
    // not the caller-supplied fallback table. Apply the explicit
    // fallback only when the static fallback wasn't applied because of
    // missing data — easiest is to override after the fact.
    if (!agg[cat] && fb !== PRESET_TABLES[preset]) {
      mapping[cat] = fb.defaultMapping[cat];
    }
  }

  return Object.freeze({
    preset: preset as MemoryRouterPreset,
    defaultMapping: Object.freeze(mapping),
  }) as RoutingTable;
}

// ============================================================================
// AdaptiveMemoryRouter class
// ============================================================================

/**
 * Memory router whose routing table is derived from a calibration
 * dataset rather than a static preset. Otherwise identical API to
 * {@link MemoryRouter}.
 */
export class AdaptiveMemoryRouter extends MemoryRouter {
  private readonly derivedTable: RoutingTable;

  constructor(options: AdaptiveMemoryRouterOptions) {
    const derivedTable = buildAdaptiveRoutingTable({
      samples: options.calibrationSamples,
      preset: options.preset,
      minSamplesPerCell: options.minSamplesPerCell,
      accuracyTolerance: options.accuracyTolerance,
    });

    super({
      ...options,
      preset: options.preset as MemoryRouterPreset,
      routingTable: derivedTable,
    });

    this.derivedTable = derivedTable;
  }

  /**
   * Inspect the derived routing table for debugging / telemetry.
   */
  getRoutingTable(): RoutingTable {
    return this.derivedTable;
  }
}
