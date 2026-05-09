/**
 * @module web-search/fusion
 *
 * URL normalization and Reciprocal Rank Fusion (RRF) scoring.
 * Pure functions, no IO.
 */
import type { RRFCandidate } from './types';

/** Default RRF constant — prevents top-ranked results from dominating. */
const DEFAULT_K = 60;

/** Normalize a URL for dedup comparison. */
export function normalizeUrl(url: string): string {
  return url
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/+$/, '')
    .replace(/[?&](utm_\w+|ref|source|fbclid|gclid)=[^&]*/g, '')
    .replace(/\?$/, '');
}

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
export function computeRRF(candidates: RRFCandidate[], k: number = DEFAULT_K): RRFCandidate[] {
  for (const candidate of candidates) {
    let score = 0;
    for (const [, rank] of candidate.providerRanks) {
      // Weight is baked into the candidate via the provider that created it
      score += 1 / (k + rank);
    }
    candidate.rrfScore = score;
  }

  return candidates.sort((a, b) => b.rrfScore - a.rrfScore);
}

/**
 * Compute weighted RRF scores using per-provider weights.
 *
 * @param candidates - Candidates with providerRanks populated
 * @param weights - Provider ID → weight multiplier map
 * @param k - RRF constant (default 60)
 */
export function computeWeightedRRF(
  candidates: RRFCandidate[],
  weights: Record<string, number>,
  k: number = DEFAULT_K
): RRFCandidate[] {
  for (const candidate of candidates) {
    let score = 0;
    for (const [provider, rank] of candidate.providerRanks) {
      score += (weights[provider] ?? 1.0) / (k + rank);
    }
    candidate.rrfScore = score;
  }

  return candidates.sort((a, b) => b.rrfScore - a.rrfScore);
}
