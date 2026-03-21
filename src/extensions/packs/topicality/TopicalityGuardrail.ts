/**
 * @fileoverview IGuardrailService implementation for topicality enforcement.
 *
 * `TopicalityGuardrail` evaluates user input (and optionally agent output)
 * against configured allowed and forbidden topic sets using semantic
 * embedding similarity.  It enforces three independent policy checks:
 *
 *  1. **Forbidden topics** — Messages that score above `forbiddenThreshold`
 *     against any forbidden topic are blocked (or flagged).
 *  2. **Off-topic detection** — Messages that score below `allowedThreshold`
 *     against *all* allowed topics are flagged (or blocked/redirected).
 *  3. **Session drift** — An EMA-based tracker flags sustained drift away
 *     from allowed topics across consecutive messages.
 *
 * ### Lazy initialisation
 * Embedding indices are built on the **first evaluation call**, not at
 * construction time.  This keeps instantiation cheap and defers the
 * potentially expensive batch embedding call until the agent actually
 * receives its first message.
 *
 * ### Fail-open semantics
 * All evaluation methods wrap their logic in try/catch.  If the embedding
 * function throws, or any other unexpected error occurs, the guardrail
 * logs a warning and returns `null` (pass) to avoid blocking legitimate
 * traffic due to infrastructure failures.
 *
 * @module topicality/TopicalityGuardrail
 */

import type {
  GuardrailConfig,
  GuardrailEvaluationResult,
  GuardrailInputPayload,
  GuardrailOutputPayload,
  IGuardrailService,
} from '../../../core/guardrails/IGuardrailService';
import { GuardrailAction } from '../../../core/guardrails/IGuardrailService';
import type { ISharedServiceRegistry } from '../../ISharedServiceRegistry';
import type { TopicalityPackOptions } from './types';
import { DEFAULT_DRIFT_CONFIG } from './types';
import { TopicEmbeddingIndex } from './TopicEmbeddingIndex';
import { TopicDriftTracker } from './TopicDriftTracker';

// ---------------------------------------------------------------------------
// Reason codes emitted by this guardrail
// ---------------------------------------------------------------------------

/**
 * Machine-readable reason code for messages matching a forbidden topic.
 * @internal
 */
const REASON_FORBIDDEN = 'TOPICALITY_FORBIDDEN';

/**
 * Machine-readable reason code for messages that do not match any allowed topic.
 * @internal
 */
const REASON_OFF_TOPIC = 'TOPICALITY_OFF_TOPIC';

/**
 * Machine-readable reason code for sustained session-level topic drift.
 * @internal
 */
const REASON_DRIFT = 'TOPICALITY_DRIFT';

// ---------------------------------------------------------------------------
// TopicalityGuardrail
// ---------------------------------------------------------------------------

/**
 * Guardrail that enforces topicality constraints via semantic embeddings.
 *
 * Implements {@link IGuardrailService} with Phase 2 (parallel) semantics:
 * `evaluateStreamingChunks: false` and `canSanitize: false`.  The guardrail
 * never modifies content — it only blocks or flags.
 *
 * @example
 * ```ts
 * const guardrail = new TopicalityGuardrail(registry, {
 *   allowedTopics: TOPIC_PRESETS.customerSupport,
 *   forbiddenTopics: TOPIC_PRESETS.commonUnsafe,
 *   forbiddenAction: 'block',
 *   offTopicAction: 'flag',
 * }, embeddingFn);
 *
 * const result = await guardrail.evaluateInput(payload);
 * if (result?.action === GuardrailAction.BLOCK) {
 *   // Reject the message
 * }
 * ```
 */
export class TopicalityGuardrail implements IGuardrailService {
  // -------------------------------------------------------------------------
  // IGuardrailService config
  // -------------------------------------------------------------------------

  /**
   * Guardrail pipeline configuration.
   *
   * - `evaluateStreamingChunks: false` — topicality evaluation requires
   *   complete text, not partial deltas.
   * - `canSanitize: false` — this guardrail only blocks or flags; it never
   *   modifies content, so it runs in Phase 2 (parallel) of the pipeline.
   */
  public readonly config: GuardrailConfig = {
    evaluateStreamingChunks: false,
    canSanitize: false,
  };

  // -------------------------------------------------------------------------
  // Private state
  // -------------------------------------------------------------------------

