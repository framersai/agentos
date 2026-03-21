/**
 * @file CheckGroundingTool.ts
 * @description On-demand grounding verification tool that allows agents and
 * workflows to explicitly check whether claims in a given text are supported
 * by a set of source documents.
 *
 * Unlike the {@link GroundingGuardrail} (which runs automatically in the
 * guardrail pipeline), this tool is invoked explicitly via a tool call,
 * enabling agents to self-verify their own output or check external content
 * before presenting it to the user.
 *
 * ### Pipeline
 * 1. Wrap plain-string sources as synthetic {@link RagRetrievedChunk} objects
 *    with `relevanceScore: 1.0` (since the caller explicitly selected them).
 * 2. Extract claims from the input text via {@link ClaimExtractor}.
 * 3. Verify all claims against the synthetic sources via
 *    {@link GroundingChecker.checkClaims}.
 * 4. Aggregate results into a {@link GroundingResult}.
 *
 * @module agentos/extensions/packs/grounding-guard/tools/CheckGroundingTool
 */

import type {
  ITool,
  ToolExecutionContext,
  ToolExecutionResult,
  JSONSchemaObject,
} from '../../../../core/tools/ITool';
import type { RagRetrievedChunk } from '../../../../rag/IRetrievalAugmentor';
import type { GroundingResult, ClaimVerification } from '../types';
import type { ClaimExtractor } from '../ClaimExtractor';
import type { GroundingChecker } from '../GroundingChecker';

// ---------------------------------------------------------------------------
// Input type
// ---------------------------------------------------------------------------

/**
 * Input arguments for the `check_grounding` tool.
 */
export interface CheckGroundingInput {
  /**
   * The text containing claims to verify against source documents.
   */
  text: string;

  /**
   * Source document texts to verify the claims against.
   * Each string is treated as a separate source chunk.
   */
  sources: string[];
}

// ---------------------------------------------------------------------------
// CheckGroundingTool
// ---------------------------------------------------------------------------

/**
 * Tool that verifies whether claims in text are supported by source documents
 * using NLI entailment scoring.
 *
 * Exposed as `check_grounding` in the tool registry so that agents can
 * explicitly verify grounding on demand, without relying solely on the
 * automatic guardrail pipeline.
 *
 * @example
 * ```typescript
 * const tool = new CheckGroundingTool(checker, extractor);
 * const result = await tool.execute({
 *   text: 'The capital of France is Paris.',
 *   sources: ['Paris is the capital city of France.'],
 * }, context);
 *
 * if (result.success && result.output?.grounded) {
 *   console.log('All claims are grounded!');
 * }
 * ```
 */
export class CheckGroundingTool implements ITool<CheckGroundingInput, GroundingResult> {
  // -------------------------------------------------------------------------
  // ITool metadata
  // -------------------------------------------------------------------------

  /** Unique tool identifier. */
  readonly id = 'check_grounding';

  /** Functional name used in LLM tool-call requests. */
  readonly name = 'check_grounding';

  /** Human-readable display name for UIs and logs. */
  readonly displayName = 'Grounding Checker';

  /**
   * Detailed description for LLM tool selection.
   * Explains what the tool does, when to use it, and what it returns.
   */
  readonly description =
    'Verify that claims in text are supported by source documents using NLI entailment. ' +
    'Returns a grounding result with per-claim verdicts (supported, contradicted, unverifiable) ' +
    'and aggregate statistics. Use this to fact-check agent output against retrieved sources.';

  /** Tool category for registry filtering. */
  readonly category = 'security';

  /** Semantic version of this tool implementation. */
  readonly version = '1.0.0';

  /**
   * This tool has no side effects — it only reads and analyses text.
   * Safe to call without user confirmation.
   */
  readonly hasSideEffects = false;

