/**
 * @fileoverview QueryClassifier — chain-of-thought LLM classifier that
 * determines both the retrieval depth tier (T0-T3) and the retrieval
 * strategy (`none` / `simple` / `moderate` / `complex`) for each query,
 * along with capability recommendations (skills, tools, extensions).
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
 * **Capability selection** (when a CapabilityDiscoveryEngine is attached):
 * - Tier 0 summaries (~150 tokens) from the discovery engine are injected
 *   into the classification prompt so the LLM can recommend which skills,
 *   tools, and extensions to activate.
 * - When no discovery engine is available, a keyword-based heuristic
 *   selects capabilities as a zero-cost fallback.
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
import { buildDefaultPlan, buildDefaultExecutionPlan } from '../rag/unified/types.js';
import type {
  ExecutionPlan,
  RetrievalPlan,
  SkillRecommendation,
  ToolRecommendation,
  ExtensionRecommendation,
} from '../rag/unified/types.js';
import type { CapabilityDiscoveryEngine } from '../discovery/CapabilityDiscoveryEngine.js';

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
const PLAN_SYSTEM_PROMPT_TEMPLATE = `You are an advanced query classifier, retrieval plan generator, and capability recommender. Your job is to analyze the user's query and produce a structured execution plan specifying:
1. Which retrieval sources to query and how to combine them
2. What memory types to consult
3. Which skills, tools, and extensions should be activated to fulfill the request

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

## Available Skill Categories
{{SKILL_SUMMARIES}}

## Available Tool Categories
{{TOOL_SUMMARIES}}

## Available Extension Categories
{{EXTENSION_SUMMARIES}}

## Conversation Context
{{CONVERSATION_CONTEXT}}

## Instructions

Think step by step about this query:

1. COMPLEXITY: Is this a simple lookup, moderate analysis, or complex research?
2. RETRIEVAL SOURCES: Would keyword search help? Would entity relationships help? Would hierarchical summaries help?
3. MEMORY RELEVANCE: Has the agent seen related information before? Should we check episodic or semantic memory?
4. MODALITY: Does this query reference images, audio, or visual content?
5. TEMPORAL: Is this about recent events? Should we prefer newer information?
6. DECOMPOSABILITY: Can this be broken into sub-questions?
7. SKILLS NEEDED: Based on the available skill categories above, which skills should be activated? Consider skills that would help fulfill the user's request (e.g., web-search for finding information, coding-agent for code tasks, email-intelligence for email tasks). Only recommend skills that are genuinely needed.
8. TOOLS NEEDED: Based on the available tool categories above, which specific tools should be made available? Consider tools the agent will need to invoke (e.g., generateImage for image requests, webSearch for web queries). Only recommend tools that are genuinely needed.
9. EXTENSIONS NEEDED: Based on the available extension categories above, which extensions should be loaded? Extensions are heavier than individual tools, so only recommend when their full bundle is needed (e.g., browser-automation for web scraping tasks, voice-synthesis for audio output).
10. EXTERNAL CALLS: Does this query require calling external APIs or services beyond internal knowledge retrieval?

Based on your analysis, output ONLY a JSON object (no markdown fences, no extra text):
{
  "thinking": "<your step-by-step reasoning covering ALL 10 dimensions above>",
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
  "skills": [
    {"skillId": "skill-name", "reasoning": "why needed", "confidence": 0.9, "priority": 0}
  ],
  "tools": [
    {"toolId": "tool-name", "reasoning": "why needed", "confidence": 0.9, "priority": 0}
  ],
  "extensions": [
    {"extensionId": "ext-name", "reasoning": "why needed", "confidence": 0.8, "priority": 0}
  ],
  "requires_external_calls": false,
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
/**
 * Shape of the raw JSON response from the plan-aware classifier.
 *
 * Extends the base classifier response with full retrieval plan fields
 * AND capability recommendation arrays. All plan fields are optional —
 * missing fields are filled from {@link buildDefaultPlan} defaults.
 * Missing capability arrays default to empty.
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

  /** Recommended skills from the LLM classifier. */
  skills?: Array<{
    skillId?: string;
    reasoning?: string;
    confidence?: number;
    priority?: number;
  }>;

  /** Recommended tools from the LLM classifier. */
  tools?: Array<{
    toolId?: string;
    reasoning?: string;
    confidence?: number;
    priority?: number;
  }>;

  /** Recommended extensions from the LLM classifier. */
  extensions?: Array<{
    extensionId?: string;
    reasoning?: string;
    confidence?: number;
    priority?: number;
  }>;

  /** Whether external API calls are required. */
  requires_external_calls?: boolean;
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
   * Optional capability discovery engine for Tier 0 summaries.
   *
   * When set, the plan-aware classifier injects category-level capability
   * summaries (~150 tokens) into the LLM prompt so it can recommend which
   * skills, tools, and extensions to activate. When absent, the classifier
   * falls back to keyword-based heuristic capability selection.
   */
  private discoveryEngine: CapabilityDiscoveryEngine | null = null;

  /**
   * Creates a new QueryClassifier instance.
   * @param config - Classifier configuration with model, provider, and thresholds.
   */
  constructor(config: QueryClassifierConfig) {
    this.config = config;
  }

  /**
   * Attach a {@link CapabilityDiscoveryEngine} for Tier 0 capability summaries.
   *
   * When attached, the plan-aware classifier (`classifyWithPlan`) injects
   * category-level summaries of all available skills, tools, and extensions
   * into the LLM prompt. This allows the LLM to recommend capability
   * activations alongside the retrieval plan, without loading full schemas.
   *
   * @param engine - A configured and initialized CapabilityDiscoveryEngine, or `null` to detach.
   *
   * @example
   * ```typescript
   * const engine = new CapabilityDiscoveryEngine(embeddingManager, vectorStore);
   * await engine.initialize({ tools, skills, extensions, channels });
   * classifier.setCapabilityDiscoveryEngine(engine);
   * ```
   */
  setCapabilityDiscoveryEngine(engine: CapabilityDiscoveryEngine | null): void {
    this.discoveryEngine = engine;
  }

  /**
   * Get the attached CapabilityDiscoveryEngine, if any.
   *
   * @returns The discovery engine instance, or `null` if not configured.
   */
  getCapabilityDiscoveryEngine(): CapabilityDiscoveryEngine | null {
    return this.discoveryEngine;
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
   * Classifies a query and produces a full {@link ExecutionPlan}.
   *
   * This is an enhanced alternative to {@link classify} that evaluates more
   * dimensions (source selection, memory relevance, modality, temporal
   * preferences, decomposability, capability recommendations) and outputs a
   * structured plan that the {@link UnifiedRetriever} can execute directly,
   * along with skill/tool/extension recommendations for the agent runtime.
   *
   * When a {@link CapabilityDiscoveryEngine} is attached (via
   * {@link setCapabilityDiscoveryEngine}), the LLM prompt includes Tier 0
   * summaries (~150 tokens) of all available capabilities, enabling the LLM
   * to recommend specific skills, tools, and extensions.
   *
   * Falls back to {@link buildDefaultExecutionPlan} with heuristic capability
   * selection when classification fails or the LLM response is malformed.
   *
   * @param query - The user's query text to classify.
   * @param conversationHistory - Optional recent conversation messages for context.
   * @returns A tuple of [ClassificationResult, ExecutionPlan].
   *
   * @example
   * ```typescript
   * const [classification, plan] = await classifier.classifyWithPlan(
   *   'Search the web for recent AI news and summarize findings',
   * );
   * // plan.skills → [{ skillId: 'web-search', ... }]
   * // plan.tools → []
   * const result = await unifiedRetriever.retrieve(query, plan);
   * ```
   *
   * @see classify for the simpler tier+strategy classification
   * @see buildDefaultExecutionPlan for execution plan defaults per strategy level
   */
  async classifyWithPlan(
    query: string,
    conversationHistory?: ConversationMessage[],
  ): Promise<[ClassificationResult, ExecutionPlan]> {
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
      const constrainedPlan: ExecutionPlan = {
        ...plan,
        strategy: constrainedClassification.strategy,
        confidence: constrainedClassification.confidence,
      };

      return [constrainedClassification, constrainedPlan];
    } catch {
      const fallback = this.fallbackResult();
      const heuristicCaps = heuristicCapabilitySelect(query);
      return [fallback, buildDefaultExecutionPlan(fallback.strategy, {
        skills: heuristicCaps.skills,
        tools: heuristicCaps.tools,
        requiresExternalCalls: heuristicCaps.skills.length > 0 || heuristicCaps.tools.length > 0,
        internalKnowledgeSufficient: heuristicCaps.skills.length === 0 && heuristicCaps.tools.length === 0,
      })];
    }
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  /**
   * Builds the plan-aware system prompt by replacing template placeholders.
   *
   * When a {@link CapabilityDiscoveryEngine} is attached, Tier 0 summaries
   * for skills, tools, and extensions are injected into the prompt via the
   * `{{SKILL_SUMMARIES}}`, `{{TOOL_SUMMARIES}}`, and `{{EXTENSION_SUMMARIES}}`
   * placeholders. This costs ~150 extra tokens total but enables the LLM to
   * make informed capability activation recommendations.
   *
   * When no discovery engine is attached, the capability summary placeholders
   * are replaced with a "Not available" message.
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

    // Resolve Tier 0 capability summaries from the discovery engine
    let skillSummaries = 'No skill categories available.';
    let toolSummaries = 'No tool categories available.';
    let extensionSummaries = 'No extension categories available.';

    if (this.discoveryEngine?.isInitialized()) {
      const byKind = this.discoveryEngine.getTier0SummariesByKind();
      if (byKind.skills) skillSummaries = byKind.skills;
      if (byKind.tools) toolSummaries = byKind.tools;
      if (byKind.extensions) extensionSummaries = byKind.extensions;
    }

    return PLAN_SYSTEM_PROMPT_TEMPLATE
      .replace('{{TOPIC_LIST}}', this.config.topicList)
      .replace('{{TOOL_LIST}}', this.config.toolList)
      .replace('{{SKILL_SUMMARIES}}', skillSummaries)
      .replace('{{TOOL_SUMMARIES}}', toolSummaries)
      .replace('{{EXTENSION_SUMMARIES}}', extensionSummaries)
      .replace('{{CONVERSATION_CONTEXT}}', conversationContext);
  }

  /**
   * Parses the LLM response for plan-aware classification.
   *
   * Extracts the base {@link ClassificationResult}, the full retrieval
   * configuration, AND capability recommendations (skills, tools, extensions)
   * from the LLM JSON output. Missing plan fields are filled from
   * {@link buildDefaultPlan} defaults. Missing capability arrays default to empty.
   *
   * @param text - Raw text from the LLM response.
   * @returns Parsed classification result and execution plan.
   * @throws If the response cannot be parsed as valid JSON.
   */
  private parsePlanResponse(text: string): {
    classification: ClassificationResult;
    plan: ExecutionPlan;
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

    // Parse capability recommendations — validate and normalize each entry
    const skills: SkillRecommendation[] = (raw.skills ?? [])
      .filter((s) => s.skillId)
      .map((s, i) => ({
        skillId: s.skillId!,
        reasoning: s.reasoning ?? 'Recommended by classifier',
        confidence: Math.max(0, Math.min(1, s.confidence ?? 0.5)),
        priority: s.priority ?? i,
      }))
      .sort((a, b) => a.priority - b.priority);

    const tools: ToolRecommendation[] = (raw.tools ?? [])
      .filter((t) => t.toolId)
      .map((t, i) => ({
        toolId: t.toolId!,
        reasoning: t.reasoning ?? 'Recommended by classifier',
        confidence: Math.max(0, Math.min(1, t.confidence ?? 0.5)),
        priority: t.priority ?? i,
      }))
      .sort((a, b) => a.priority - b.priority);

    const extensions: ExtensionRecommendation[] = (raw.extensions ?? [])
      .filter((e) => e.extensionId)
      .map((e, i) => ({
        extensionId: e.extensionId!,
        reasoning: e.reasoning ?? 'Recommended by classifier',
        confidence: Math.max(0, Math.min(1, e.confidence ?? 0.5)),
        priority: e.priority ?? i,
      }))
      .sort((a, b) => a.priority - b.priority);

    const requiresExternalCalls = raw.requires_external_calls ??
      (skills.length > 0 || tools.length > 0 || strategy !== 'none');

    const plan: ExecutionPlan = {
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
      skills,
      tools,
      extensions,
      requiresExternalCalls,
      internalKnowledgeSufficient: raw.internal_knowledge_sufficient,
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

// ============================================================================
// Heuristic Capability Selection
// ============================================================================

/**
 * Keyword-pattern-based capability matching rules.
 *
 * Each entry maps a regex pattern (tested against the lowercased query)
 * to either a skill ID or a tool ID. When the pattern matches, the
 * corresponding recommendation is included in the heuristic result.
 *
 * @internal
 */
const HEURISTIC_SKILL_PATTERNS: Array<{
  pattern: RegExp;
  skillId: string;
  reasoning: string;
}> = [
  { pattern: /\b(search|find|look\s*up|research|google|browse)\b/i, skillId: 'web-search', reasoning: 'Query involves finding external information' },
  { pattern: /\b(code|program|function|debug|refactor|implement|write\s*code|fix\s*bug)\b/i, skillId: 'coding-agent', reasoning: 'Query involves code creation or analysis' },
  { pattern: /\b(email|send\s*mail|inbox|compose\s*email|mail\s*to)\b/i, skillId: 'email-intelligence', reasoning: 'Query involves email operations' },
  { pattern: /\b(summarize|tldr|brief|digest|condense|synopsis)\b/i, skillId: 'summarize', reasoning: 'Query asks for content summarization' },
  { pattern: /\b(deep\s*research|investigate|thorough\s*analysis|literature\s*review)\b/i, skillId: 'deep-research', reasoning: 'Query requires deep investigation' },
  { pattern: /\b(translate|translation|in\s+\w+\s+language)\b/i, skillId: 'translation', reasoning: 'Query involves language translation' },
  { pattern: /\b(post\s+to|tweet|publish|share\s+on|social\s*media)\b/i, skillId: 'social-broadcast', reasoning: 'Query involves social media posting' },
  { pattern: /\b(youtube|video|tiktok|upload\s+video)\b/i, skillId: 'youtube-bot', reasoning: 'Query involves video platform operations' },
  { pattern: /\b(blog|article|write\s*post|publish\s*article)\b/i, skillId: 'blog-publisher', reasoning: 'Query involves blog or article creation' },
];

/**
 * Keyword-pattern-based tool matching rules.
 *
 * @internal
 */
const HEURISTIC_TOOL_PATTERNS: Array<{
  pattern: RegExp;
  toolId: string;
  reasoning: string;
}> = [
  { pattern: /\b(image|picture|photo|draw|generate\s*image|illustration|artwork)\b/i, toolId: 'generateImage', reasoning: 'Query involves image generation' },
  { pattern: /\b(schedule|calendar|meeting|appointment|event|reminder)\b/i, toolId: 'calendar', reasoning: 'Query involves scheduling or calendar' },
  { pattern: /\b(web\s*search|search\s*online|look\s*up\s*online)\b/i, toolId: 'webSearch', reasoning: 'Query needs web search tool' },
  { pattern: /\b(file|read\s*file|write\s*file|save|open\s*document)\b/i, toolId: 'fileSystem', reasoning: 'Query involves file operations' },
  { pattern: /\b(run\s*code|execute|shell|terminal|command)\b/i, toolId: 'codeExecution', reasoning: 'Query requires code execution' },
  { pattern: /\b(analyze\s*data|chart|graph|plot|statistics|metrics)\b/i, toolId: 'dataAnalysis', reasoning: 'Query involves data analysis' },
];

/**
 * Rule-based heuristic capability selection for when no LLM is available.
 *
 * Evaluates the query against a curated set of keyword patterns to recommend
 * skills and tools. This provides zero-latency capability recommendations
 * as a fallback when the LLM classifier is unavailable, times out, or
 * returns an error.
 *
 * The heuristic is intentionally conservative — it only recommends
 * capabilities when there is a strong keyword signal. False negatives
 * (missing a recommendation) are preferred over false positives (recommending
 * unnecessary capabilities) to avoid activation overhead.
 *
 * @param query - The raw user query string.
 * @returns Object with `skills` and `tools` recommendation arrays.
 *
 * @example
 * ```typescript
 * const caps = heuristicCapabilitySelect('Search the web for AI news and generate an image');
 * // caps.skills → [{ skillId: 'web-search', ... }]
 * // caps.tools → [{ toolId: 'generateImage', ... }]
 * ```
 */
export function heuristicCapabilitySelect(query: string): {
  skills: SkillRecommendation[];
  tools: ToolRecommendation[];
} {
  const skills: SkillRecommendation[] = [];
  const tools: ToolRecommendation[] = [];

  let skillPriority = 0;
  let toolPriority = 0;

  for (const { pattern, skillId, reasoning } of HEURISTIC_SKILL_PATTERNS) {
    if (pattern.test(query)) {
      skills.push({
        skillId,
        reasoning,
        confidence: 0.6, // Heuristic confidence is lower than LLM
        priority: skillPriority++,
      });
    }
  }

  for (const { pattern, toolId, reasoning } of HEURISTIC_TOOL_PATTERNS) {
    if (pattern.test(query)) {
      tools.push({
        toolId,
        reasoning,
        confidence: 0.6, // Heuristic confidence is lower than LLM
        priority: toolPriority++,
      });
    }
  }

  return { skills, tools };
}
