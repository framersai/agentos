/**
 * @module web-search/dedup
 *
 * Semantic deduplication for web search results.
 * Uses TF-IDF cosine similarity to detect near-duplicates across providers.
 * Pure functions, no IO.
 */
import { cosineSimilarity } from '../rag/citation/cosine.js';
import { normalizeUrl } from './fusion.js';
/** Build vocabulary index from all texts. */
export function buildVocabulary(texts) {
    const vocab = new Map();
    for (const text of texts) {
        for (const word of text.toLowerCase().split(/\W+/).filter(Boolean)) {
            if (!vocab.has(word))
                vocab.set(word, vocab.size);
        }
    }
    return vocab;
}
/** Build a TF vector normalized by document length. */
export function buildTfVector(text, vocabulary) {
    const words = text.toLowerCase().split(/\W+/).filter(Boolean);
    const vec = new Array(vocabulary.size).fill(0);
    for (const w of words) {
        const idx = vocabulary.get(w);
        if (idx !== undefined)
            vec[idx]++;
    }
    const len = words.length || 1;
    return vec.map((v) => v / len);
}
/**
 * Merge a source candidate into a target candidate.
 * Combines provider ranks and keeps the richest content.
 */
function mergeCandidates(target, source) {
    for (const [prov, rank] of source.providerRanks) {
        if (!target.providerRanks.has(prov)) {
            target.providerRanks.set(prov, rank);
            target.providerSources.push(prov);
        }
    }
    if (source.content && !target.content) {
        target.content = source.content;
    }
    if (source.relevanceScore &&
        (!target.relevanceScore || source.relevanceScore > target.relevanceScore)) {
        target.relevanceScore = source.relevanceScore;
    }
}
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
export function semanticDedup(candidates, threshold = 0.85) {
    if (candidates.length <= 1)
        return candidates;
    // Pass 1: merge by normalized URL
    const urlMap = new Map();
    for (const c of candidates) {
        const normUrl = c.normalizedUrl || normalizeUrl(c.url);
        const existing = urlMap.get(normUrl);
        if (existing) {
            mergeCandidates(existing, c);
        }
        else {
            urlMap.set(normUrl, { ...c, normalizedUrl: normUrl });
        }
    }
    const urlDeduped = Array.from(urlMap.values());
    if (urlDeduped.length <= 1)
        return urlDeduped;
    // Pass 2: semantic similarity on snippets
    const snippets = urlDeduped.map((c) => c.snippet);
    const vocab = buildVocabulary(snippets);
    if (vocab.size === 0)
        return urlDeduped;
    const vectors = snippets.map((s) => buildTfVector(s, vocab));
    const merged = new Set();
    const result = [];
    for (let i = 0; i < urlDeduped.length; i++) {
        if (merged.has(i))
            continue;
        const current = urlDeduped[i];
        for (let j = i + 1; j < urlDeduped.length; j++) {
            if (merged.has(j))
                continue;
            const sim = cosineSimilarity(vectors[i], vectors[j]);
            if (sim >= threshold) {
                mergeCandidates(current, urlDeduped[j]);
                merged.add(j);
            }
        }
        result.push(current);
    }
    return result;
}
//# sourceMappingURL=dedup.js.map