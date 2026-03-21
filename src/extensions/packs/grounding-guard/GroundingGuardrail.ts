/**
 * @file GroundingGuardrail.ts
 * @description Guardrail service that verifies agent output is grounded in RAG
 * source chunks.  Operates at two levels:
 *
 * 1. **Streaming (TEXT_DELTA)** -- sentence-boundary buffering with a fast
 *    first-pass NLI check on individual sentences as they arrive.  Catches
 *    contradictions in near real-time.
 *
 * 2. **Final (FINAL_RESPONSE / isFinal)** -- comprehensive extraction of ALL
 *    claims via {@link ClaimExtractor} followed by batch verification via
 *    {@link GroundingChecker}.  Produces aggregate statistics and per-claim
 *    metadata.
 *
 * ### Sentence-boundary buffering
 *
 * During streaming, text deltas are accumulated in a per-stream buffer.  When
 * a sentence boundary is detected (`. `, `? `, `! `, or `\n`), the completed
 * sentence is extracted, filtered through the same heuristics as
 * {@link ClaimExtractor} (skip questions, hedges, meta), and -- if factual --
 * verified against the top-5 RAG sources via NLI.
 *
 * A stale-stream pruning pass runs whenever the buffer map exceeds 100
 * entries, removing any stream that has not received a delta in 60 seconds.
 *
 * ### Reason codes
 *
 * - `GROUNDING_CONTRADICTION` -- at least one claim is contradicted by sources.
 * - `GROUNDING_UNVERIFIABLE` -- the ratio of unverifiable claims exceeds the
 *   configured {@link GroundingGuardOptions.maxUnverifiableRatio}.
 *
 * @module agentos/extensions/packs/grounding-guard/GroundingGuardrail
 */

import type { ISharedServiceRegistry } from '../../ISharedServiceRegistry';
import type {
  IGuardrailService,
  GuardrailConfig,
  GuardrailInputPayload,
  GuardrailOutputPayload,
  GuardrailEvaluationResult,
} from '../../../core/guardrails/IGuardrailService';
import { GuardrailAction } from '../../../core/guardrails/IGuardrailService';
import { AgentOSResponseChunkType } from '../../../api/types/AgentOSResponse';
import type { AgentOSTextDeltaChunk, AgentOSFinalResponseChunk } from '../../../api/types/AgentOSResponse';
import type { RagRetrievedChunk } from '../../../rag/IRetrievalAugmentor';
import type { GroundingGuardOptions, GroundingResult, ClaimVerification } from './types';
import { ClaimExtractor } from './ClaimExtractor';
import { GroundingChecker } from './GroundingChecker';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Maximum number of stream buffers before triggering stale-stream pruning.
 * Prevents unbounded memory growth from leaked / abandoned streams.
 */
const PRUNE_THRESHOLD = 100;

/**
 * Maximum age (in milliseconds) for a stream buffer entry before it is
 * considered stale and eligible for pruning.  60 seconds.
 */
const STALE_MS = 60_000;

/**
 * Sentence-boundary regex used to split accumulated buffer text into
 * individual sentences.  Matches sentence-ending punctuation followed by a
 * space or a newline character.
 */
const SENTENCE_BOUNDARY_RE = /(?<=[.?!])\s|\n/;

/**
 * Prefixes (lower-cased) that identify hedging / uncertain statements.
 * Mirrors the same filter set used by {@link ClaimExtractor}.
 */
const HEDGE_PREFIXES: readonly string[] = [
  'i think',
  'maybe',
  'perhaps',
  'it seems',
  'i believe',
];

/**
 * Substrings (lower-cased) indicating meta / conversational filler.
 */
const META_SUBSTRINGS: readonly string[] = [
  'i hope this helps',
  'let me know',
  'feel free',
  "here's",
  'heres',
];

/**
 * Prefixes (lower-cased) identifying greetings and acknowledgements.
 */
const GREETING_PREFIXES: readonly string[] = [
  'hello',
  'hi there',
  'sure!',
  'great question',
  'of course',
];

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/**
 * Per-stream buffer state tracked during streaming evaluation.
 */
interface StreamBufferEntry {
  /** Accumulated text from TEXT_DELTA chunks for this stream. */
  buffer: string;
  /** Timestamp of the last delta received (ms since epoch). */
  lastSeenAt: number;
}

// ---------------------------------------------------------------------------
// GroundingGuardrail
// ---------------------------------------------------------------------------

