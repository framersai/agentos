/**
 * @fileoverview QueryClassifier — chain-of-thought LLM classifier that
 * determines the retrieval depth tier (T0-T3) for each incoming query.
 *
 * The classifier is the first stage of the QueryRouter pipeline. It examines
 * the user's query (and optional conversation history) to decide how much
 * retrieval effort is needed:
 *
 * - **T0 (Trivial)**: No retrieval — answer from internal knowledge or context.
 * - **T1 (Simple lookup)**: Single-source vector search.
 * - **T2 (Multi-source)**: Cross-document retrieval + optional graph traversal.
 * - **T3 (Research)**: Deep iterative research across the full corpus.
 *
 * The classifier calls an LLM with a chain-of-thought system prompt, parses
 * the structured JSON response, and applies confidence-based tier bumping
 * and maxTier capping before returning a {@link ClassificationResult}.
 *
 * On any failure (LLM error, JSON parse error), a safe T1 fallback is returned
 * to ensure the pipeline never completely stalls.
 *
 * @module @framers/agentos/query-router/QueryClassifier
 */

import { generateText } from '../api/generateText.js';
import type {
  ClassificationResult,
  ConversationMessage,
  QueryTier,
} from './types.js';

// ============================================================================
// Configuration
// ============================================================================

/**
 * Configuration for the {@link QueryClassifier}.
 *
 * Controls model selection, confidence thresholds, tier limits, and the
 * knowledge context (topic list, tool list) injected into the system prompt.
 */
export interface QueryClassifierConfig {
  /** LLM model identifier (e.g. "gpt-4o-mini"). */
  model: string;

  /** LLM provider name (e.g. "openai", "anthropic"). */
  provider: string;

  /**
   * Minimum confidence threshold for accepting a classification.
   * If the LLM's confidence falls below this, the tier is bumped up by 1
   * to request broader retrieval as a safety measure.
   */
  confidenceThreshold: number;

  /** Maximum tier the classifier is allowed to assign. */
  maxTier: QueryTier;

  /**
   * Newline-delimited list of known topics in the corpus.
   * Injected into the system prompt via `{{TOPIC_LIST}}`.
   */
  topicList: string;

  /**
   * Comma-delimited list of available tools.
   * Injected into the system prompt via `{{TOOL_LIST}}`.
   */
  toolList: string;

  /** Optional API key override (otherwise resolved from environment). */
  apiKey?: string;

  /** Optional base URL override for the LLM provider. */
  baseUrl?: string;
}

// ============================================================================
// System Prompt Template
// ============================================================================

/**
 * Chain-of-thought system prompt template for the query classifier.
 *
 * Placeholders:
 * - `{{TOPIC_LIST}}` — known corpus topics
 * - `{{TOOL_LIST}}` — available tools
 * - `{{CONVERSATION_CONTEXT}}` — recent conversation history (may be empty)
 */
const SYSTEM_PROMPT_TEMPLATE = `You are a query complexity classifier. Your job is to analyze the user's query and determine how much retrieval effort is needed to answer it accurately.

## Tier Definitions

- **T0 (Trivial)**: Greetings, small talk, or questions answerable from general knowledge or the conversation context alone. No retrieval needed.
- **T1 (Simple lookup)**: Questions about a specific fact, config value, or code snippet. A single vector search should suffice.
- **T2 (Multi-source)**: Questions that span multiple documents or require combining information from different parts of the codebase. May need graph traversal.
- **T3 (Research)**: Deep investigation questions that require iterative multi-pass retrieval, synthesis, and comparison across the entire corpus.

## Known Topics
{{TOPIC_LIST}}

## Available Tools
{{TOOL_LIST}}

## Conversation Context
{{CONVERSATION_CONTEXT}}

## Instructions

Think step-by-step about the query:
1. What is the user actually asking?
2. Can this be answered from general knowledge or conversation context alone?
3. How many sources/documents would be needed?
4. Are any tools required?

Respond with ONLY a JSON object (no markdown fences, no extra text):
{
  "thinking": "<your step-by-step reasoning>",
  "tier": <0|1|2|3>,
  "confidence": <0.0 to 1.0>,
  "internal_knowledge_sufficient": <true|false>,
  "suggested_sources": [<"vector"|"graph"|"research">],
  "tools_needed": [<tool names or empty>]
}`;

// ============================================================================
// Raw LLM Response Shape
// ============================================================================

/**
 * Shape of the raw JSON response expected from the LLM classifier.
 * Parsed from the model's text output before mapping to {@link ClassificationResult}.
 */
interface RawClassifierResponse {
  thinking: string;
  tier: number;
  confidence: number;
  internal_knowledge_sufficient: boolean;
  suggested_sources: string[];
  tools_needed: string[];
}

// ============================================================================
// QueryClassifier
// ============================================================================