  /** Shared service registry provided by the extension manager. */
  private readonly services: ISharedServiceRegistry;

  /** Resolved pack options with caller overrides. */
  private readonly options: TopicalityPackOptions;

  /** Caller-supplied or registry-backed embedding function. */
  private readonly embeddingFn: (texts: string[]) => Promise<number[][]>;

  /**
   * Embedding index for allowed topics.  Lazily built on the first
   * evaluation call.  `null` until built or if no allowed topics are
   * configured.
   */
  private allowedIndex: TopicEmbeddingIndex | null = null;

  /**
   * Embedding index for forbidden topics.  Lazily built on the first
   * evaluation call.  `null` until built or if no forbidden topics are
   * configured.
   */
  private forbiddenIndex: TopicEmbeddingIndex | null = null;

  /**
   * Session-level EMA drift tracker.  Only instantiated when
   * `enableDriftDetection` is `true` (default).  `null` otherwise.
   */
  private driftTracker: TopicDriftTracker | null = null;

  /**
   * Which side of the conversation to evaluate.
   * - `'input'`  — only user messages
   * - `'output'` — only agent responses
   * - `'both'`   — both directions
   */
  private readonly scope: 'input' | 'output' | 'both';

  /**
   * Minimum similarity to any allowed topic for the message to be
   * considered on-topic.
   */
  private readonly allowedThreshold: number;

  /**
   * Similarity above which a forbidden topic match triggers action.
   */
  private readonly forbiddenThreshold: number;

  /**
   * Whether the lazy initialisation of embedding indices has been
   * performed.  Prevents redundant build calls.
   */
  private indicesBuilt = false;

  // -------------------------------------------------------------------------
  // Constructor
  // -------------------------------------------------------------------------

  /**
   * Creates a new `TopicalityGuardrail`.
   *
   * @param services    - Shared service registry for heavyweight resource sharing.
   * @param options     - Pack-level configuration (topics, thresholds, actions).
   * @param embeddingFn - Optional explicit embedding function.  When omitted,
   *   the guardrail falls back to requesting an EmbeddingManager from the
   *   shared service registry at evaluation time.
   */
  constructor(
    services: ISharedServiceRegistry,
    options: TopicalityPackOptions,
    embeddingFn?: (texts: string[]) => Promise<number[][]>,
  ) {
    this.services = services;
    this.options = options;

    // Resolve embedding function: prefer explicit argument, then fall back
    // to the shared service registry.
    this.embeddingFn = embeddingFn ?? this.createRegistryEmbeddingFn();

    // Resolve scope and thresholds from options with sensible defaults.
    this.scope = options.guardrailScope ?? 'input';
    this.allowedThreshold = options.allowedThreshold ?? 0.35;
    this.forbiddenThreshold = options.forbiddenThreshold ?? 0.65;

    // Instantiate drift tracker if enabled (default: true).
    const driftEnabled = options.enableDriftDetection !== false;
    if (driftEnabled) {
      const driftConfig = { ...DEFAULT_DRIFT_CONFIG, ...(options.drift ?? {}) };
      this.driftTracker = new TopicDriftTracker(driftConfig);
    }
  }

  // -------------------------------------------------------------------------
  // IGuardrailService — evaluateInput
  // -------------------------------------------------------------------------

  /**
   * Evaluates a user input message against configured topic constraints.
   *
   * When `scope` is `'output'`, this method immediately returns `null`
   * because input evaluation is disabled.
   *
   * @param payload - The input payload containing the user message text and
   *   session context.
   * @returns A guardrail evaluation result (BLOCK or FLAG), or `null` if
   *   the message passes all topic checks.  Returns `null` on any error
   *   (fail-open).
   */
  async evaluateInput(
    payload: GuardrailInputPayload,
  ): Promise<GuardrailEvaluationResult | null> {
    // If scope is output-only, skip input evaluation entirely.
    if (this.scope === 'output') {
      return null;
    }

    try {
      // Extract the text content from the input payload.
      const text = payload.input.textInput;
      if (!text || text.trim().length === 0) {
        // No text to evaluate — pass through.
        return null;
      }

      // Lazy-build embedding indices on the first call.
      await this.ensureIndicesBuilt();

      // Embed the user's text once — reuse the vector for all checks.
      const [embedding] = await this.embeddingFn([text]);

      // Run the core evaluation pipeline on the embedded vector.
      return this.evaluateEmbedding(embedding, payload.context.sessionId);
    } catch (error) {
      // Fail-open: log the error but let the message through.
      console.warn(
        '[TopicalityGuardrail] evaluateInput failed (fail-open):',
        error instanceof Error ? error.message : error,
      );
      return null;
    }
  }

