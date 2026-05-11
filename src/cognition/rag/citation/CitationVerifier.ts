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
import type {
  CitationVerifierConfig,
  ClaimVerdict,
  VerifiedResponse,
  VerificationSource,
} from './types.js';

const DEFAULT_SUPPORT = 0.6;
const DEFAULT_UNVERIFIABLE = 0.3;

/** Core citation verification engine. */
export class CitationVerifier {
  private readonly embedFn: CitationVerifierConfig['embedFn'];
  private readonly supportThreshold: number;
  private readonly unverifiableThreshold: number;
  private readonly nliFn?: CitationVerifierConfig['nliFn'];
  private readonly extractClaimsFn?: CitationVerifierConfig['extractClaims'];

  constructor(config: CitationVerifierConfig) {
    this.embedFn = config.embedFn;
    this.supportThreshold = config.supportThreshold ?? DEFAULT_SUPPORT;
    this.unverifiableThreshold = config.unverifiableThreshold ?? DEFAULT_UNVERIFIABLE;
    this.nliFn = config.nliFn;
    this.extractClaimsFn = config.extractClaims;
  }

  /**
   * Verify claims against provided sources.
   *
   * Accepts the input in two shapes:
   *
   * - **`string`** — the raw text the verifier should decompose into atomic
   *   claims before scoring. Uses the configured `extractClaims` callback
   *   (e.g. an LLM-driven decomposer) or the built-in sentence splitter.
   *   Best when the input is one block of LLM-generated prose and you want
   *   the verifier to handle decomposition.
   *
   * - **`string[]`** — a list of pre-decomposed atomic claims, used as-is
   *   without any further extraction. Best when you already broke the prose
   *   into structured claims yourself, when you're verifying claims that
   *   came from a parser other than English sentence splitting, or when
   *   you want to scope verification to a specific subset of claims.
   *
   * Both paths score each claim against each source via cosine similarity
   * and (optionally) NLI contradiction detection, then return a single
   * {@link VerifiedResponse} with per-claim verdicts.
   *
   * @param input   - Either the raw text or a pre-decomposed claim list.
   * @param sources - Sources to score every claim against.
   */
  async verify(
    input: string | string[],
    sources: VerificationSource[],
  ): Promise<VerifiedResponse> {
    const claims = Array.isArray(input)
      ? input
      : await this.extractClaims(input);

    if (claims.length === 0) return this.emptyResult();

    const allTexts = [...claims, ...sources.map(s => s.content)];
    const allEmbeddings = await this.embedFn(allTexts);
    const claimEmbeddings = allEmbeddings.slice(0, claims.length);
    const sourceEmbeddings = allEmbeddings.slice(claims.length);

    const verdicts: ClaimVerdict[] = [];

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

      let verdict: ClaimVerdict['verdict'];
      if (bestSim >= this.supportThreshold) {
        verdict = 'supported';
      } else if (bestSim < this.unverifiableThreshold) {
        verdict = 'unverifiable';
      } else {
        verdict = 'weak';
      }

      if (verdict === 'supported' && this.nliFn && bestIdx >= 0) {
        try {
          const nli = await this.nliFn(sources[bestIdx].content, claims[i]);
          if (nli.label === 'contradiction' && nli.score > 0.7) {
            verdict = 'contradicted';
          }
        } catch { /* NLI failure — keep cosine verdict */ }
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

  /**
   * Decompose raw text into atomic claims using the same logic
   * `verify(text, sources)` uses internally.
   *
   * Uses the constructor's `extractClaims` callback when provided,
   * otherwise falls back to the built-in sentence splitter. Exposed
   * publicly so callers who want to **inspect or filter** the claim
   * list before verification can do so, then hand it back to
   * `verify(claims[], sources)`:
   *
   * ```ts
   * const claims = await verifier.extractClaims(llmText);
   * const filtered = claims.filter((c) => !c.startsWith('I think'));
   * const result = await verifier.verify(filtered, sources);
   * ```
   */
  async extractClaims(text: string): Promise<string[]> {
    return this.extractClaimsFn
      ? await this.extractClaimsFn(text)
      : this.sentenceSplit(text);
  }

  private sentenceSplit(text: string): string[] {
    return text
      .replace(/```[\s\S]*?```/g, '')
      .split(/(?<=[.!?])\s+/)
      .map(s => s.trim())
      .filter(s => s.length > 15)
      .filter(s => !s.startsWith('I think') && !s.startsWith('Maybe') && !s.startsWith('Perhaps'))
      .filter(s => !s.endsWith('?'))
      .filter(s => !s.startsWith('I hope') && !s.startsWith('Let me know') && !s.startsWith('Feel free'));
  }

  private aggregate(verdicts: ClaimVerdict[]): VerifiedResponse {
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
    };
  }

  private emptyResult(): VerifiedResponse {
    return {
      claims: [], overallGrounded: true, supportedRatio: 1,
      totalClaims: 0, supportedCount: 0, contradictedCount: 0,
      unverifiableCount: 0, weakCount: 0,
    };
  }
}