/**
 * Chain-of-thought LLM classifier that determines retrieval depth (T0-T3)
 * for each incoming query.
 *
 * @example
 * ```ts
 * const classifier = new QueryClassifier({
 *   model: 'gpt-4o-mini',
 *   provider: 'openai',
 *   confidenceThreshold: 0.7,
 *   maxTier: 3,
 *   topicList: 'Auth (docs/auth.md)\nDB (docs/db.md)',
 *   toolList: 'search_code, read_file',
 * });
 *
 * const result = await classifier.classify('How does auth work?');
 * console.log(result.tier); // 1
 * ```
 */
export class QueryClassifier {
  /** Immutable classifier configuration. */
  private readonly config: QueryClassifierConfig;

  /**
   * Creates a new QueryClassifier instance.
   * @param config - Classifier configuration with model, provider, and thresholds.
   */
  constructor(config: QueryClassifierConfig) {
    this.config = config;
  }

  /**
   * Classifies a user query into a retrieval tier.
   *
   * Steps:
   * 1. Builds a chain-of-thought system prompt with tier definitions, topic list,
   *    tool list, and optional conversation context.
   * 2. Calls the LLM via `generateText`.
   * 3. Parses the JSON response (handling optional markdown code fences).
   * 4. Applies confidence-based tier bumping: if confidence < threshold, tier += 1.
   * 5. Caps the tier at the configured `maxTier`.
   * 6. On ANY error, returns a safe T1 fallback with confidence 0.
   *
   * @param query - The user's query text to classify.
   * @param conversationHistory - Optional recent conversation messages for context.
   * @returns A {@link ClassificationResult} with tier, confidence, reasoning, and metadata.
   */
  async classify(
    query: string,
    conversationHistory?: ConversationMessage[],
  ): Promise<ClassificationResult> {
    try {
      const systemPrompt = this.buildSystemPrompt(conversationHistory);

      const response = await generateText({
        provider: this.config.provider,
        model: this.config.model,
        system: systemPrompt,
        prompt: query,
        temperature: 0.1,
        apiKey: this.config.apiKey,
        baseUrl: this.config.baseUrl,
      });

      const parsed = this.parseResponse(response.text);
      return this.applyConstraints(parsed);
    } catch {
      return this.fallbackResult();
    }
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  /**
   * Builds the system prompt by replacing template placeholders with actual
   * topic list, tool list, and conversation context.
   *
   * @param conversationHistory - Optional conversation messages to include as context.
   * @returns The fully rendered system prompt string.
   */
  private buildSystemPrompt(conversationHistory?: ConversationMessage[]): string {
    let conversationContext = 'No prior conversation.';

    if (conversationHistory && conversationHistory.length > 0) {
      conversationContext = conversationHistory
        .map((msg) => `${msg.role}: ${msg.content}`)
        .join('\n');
    }

    return SYSTEM_PROMPT_TEMPLATE
      .replace('{{TOPIC_LIST}}', this.config.topicList)
      .replace('{{TOOL_LIST}}', this.config.toolList)
      .replace('{{CONVERSATION_CONTEXT}}', conversationContext);
  }

  /**
   * Parses the LLM response text into a {@link ClassificationResult}.
   *
   * Handles two response formats:
   * - Raw JSON object
   * - JSON wrapped in markdown code fences (```json ... ```)
   *
   * @param text - Raw text from the LLM response.
   * @returns A parsed {@link ClassificationResult}.
   * @throws If the response cannot be parsed as valid JSON.
   */
  private parseResponse(text: string): ClassificationResult {
    // Extract JSON from the response — handle optional markdown code fences
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error(`Failed to extract JSON from classifier response: ${text.slice(0, 200)}`);
    }

    const raw: RawClassifierResponse = JSON.parse(jsonMatch[0]);

    return {
      tier: raw.tier as QueryTier,
      confidence: raw.confidence,
      reasoning: raw.thinking,
      internalKnowledgeSufficient: raw.internal_knowledge_sufficient,
      suggestedSources: raw.suggested_sources as ClassificationResult['suggestedSources'],
      toolsNeeded: raw.tools_needed,
    };
  }

  /**
   * Applies post-classification constraints:
   * 1. If confidence < threshold, bump tier by 1 (request broader retrieval).
   * 2. Cap tier at the configured maxTier.
   *
   * @param result - The raw classification result from the LLM.
   * @returns The constrained classification result.
   */
  private applyConstraints(result: ClassificationResult): ClassificationResult {
    let tier = result.tier;

    // Bump tier when confidence is below the threshold
    if (result.confidence < this.config.confidenceThreshold) {
      tier = Math.min(tier + 1, 3) as QueryTier;
    }

    // Cap at maxTier
    tier = Math.min(tier, this.config.maxTier) as QueryTier;

    return {
      ...result,
      tier,
    };
  }

  /**
   * Returns a safe T1 fallback result when classification fails for any reason.
   * T1 ensures at least a basic vector search is performed, which is a
   * reasonable default when the classifier cannot determine the right tier.
   *
   * @returns A T1 {@link ClassificationResult} with confidence 0.
   */
  private fallbackResult(): ClassificationResult {
    return {
      tier: 1,
      confidence: 0,
      reasoning: 'Classification failed; falling back to T1 for safety.',
      internalKnowledgeSufficient: false,
      suggestedSources: ['vector'],
      toolsNeeded: [],
    };
  }
}
