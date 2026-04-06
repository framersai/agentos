/**
 * @module web-search/fusion
 *
 * URL normalization and Reciprocal Rank Fusion (RRF) scoring.
 * Pure functions, no IO.
 */
import type { RRFCandidate } from './types';
/** Normalize a URL for dedup comparison. */
export declare function normalizeUrl(url: string): string;
/**
 * Compute RRF scores for candidates.
 *
 * Formula: score(d) = Σ (provider_weight / (k + rank_in_provider))
 * Results appearing in multiple providers get naturally boosted.
 *
 * @param candidates - Candidates with providerRanks populated
 * @param k - RRF constant (default 60)
 * @returns Same candidates with rrfScore computed, sorted descending
 */
export declare function computeRRF(candidates: RRFCandidate[], k?: number): RRFCandidate[];
/**
 * Compute weighted RRF scores using per-provider weights.
 *
 * @param candidates - Candidates with providerRanks populated
 * @param weights - Provider ID → weight multiplier map
 * @param k - RRF constant (default 60)
 */
export declare function computeWeightedRRF(candidates: RRFCandidate[], weights: Record<string, number>, k?: number): RRFCandidate[];
//# sourceMappingURL=fusion.d.ts.map