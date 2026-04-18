/**
 * @fileoverview Trigram-based language detection profiles and scoring algorithm.
 *
 * Implements the Cavnar & Trenkle (1994) approach: build a ranked trigram
 * frequency profile from the input text and compare it against pre-computed
 * reference profiles for each supported language.  The language whose profile
 * has the lowest "out-of-place" distance wins.
 *
 * Each reference profile stores the top-300 most frequent trigrams for the
 * language, derived from representative corpora.  Only the 82 languages
 * bundled with franc-min are covered here; the top-20 by global speaker
 * count are given full 300-trigram profiles while the rest carry abbreviated
 * profiles that still achieve > 90 % accuracy on passages of 50+ characters.
 *
 * ISO 639-3 codes are used throughout (e.g. "eng", "spa", "cmn") to stay
 * consistent with the franc ecosystem.
 *
 * @module backend/agentos/nlp/ai_utilities/trigram-language-profiles
 */
/** A ranked list of trigrams for one language (most frequent first). */
export interface LanguageProfile {
    /** ISO 639-3 code */
    code: string;
    /** Human-readable label (English) */
    name: string;
    /** Ordered trigrams, index 0 = most frequent. */
    trigrams: string[];
}
/**
 * Extract trigrams from text, including word-boundary trigrams
 * (padded with spaces).  The text is lowercased and normalised first.
 */
export declare function extractTrigrams(text: string): Map<string, number>;
/**
 * Build a ranked list of trigrams from frequency counts (most frequent first).
 */
export declare function rankTrigrams(counts: Map<string, number>, maxRank?: number): string[];
/**
 * Compute the "out-of-place" distance between an input ranked trigram list
 * and a reference profile.  Lower = better match.
 *
 * For each trigram in the input profile, find its position in the reference.
 * If not found, apply a penalty equal to `maxRank`.  Sum all displacements.
 */
export declare function computeDistance(inputRanked: string[], referenceProfile: string[], maxRank?: number): number;
/**
 * Convert raw distances to 0-1 confidence scores.
 *
 * The best (lowest-distance) language gets the highest confidence.
 * We use inverse-distance normalisation:
 *   score_i = (1 / (1 + distance_i)) / sum(1 / (1 + distance_j))
 */
export declare function distancesToConfidences(distances: Array<{
    code: string;
    distance: number;
}>): Array<{
    code: string;
    confidence: number;
}>;
/**
 * Convert an ISO 639-3 code to ISO 639-1 if a mapping exists,
 * otherwise return the 3-letter code as-is.
 */
export declare function iso6393To1(code: string): string;
export interface DetectLanguageOptions {
    /** Maximum number of candidate results to return (default 3). */
    maxCandidates?: number;
    /** Minimum text length in characters to attempt detection (default 10). */
    minLength?: number;
}
/**
 * Detect the language of a text string using trigram frequency profiles.
 *
 * @param text - The input text to analyse
 * @param options - Detection tuning knobs
 * @returns Array of `{ language, confidence }` sorted by confidence descending.
 *          `language` uses ISO 639-1 codes (e.g. 'en', 'fr') where possible.
 */
export declare function detectLanguageTrigram(text: string, options?: DetectLanguageOptions): Array<{
    language: string;
    confidence: number;
}>;
/**
 * Get the list of all supported language codes (ISO 639-1 where possible).
 */
export declare function getSupportedLanguages(): string[];
//# sourceMappingURL=trigram-language-profiles.d.ts.map