  // -------------------------------------------------------------------------
  // IGuardrailService — evaluateOutput
  // -------------------------------------------------------------------------

  /**
   * Evaluates an agent output chunk against configured topic constraints.
   *
   * When `scope` is `'input'`, this method immediately returns `null`
   * because output evaluation is disabled.
   *
   * For output evaluation, the guardrail extracts text from the response
   * chunk's `finalResponseText` field (since `evaluateStreamingChunks` is
   * `false`, only FINAL_RESPONSE chunks are seen).
   *
   * @param payload - The output payload containing the response chunk and
   *   session context.
   * @returns A guardrail evaluation result (BLOCK or FLAG), or `null` if
   *   the output passes all topic checks.  Returns `null` on any error
   *   (fail-open).
   */
  async evaluateOutput(
    payload: GuardrailOutputPayload,
  ): Promise<GuardrailEvaluationResult | null> {
    // If scope is input-only, skip output evaluation entirely.
    if (this.scope === 'input') {
      return null;
    }

    try {
      // Extract text from the chunk.  Since evaluateStreamingChunks is false,
      // we receive FINAL_RESPONSE chunks with finalResponseText.
      const chunk = payload.chunk as Record<string, unknown>;
      const text =
        (chunk.textDelta as string | undefined) ??
        (chunk.finalResponseText as string | undefined) ??
        '';

      if (!text || text.trim().length === 0) {
        return null;
      }

      // Lazy-build embedding indices on the first call.
      await this.ensureIndicesBuilt();

      // Embed the output text once.
      const [embedding] = await this.embeddingFn([text]);

      // Run the core evaluation pipeline.
      return this.evaluateEmbedding(embedding, payload.context.sessionId);
    } catch (error) {
      // Fail-open: log and pass through.
      console.warn(
        '[TopicalityGuardrail] evaluateOutput failed (fail-open):',
        error instanceof Error ? error.message : error,
      );
      return null;
    }
  }

  // -------------------------------------------------------------------------
  // Core evaluation pipeline
  // -------------------------------------------------------------------------

