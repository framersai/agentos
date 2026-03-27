/**
 * @fileoverview QueryClassifier — chain-of-thought LLM classifier that
 * determines both the retrieval depth tier (T0-T3) and the retrieval
 * strategy (`none` / `simple` / `moderate` / `complex`) for each query.
 *
 * The classifier is the first stage of the QueryRouter pipeline. It examines
 * the user's query (and optional conversation history) to decide how much
 * retrieval effort is needed:
 *
 * - **T0 (Trivial)** / `none`:     No retrieval — answer from internal knowledge.
 * - **T1 (Simple)** / `simple`:    Direct embedding search — fast, cheap.
 * - **T2 (Multi-source)** / `moderate`: HyDE retrieval — hypothesis-based
 *   embedding bridges vocabulary mismatch between questions and docs.
 * - **T3 (Research)** / `complex`:  HyDE + deep research — decompose multi-part
 *   queries into sub-queries, HyDE per sub-query, then merge + synthesize.
 *
 * **Strategy selection criteria** (LLM-as-judge evaluates):
 * - Is the query factual/concrete or abstract/vague?
 * - Does it require reasoning across multiple documents?
 * - Would vocabulary mismatch between query and docs degrade direct search?
 * - Is decomposition needed (multi-part question)?
 *
 * The classifier also includes a zero-cost **heuristic fallback** for offline
 * and cost-constrained scenarios.
 *
 * @module @framers/agentos/query-router/QueryClassifier
 */

import { generateText } from '../api/generateText.js';
import {
  STRATEGY_TO_TIER,
  TIER_TO_STRATEGY,
} from './types.js';
import type {
  ClassificationResult,
  ConversationMessage,
  QueryTier,
  RetrievalStrategy,
} from './types.js';
import { buildDefaultPlan } from '../rag/unified/types.js';
import type { RetrievalPlan } from '../rag/unified/types.js';

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
 * This prompt asks the LLM to evaluate both the complexity tier AND the
 * optimal retrieval strategy, including whether HyDE (Hypothetical Document
 * Embedding) should be used to bridge vocabulary gaps.
 *
 * Placeholders:
 * - `{{TOPIC_LIST}}` — known corpus topics
 * - `{{TOOL_LIST}}` — available tools
 * - `{{CONVERSATION_CONTEXT}}` — recent conversation history (may be empty)
 */
const SYSTEM_PROMPT_TEMPLATE = `You are a query complexity classifier and retrieval strategy selector. Your job is to analyze the user's query and determine both the complexity tier AND the optimal retrieval strategy.

## Tier Definitions

- **T0 (Trivial)**: Greetings, small talk, or questions answerable from general knowledge or the conversation context alone. No retrieval needed.
- **T1 (Simple lookup)**: Questions about a specific fact, config value, or code snippet. A single vector search should suffice.
- **T2 (Multi-source)**: Questions that span multiple documents or require combining information from different parts of the codebase. May need graph traversal.
- **T3 (Research)**: Deep investigation questions that require iterative multi-pass retrieval, synthesis, and comparison across the entire corpus.

## Retrieval Strategies

- **none**: Skip retrieval entirely. Use when the query is answerable from context alone (T0).
- **simple**: Direct embedding search. Use when the query uses concrete, specific vocabulary that likely matches stored documents. Fast and cheap.
- **moderate**: HyDE (Hypothetical Document Embedding) retrieval. Use when the query is abstract, uses different vocabulary than docs might, or asks "how" / "why" / "explain" questions where generating a hypothetical answer first would improve search quality.
- **complex**: HyDE + query decomposition. Use for multi-part questions, comparative analysis, or queries requiring information synthesis across many sources.

## Strategy Selection Criteria

Evaluate these dimensions:
1. **Vocabulary match**: Would the query terms directly match document terms? If not, HyDE helps.
2. **Abstraction level**: Abstract/vague queries benefit from HyDE (moderate). Concrete lookups do not (simple).
3. **Multi-part**: Questions with "and", "also", "compare", "differences" → complex.
4. **Reasoning depth**: "Explain implications", "analyze tradeoffs" → moderate or complex.
5. **Decomposability**: Can the query be split into independent sub-questions? → complex.

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
4. Would the query vocabulary match stored document vocabulary directly?
5. Should HyDE be used to bridge semantic gaps?
6. Does the query need decomposition into sub-queries?
7. Are any tools required?

Respond with ONLY a JSON object (no markdown fences, no extra text):
{
  "thinking": "<your step-by-step reasoning>",
  "tier": <0|1|2|3>,
  "strategy": "<none|simple|moderate|complex>",
  "confidence": <0.0 to 1.0>,
  "internal_knowledge_sufficient": <true|false>,
  "suggested_sources": [<"vector"|"graph"|"research">],
  "tools_needed": [<tool names or empty>]
}`;