  /**
   * JSON Schema defining the expected input arguments.
   * Used by the LLM to construct valid tool-call payloads and by the
   * ToolExecutor for input validation.
   */
  readonly inputSchema: JSONSchemaObject = {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        description: 'Text containing claims to verify against source documents.',
      },
      sources: {
        type: 'array',
        items: { type: 'string' },
        description: 'Source document texts to verify claims against. Each string is a separate source.',
      },
    },
    required: ['text', 'sources'],
  };

  // -------------------------------------------------------------------------
  // Private dependencies
  // -------------------------------------------------------------------------

  /**
   * Grounding checker instance that runs NLI verification.
   * Injected at construction time from the pack factory.
   */
  private readonly checker: GroundingChecker;

  /**
   * Claim extractor instance for splitting text into atomic claims.
   * Injected at construction time from the pack factory.
   */
  private readonly extractor: ClaimExtractor;

  // -------------------------------------------------------------------------
  // Constructor
  // -------------------------------------------------------------------------

  /**
   * Construct a new CheckGroundingTool.
   *
   * @param checker   - {@link GroundingChecker} instance for NLI verification.
   * @param extractor - {@link ClaimExtractor} instance for claim extraction.
   */
  constructor(checker: GroundingChecker, extractor: ClaimExtractor) {
    this.checker = checker;
    this.extractor = extractor;
  }

  // -------------------------------------------------------------------------
  // ITool — execute
  // -------------------------------------------------------------------------

  /**
   * Execute the grounding check.
   *
   * 1. Wraps the plain-string `sources` as synthetic {@link RagRetrievedChunk}
   *    objects with `relevanceScore: 1.0`.
   * 2. Extracts claims from `text` via the {@link ClaimExtractor}.
   * 3. Verifies all claims via {@link GroundingChecker.checkClaims}.
   * 4. Aggregates results into a {@link GroundingResult}.
   *
   * @param args    - Input arguments containing `text` and `sources`.
   * @param context - Tool execution context (unused but required by ITool).
   * @returns A {@link ToolExecutionResult} wrapping the {@link GroundingResult}.
   */
  async execute(
    args: CheckGroundingInput,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult<GroundingResult>> {
    const { text, sources } = args;

    // Validate inputs.
    if (!text || text.trim().length === 0) {
      return {
        success: false,
        error: 'Input text is empty or missing.',
      };
    }

    if (!sources || sources.length === 0) {
      return {
        success: false,
        error: 'No source documents provided. At least one source is required.',
      };
    }

    // Step 1: Wrap string sources as synthetic RagRetrievedChunk objects.
    // Each source is assigned a synthetic ID and maximum relevance (1.0)
    // since the caller explicitly selected these sources for verification.
    const ragChunks: RagRetrievedChunk[] = sources.map((content, index) => ({
      id: `synthetic-source-${index}`,
      content,
      originalDocumentId: `synthetic-doc-${index}`,
      relevanceScore: 1.0,
    }));

    // Step 2: Extract claims from the input text.
    let claims;
    try {
      claims = await this.extractor.extract(text);
    } catch (err) {
      return {
        success: false,
        error: `Claim extraction failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    // Handle the case where no verifiable claims are found.
    if (claims.length === 0) {
      const emptyResult: GroundingResult = {
        grounded: true,
        claims: [],
        totalClaims: 0,
        supportedCount: 0,
        contradictedCount: 0,
        unverifiableCount: 0,
        unverifiableRatio: 0,
        summary: '0 claims extracted — nothing to verify.',
      };

      return {
        success: true,
        output: emptyResult,
      };
    }

    // Step 3: Verify all claims against the synthetic RAG sources.
    let verifications: ClaimVerification[];
    try {
      verifications = await this.checker.checkClaims(claims, ragChunks);
    } catch (err) {
      return {
        success: false,
        error: `Claim verification failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    // Step 4: Aggregate results into a GroundingResult.
    const result = this.aggregateResults(verifications);

    return {
      success: true,
      output: result,
    };
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Aggregate per-claim verification results into a {@link GroundingResult}.
   *
   * Computes counts for each verdict type, the unverifiable ratio, and the
   * top-level grounded flag.  The default max-unverifiable-ratio for the tool
   * is 0.5 (matching the guardrail default).
   *
   * @param verifications - Per-claim verification results.
   * @returns Aggregated grounding result.
   */
  private aggregateResults(verifications: ClaimVerification[]): GroundingResult {
    const totalClaims = verifications.length;

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

    // Grounded = no contradictions AND unverifiable ratio within tolerance.
    const grounded = contradictedCount === 0 && unverifiableRatio <= 0.5;

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
