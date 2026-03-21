/**
 * @file types.ts
 * @description Core type definitions for the Grounding Guard extension pack.
 *
 * This module defines all shared types, interfaces, and service-identity
 * constants used throughout the grounding verification pipeline.  The
 * grounding guard checks whether factual claims in agent output are
 * supported, contradicted, or unverifiable against retrieved source
 * chunks (RAG context).
 *
 * Architecture overview
 * ---------------------
 * ```
 * ClaimExtractor  ──→  ExtractedClaim[]
 *                              │
 *                              ▼
 * GroundingChecker  ──→  ClaimVerification[]
 *                              │
 *                              ▼
 *                       GroundingResult  ──→  guardrail decision
 * ```
 *
 * @module agentos/extensions/packs/grounding-guard/types
 */

// ---------------------------------------------------------------------------
// Verdict type
// ---------------------------------------------------------------------------

/**
 * The grounding verdict assigned to a single extracted claim after NLI
 * (Natural Language Inference) evaluation against retrieved source chunks.
 *
 * - `'supported'`    — At least one source chunk entails the claim above the
 *                      configured entailment threshold.
 * - `'contradicted'` — At least one source chunk contradicts the claim above
 *                      the configured contradiction threshold.
 * - `'unverifiable'` — No source chunk meets either threshold and (if
 *                      configured) the LLM escalation also could not
 *                      definitively verify the claim.
 */
export type GroundingVerdict = 'supported' | 'contradicted' | 'unverifiable';

// ---------------------------------------------------------------------------
// ExtractedClaim
// ---------------------------------------------------------------------------

/**
 * A single factual claim extracted from an agent output string.
 *
 * Claims are produced by {@link ClaimExtractor} and consumed by
 * {@link GroundingChecker}.  Each claim carries the original text
 * of the statement and metadata about how it was produced.
 */
export interface ExtractedClaim {
  /**
   * The normalised text of the extracted factual claim.
   *
   * When `decomposed` is `true` this may differ from any literal substring
   * of the source text (e.g. a restatement produced by an LLM).  When
   * `decomposed` is `false` this is always a substring of the source text
   * (possibly trimmed).
   */
  claim: string;

  /**
   * Character offset (zero-based, UTF-16 code units) at which this claim
   * begins in the original text passed to {@link ClaimExtractor.extract}.
   *
   * For decomposed claims derived from a complex source sentence the offset
   * points to the start of that source sentence, not any exact position of
   * the decomposed text.
   */
  sourceOffset: number;

  /**
   * Whether this claim was produced by LLM-based sentence decomposition.
   *
   * - `true`  — the claim was synthesised by the LLM from a longer, complex
   *             sentence that contained multiple atomic assertions.
   * - `false` — the claim is a verbatim (trimmed) sentence from the source.
   */
  decomposed: boolean;
}

// ---------------------------------------------------------------------------
// ClaimVerification
// ---------------------------------------------------------------------------

/**
 * Verification result for a single {@link ExtractedClaim}.
 *
 * Produced by {@link GroundingChecker.checkClaim} after running the claim
 * through the NLI pipeline (and optionally an LLM escalation step).
 */
export interface ClaimVerification {
  /**
   * The claim text that was verified.
   * Copied from {@link ExtractedClaim.claim} for self-contained reporting.
   */
  claim: string;

  /**
   * The verdict assigned by the NLI pipeline (and optional LLM escalation).
   */
  verdict: GroundingVerdict;

  /**
   * Confidence value in the range [0, 1] associated with the verdict.
   *
   * For `'supported'`    this is the highest entailment score across all
   *                       source chunks evaluated.
   * For `'contradicted'` this is the highest contradiction score across all
   *                       source chunks evaluated.
   * For `'unverifiable'` this is `0` (no strong signal in either direction).
   */
  confidence: number;

  /**
   * The source chunk that produced the strongest signal (highest entailment
   * or contradiction score).
   *
   * `null` when no sources were provided or the NLI pipeline was unavailable.
   */
  bestSource: {
    /** Unique chunk identifier from the vector store. */
    chunkId: string;
    /** The raw text content of the source chunk. */
    content: string;
    /** The relevance / NLI score that ranked this chunk as best. */
    score: number;
  } | null;

  /**
   * Whether this claim was escalated to LLM reasoning because the NLI
   * model did not produce a confident verdict above either threshold.
   *
   * When `true`, the `verdict` and `confidence` were determined by the LLM
   * chain-of-thought prompt rather than directly by the NLI pipeline.
   */
  escalated: boolean;

  /**
   * Optional free-text explanation of the verdict.
   *
   * Populated when:
   * - `escalated` is `true` (the LLM's reasoning narrative)
   * - The NLI pipeline is unavailable and a static explanation is provided
   *
   * `undefined` for straightforward NLI verdicts.
   */
  reasoning?: string;
}

// ---------------------------------------------------------------------------
// GroundingResult
// ---------------------------------------------------------------------------

/**
 * Aggregated grounding result for a complete agent output string.
 *
 * Returned by the top-level grounding guardrail after extracting and
 * verifying every claim in the output.
 */
export interface GroundingResult {
  /**
   * High-level pass/fail flag.
   *
   * `true`  when `contradictedCount === 0` AND
   *         `unverifiableRatio <= options.maxUnverifiableRatio`.
   * `false` otherwise.
   */
  grounded: boolean;

  /**
   * Per-claim verification results, one entry per item from the
   * {@link ExtractedClaim} array produced by {@link ClaimExtractor}.
   */
  claims: ClaimVerification[];

  /** Total number of claims extracted from the output. */
  totalClaims: number;

  /** Number of claims with verdict `'supported'`. */
  supportedCount: number;