// ============================================================================
// Plan-Aware System Prompt Template (for classifyWithPlan)
// ============================================================================

/**
 * Enhanced chain-of-thought system prompt for the plan-aware classifier.
 *
 * This prompt asks the LLM to evaluate MORE dimensions than the base classifier:
 * complexity, source selection, memory relevance, modality, temporal preferences,
 * and decomposability. It produces a full {@link RetrievalPlan} as output.
 *
 * Placeholders:
 * - `{{TOPIC_LIST}}` — known corpus topics
 * - `{{TOOL_LIST}}` — available tools
 * - `{{CONVERSATION_CONTEXT}}` — recent conversation history (may be empty)
 */
const PLAN_SYSTEM_PROMPT_TEMPLATE = `You are an advanced query classifier and retrieval plan generator. Your job is to analyze the user's query and produce a structured retrieval plan specifying exactly which sources to query, how to combine them, and what memory types to consult.

## Source Definitions

- **vector**: Dense vector similarity search. Good for semantic matching.
- **bm25**: Sparse keyword search. Good for exact terms, error codes, function names.
- **graph**: GraphRAG entity/relationship traversal. Good for "how does X relate to Y" queries.
- **raptor**: RAPTOR hierarchical summary tree. Good for theme/overview queries.
- **memory**: Cognitive memory (episodic/semantic/procedural). Good for recalling past interactions.
- **multimodal**: Image/audio/video search. Only needed when query references visual or audio content.

## Memory Types

- **episodic**: Past events, interactions, conversations the agent experienced.
- **semantic**: Facts, knowledge, learned concepts.
- **procedural**: Workflows, how-to knowledge, step-by-step processes.
- **prospective**: Upcoming intentions, reminders, planned future actions.

## Known Topics
{{TOPIC_LIST}}

## Available Tools
{{TOOL_LIST}}

## Conversation Context
{{CONVERSATION_CONTEXT}}

## Instructions

Think step by step about this query:

1. COMPLEXITY: Is this a simple lookup, moderate analysis, or complex research?
2. SOURCES NEEDED: Would keyword search help? Would entity relationships help? Would hierarchical summaries help?
3. MEMORY RELEVANCE: Has the agent seen related information before? Should we check episodic or semantic memory?
4. MODALITY: Does this query reference images, audio, or visual content?
5. TEMPORAL: Is this about recent events? Should we prefer newer information?
6. DECOMPOSABILITY: Can this be broken into sub-questions?

Based on your analysis, output ONLY a JSON object (no markdown fences, no extra text):
{
  "thinking": "<your step-by-step reasoning>",
  "strategy": "none|simple|moderate|complex",
  "sources": {
    "vector": true,
    "bm25": true,
    "graph": false,
    "raptor": false,
    "memory": true,
    "multimodal": false
  },
  "hyde": {
    "enabled": false,
    "hypothesisCount": 1
  },
  "memoryTypes": ["semantic"],
  "modalities": ["text"],
  "temporal": {
    "preferRecent": false,
    "recencyBoost": 1.0,
    "maxAgeMs": null
  },
  "graphConfig": {
    "maxDepth": 2,
    "minEdgeWeight": 0.3
  },
  "raptorLayers": [0],
  "deepResearch": false,
  "confidence": 0.9,
  "reasoning": "<concise explanation of why this plan was chosen>",
  "tier": 1,
  "internal_knowledge_sufficient": false,
  "suggested_sources": ["vector"],
  "tools_needed": []
}`;

// ============================================================================
// Raw LLM Response Shapes
// ============================================================================

/**
 * Shape of the raw JSON response expected from the LLM classifier.
 * Parsed from the model's text output before mapping to {@link ClassificationResult}.
 */
interface RawClassifierResponse {
  thinking: string;
  tier: number;
  strategy?: string;
  confidence: number;
  internal_knowledge_sufficient: boolean;
  suggested_sources: string[];
  tools_needed: string[];
}

/**
 * Shape of the raw JSON response from the plan-aware classifier.
 *
 * Extends the base classifier response with full retrieval plan fields.
 * All plan fields are optional — missing fields are filled from
 * {@link buildDefaultPlan} defaults.
 *
 * @internal
 */
