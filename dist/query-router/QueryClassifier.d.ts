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
import type { ClassificationResult, ConversationMessage, QueryTier, QueryRouterRequestOptions, RetrievalStrategy } from './types.js';
import type { ExecutionPlan, SkillRecommendation, ToolRecommendation } from '../rag/unified/types.js';
import type { CapabilityDiscoveryEngine } from '../discovery/CapabilityDiscoveryEngine.js';
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
export declare function heuristicClassify(query: string): RetrievalStrategy;
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
export declare class QueryClassifier {
    /** Immutable classifier configuration. */
    private readonly config;
    /**
     * Optional capability discovery engine for Tier 0 summaries.
     *
     * When set, the plan-aware classifier injects category-level capability
     * summaries (~150 tokens) into the LLM prompt so it can recommend which
     * skills, tools, and extensions to activate. When absent, the classifier
     * falls back to keyword-based heuristic capability selection.
     */
    private discoveryEngine;
    /**
     * Creates a new QueryClassifier instance.
     * @param config - Classifier configuration with model, provider, and thresholds.
     */
    constructor(config: QueryClassifierConfig);
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
    setCapabilityDiscoveryEngine(engine: CapabilityDiscoveryEngine | null): void;
    /**
     * Get the attached CapabilityDiscoveryEngine, if any.
     *
     * @returns The discovery engine instance, or `null` if not configured.
     */
    getCapabilityDiscoveryEngine(): CapabilityDiscoveryEngine | null;
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
    classify(query: string, conversationHistory?: ConversationMessage[], _options?: QueryRouterRequestOptions): Promise<ClassificationResult>;
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
    classifyWithPlan(query: string, conversationHistory?: ConversationMessage[], options?: QueryRouterRequestOptions): Promise<[ClassificationResult, ExecutionPlan]>;
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
    private buildPlanSystemPrompt;
    /**
     * Cached catalog summaries to avoid repeated dynamic imports.
     * `null` means not yet loaded; a resolved value is cached for reuse.
     */
    private catalogSummariesCache;
    /**
     * Loads category-grouped summaries from the static capability catalog.
     *
     * This fallback uses the bundled platform knowledge corpus that ships inside
     * `@framers/agentos`. That keeps capability summaries available even when the
     * extensions registry package is not installed or its runtime build artifacts
     * are unavailable.
     *
     * @returns An object with `tools` and `extensions` summary strings,
     *          or "Not available" if the bundled corpus cannot be loaded.
     */
    private getCatalogSummaries;
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
    private parsePlanResponse;
    /**
     * Builds the system prompt by replacing template placeholders with actual
     * topic list, tool list, and conversation context.
     *
     * @param conversationHistory - Optional conversation messages to include as context.
     * @returns The fully rendered system prompt string.
     */
    private buildSystemPrompt;
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
    private parseResponse;
    /**
     * Applies post-classification constraints:
     * 1. If confidence < threshold, bump tier by 1 (request broader retrieval).
     * 2. Cap tier at the configured maxTier.
     * 3. Re-synchronise the strategy with the potentially adjusted tier.
     *
     * @param result - The raw classification result from the LLM.
     * @returns The constrained classification result.
     */
    private applyConstraints;
    /**
     * Returns a safe T1/simple fallback result when classification fails.
     *
     * T1 ensures at least a basic vector search is performed, which is a
     * reasonable default when the classifier cannot determine the right tier.
     * Strategy `simple` avoids the overhead of HyDE when the LLM is down.
     *
     * @returns A T1 {@link ClassificationResult} with confidence 0.
     */
    private fallbackResult;
}
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
export declare function heuristicCapabilitySelect(query: string, options?: QueryRouterRequestOptions): {
    skills: SkillRecommendation[];
    tools: ToolRecommendation[];
};
//# sourceMappingURL=QueryClassifier.d.ts.map