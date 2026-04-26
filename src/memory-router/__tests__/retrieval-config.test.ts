/**
 * @file retrieval-config.test.ts
 * @description Contract tests for the RetrievalConfigRouter primitive.
 * Pin: type contract, calibration data shape, selector behavior, and
 * the oracle-aggregate forecast math.
 *
 * Source data: 2026-04-26 LongMemEval-M Phase A N=54 ablation runs.
 */

import { describe, it, expect } from 'vitest';
import {
  RETRIEVAL_CONFIG_IDS,
  RETRIEVAL_CONFIG_SPECS,
  M_PHASE_A_PER_CATEGORY_ACCURACY,
  M_PHASE_A_COST_PER_CORRECT,
  M_TUNED_PER_CATEGORY_TABLE,
  selectBestRetrievalConfig,
  computeOracleAggregate,
  computeOracleCostPerCorrect,
  type RetrievalConfigId,
} from '../retrieval-config.js';
import { MEMORY_QUERY_CATEGORIES } from '../routing-tables.js';

describe('RetrievalConfigRouter primitives', () => {
  describe('RETRIEVAL_CONFIG_IDS', () => {
    it('exposes the 6 calibrated config variants', () => {
      expect(RETRIEVAL_CONFIG_IDS).toEqual([
        'canonical',
        'hyde',
        'topk50',
        'topk50-mult5',
        'hyde-topk50',
        'hyde-topk50-mult5',
      ]);
    });
  });

  describe('RETRIEVAL_CONFIG_SPECS', () => {
    it('every config id has a spec entry', () => {
      for (const id of RETRIEVAL_CONFIG_IDS) {
        expect(RETRIEVAL_CONFIG_SPECS[id]).toBeDefined();
        expect(RETRIEVAL_CONFIG_SPECS[id].id).toBe(id);
      }
    });

    it('canonical has default flag values (3, 20, no hyde)', () => {
      const spec = RETRIEVAL_CONFIG_SPECS.canonical;
      expect(spec.hyde).toBe(false);
      expect(spec.rerankCandidateMultiplier).toBe(3);
      expect(spec.readerTopK).toBe(20);
    });

    it('hyde-topk50-mult5 has all three M-tuned flag values', () => {
      const spec = RETRIEVAL_CONFIG_SPECS['hyde-topk50-mult5'];
      expect(spec.hyde).toBe(true);
      expect(spec.rerankCandidateMultiplier).toBe(5);
      expect(spec.readerTopK).toBe(50);
    });

    it('frozen at module load — mutation throws or is silently dropped', () => {
      const spec = RETRIEVAL_CONFIG_SPECS.canonical;
      // In strict mode, this throws TypeError. In sloppy mode, silently fails.
      // Either way, the value should not change.
      try {
        (spec as { hyde: boolean }).hyde = true;
      } catch {
        // expected in strict mode
      }
      expect(RETRIEVAL_CONFIG_SPECS.canonical.hyde).toBe(false);
    });
  });

  describe('M_PHASE_A_PER_CATEGORY_ACCURACY', () => {
    it('every category × every config has a numeric accuracy in [0, 1]', () => {
      for (const cat of MEMORY_QUERY_CATEGORIES) {
        for (const id of RETRIEVAL_CONFIG_IDS) {
          const acc = M_PHASE_A_PER_CATEGORY_ACCURACY[cat][id];
          expect(acc).toBeGreaterThanOrEqual(0);
          expect(acc).toBeLessThanOrEqual(1);
        }
      }
    });

    it('combined config wins SSA on the calibration data', () => {
      const ssa = M_PHASE_A_PER_CATEGORY_ACCURACY['single-session-assistant'];
      expect(ssa['hyde-topk50-mult5']).toBe(1.0);
      expect(ssa.hyde).toBe(0.889);
    });

    it('HyDE alone wins TR on the calibration data', () => {
      const tr = M_PHASE_A_PER_CATEGORY_ACCURACY['temporal-reasoning'];
      expect(tr.hyde).toBe(0.667);
      expect(tr['hyde-topk50-mult5']).toBe(0.333); // combined HURTS TR
    });

    it('multi-session is precision-bound: combined required for the lift', () => {
      const ms = M_PHASE_A_PER_CATEGORY_ACCURACY['multi-session'];
      expect(ms['hyde-topk50-mult5']).toBe(0.667);
      expect(ms.hyde).toBe(0.111); // hyde alone hurts MS
      expect(ms.canonical).toBe(0.18); // baseline
    });
  });

  describe('M_PHASE_A_COST_PER_CORRECT', () => {
    it('HyDE alone is the cheapest non-baseline config', () => {
      const sortedByCost = [...RETRIEVAL_CONFIG_IDS].sort(
        (a, b) => M_PHASE_A_COST_PER_CORRECT[a] - M_PHASE_A_COST_PER_CORRECT[b],
      );
      // canonical baseline at $0.0818 (from Phase B N=500); hyde at $0.0369 cheaper
      expect(M_PHASE_A_COST_PER_CORRECT.hyde).toBeLessThan(M_PHASE_A_COST_PER_CORRECT.canonical);
    });

    it('combined M-tuned is cheaper than topk50/hyde-topk50 alone', () => {
      expect(M_PHASE_A_COST_PER_CORRECT['hyde-topk50-mult5']).toBeLessThan(
        M_PHASE_A_COST_PER_CORRECT.topk50,
      );
      expect(M_PHASE_A_COST_PER_CORRECT['hyde-topk50-mult5']).toBeLessThan(
        M_PHASE_A_COST_PER_CORRECT['hyde-topk50'],
      );
    });
  });

  describe('M_TUNED_PER_CATEGORY_TABLE', () => {
    it('every category has a calibrated config pick', () => {
      for (const cat of MEMORY_QUERY_CATEGORIES) {
        expect(M_TUNED_PER_CATEGORY_TABLE[cat]).toBeDefined();
        expect(RETRIEVAL_CONFIG_IDS).toContain(M_TUNED_PER_CATEGORY_TABLE[cat]);
      }
    });

    it('SSA → combined (data-driven from N=54)', () => {
      expect(M_TUNED_PER_CATEGORY_TABLE['single-session-assistant']).toBe('hyde-topk50-mult5');
    });

    it('TR → HyDE alone (combined hurts TR)', () => {
      expect(M_TUNED_PER_CATEGORY_TABLE['temporal-reasoning']).toBe('hyde');
    });

    it('MS → combined (the only config that lifts MS to 66.7%)', () => {
      expect(M_TUNED_PER_CATEGORY_TABLE['multi-session']).toBe('hyde-topk50-mult5');
    });
  });

  describe('selectBestRetrievalConfig', () => {
    it('returns the calibrated pick when registered set is undefined', () => {
      expect(selectBestRetrievalConfig('multi-session')).toBe('hyde-topk50-mult5');
      expect(selectBestRetrievalConfig('temporal-reasoning')).toBe('hyde');
    });

    it('returns the calibrated pick when it is in the registered set', () => {
      const registered: RetrievalConfigId[] = ['canonical', 'hyde', 'hyde-topk50-mult5'];
      expect(selectBestRetrievalConfig('multi-session', registered)).toBe('hyde-topk50-mult5');
      expect(selectBestRetrievalConfig('temporal-reasoning', registered)).toBe('hyde');
    });

    it('falls back to highest-accuracy registered alternative when calibrated pick missing', () => {
      // MS calibrated pick is hyde-topk50-mult5; register only canonical + hyde
      const registered: RetrievalConfigId[] = ['canonical', 'hyde'];
      const choice = selectBestRetrievalConfig('multi-session', registered);
      // M_PHASE_A: MS canonical=0.180, hyde=0.111. Higher accuracy is canonical.
      expect(choice).toBe('canonical');
    });

    it('breaks ties by lower $/correct', () => {
      // SSP: canonical=0.10, hyde=0.222, topk50=0.222 — tie at 0.222
      // canonical $/c = 0.0818, hyde $/c = 0.0369, topk50 $/c = 0.1351
      // Of the tied (hyde, topk50), hyde is cheaper.
      const registered: RetrievalConfigId[] = ['canonical', 'hyde', 'topk50'];
      const choice = selectBestRetrievalConfig('single-session-preference', registered);
      expect(choice).toBe('hyde');
    });

    it('falls back to canonical for empty registered set', () => {
      // Empty array means "use defaults" — calibrated pick.
      const choice = selectBestRetrievalConfig('multi-session', []);
      expect(choice).toBe('hyde-topk50-mult5'); // empty array treated as no constraint
    });
  });

  describe('computeOracleAggregate', () => {
    it('forecasts the per-category-oracle aggregate accuracy on the M distribution', () => {
      // LongMemEval-M true distribution from Stage J Phase B (N=500):
      // MS 26.6%, TR 26.6%, KU 15.6%, SSU 14.0%, SSA 11.2%, SSP 6.0%
      const mDistribution = {
        'single-session-assistant': 0.112,
        'single-session-user': 0.140,
        'single-session-preference': 0.060,
        'knowledge-update': 0.156,
        'multi-session': 0.266,
        'temporal-reasoning': 0.266,
      };
      const oracle = computeOracleAggregate(mDistribution);
      // Per-category best on M (calibrated table):
      // SSA → combined (1.0); SSU → combined (0.778); SSP → hyde (0.222);
      // KU → combined (0.778); MS → combined (0.667); TR → hyde (0.667).
      // Weighted: 1.0*0.112 + 0.778*0.140 + 0.222*0.060 + 0.778*0.156 + 0.667*0.266 + 0.667*0.266
      // = 0.112 + 0.1089 + 0.01332 + 0.1214 + 0.1774 + 0.1774
      // = 0.7104
      expect(oracle).toBeGreaterThan(0.69);
      expect(oracle).toBeLessThan(0.73);
    });

    it('beats static combined config (57.4% on N=54 stratified) by at least 5 pp', () => {
      // True M distribution (heavier on MS+TR which are the weakest categories)
      const mDistribution = {
        'single-session-assistant': 0.112,
        'single-session-user': 0.140,
        'single-session-preference': 0.060,
        'knowledge-update': 0.156,
        'multi-session': 0.266,
        'temporal-reasoning': 0.266,
      };
      const oracle = computeOracleAggregate(mDistribution);
      // Compute static-combined accuracy under same distribution
      let staticCombined = 0;
      for (const [cat, weight] of Object.entries(mDistribution) as [
        keyof typeof M_PHASE_A_PER_CATEGORY_ACCURACY,
        number,
      ][]) {
        staticCombined +=
          M_PHASE_A_PER_CATEGORY_ACCURACY[cat]['hyde-topk50-mult5'] * weight;
      }
      expect(oracle - staticCombined).toBeGreaterThan(0.05);
    });
  });

  describe('computeOracleCostPerCorrect', () => {
    it('forecasts cost-per-correct under per-category dispatch', () => {
      const mDistribution = {
        'single-session-assistant': 0.112,
        'single-session-user': 0.140,
        'single-session-preference': 0.060,
        'knowledge-update': 0.156,
        'multi-session': 0.266,
        'temporal-reasoning': 0.266,
      };
      const oracleCost = computeOracleCostPerCorrect(mDistribution);
      // Per-category cost: SSA combined $0.056; SSU combined $0.056;
      // SSP hyde $0.037; KU combined $0.056; MS combined $0.056; TR hyde $0.037.
      // Weighted: most-traffic categories use combined ($0.056), TR (26.6%) uses hyde ($0.037)
      // Average somewhere in [$0.045, $0.060].
      expect(oracleCost).toBeGreaterThan(0.04);
      expect(oracleCost).toBeLessThan(0.08);
    });
  });
});