  /**
   * Runs the three-stage topicality evaluation pipeline on a pre-computed
   * embedding vector.
   *
   * Evaluation order:
   *  1. Forbidden topic check (highest priority — immediate block/flag)
   *  2. Off-topic check against allowed topics
   *  3. Session drift check (only if drift detection is enabled and allowed
   *     topics are configured)
   *
   * @param embedding - Pre-computed embedding vector for the text.
   * @param sessionId - Session identifier for drift tracking.
   * @returns A {@link GuardrailEvaluationResult} if any check triggers, or
   *   `null` if all checks pass.
   *
   * @internal
   */
  private evaluateEmbedding(
    embedding: number[],
    sessionId: string,
  ): GuardrailEvaluationResult | null {
    // ------------------------------------------------------------------
    // Step 1: Check forbidden topics
    // ------------------------------------------------------------------
    if (this.forbiddenIndex) {
      const forbiddenMatches = this.forbiddenIndex.matchByVector(embedding);

      // Check if any forbidden topic exceeds the threshold.
      for (const match of forbiddenMatches) {
        if (match.similarity > this.forbiddenThreshold) {
          // Determine action: 'block' (default) or 'flag'.
          const action =
            this.options.forbiddenAction === 'flag'
              ? GuardrailAction.FLAG
              : GuardrailAction.BLOCK;

          return {
            action,
            reason: `Message matches forbidden topic: ${match.topicName}`,
            reasonCode: REASON_FORBIDDEN,
            metadata: {
              matchedTopic: match.topicId,
              matchedTopicName: match.topicName,
              similarity: match.similarity,
            },
          };
        }
      }
    }

    // ------------------------------------------------------------------
    // Step 2: Check allowed topics (off-topic detection)
    // ------------------------------------------------------------------
    if (this.allowedIndex) {
      const isOnTopic = this.allowedIndex.isOnTopicByVector(
        embedding,
        this.allowedThreshold,
      );

      if (!isOnTopic) {
        // Get the nearest topic for metadata, even though it's below threshold.
        const allMatches = this.allowedIndex.matchByVector(embedding);
        const nearestTopic = allMatches.length > 0 ? allMatches[0] : null;

        // Determine action based on offTopicAction option.
        let action: GuardrailAction;
        switch (this.options.offTopicAction) {
          case 'block':
            action = GuardrailAction.BLOCK;
            break;
          case 'redirect':
            // Redirect maps to FLAG with metadata indicating redirection intent.
            action = GuardrailAction.FLAG;
            break;
          default:
            // Default: 'flag'
            action = GuardrailAction.FLAG;
            break;
        }

        return {
          action,
          reason: nearestTopic
            ? `Message is off-topic. Nearest topic: ${nearestTopic.topicName} (similarity: ${nearestTopic.similarity.toFixed(3)})`
            : 'Message is off-topic. No matching topics found.',
          reasonCode: REASON_OFF_TOPIC,
          metadata: {
            nearestTopic: nearestTopic?.topicId ?? null,
            nearestTopicName: nearestTopic?.topicName ?? null,
            nearestSimilarity: nearestTopic?.similarity ?? 0,
          },
        };
      }
    }

    // ------------------------------------------------------------------
    // Step 3: Check session drift (only when drift detection is enabled
    //         and we have allowed topics to compare against)
    // ------------------------------------------------------------------
    if (this.driftTracker && this.allowedIndex) {
      const driftResult = this.driftTracker.update(
        sessionId,
        embedding,
        this.allowedIndex,
      );

      if (driftResult.driftLimitExceeded) {
        return {
          // Drift is always a FLAG — it represents a gradual trend, not
          // an immediate policy violation.
          action: GuardrailAction.FLAG,
          reason: `Session has drifted off-topic for ${driftResult.driftStreak} consecutive messages.`,
          reasonCode: REASON_DRIFT,
          metadata: {
            driftStreak: driftResult.driftStreak,
            currentSimilarity: driftResult.currentSimilarity,
            nearestTopic: driftResult.nearestTopic?.topicId ?? null,
            nearestTopicName: driftResult.nearestTopic?.topicName ?? null,
          },
        };
      }
    }

    // All checks passed — no action needed.
    return null;
  }

  // -------------------------------------------------------------------------
  // Lazy index building
  // -------------------------------------------------------------------------

  /**
   * Ensures that the allowed and forbidden embedding indices have been built.
   *
   * Called once before the first evaluation.  Subsequent calls are no-ops
   * (guarded by the `indicesBuilt` flag).
   *
   * @internal
   */
  private async ensureIndicesBuilt(): Promise<void> {
    if (this.indicesBuilt) {
      return;
    }

    // Build the forbidden-topic index if any forbidden topics are configured.
    if (this.options.forbiddenTopics && this.options.forbiddenTopics.length > 0) {
      this.forbiddenIndex = new TopicEmbeddingIndex(this.embeddingFn);
      await this.forbiddenIndex.build(this.options.forbiddenTopics);
    }

    // Build the allowed-topic index if any allowed topics are configured.
    if (this.options.allowedTopics && this.options.allowedTopics.length > 0) {
      this.allowedIndex = new TopicEmbeddingIndex(this.embeddingFn);
      await this.allowedIndex.build(this.options.allowedTopics);
    }

    this.indicesBuilt = true;
  }

  // -------------------------------------------------------------------------
  // Registry-based embedding fallback
  // -------------------------------------------------------------------------

  /**
   * Creates an embedding function that retrieves an EmbeddingManager from
   * the shared service registry at call time.
   *
   * This fallback is used when no explicit `embeddingFn` is provided to
   * the constructor.  It throws if the EmbeddingManager service is not
   * available in the registry.
   *
   * @returns An async embedding function.
   * @internal
   */
  private createRegistryEmbeddingFn(): (texts: string[]) => Promise<number[][]> {
    return async (texts: string[]): Promise<number[][]> => {
      // Attempt to retrieve the EmbeddingManager from the shared registry.
      const em = await this.services.getOrCreate<{
        generateEmbeddings: (texts: string[]) => Promise<number[][]>;
      }>(
        'agentos:topicality:embedding-manager',
        async () => {
          throw new Error(
            'EmbeddingManager not available in shared service registry. ' +
              'Provide an explicit embeddingFn or register an EmbeddingManager.',
          );
        },
      );
      return em.generateEmbeddings(texts);
    };
  }
}
