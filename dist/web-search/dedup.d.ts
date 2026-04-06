import type { RRFCandidate } from './types';
/** Build vocabulary index from all texts. */
export declare function buildVocabulary(texts: string[]): Map<string, number>;
/** Build a TF vector normalized by document length. */
export declare function buildTfVector(text: string, vocabulary: Map<string, number>): number[];
/**
 * Semantic dedup: merge near-duplicate results across providers.
 *
 * Two-pass:
 * 1. URL normalization merge (exact match after stripping protocol/www/tracking)
 * 2. TF-IDF cosine similarity on snippets (catches same article at different URLs)
 *
 * Keeps the version with richest content (prefers full markdown over snippet-only).
 *
 * @param candidates - Raw candidates from all providers
 * @param threshold - Cosine similarity threshold for dedup (default 0.85)
 */
export declare function semanticDedup(candidates: RRFCandidate[], threshold?: number): RRFCandidate[];
//# sourceMappingURL=dedup.d.ts.map