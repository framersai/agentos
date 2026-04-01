/**
 * @fileoverview Types for the citation verification pipeline.
 *
 * Used by CitationVerifier (core) and verify_citations tool (extension).
 *
 * @module agentos/rag/citation/types
 */
/** Verdict for a single verified claim. */
export interface ClaimVerdict {
    /** The atomic claim text. */
    text: string;
    /** Verification verdict. */
    verdict: 'supported' | 'contradicted' | 'unverifiable' | 'weak';
    /** Cosine similarity to best-matching source (0-1). */
    confidence: number;
    /** Index of the best-matching source in the input array. */
    sourceIndex?: number;
    /** The matching source fragment (truncated to 200 chars). */
    sourceSnippet?: string;
    /** Source URL or file path. */
    sourceRef?: string;
    /** True if this claim was verified via web search fallback. */
    webVerified?: boolean;
}
/** Aggregated verification result for a text. */
export interface VerifiedResponse {
    /** Per-claim verification results. */
    claims: ClaimVerdict[];
    /** True if no claims are contradicted. */
    overallGrounded: boolean;
    /** Ratio of supported claims to total (0-1). */
    supportedRatio: number;
    /** Total claims extracted. */
    totalClaims: number;
    /** Counts by verdict type. */
    supportedCount: number;
    contradictedCount: number;
    unverifiableCount: number;
    weakCount: number;
    /** Human-readable summary. */
    summary: string;
}
/** A source document for verification. */
export interface VerificationSource {
    /** Source text content. */
    content: string;
    /** Source title or heading. */
    title?: string;
    /** Source URL or file path. */
    url?: string;
}
/** Configuration for CitationVerifier. */
export interface CitationVerifierConfig {
    /** Batch embedding function: texts → embedding vectors. */
    embedFn: (texts: string[]) => Promise<number[][]>;
    /** Cosine similarity threshold for "supported". Default: 0.6 */
    supportThreshold?: number;
    /** Below this threshold, claim is "unverifiable". Default: 0.3 */
    unverifiableThreshold?: number;
    /** Optional NLI function for contradiction detection. */
    nliFn?: (premise: string, hypothesis: string) => Promise<{
        label: 'entailment' | 'contradiction' | 'neutral';
        score: number;
    }>;
    /** Optional claim extractor. Falls back to sentence splitting. */
    extractClaims?: (text: string) => Promise<string[]>;
}
//# sourceMappingURL=types.d.ts.map