/**
 * Guardrail service that checks whether factual claims in agent output are
 * supported by RAG-retrieved source documents.
 *
 * Implements {@link IGuardrailService} with:
 * - `evaluateStreamingChunks: true` (enabled by default)
 * - `canSanitize: false` (grounding does not modify content)
 *
 * @example
 * ```typescript
 * const guardrail = new GroundingGuardrail(registry, {
 *   contradictionAction: 'block',
 *   maxUnverifiableRatio: 0.3,
 * });
 * ```
 */
export class GroundingGuardrail implements IGuardrailService {
  // -------------------------------------------------------------------------
  // IGuardrailService config
  // -------------------------------------------------------------------------

  /**
   * Guardrail configuration exposed to the extension manager.
   *
   * - `evaluateStreamingChunks: true` -- we need to see TEXT_DELTA chunks for
   *   sentence-boundary buffering and real-time contradiction detection.
   * - `canSanitize: false` -- grounding never modifies the response text; it
   *   only FLAGs or BLOCKs.
   */
  readonly config: GuardrailConfig = {
    evaluateStreamingChunks: true,
    canSanitize: false,
  };

  // -------------------------------------------------------------------------
  // Private state
  // -------------------------------------------------------------------------

  /** Per-stream sentence buffer for streaming evaluation. */
  private readonly streamBuffers = new Map<string, StreamBufferEntry>();

  /** Shared service registry for NLI pipeline access. */
  private readonly services: ISharedServiceRegistry;

  /** Resolved pack-level options. */
  private readonly options: GroundingGuardOptions;

  /** Claim extractor for the comprehensive final-pass check. */
  private readonly extractor: ClaimExtractor;

  /** Grounding checker that runs NLI (+ optional LLM escalation). */
  private readonly checker: GroundingChecker;

  /** Resolved contradiction action (default: 'flag'). */
  private readonly contradictionAction: 'flag' | 'block';

  /** Resolved unverifiable action (default: 'flag'). */
  private readonly unverifiableAction: 'flag' | 'block';

  /** Resolved max unverifiable ratio (default: 0.5). */
  private readonly maxUnverifiableRatio: number;

  /** Whether streaming NLI checks are enabled (default: true). */
  private readonly enableStreamingChecks: boolean;

  /** Max sources per claim for streaming fast-pass (default: 5). */
  private readonly maxSourcesPerClaim: number;

  // -------------------------------------------------------------------------
  // Constructor
  // -------------------------------------------------------------------------

  /**
   * Construct a new GroundingGuardrail.
   *
   * @param services     - Shared service registry for NLI pipeline access.
   * @param options      - Pack-level configuration options.
   * @param embeddingFn  - Optional override embedding function (reserved for
   *                       future use; currently unused).
   */
  constructor(
    services: ISharedServiceRegistry,
    options: GroundingGuardOptions,
    embeddingFn?: (text: string) => Promise<number[]>,
  ) {
    this.services = services;
    this.options = options;

    // Resolve option defaults.
    this.contradictionAction = options.contradictionAction ?? 'flag';
    this.unverifiableAction = options.unverifiableAction ?? 'flag';
    this.maxUnverifiableRatio = options.maxUnverifiableRatio ?? 0.5;
    this.enableStreamingChecks = options.enableStreamingChecks !== false;
    this.maxSourcesPerClaim = options.maxSourcesPerClaim ?? 5;

    // Build internal components using the same LLM function (if provided).
    this.extractor = new ClaimExtractor(options.llm);
    this.checker = new GroundingChecker(services, {
      nliModelId: options.nliModelId,
      entailmentThreshold: options.entailmentThreshold,
      contradictionThreshold: options.contradictionThreshold,
      llmFn: options.llm,
      maxSourcesPerClaim: options.maxSourcesPerClaim,
      quantized: options.quantized,
    });
  }

  // -------------------------------------------------------------------------
  // IGuardrailService — evaluateInput
  // -------------------------------------------------------------------------

  /**
   * Evaluate user input before orchestration.
   *
   * Grounding verification is an output-only concern (it checks whether the
   * agent's *response* is faithful to sources).  User input is always allowed
   * through unchanged.
   *
   * @param _payload - Input payload (ignored).
   * @returns Always `null` (allow).
   */
  async evaluateInput(_payload: GuardrailInputPayload): Promise<GuardrailEvaluationResult | null> {
    // Grounding is output-only — always pass input through.
    return null;
  }

