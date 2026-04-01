/**
 * @fileoverview Citation Verifier — decompose text into claims and verify
 * each claim against sources using cosine similarity.
 *
 * Algorithm:
 * 1. Extract claims (LLM decomposition or sentence splitting fallback)
 * 2. Batch-embed all claims + source contents (one embedding call)
 * 3. Compute cosine similarity matrix: claims × sources
 * 4. Assign per-claim verdict based on best similarity score
 * 5. Optional NLI contradiction check on "supported" claims
 *
 * @module agentos/rag/citation/CitationVerifier
 */
import { cosineSimilarity } from './cosine.js';
const DEFAULT_SUPPORT = 0.6;
const DEFAULT_UNVERIFIABLE = 0.3;
/** Core citation verification engine. */
export class CitationVerifier {
    constructor(config) {
        this.embedFn = config.embedFn;
        this.supportThreshold = config.supportThreshold ?? DEFAULT_SUPPORT;
        this.unverifiableThreshold = config.unverifiableThreshold ?? DEFAULT_UNVERIFIABLE;
        this.nliFn = config.nliFn;
        this.extractClaimsFn = config.extractClaims;
    }
    /** Verify claims in text against provided sources. */
    async verify(text, sources) {
        const claims = this.extractClaimsFn
            ? await this.extractClaimsFn(text)
            : this.sentenceSplit(text);
        if (claims.length === 0)
            return this.emptyResult();
        const allTexts = [...claims, ...sources.map(s => s.content)];
        const allEmbeddings = await this.embedFn(allTexts);
        const claimEmbeddings = allEmbeddings.slice(0, claims.length);
        const sourceEmbeddings = allEmbeddings.slice(claims.length);
        const verdicts = [];
        for (let i = 0; i < claims.length; i++) {
            let bestSim = 0;
            let bestIdx = -1;
            for (let j = 0; j < sources.length; j++) {
                const sim = cosineSimilarity(claimEmbeddings[i], sourceEmbeddings[j]);
                if (sim > bestSim) {
                    bestSim = sim;
                    bestIdx = j;
                }
            }
            let verdict;
            if (bestSim >= this.supportThreshold) {
                verdict = 'supported';
            }
            else if (bestSim < this.unverifiableThreshold) {
                verdict = 'unverifiable';
            }
            else {
                verdict = 'weak';
            }
            if (verdict === 'supported' && this.nliFn && bestIdx >= 0) {
                try {
                    const nli = await this.nliFn(sources[bestIdx].content, claims[i]);
                    if (nli.label === 'contradiction' && nli.score > 0.7) {
                        verdict = 'contradicted';
                    }
                }
                catch { /* NLI failure — keep cosine verdict */ }
            }
            verdicts.push({
                text: claims[i],
                verdict,
                confidence: bestSim,
                sourceIndex: bestIdx >= 0 ? bestIdx : undefined,
                sourceSnippet: bestIdx >= 0 ? sources[bestIdx].content.slice(0, 200) : undefined,
                sourceRef: bestIdx >= 0 ? sources[bestIdx].url : undefined,
            });
        }
        return this.aggregate(verdicts);
    }
    sentenceSplit(text) {
        return text
            .replace(/```[\s\S]*?```/g, '')
            .split(/(?<=[.!?])\s+/)
            .map(s => s.trim())
            .filter(s => s.length > 15)
            .filter(s => !s.startsWith('I think') && !s.startsWith('Maybe') && !s.startsWith('Perhaps'))
            .filter(s => !s.endsWith('?'))
            .filter(s => !s.startsWith('I hope') && !s.startsWith('Let me know') && !s.startsWith('Feel free'));
    }
    aggregate(verdicts) {
        const total = verdicts.length;
        const supported = verdicts.filter(v => v.verdict === 'supported').length;
        const contradicted = verdicts.filter(v => v.verdict === 'contradicted').length;
        const unverifiable = verdicts.filter(v => v.verdict === 'unverifiable').length;
        const weak = verdicts.filter(v => v.verdict === 'weak').length;
        return {
            claims: verdicts,
            overallGrounded: contradicted === 0,
            supportedRatio: total > 0 ? supported / total : 1,
            totalClaims: total,
            supportedCount: supported,
            contradictedCount: contradicted,
            unverifiableCount: unverifiable,
            weakCount: weak,
            summary: total > 0
                ? `${supported}/${total} claims verified (${Math.round((supported / total) * 100)}%)`
                : 'No verifiable claims found.',
        };
    }
    emptyResult() {
        return {
            claims: [], overallGrounded: true, supportedRatio: 1,
            totalClaims: 0, supportedCount: 0, contradictedCount: 0,
            unverifiableCount: 0, weakCount: 0, summary: 'No verifiable claims found.',
        };
    }
}
//# sourceMappingURL=CitationVerifier.js.map