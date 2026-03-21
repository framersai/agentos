/**
 * @fileoverview On-demand topic checking tool for the topicality extension pack.
 *
 * `CheckTopicTool` implements {@link ITool} and exposes a `check_topic`
 * function that agents and workflows can invoke to determine whether a
 * piece of text aligns with the configured allowed topics, matches any
 * forbidden topics, or both.
 *
 * Unlike the {@link TopicalityGuardrail} (which runs automatically on every
 * message), this tool is invoked explicitly and returns structured data
 * rather than triggering block/flag actions.  It is useful for:
 *
 *  - Agent self-awareness ("Am I still on-topic?")
 *  - User-facing topic suggestions ("Your question is closest to: Billing")
 *  - Workflow branching ("If off-topic, route to fallback handler")
 *
 * @module topicality/tools/CheckTopicTool
 */

import type {
  ITool,
  JSONSchemaObject,
  ToolExecutionContext,
  ToolExecutionResult,
} from '../../../../core/tools/ITool';
import type { TopicEmbeddingIndex } from '../TopicEmbeddingIndex';
import type { TopicMatch } from '../types';

// ---------------------------------------------------------------------------
// Input / output types
// ---------------------------------------------------------------------------

/**
 * Input arguments accepted by the `check_topic` tool.
 */
interface CheckTopicInput {
  /** The text string to evaluate against configured topics. */
  text: string;
}

/**
 * Structured output returned by the `check_topic` tool on success.
 */
interface CheckTopicOutput {
  /**
   * Whether the text is considered on-topic (i.e., above the allowed
   * threshold against at least one allowed topic).  `null` if no
   * allowed topics are configured.
   */
  onTopic: boolean | null;

  /**
   * The allowed topic with the highest similarity to the input text,
   * or `null` if no allowed topics are configured.
   */
  nearestTopic: TopicMatch | null;

  /**
   * The forbidden topic with the highest similarity to the input text,
   * or `null` if no forbidden topics are configured or none matched.
   * Only includes matches above the forbidden threshold.
   */
  forbiddenMatch: TopicMatch | null;

  /**
   * Full list of similarity scores against all configured topics
   * (both allowed and forbidden), sorted descending by similarity.
   */
  allScores: TopicMatch[];
}

// ---------------------------------------------------------------------------
// CheckTopicTool
// ---------------------------------------------------------------------------

/**
 * On-demand topic classification tool.
 *
 * Embeds the input text and checks it against both allowed and forbidden
 * topic indices, returning structured similarity data.
 *
 * @example
 * ```ts
 * const result = await tool.execute(
 *   { text: 'How do I cancel my subscription?' },
 *   executionContext,
 * );
 * // result.output.onTopic → true
 * // result.output.nearestTopic → { topicId: 'billing', ... }
 * ```
 */
export class CheckTopicTool implements ITool<CheckTopicInput, CheckTopicOutput> {
  // -------------------------------------------------------------------------
  // ITool metadata
  // -------------------------------------------------------------------------

  /** @inheritdoc */
  readonly id = 'check_topic';

  /** @inheritdoc */
  readonly name = 'check_topic';

  /** @inheritdoc */
  readonly displayName = 'Topic Checker';

  /** @inheritdoc */
  readonly description =
    'Checks whether a piece of text aligns with configured allowed topics or ' +
    'matches any forbidden topics. Returns similarity scores and the nearest ' +
    'topic match. Useful for agent self-awareness and workflow branching.';

  /** @inheritdoc */
  readonly category = 'security';

  /** @inheritdoc */
  readonly version = '1.0.0';

  /** @inheritdoc */
  readonly hasSideEffects = false;

