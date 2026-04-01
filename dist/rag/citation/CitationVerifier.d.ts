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
import type { CitationVerifierConfig, VerifiedResponse, VerificationSource } from './types.js';
/** Core citation verification engine. */
export declare class CitationVerifier {
    private readonly embedFn;
    private readonly supportThreshold;
    private readonly unverifiableThreshold;
    private readonly nliFn?;
    private readonly extractClaimsFn?;
    constructor(config: CitationVerifierConfig);
    /** Verify claims in text against provided sources. */
    verify(text: string, sources: VerificationSource[]): Promise<VerifiedResponse>;
    private sentenceSplit;
    private aggregate;
    private emptyResult;
}
//# sourceMappingURL=CitationVerifier.d.ts.map