  // -------------------------------------------------------------------------
  // IGuardrailService — evaluateOutput
  // -------------------------------------------------------------------------

  /**
   * Evaluate agent output for grounding against RAG source chunks.
   *
   * Dispatches to either the streaming handler (TEXT_DELTA) or the
   * comprehensive final-pass handler (FINAL_RESPONSE / isFinal) based on the
   * chunk type.
   *
   * Returns `null` when:
   * - The guardrail scope is `'input'` (output evaluation disabled).
   * - No `ragSources` are available (cannot ground without sources).
   * - The chunk type is not TEXT_DELTA or a final chunk.
   *
   * @param payload - Output evaluation payload from the guardrail pipeline.
   * @returns Evaluation result or `null` to allow without action.
   */
  async evaluateOutput(payload: GuardrailOutputPayload): Promise<GuardrailEvaluationResult | null> {
    const { chunk, ragSources } = payload;

    // If scope is input-only, skip output evaluation entirely.
    if (this.options.guardrailScope === 'input') {
      return null;
    }

    // Cannot ground without RAG sources — pass through silently.
    if (!ragSources || ragSources.length === 0) {
      return null;
    }

    // Dispatch based on chunk type.
    if (chunk.type === AgentOSResponseChunkType.TEXT_DELTA) {
      return this.handleTextDelta(chunk as AgentOSTextDeltaChunk, ragSources);
    }

    // Handle final response — either explicit FINAL_RESPONSE type or isFinal flag.
    if (chunk.type === AgentOSResponseChunkType.FINAL_RESPONSE || chunk.isFinal) {
      return this.handleFinal(chunk, ragSources);
    }

    // Other chunk types (SYSTEM_PROGRESS, TOOL_CALL, etc.) — pass through.
    return null;
  }

  // -------------------------------------------------------------------------
  // Public cleanup API
  // -------------------------------------------------------------------------

  /**
   * Clear all per-stream sentence buffers.
   *
   * Called by the pack's `onDeactivate` hook to release memory when the
   * extension is unloaded.  Idempotent — safe to call multiple times.
   */
  public clearBuffers(): void {
    this.streamBuffers.clear();
  }

  // -------------------------------------------------------------------------
  // Streaming TEXT_DELTA handler
  // -------------------------------------------------------------------------

  /**
   * Handle a TEXT_DELTA streaming chunk.
   *
   * Appends the text delta to the per-stream sentence buffer.  When a
   * sentence boundary is detected, the completed sentence is extracted and
   * evaluated for grounding if it passes the factual-claim filter.
   *
   * @param chunk      - The TEXT_DELTA chunk from the streaming pipeline.
   * @param ragSources - RAG source chunks for grounding verification.
   * @returns FLAG result if a contradiction is detected, or `null` to allow.
   */
  private async handleTextDelta(
    chunk: AgentOSTextDeltaChunk,
    ragSources: RagRetrievedChunk[],
  ): Promise<GuardrailEvaluationResult | null> {
    const streamId = chunk.streamId;
    const textDelta = chunk.textDelta ?? '';

    // Lazy-prune stale stream buffers to prevent unbounded growth.
    if (this.streamBuffers.size > PRUNE_THRESHOLD) {
      this.pruneStaleBuffers();
    }

    // Get or create the buffer entry for this stream.
    let entry = this.streamBuffers.get(streamId);
    if (!entry) {
      entry = { buffer: '', lastSeenAt: Date.now() };
      this.streamBuffers.set(streamId, entry);
    }

    // Append the new delta to the buffer.
    entry.buffer += textDelta;
    entry.lastSeenAt = Date.now();

    // Check for sentence boundaries in the accumulated buffer.
    const sentenceBoundaryIdx = this.findSentenceBoundary(entry.buffer);
    if (sentenceBoundaryIdx === -1) {
      // No complete sentence yet — pass through.
      return null;
    }

    // Extract the completed sentence and advance the buffer.
    const completedSentence = entry.buffer.substring(0, sentenceBoundaryIdx).trim();
    entry.buffer = entry.buffer.substring(sentenceBoundaryIdx).trimStart();

    // Skip empty sentences.
    if (completedSentence.length === 0) {
      return null;
    }

    // Apply the same factual-claim filter used by ClaimExtractor.
    if (!this.isFactualClaim(completedSentence)) {
      return null;
    }

    // If streaming NLI checks are disabled, pass through without checking.
    if (!this.enableStreamingChecks) {
      return null;
    }

    // Select top-N sources by relevance for the streaming fast-pass.
    const topSources = [...ragSources]
      .sort((a, b) => (b.relevanceScore ?? 1.0) - (a.relevanceScore ?? 1.0))
      .slice(0, this.maxSourcesPerClaim);

    // Run NLI check on the single sentence.
    let verification: ClaimVerification;
    try {
      verification = await this.checker.checkClaim(completedSentence, topSources);
    } catch {
      // NLI failure — degrade gracefully, let the sentence pass.
      return null;
    }

    // If the sentence is contradicted, flag or block immediately.
    if (verification.verdict === 'contradicted') {
      const action = this.contradictionAction === 'block'
        ? GuardrailAction.BLOCK
        : GuardrailAction.FLAG;

      return {
        action,
        reason: `Claim contradicted by sources: "${completedSentence}"`,
        reasonCode: 'GROUNDING_CONTRADICTION',
        metadata: {
          claim: completedSentence,
          verdict: verification.verdict,
          confidence: verification.confidence,
          bestSource: verification.bestSource,
          streamId,
          phase: 'streaming',
        },
      };
    }

    // Supported or unverifiable — pass through during streaming.
    return null;
  }