  /** @inheritdoc */
  readonly inputSchema: JSONSchemaObject = {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        description: 'The text to evaluate against configured topics.',
      },
    },
    required: ['text'],
    additionalProperties: false,
  };

  // -------------------------------------------------------------------------
  // Private state
  // -------------------------------------------------------------------------

  /**
   * Embedding index for allowed topics.  May be `null` if no allowed
   * topics are configured.
   */
  private allowedIndex: TopicEmbeddingIndex | null;

  /**
   * Embedding index for forbidden topics.  May be `null` if no forbidden
   * topics are configured.
   */
  private forbiddenIndex: TopicEmbeddingIndex | null;

  /**
   * Embedding function used to convert input text to a numeric vector.
   */
  private readonly embeddingFn: (texts: string[]) => Promise<number[][]>;

  /**
   * Minimum similarity score against an allowed topic for the text to
   * be considered on-topic.
   */
  private readonly allowedThreshold: number;

  /**
   * Similarity score above which a forbidden topic match is reported.
   */
  private readonly forbiddenThreshold: number;

  // -------------------------------------------------------------------------
  // Constructor
  // -------------------------------------------------------------------------

  /**
   * Creates a new `CheckTopicTool`.
   *
   * @param allowedIndex      - Pre-built index of allowed topics (or `null`).
   * @param forbiddenIndex    - Pre-built index of forbidden topics (or `null`).
   * @param embeddingFn       - Async function to embed text strings.
   * @param allowedThreshold  - Minimum similarity for on-topic classification.
   * @param forbiddenThreshold - Minimum similarity for forbidden topic flagging.
   */
  constructor(
    allowedIndex: TopicEmbeddingIndex | null,
    forbiddenIndex: TopicEmbeddingIndex | null,
    embeddingFn: (texts: string[]) => Promise<number[][]>,
    allowedThreshold: number,
    forbiddenThreshold: number,
  ) {
    this.allowedIndex = allowedIndex;
    this.forbiddenIndex = forbiddenIndex;
    this.embeddingFn = embeddingFn;
    this.allowedThreshold = allowedThreshold;
    this.forbiddenThreshold = forbiddenThreshold;
  }

  // -------------------------------------------------------------------------
  // Index setters (used by pack factory on rebuild)
  // -------------------------------------------------------------------------

  /**
   * Replaces the allowed topic index.  Called by the pack factory when
   * components are rebuilt (e.g., after `onActivate`).
   *
   * @param index - The new allowed topic index (or `null` to clear).
   */
  setAllowedIndex(index: TopicEmbeddingIndex | null): void {
    this.allowedIndex = index;
  }

  /**
   * Replaces the forbidden topic index.  Called by the pack factory when
   * components are rebuilt.
   *
   * @param index - The new forbidden topic index (or `null` to clear).
   */
  setForbiddenIndex(index: TopicEmbeddingIndex | null): void {
    this.forbiddenIndex = index;
  }

  // -------------------------------------------------------------------------
  // ITool — execute
  // -------------------------------------------------------------------------

  /**
   * Embeds the input text and evaluates it against allowed and forbidden
   * topic indices.
   *
   * @param args    - Input arguments containing the `text` field.
   * @param context - Tool execution context (not used by this tool).
   * @returns A {@link ToolExecutionResult} containing the structured
   *   topic analysis or an error message.
   */
  async execute(
    args: CheckTopicInput,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult<CheckTopicOutput>> {
    // Validate input.
    if (!args.text || args.text.trim().length === 0) {
      return {
        success: false,
        error: 'The "text" field is required and must be a non-empty string.',
      };
    }

    try {
      // Embed the input text once.
      const [embedding] = await this.embeddingFn([args.text]);

      // Collect all scores from both indices.
      const allScores: TopicMatch[] = [];

      // --- Allowed topics ---
      let onTopic: boolean | null = null;
      let nearestTopic: TopicMatch | null = null;

      if (this.allowedIndex) {
        const allowedMatches = this.allowedIndex.matchByVector(embedding);
        allScores.push(...allowedMatches);

        // Determine if on-topic using the threshold.
        onTopic = this.allowedIndex.isOnTopicByVector(embedding, this.allowedThreshold);

        // The nearest topic is the first match (highest similarity).
        nearestTopic = allowedMatches.length > 0 ? allowedMatches[0] : null;
      }

      // --- Forbidden topics ---
      let forbiddenMatch: TopicMatch | null = null;

      if (this.forbiddenIndex) {
        const forbiddenMatches = this.forbiddenIndex.matchByVector(embedding);
        allScores.push(...forbiddenMatches);

        // Report the highest-scoring forbidden match if above threshold.
        if (forbiddenMatches.length > 0 && forbiddenMatches[0].similarity > this.forbiddenThreshold) {
          forbiddenMatch = forbiddenMatches[0];
        }
      }

      // Sort all scores descending by similarity.
      allScores.sort((a, b) => b.similarity - a.similarity);

      return {
        success: true,
        output: {
          onTopic,
          nearestTopic,
          forbiddenMatch,
          allScores,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: `Topic check failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}
