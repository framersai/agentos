/**
 * @file GroundingChecker.ts
 * @description Verifies extracted factual claims against RAG source chunks
 * using a Natural Language Inference (NLI) pipeline.
 *
 * Pipeline per claim
 * ------------------
 * 1. Sort source chunks by `relevanceScore` descending; keep top-N.
 * 2. Load the NLI pipeline from the shared service registry (lazy, cached).
 * 3. For each source chunk, call the pipeline with `{ text: claim, text_pair: chunk }`.
 * 4. Find the chunk producing the highest ENTAILMENT score and the chunk
 *    producing the highest CONTRADICTION score.
 * 5. If `bestEntailment >= entailmentThreshold` → verdict `'supported'`.
 * 6. If `bestContradiction >= contradictionThreshold` → verdict `'contradicted'`.
 * 7. If neither threshold is met and an `llmFn` is configured → escalate to
 *    LLM chain-of-thought reasoning.
 * 8. Otherwise → `'unverifiable'`.
 *
 * Graceful degradation
 * --------------------
 * If the NLI pipeline fails to load (e.g. missing ONNX runtime, network error),
 * the checker sets an `unavailable` flag and returns `'unverifiable'` for every
 * subsequent claim rather than throwing.  This ensures the guardrail pipeline
 * degrades gracefully instead of crashing the agent.
 *
 * @module agentos/extensions/packs/grounding-guard/GroundingChecker
 */

import type { ISharedServiceRegistry } from '../../ISharedServiceRegistry';
import type { RagRetrievedChunk } from '../../../rag/IRetrievalAugmentor';
import type { ExtractedClaim, ClaimVerification } from './types';
import { GROUNDING_SERVICE_IDS } from './types';

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/**
 * Raw output shape from the HuggingFace `text-classification` pipeline when
 * called on a text-pair (premise + hypothesis).  NLI models return one entry
 * per label (ENTAILMENT, NEUTRAL, CONTRADICTION).
 */
interface NliLabel {
  /** Label name as returned by the model, e.g. `'ENTAILMENT'`, `'NEUTRAL'`, `'CONTRADICTION'`. */
  label: string;
  /** Confidence score in the range [0, 1]. */
  score: number;
}

/**
 * LLM escalation response shape expected from the chain-of-thought prompt.
 *
 * The LLM is instructed to return this as a JSON object embedded in its
 * response text.
 */
interface LlmEscalationResponse {
  /**
   * The LLM's verdict for the claim.
   * One of `'supported'`, `'contradicted'`, or `'unverifiable'`.
   */
  verdict: 'supported' | 'contradicted' | 'unverifiable';
  /**
   * Confidence in the verdict, in the range [0, 1].
   */
  confidence: number;
  /**
   * Chain-of-thought reasoning narrative.
   */
  reasoning: string;
}

// ---------------------------------------------------------------------------
// GroundingChecker options
// ---------------------------------------------------------------------------

/**
 * Constructor options for {@link GroundingChecker}.
 */
export interface GroundingCheckerOptions {
  /**
   * HuggingFace model ID for the NLI pipeline.
   * @default 'cross-encoder/nli-deberta-v3-small'
   */
  nliModelId?: string;

  /**
   * Minimum entailment score (inclusive) to classify a claim as `'supported'`.
   * @default 0.7
   */
  entailmentThreshold?: number;

  /**
   * Minimum contradiction score (inclusive) to classify a claim as `'contradicted'`.
   * @default 0.7
   */
  contradictionThreshold?: number;

  /**
   * Optional LLM callable for escalating ambiguous claims (where neither
   * entailment nor contradiction score meets its threshold).
   *
   * @param prompt - Full chain-of-thought prompt.
   * @returns Raw LLM response text containing a JSON object with
   *          `{ verdict, confidence, reasoning }`.
   */
  llmFn?: (prompt: string) => Promise<string>;

  /**
   * Maximum number of source chunks evaluated per claim (top-N by relevance).
   * @default 5
   */
  maxSourcesPerClaim?: number;

  /**
   * Use 8-bit quantised NLI model variants when available.
   * @default true
   */
  quantized?: boolean;
}

// ---------------------------------------------------------------------------
// GroundingChecker
// ---------------------------------------------------------------------------