  /** Number of claims with verdict `'contradicted'`. */
  contradictedCount: number;

  /** Number of claims with verdict `'unverifiable'`. */
  unverifiableCount: number;

  /**
   * Ratio of unverifiable claims to total claims in the range [0, 1].
   * Computed as `unverifiableCount / totalClaims` (or `0` when there are
   * no claims).
   */
  unverifiableRatio: number;

  /**
   * Human-readable one-line summary suitable for logging and observability
   * dashboards.
   *
   * @example
   * `"3/5 claims supported, 0 contradicted, 2 unverifiable (ratio 0.40)"`
   */
  summary: string;
}

// ---------------------------------------------------------------------------
// GroundingGuardOptions
// ---------------------------------------------------------------------------

/**
 * Top-level configuration object passed to `createGroundingGuardPack()`.
 *
 * All fields are optional; sensible defaults are documented per-field.  A
 * zero-config setup will use `cross-encoder/nli-deberta-v3-small` with
 * standard thresholds and flag (rather than block) any problematic output.
 */
export interface GroundingGuardOptions {
  /**
   * Hugging Face model identifier for the NLI (Natural Language Inference)
   * pipeline used to classify claim–source pairs as entailment / neutral /
   * contradiction.
   *
   * Must be a `text-classification` model that emits labels matching the
   * pattern `ENTAILMENT` and `CONTRADICTION` (case-insensitive).
   *
   * @default 'cross-encoder/nli-deberta-v3-small'
   */
  nliModelId?: string;

  /**
   * Minimum entailment score (inclusive) required to mark a claim as
   * `'supported'`.  Must be in the range [0, 1].
   *
   * @default 0.7
   */
  entailmentThreshold?: number;

  /**
   * Minimum contradiction score (inclusive) required to mark a claim as
   * `'contradicted'`.  Must be in the range [0, 1].
   *
   * @default 0.7
   */
  contradictionThreshold?: number;

  /**
   * Maximum fraction of claims that may be `'unverifiable'` before the
   * overall {@link GroundingResult.grounded} flag is set to `false`.
   * Must be in the range [0, 1].
   *
   * @default 0.5
   */
  maxUnverifiableRatio?: number;

  /**
   * Guardrail action taken when one or more claims are `'contradicted'`.
   *
   * - `'flag'`  — annotate the output and pass it through (default).
   * - `'block'` — halt delivery of the agent response.
   *
   * @default 'flag'
   */
  contradictionAction?: 'flag' | 'block';

  /**
   * Guardrail action taken when the unverifiable ratio exceeds
   * {@link maxUnverifiableRatio}.
   *
   * - `'flag'`  — annotate the output and pass it through (default).
   * - `'block'` — halt delivery of the agent response.
   *
   * @default 'flag'
   */
  unverifiableAction?: 'flag' | 'block';

  /**
   * Optional LLM callable used for two purposes:
   *
   * 1. **Claim decomposition** — breaking complex sentences (>20 words or
   *    containing multiple conjunctions) into atomic sub-claims.
   * 2. **NLI escalation** — applying chain-of-thought reasoning when the
   *    NLI model does not exceed either threshold for a given claim.
   *
   * When omitted, complex sentences are passed through as single claims and
   * ambiguous NLI results are always classified as `'unverifiable'`.
   *
   * @param prompt - The full prompt string to send to the LLM.
   * @returns A promise resolving to the raw LLM response text.
   */
  llm?: (prompt: string) => Promise<string>;

  /**
   * Maximum number of source chunks evaluated per claim.
   * The top-N chunks (by relevance score) are used.  Higher values improve
   * recall but increase NLI inference cost.
   *
   * @default 5
   */
  maxSourcesPerClaim?: number;

  /**
   * When `true`, the guardrail hook also verifies individual streaming
   * chunks (SSE deltas) as they arrive, not only the fully-assembled message.
   *
   * @default true
   */
  enableStreamingChecks?: boolean;

  /**
   * Use 8-bit quantised NLI model variants when available.
   * Reduces memory footprint at a small accuracy cost.
   *
   * @default true
   */
  quantized?: boolean;

  /**
   * Determines which agent messages are evaluated by the guardrail hook.
   *
   * - `'input'`  — only inbound user messages
   * - `'output'` — only outbound assistant messages
   * - `'both'`   — evaluate at both stages
   *
   * @default 'output'
   */
  guardrailScope?: 'input' | 'output' | 'both';
}

// ---------------------------------------------------------------------------
// Service identity constants
// ---------------------------------------------------------------------------

/**
 * Stable string identifiers for every injectable service provided by the
 * grounding guard pack.
 *
 * Values follow the AgentOS convention: `agentos:<domain>:<service-name>`.
 * These constants are used as keys in the {@link ISharedServiceRegistry}
 * so that components can locate pack services without importing concrete
 * implementations.
 *
 * @example
 * ```ts
 * const nli = await registry.getOrCreate(GROUNDING_SERVICE_IDS.NLI_PIPELINE, factory);
 * ```
 */
export const GROUNDING_SERVICE_IDS = {
  /**
   * The HuggingFace `text-classification` pipeline instance used for
   * Natural Language Inference (NLI) — evaluating whether a source chunk
   * entails or contradicts a claim.
   *
   * The instance stored under this key is a callable that accepts
   * `{ text, text_pair }` and returns `[{ label, score }]`.
   */
  NLI_PIPELINE: 'agentos:grounding:nli-pipeline',
} as const;

/**
 * Union of all {@link GROUNDING_SERVICE_IDS} values — useful for
 * type-narrowing in registry look-ups.
 */
export type GroundingServiceId =
  (typeof GROUNDING_SERVICE_IDS)[keyof typeof GROUNDING_SERVICE_IDS];