  // -------------------------------------------------------------------------
  // Final response handler
  // -------------------------------------------------------------------------

  /**
   * Handle a final response chunk (FINAL_RESPONSE or isFinal=true).
   *
   * Performs the comprehensive grounding check:
   * 1. Flush any remaining buffered text for this stream.
   * 2. Extract the full response text from the chunk.
   * 3. Extract ALL claims via {@link ClaimExtractor}.
   * 4. Verify ALL claims via {@link GroundingChecker.checkClaims}.
   * 5. Aggregate results and determine the guardrail action.
   *
   * @param chunk      - The final response chunk.
   * @param ragSources - RAG source chunks for grounding verification.
   * @returns Evaluation result with aggregate statistics, or `null` to allow.
   */
  private async handleFinal(
    chunk: { streamId: string; type: string; isFinal: boolean;
      [key: string]: unknown },
    ragSources: RagRetrievedChunk[],
  ): Promise<GuardrailEvaluationResult | null> {
    const streamId = chunk.streamId;

    // Flush the remaining buffer for this stream (if any).
    const bufferEntry = this.streamBuffers.get(streamId);
    const remainingBuffer = bufferEntry?.buffer ?? '';
    this.streamBuffers.delete(streamId);

    // Extract the full response text.
    // For FINAL_RESPONSE chunks, use finalResponseText.
    // For isFinal TEXT_DELTA chunks, use the accumulated buffer.
    let fullText: string;
    if (chunk.type === AgentOSResponseChunkType.FINAL_RESPONSE) {
      fullText = (chunk as unknown as AgentOSFinalResponseChunk).finalResponseText ?? '';
    } else {
      // isFinal TEXT_DELTA — the full text is whatever was accumulated.
      fullText = remainingBuffer + ((chunk as any).textDelta ?? '');
    }

    // If there is no text to check, pass through.
    if (!fullText || fullText.trim().length === 0) {
      return null;
    }

    // Phase 1: Extract all claims from the full response.
    let claims;
    try {
      claims = await this.extractor.extract(fullText);
    } catch {
      // Extraction failure — degrade gracefully.
      return null;
    }

    // No claims extracted — nothing to verify.
    if (claims.length === 0) {
      return null;
    }

    // Phase 2: Verify all claims against RAG sources.
    let verifications: ClaimVerification[];
    try {
      verifications = await this.checker.checkClaims(claims, ragSources);
    } catch {
      // Verification failure — degrade gracefully.
      return null;
    }

    // Phase 3: Aggregate results into a GroundingResult.
    const result = this.aggregateResults(verifications);

    // Phase 4: Determine guardrail action based on aggregate.
    if (result.contradictedCount > 0) {
      const action = this.contradictionAction === 'block'
        ? GuardrailAction.BLOCK
        : GuardrailAction.FLAG;

      return {
        action,
        reason: `${result.contradictedCount} claim(s) contradicted by sources`,
        reasonCode: 'GROUNDING_CONTRADICTION',
        metadata: {
          groundingResult: result,
          phase: 'final',
          streamId,
        },
      };
    }

    if (result.unverifiableRatio > this.maxUnverifiableRatio) {
      const action = this.unverifiableAction === 'block'
        ? GuardrailAction.BLOCK
        : GuardrailAction.FLAG;

      return {
        action,
        reason: `Unverifiable ratio ${result.unverifiableRatio.toFixed(2)} exceeds threshold ${this.maxUnverifiableRatio}`,
        reasonCode: 'GROUNDING_UNVERIFIABLE',
        metadata: {
          groundingResult: result,
          phase: 'final',
          streamId,
        },
      };
    }

    // All claims are grounded — pass through.
    return null;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Find the index of the first sentence boundary in `text`.
   *
   * A sentence boundary is defined as sentence-ending punctuation (`.`, `?`,
   * `!`) followed by a whitespace character, or a newline.
   *
   * @param text - The buffer text to scan.
   * @returns The index after the sentence boundary, or -1 if none found.
   */
  private findSentenceBoundary(text: string): number {
    // Look for `. `, `? `, `! `, or `\n`.
    const match = text.match(/[.?!]\s|\n/);
    if (!match || match.index === undefined) {
      return -1;
    }
    // Return the position AFTER the boundary (include the punctuation,
    // exclude the trailing whitespace).
    return match.index + match[0].length;
  }

  /**
   * Determine whether a sentence is a factual claim eligible for NLI
   * verification.
   *
   * Applies the same filters as {@link ClaimExtractor.isFactual}:
   * - Skip questions (end with `?`)
   * - Skip hedging statements
   * - Skip meta / conversational filler
   * - Skip greetings and acknowledgements
   *
   * @param sentence - Trimmed sentence text.
   * @returns `true` if the sentence should be verified.
   */
  private isFactualClaim(sentence: string): boolean {
    const lower = sentence.toLowerCase();

    // Questions are not factual claims.
    if (sentence.endsWith('?')) {
      return false;
    }

    // Hedging statements — uncertain, not verifiable.
    for (const hedge of HEDGE_PREFIXES) {
      if (lower.startsWith(hedge)) {
        return false;
      }
    }

    // Meta / conversational filler.
    for (const meta of META_SUBSTRINGS) {
      if (lower.includes(meta)) {
        return false;
      }
    }

    // Greetings and acknowledgements.
    for (const greeting of GREETING_PREFIXES) {
      if (lower.startsWith(greeting)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Prune stream buffer entries that have not received a delta within
   * {@link STALE_MS} milliseconds.
   *
   * Called lazily when the buffer map exceeds {@link PRUNE_THRESHOLD} entries
   * to prevent unbounded memory growth from abandoned streams.
   */
  private pruneStaleBuffers(): void {
    const now = Date.now();
    for (const [streamId, entry] of this.streamBuffers) {
      if (now - entry.lastSeenAt > STALE_MS) {
        this.streamBuffers.delete(streamId);
      }
    }
  }

  /**
   * Aggregate an array of per-claim verifications into a single
   * {@link GroundingResult}.
   *
   * Computes counts for each verdict type, the unverifiable ratio, and the
   * top-level grounded flag.
   *
   * @param verifications - Per-claim verification results from
   *                        {@link GroundingChecker.checkClaims}.
   * @returns Aggregated grounding result.
   */
  private aggregateResults(verifications: ClaimVerification[]): GroundingResult {
    const totalClaims = verifications.length;

    // Count verdicts.
    let supportedCount = 0;
    let contradictedCount = 0;
    let unverifiableCount = 0;

    for (const v of verifications) {
      switch (v.verdict) {
        case 'supported':
          supportedCount++;
          break;
        case 'contradicted':
          contradictedCount++;
          break;
        case 'unverifiable':
          unverifiableCount++;
          break;
      }
    }

    // Compute ratio (guard against division by zero).
    const unverifiableRatio = totalClaims > 0 ? unverifiableCount / totalClaims : 0;

    // Determine top-level grounded flag.
    const grounded =
      contradictedCount === 0 && unverifiableRatio <= this.maxUnverifiableRatio;

    // Build human-readable summary.
    const summary = [
      `${supportedCount}/${totalClaims} claims supported`,
      `${contradictedCount} contradicted`,
      `${unverifiableCount} unverifiable (ratio ${unverifiableRatio.toFixed(2)})`,
    ].join(', ');

    return {
      grounded,
      claims: verifications,
      totalClaims,
      supportedCount,
      contradictedCount,
      unverifiableCount,
      unverifiableRatio,
      summary,
    };
  }
}