/**
 * Verifies factual claims against RAG-retrieved source chunks using NLI.
 *
 * Instantiate once and reuse across multiple requests.  The NLI pipeline is
 * cached in the {@link ISharedServiceRegistry} so model weights are only
 * loaded once even if multiple `GroundingChecker` instances share the same
 * registry.
 *
 * @example
 * ```typescript
 * const checker = new GroundingChecker(registry, {
 *   entailmentThreshold: 0.75,
 *   llmFn: myLlm,
 * });
 *
 * const verifications = await checker.checkClaims(extractedClaims, ragChunks);
 * await checker.dispose();
 * ```
 */
export class GroundingChecker {
  // -------------------------------------------------------------------------
  // Configuration (resolved with defaults)
  // -------------------------------------------------------------------------

  /** HuggingFace model ID to load as the NLI pipeline. */
  private readonly nliModelId: string;

  /** Entailment score threshold for the `'supported'` verdict. */
  private readonly entailmentThreshold: number;

  /** Contradiction score threshold for the `'contradicted'` verdict. */
  private readonly contradictionThreshold: number;

  /**
   * Optional LLM callable for escalation of ambiguous cases.
   * `undefined` means LLM escalation is disabled.
   */
  private readonly llmFn: ((prompt: string) => Promise<string>) | undefined;

  /** Maximum number of source chunks to evaluate per claim. */
  private readonly maxSourcesPerClaim: number;

  /** Whether to load quantised (8-bit) model weights. */
  private readonly quantized: boolean;

  // -------------------------------------------------------------------------
  // Runtime state
  // -------------------------------------------------------------------------

  /**
   * When `true`, the NLI pipeline failed to load and every subsequent
   * `checkClaim` call returns `'unverifiable'` without retrying the load.
   */
  private unavailable = false;

  // -------------------------------------------------------------------------
  // Constructor
  // -------------------------------------------------------------------------