interface RawPlanClassifierResponse extends RawClassifierResponse {
  sources?: {
    vector?: boolean;
    bm25?: boolean;
    graph?: boolean;
    raptor?: boolean;
    memory?: boolean;
    multimodal?: boolean;
  };
  hyde?: {
    enabled?: boolean;
    hypothesisCount?: number;
  };
  memoryTypes?: string[];
  modalities?: string[];
  temporal?: {
    preferRecent?: boolean;
    recencyBoost?: number;
    maxAgeMs?: number | null;
  };
  graphConfig?: {
    maxDepth?: number;
    minEdgeWeight?: number;
  };
  raptorLayers?: number[];
  deepResearch?: boolean;
  reasoning?: string;
}

// ============================================================================
// Valid strategy values for runtime validation
// ============================================================================

/** Set of valid retrieval strategy string values. */
const VALID_STRATEGIES = new Set<string>(['none', 'simple', 'moderate', 'complex']);

// ============================================================================
// Heuristic Classifier
// ============================================================================

/**
 * Rule-based heuristic classifier for retrieval strategy selection.
 *
 * Provides a zero-cost, zero-latency alternative to the LLM classifier.
 * Evaluates query characteristics (word count, question words, multi-part
 * indicators, abstraction signals) to recommend a retrieval strategy.
 *
 * Heuristic rules (evaluated in order):
 * 1. Very short queries (<=5 words) without question words → `simple`
 * 2. Multi-part indicators ("and also", "compare", "differences") → `complex`
 * 3. Long queries (>30 words) → `complex`
 * 4. Abstract/reasoning question words with >10 words → `moderate`
 * 5. Greeting patterns → `none`
 * 6. Default → `simple`
 *
 * @param query - The raw user query string.
 * @returns The recommended retrieval strategy.
 */
export function heuristicClassify(query: string): RetrievalStrategy {
  const trimmed = query.trim();

  // Greeting / trivial detection
  if (/^(hi|hello|hey|howdy|good\s+(morning|afternoon|evening)|thanks|thank\s+you|bye|goodbye)\b/i.test(trimmed)) {
    return 'none';
  }

  const wordCount = trimmed.split(/\s+/).length;
  const hasAbstractQuestionWords = /\b(how|why|explain|compare|analyze|analyse|implications|impact|tradeoffs?|trade-offs?|differences?|pros\s+and\s+cons)\b/i.test(trimmed);
  const hasSimpleQuestionWords = /\b(what|where|which|when|who|is|does|can)\b/i.test(trimmed);
  const hasMultipleParts = /\b(and\s+also|additionally|furthermore|plus|as\s+well\s+as|compare|versus|vs\.?|differences?\s+between)\b/i.test(trimmed);
  const hasDecompositionSignals = /\b(first.*then|both.*and|each|all\s+of|every|respectively|steps?\s+to|outline)\b/i.test(trimmed);

  // Short, concrete query → simple direct search
  if (wordCount <= 5 && !hasAbstractQuestionWords) {
    return 'simple';
  }

  // Multi-part or decomposable → complex (HyDE + decompose)
  if (hasMultipleParts || hasDecompositionSignals || wordCount > 30) {
    return 'complex';
  }

  // Abstract/reasoning with moderate length → moderate (HyDE)
  if (hasAbstractQuestionWords && wordCount > 10) {
    return 'moderate';
  }

  // Simple question words → simple
  if (hasSimpleQuestionWords && wordCount <= 15) {
    return 'simple';
  }

  // Medium-length queries with question words → moderate (benefit from HyDE)
  if ((hasAbstractQuestionWords || hasSimpleQuestionWords) && wordCount > 15) {
    return 'moderate';
  }

  return 'simple';
}

// ============================================================================
// QueryClassifier
// ============================================================================