  /**
   * Create a new GroundingChecker.
   *
   * @param services - Shared service registry used to lazily load and cache
   *   the HuggingFace NLI pipeline instance.
   * @param options  - Optional configuration overrides.
   */
  constructor(
    private readonly services: ISharedServiceRegistry,
    options?: GroundingCheckerOptions,
  ) {
    this.nliModelId = options?.nliModelId ?? 'cross-encoder/nli-deberta-v3-small';
    this.entailmentThreshold = options?.entailmentThreshold ?? 0.7;
    this.contradictionThreshold = options?.contradictionThreshold ?? 0.7;
    this.llmFn = options?.llmFn;
    this.maxSourcesPerClaim = options?.maxSourcesPerClaim ?? 5;
    this.quantized = options?.quantized ?? true;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Verify a single extracted claim against a set of RAG source chunks.
   *
   * Processing steps:
   * 1. Sort `sources` by `relevanceScore` (descending), keep top-N.
   * 2. Lazily load the NLI pipeline from the registry.
   * 3. Run each (claim, chunk) pair through the pipeline.
   * 4. Determine the verdict from the best entailment / contradiction scores.
   * 5. Escalate to LLM if configured and neither threshold is met.
   *
   * @param claim   - The text of the factual claim to verify.
   * @param sources - RAG-retrieved source chunks to check against.
   * @returns A promise resolving to a {@link ClaimVerification}.
   */
  async checkClaim(claim: string, sources: RagRetrievedChunk[]): Promise<ClaimVerification> {
    // Fast-path: if NLI previously failed to load, return unverifiable immediately.
    if (this.unavailable) {
      return this.unverifiableResult(claim, null, false, 'NLI pipeline unavailable');
    }

    // Sort sources by relevance score (highest first) and take top-N.
    const topSources = [...sources]
      .sort((a, b) => (b.relevanceScore ?? 1.0) - (a.relevanceScore ?? 1.0))
      .slice(0, this.maxSourcesPerClaim);

    // Attempt to load (or retrieve cached) NLI pipeline.
    let nliPipeline: (input: { text: string; text_pair: string }) => Promise<NliLabel[]>;
    try {
      nliPipeline = await this.services.getOrCreate(
        GROUNDING_SERVICE_IDS.NLI_PIPELINE,
        async () => {
          // Dynamic import keeps the heavy ONNX / WebAssembly runtime out
          // of the initial bundle.
          const { pipeline } = await import('@huggingface/transformers');
          return pipeline('text-classification', this.nliModelId, {
            quantized: this.quantized,
          });
        },
        {
          /** Release ONNX resources when the registry entry is evicted. */
          dispose: async (p: unknown) => (p as any)?.dispose?.(),
          /** Tags for diagnostics and capability-discovery tooling. */
          tags: ['ml', 'nli', 'grounding', 'onnx'],
        },
      );
    } catch {
      // Mark as permanently unavailable so we don't retry on every call.
      this.unavailable = true;
      return this.unverifiableResult(claim, null, false, 'NLI pipeline failed to load');
    }

    // If there are no source chunks there is nothing to check against.
    if (topSources.length === 0) {
      return this.unverifiableResult(claim, null, false);
    }

    // ---------------------------------------------------------------------------
    // Run NLI for each (claim, source) pair and collect scores.
    // ---------------------------------------------------------------------------

    let bestEntailmentScore = 0;
    let bestContradictionScore = 0;
    let bestEntailmentChunk: RagRetrievedChunk | null = null;
    let bestContradictionChunk: RagRetrievedChunk | null = null;

    for (const chunk of topSources) {
      let labels: NliLabel[];
      try {
        // The NLI pipeline expects `text` = hypothesis (claim) and
        // `text_pair` = premise (source content).
        labels = await nliPipeline({ text: claim, text_pair: chunk.content });
      } catch {
        // If one chunk call fails, skip it and continue with the others.
        continue;
      }

      // Extract entailment and contradiction scores from the label array.
      for (const label of labels) {
        const normalised = label.label.toUpperCase();

        if (normalised === 'ENTAILMENT' && label.score > bestEntailmentScore) {
          bestEntailmentScore = label.score;
          bestEntailmentChunk = chunk;
        }

        if (normalised === 'CONTRADICTION' && label.score > bestContradictionScore) {
          bestContradictionScore = label.score;
          bestContradictionChunk = chunk;
        }
      }
    }

    // ---------------------------------------------------------------------------
    // Apply threshold logic to determine verdict.
    // ---------------------------------------------------------------------------

    if (bestEntailmentScore >= this.entailmentThreshold) {
      // Strong entailment signal — claim is supported.
      return {
        claim,
        verdict: 'supported',
        confidence: bestEntailmentScore,
        bestSource: bestEntailmentChunk
          ? {
              chunkId: bestEntailmentChunk.id,
              content: bestEntailmentChunk.content,
              score: bestEntailmentScore,
            }
          : null,
        escalated: false,
      };
    }

    if (bestContradictionScore >= this.contradictionThreshold) {
      // Strong contradiction signal — claim is contradicted.
      return {
        claim,
        verdict: 'contradicted',
        confidence: bestContradictionScore,
        bestSource: bestContradictionChunk
          ? {
              chunkId: bestContradictionChunk.id,
              content: bestContradictionChunk.content,
              score: bestContradictionScore,
            }
          : null,
        escalated: false,
      };
    }

    // ---------------------------------------------------------------------------
    // Neither threshold met — escalate to LLM if available.
    // ---------------------------------------------------------------------------

    if (this.llmFn) {
      return this.escalateToLlm(claim, topSources, bestEntailmentChunk ?? bestContradictionChunk);
    }

    // No LLM available — return unverifiable.
    return this.unverifiableResult(
      claim,
      bestEntailmentChunk ?? bestContradictionChunk,
      false,
    );
  }

  /**
   * Verify an array of extracted claims against RAG source chunks in parallel.
   *
   * All claims are evaluated concurrently via `Promise.all`.  The order of
   * results matches the order of the input `claims` array.
   *
   * @param claims  - Extracted claims to verify.
   * @param sources - RAG-retrieved source chunks shared across all claims.
   * @returns A promise resolving to an array of {@link ClaimVerification}
   *          results, one per claim, in the same order as `claims`.
   */
  async checkClaims(
    claims: ExtractedClaim[],
    sources: RagRetrievedChunk[],
  ): Promise<ClaimVerification[]> {
    // Run all claim verifications concurrently — they are independent and
    // the NLI pipeline is stateless, so parallelism is safe.
    return Promise.all(claims.map((c) => this.checkClaim(c.claim, sources)));
  }

  /**
   * Release the NLI pipeline from the shared service registry, freeing ONNX /
   * WASM model weights.
   *
   * Idempotent — safe to call multiple times.  Should be called when the
   * owning extension pack is unloaded.
   */
  async dispose(): Promise<void> {
    await this.services.release(GROUNDING_SERVICE_IDS.NLI_PIPELINE);
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Build an `'unverifiable'` {@link ClaimVerification} result.
   *
   * Used as the graceful-degradation path when:
   * - The NLI pipeline is unavailable.
   * - No source chunks were provided.
   * - Neither entailment nor contradiction threshold was met (and no LLM is
   *   configured).
   *
   * @param claim      - The claim text.
   * @param bestChunk  - The most relevant chunk seen (may be `null`).
   * @param escalated  - Whether LLM escalation was attempted.
   * @param reasoning  - Optional explanation string.
   */
  private unverifiableResult(
    claim: string,
    bestChunk: RagRetrievedChunk | null,
    escalated: boolean,
    reasoning?: string,
  ): ClaimVerification {
    return {
      claim,
      verdict: 'unverifiable',
      confidence: 0,
      bestSource: bestChunk
        ? {
            chunkId: bestChunk.id,
            content: bestChunk.content,
            score: bestChunk.relevanceScore ?? 1.0,
          }
        : null,
      escalated,
      reasoning,
    };
  }

  /**
   * Escalate an ambiguous claim to the LLM for chain-of-thought reasoning.
   *
   * Constructs a structured prompt that provides the claim text, relevant
   * source excerpts, and instructions to return a JSON verdict object.  If
   * the LLM response cannot be parsed the method falls back to
   * `'unverifiable'`.
   *
   * @param claim       - The claim text to verify.
   * @param topSources  - Source chunks to include as evidence in the prompt.
   * @param bestChunk   - The best chunk encountered (for `bestSource` in the
   *                      returned result).
   * @returns A promise resolving to a {@link ClaimVerification}.
   */
  private async escalateToLlm(
    claim: string,
    topSources: RagRetrievedChunk[],
    bestChunk: RagRetrievedChunk | null,
  ): Promise<ClaimVerification> {
    if (!this.llmFn) {
      // Guard — should not be reached since callers check this.llmFn first.
      return this.unverifiableResult(claim, bestChunk, false);
    }

    // Build source evidence block for the prompt.
    const evidenceBlock = topSources
      .map((s, i) => `[Source ${i + 1}]: ${s.content}`)
      .join('\n\n');

    const prompt = [
      'You are a fact-checking assistant.',
      'Your task is to determine whether a factual claim is supported or contradicted by the provided sources.',
      '',
      `Claim: "${claim}"`,
      '',
      'Sources:',
      evidenceBlock,
      '',
      'Think step by step, then provide your verdict as a JSON object with this exact shape:',
      '{ "verdict": "supported" | "contradicted" | "unverifiable", "confidence": 0.0–1.0, "reasoning": "<your reasoning>" }',
      '',
      'Return ONLY the JSON object — no surrounding text, markdown fences, or explanation.',
    ].join('\n');

    let raw: string;
    try {
      raw = await this.llmFn(prompt);
    } catch {
      // LLM call failed — fall back to unverifiable.
      return this.unverifiableResult(claim, bestChunk, true, 'LLM escalation failed');
    }

    // Extract the first JSON object from the response.
    const objectMatch = raw.match(/\{[\s\S]*}/);
    if (!objectMatch) {
      return this.unverifiableResult(
        claim,
        bestChunk,
        true,
        'LLM did not return a parseable JSON object',
      );
    }

    let parsed: LlmEscalationResponse;
    try {
      parsed = JSON.parse(objectMatch[0]) as LlmEscalationResponse;
    } catch {
      return this.unverifiableResult(
        claim,
        bestChunk,
        true,
        'LLM response JSON parse failed',
      );
    }

    // Validate that the parsed object has the expected shape.
    const validVerdicts = new Set(['supported', 'contradicted', 'unverifiable']);
    if (!validVerdicts.has(parsed.verdict) || typeof parsed.confidence !== 'number') {
      return this.unverifiableResult(
        claim,
        bestChunk,
        true,
        'LLM returned an invalid verdict shape',
      );
    }

    // Find the source that best represents the LLM's reasoning context.
    // Use the first source as a proxy (it has the highest relevance score).
    const representativeChunk = topSources[0] ?? bestChunk;

    return {
      claim,
      verdict: parsed.verdict,
      confidence: Math.min(1, Math.max(0, parsed.confidence)), // clamp to [0,1]
      bestSource: representativeChunk
        ? {
            chunkId: representativeChunk.id,
            content: representativeChunk.content,
            score: representativeChunk.relevanceScore ?? 1.0,
          }
        : null,
      escalated: true,
      reasoning: parsed.reasoning,
    };
  }
}