/**
 * Chain-of-thought LLM classifier that determines retrieval depth (T0-T3)
 * and retrieval strategy (`none`/`simple`/`moderate`/`complex`) for each
 * incoming query.
 *
 * The strategy field controls whether HyDE (Hypothetical Document Embedding)
 * is engaged during retrieval and at what depth.
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
 * console.log(result.tier);     // 1
 * console.log(result.strategy); // 'moderate'
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
   * Classifies a user query into a retrieval tier and strategy.
   *
   * Steps:
   * 1. Builds a chain-of-thought system prompt with tier definitions, strategy
   *    definitions, topic list, tool list, and optional conversation context.
   * 2. Calls the LLM via `generateText`.
   * 3. Parses the JSON response (handling optional markdown code fences).
   * 4. Validates and normalises the `strategy` field (falls back to tier-inferred).
   * 5. Applies confidence-based tier bumping: if confidence < threshold, tier += 1.
   * 6. Caps the tier at the configured `maxTier`.
   * 7. On ANY error, returns a safe T1/simple fallback with confidence 0.
   *
   * @param query - The user's query text to classify.
   * @param conversationHistory - Optional recent conversation messages for context.
   * @returns A {@link ClassificationResult} with tier, strategy, confidence, reasoning, and metadata.
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
  // Plan-aware classification
  // --------------------------------------------------------------------------

  /**
   * Classifies a query and produces a full {@link RetrievalPlan}.
   *
   * This is an enhanced alternative to {@link classify} that evaluates more
   * dimensions (source selection, memory relevance, modality, temporal
   * preferences, decomposability) and outputs a structured plan that the
   * {@link UnifiedRetriever} can execute directly.
   *
   * Falls back to {@link buildDefaultPlan} when classification fails or
   * the LLM response is malformed.
   *
   * @param query - The user's query text to classify.
   * @param conversationHistory - Optional recent conversation messages for context.
   * @returns A tuple of [ClassificationResult, RetrievalPlan].
   *
   * @example
   * ```typescript
   * const [classification, plan] = await classifier.classifyWithPlan(
   *   'How does the auth system integrate with the session store?',
   * );
   * const result = await unifiedRetriever.retrieve(query, plan);
   * ```
   *
   * @see classify for the simpler tier+strategy classification
   * @see buildDefaultPlan for plan defaults per strategy level
   */
  async classifyWithPlan(
    query: string,
    conversationHistory?: ConversationMessage[],
  ): Promise<[ClassificationResult, RetrievalPlan]> {
    try {
      const systemPrompt = this.buildPlanSystemPrompt(conversationHistory);

      const response = await generateText({
        provider: this.config.provider,
        model: this.config.model,
        system: systemPrompt,
        prompt: query,
        temperature: 0.1,
        apiKey: this.config.apiKey,
        baseUrl: this.config.baseUrl,
      });

      const { classification, plan } = this.parsePlanResponse(response.text);
      const constrainedClassification = this.applyConstraints(classification);

      // Re-sync plan strategy with constrained classification
      const constrainedPlan: RetrievalPlan = {
        ...plan,
        strategy: constrainedClassification.strategy,
        confidence: constrainedClassification.confidence,
      };

      return [constrainedClassification, constrainedPlan];
    } catch {
      const fallback = this.fallbackResult();
      return [fallback, buildDefaultPlan(fallback.strategy)];
    }
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  /**
   * Builds the plan-aware system prompt by replacing template placeholders.
   *
   * @param conversationHistory - Optional conversation messages to include.
   * @returns The fully rendered plan system prompt string.
   */
  private buildPlanSystemPrompt(conversationHistory?: ConversationMessage[]): string {
    let conversationContext = 'No prior conversation.';

    if (conversationHistory && conversationHistory.length > 0) {
      conversationContext = conversationHistory
        .map((msg) => `${msg.role}: ${msg.content}`)
        .join('\n');
    }

    return PLAN_SYSTEM_PROMPT_TEMPLATE
      .replace('{{TOPIC_LIST}}', this.config.topicList)
      .replace('{{TOOL_LIST}}', this.config.toolList)
      .replace('{{CONVERSATION_CONTEXT}}', conversationContext);
  }

  /**
   * Parses the LLM response for plan-aware classification.
   *
   * Extracts both the base {@link ClassificationResult} and the full
   * {@link RetrievalPlan} from the LLM JSON output. Missing plan fields
   * are filled from {@link buildDefaultPlan} defaults.
   *
   * @param text - Raw text from the LLM response.
   * @returns Parsed classification result and retrieval plan.
   * @throws If the response cannot be parsed as valid JSON.
   */
  private parsePlanResponse(text: string): {
    classification: ClassificationResult;
    plan: RetrievalPlan;
  } {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error(`Failed to extract JSON from plan classifier response: ${text.slice(0, 200)}`);
    }

    const raw: RawPlanClassifierResponse = JSON.parse(jsonMatch[0]);

    const tier = raw.tier as QueryTier;
    const strategy: RetrievalStrategy =
      raw.strategy && VALID_STRATEGIES.has(raw.strategy)
        ? (raw.strategy as RetrievalStrategy)
        : TIER_TO_STRATEGY[tier] ?? 'simple';

    const classification: ClassificationResult = {
      tier,
      strategy,
      confidence: raw.confidence,
      reasoning: raw.thinking,
      internalKnowledgeSufficient: raw.internal_knowledge_sufficient,
      suggestedSources: raw.suggested_sources as ClassificationResult['suggestedSources'],
      toolsNeeded: raw.tools_needed,
    };

    // Build the plan from LLM output, filling gaps from defaults
    const defaults = buildDefaultPlan(strategy);

    const plan: RetrievalPlan = {
      strategy,
      sources: {
        vector: raw.sources?.vector ?? defaults.sources.vector,
        bm25: raw.sources?.bm25 ?? defaults.sources.bm25,
        graph: raw.sources?.graph ?? defaults.sources.graph,
        raptor: raw.sources?.raptor ?? defaults.sources.raptor,
        memory: raw.sources?.memory ?? defaults.sources.memory,
        multimodal: raw.sources?.multimodal ?? defaults.sources.multimodal,
      },
      hyde: {
        enabled: raw.hyde?.enabled ?? defaults.hyde.enabled,
        hypothesisCount: raw.hyde?.hypothesisCount ?? defaults.hyde.hypothesisCount,
      },
      memoryTypes: (raw.memoryTypes ?? defaults.memoryTypes) as RetrievalPlan['memoryTypes'],
      modalities: (raw.modalities ?? defaults.modalities) as RetrievalPlan['modalities'],
      temporal: {
        preferRecent: raw.temporal?.preferRecent ?? defaults.temporal.preferRecent,
        recencyBoost: raw.temporal?.recencyBoost ?? defaults.temporal.recencyBoost,
        maxAgeMs: raw.temporal?.maxAgeMs !== undefined ? raw.temporal.maxAgeMs : defaults.temporal.maxAgeMs,
      },
      graphConfig: {
        maxDepth: raw.graphConfig?.maxDepth ?? defaults.graphConfig.maxDepth,
        minEdgeWeight: raw.graphConfig?.minEdgeWeight ?? defaults.graphConfig.minEdgeWeight,
      },
      raptorLayers: raw.raptorLayers ?? defaults.raptorLayers,
      deepResearch: raw.deepResearch ?? defaults.deepResearch,
      confidence: raw.confidence,
      reasoning: raw.reasoning ?? raw.thinking,
    };

    return { classification, plan };
  }

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
   * The `strategy` field is validated against the set of known strategies.
   * If the LLM returns an unrecognized strategy or omits it, the strategy
   * is inferred from the tier via {@link TIER_TO_STRATEGY}.
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

    const tier = raw.tier as QueryTier;

    // Validate the strategy field — fall back to tier-inferred if invalid or missing
    const strategy: RetrievalStrategy =
      raw.strategy && VALID_STRATEGIES.has(raw.strategy)
        ? (raw.strategy as RetrievalStrategy)
        : TIER_TO_STRATEGY[tier] ?? 'simple';

    return {
      tier,
      strategy,
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
   * 3. Re-synchronise the strategy with the potentially adjusted tier.
   *
   * @param result - The raw classification result from the LLM.
   * @returns The constrained classification result.
   */
  private applyConstraints(result: ClassificationResult): ClassificationResult {
    let tier = result.tier;
    let strategy = result.strategy;

    // Bump tier when confidence is below the threshold
    if (result.confidence < this.config.confidenceThreshold) {
      tier = Math.min(tier + 1, 3) as QueryTier;
    }

    // Cap at maxTier
    tier = Math.min(tier, this.config.maxTier) as QueryTier;

    // Re-synchronise strategy with the (possibly adjusted) tier.
    // If the tier was bumped and strategy didn't change, upgrade strategy
    // to match the new tier level.
    if (tier !== result.tier) {
      const tierStrategy = TIER_TO_STRATEGY[tier];
      // Only upgrade, never downgrade — STRATEGY_TO_TIER values ascend
      if (STRATEGY_TO_TIER[tierStrategy] > STRATEGY_TO_TIER[strategy]) {
        strategy = tierStrategy;
      }
    }

    return {
      ...result,
      tier,
      strategy,
    };
  }

  /**
   * Returns a safe T1/simple fallback result when classification fails.
   *
   * T1 ensures at least a basic vector search is performed, which is a
   * reasonable default when the classifier cannot determine the right tier.
   * Strategy `simple` avoids the overhead of HyDE when the LLM is down.
   *
   * @returns A T1 {@link ClassificationResult} with confidence 0.
   */
  private fallbackResult(): ClassificationResult {
    return {
      tier: 1,
      strategy: 'simple',
      confidence: 0,
      reasoning: 'Classification failed; falling back to T1 for safety.',
      internalKnowledgeSufficient: false,
      suggestedSources: ['vector'],
      toolsNeeded: [],
    };
  }
}
