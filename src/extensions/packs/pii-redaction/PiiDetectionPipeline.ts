/**
 * @file PiiDetectionPipeline.ts
 * @description Orchestrates the four-tier PII detection pipeline: Regex →
 * NLP pre-filter → NER model → LLM judge.  Each tier is gated by the
 * previous tier's output or configuration flags so that only the work needed
 * is performed, keeping median latency low for clean or simple inputs.
 *
 * ## Tier overview
 *
 * | Tier | Class                  | Always runs?                                  |
 * |------|------------------------|-----------------------------------------------|
 * | 1    | RegexRecognizer        | Yes                                           |
 * | 2    | NlpPrefilterRecognizer | Yes (when available / compromise installed)   |
 * | 3    | NerModelRecognizer     | Only when Tier 2 found PERSON/ORG/LOC         |
 * | 4    | LlmJudgeRecognizer     | Only for ambiguous entities (0.3 < score < 0.7)|
 *
 * After tiers 1–3 produce raw candidates, {@link mergeEntities} collapses
 * overlapping spans.  Tier 4 then re-examines the ambiguous slice.  Finally
 * the merged list is threshold-filtered and sorted by start offset.
 *
 * @module pii-redaction/PiiDetectionPipeline
 */

import type { ISharedServiceRegistry } from '../../ISharedServiceRegistry';
import type {
  PiiEntity,
  PiiEntityType,
  PiiDetectionResult,
  PiiRedactionPackOptions,
  LlmJudgeConfig,
} from './types';
import { ALL_PII_ENTITY_TYPES } from './types';
import { RegexRecognizer } from './recognizers/RegexRecognizer';
import { NlpPrefilterRecognizer } from './recognizers/NlpPrefilterRecognizer';
import { NerModelRecognizer } from './recognizers/NerModelRecognizer';
import { LlmJudgeRecognizer } from './recognizers/LlmJudgeRecognizer';
import { mergeEntities } from './EntityMerger';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Window of characters scanned to each side of an entity when performing
 * context enhancement in Step 2.  ±50 chars provides enough context for
 * keyword phrases like "social security number:" while remaining cheap.
 */
const CONTEXT_WINDOW_CHARS = 50;

/**
 * Score boost applied when a strong context keyword is found within the
 * {@link CONTEXT_WINDOW_CHARS} window around a matching entity.
 */
const CONTEXT_BOOST_STRONG = 0.2;

/**
 * Score boost applied when a weaker/generic context keyword is found.
 */
const CONTEXT_BOOST_WEAK = 0.15;

/**
 * Lower bound (exclusive) of the ambiguous score range that triggers the
 * LLM judge.  Entities with score ≤ this value are assumed to be too weak
 * to bother re-examining.
 */
const LLM_JUDGE_SCORE_LOW = 0.3;

/**
 * Upper bound (exclusive) of the ambiguous score range.  Entities at or
 * above this value have sufficient confidence without needing LLM
 * verification.
 */
const LLM_JUDGE_SCORE_HIGH = 0.7;

/**
 * Default confidence threshold applied when none is specified in
 * {@link PiiRedactionPackOptions}.  Matches the documented default.
 */
const DEFAULT_CONFIDENCE_THRESHOLD = 0.5;

// ---------------------------------------------------------------------------
// Context-keyword definitions
// ---------------------------------------------------------------------------

/**
 * Mapping of {@link PiiEntityType} to the context keyword groups that signal
 * the entity is genuine PII in context.  Keywords are matched
 * case-insensitively.
 *
 * Each entry is a tuple of [keywords, boostAmount]:
 * - Strong keywords (more specific phrases) → {@link CONTEXT_BOOST_STRONG}
 * - Weak keywords (generic labels)          → {@link CONTEXT_BOOST_WEAK}
 */
const CONTEXT_KEYWORDS: Partial<
  Record<PiiEntityType, Array<{ keywords: string[]; boost: number }>>
> = {
  SSN: [
    { keywords: ['social security', 'ssn:', 'ss#'], boost: CONTEXT_BOOST_STRONG },
    { keywords: ['tax id', 'government id'], boost: CONTEXT_BOOST_WEAK },
  ],
  PERSON: [
    { keywords: ['name:', 'full name', 'first name', 'last name', 'patient', 'employee'], boost: CONTEXT_BOOST_STRONG },
    { keywords: ['mr.', 'mrs.', 'ms.', 'dr.', 'prof.'], boost: CONTEXT_BOOST_WEAK },
  ],
  DATE_OF_BIRTH: [
    { keywords: ['date of birth', 'dob:', 'born on', 'birthday'], boost: CONTEXT_BOOST_STRONG },
    { keywords: ['birth', 'age:'], boost: CONTEXT_BOOST_WEAK },
  ],
  LOCATION: [
    { keywords: ['address:', 'mailing address', 'home address', 'street', 'city', 'zip code', 'postal code'], boost: CONTEXT_BOOST_STRONG },
    { keywords: ['lives at', 'resides at', 'located at'], boost: CONTEXT_BOOST_WEAK },
  ],
  PHONE: [
    { keywords: ['phone:', 'tel:', 'mobile:', 'cell:', 'fax:', 'telephone', 'contact number'], boost: CONTEXT_BOOST_STRONG },
    { keywords: ['call', 'reach me at'], boost: CONTEXT_BOOST_WEAK },
  ],
  EMAIL: [
    { keywords: ['email:', 'e-mail:', 'contact:', 'email address'], boost: CONTEXT_BOOST_STRONG },
    { keywords: ['send to', 'reply to', '@'], boost: CONTEXT_BOOST_WEAK },
  ],
  CREDIT_CARD: [
    { keywords: ['credit card', 'card number', 'cc:', 'visa', 'mastercard', 'amex'], boost: CONTEXT_BOOST_STRONG },
    { keywords: ['payment', 'billing', 'expires'], boost: CONTEXT_BOOST_WEAK },
  ],
  PASSPORT: [
    { keywords: ['passport', 'passport number', 'passport no.', 'travel document'], boost: CONTEXT_BOOST_STRONG },
    { keywords: ['identity', 'nationality', 'issued by'], boost: CONTEXT_BOOST_WEAK },
  ],
};

// ---------------------------------------------------------------------------
// PiiDetectionPipeline
// ---------------------------------------------------------------------------

/**
 * Four-tier PII detection pipeline that orchestrates Regex, NLP pre-filter,
 * NER model, and LLM judge recognisers into a single `detect()` call.
 *
 * ### Construction
 * ```ts
 * const pipeline = new PiiDetectionPipeline(serviceRegistry, packOptions, getSecret);
 * const result = await pipeline.detect('Call me at 555-123-4567');
 * ```
 *
 * ### Lifecycle
 * The pipeline is designed to be constructed once at pack startup and reused
 * across many `detect()` calls.  Recognisers are constructed eagerly but load
 * their heavy dependencies (NLP models, NER weights) lazily on first use.
 *
 * ### Concurrency
 * `detect()` is safe to call concurrently from multiple async contexts:
 * - Regex and NLP recognisers create fresh scoped instances per call.
 * - The NER model pipeline is shared and thread-safe via the service registry.
 * - The LLM judge uses an internal semaphore to cap concurrent requests.
 */
export class PiiDetectionPipeline {
  // -----------------------------------------------------------------------
  // Recogniser instances
  // -----------------------------------------------------------------------

  /**
   * Tier 1: Regex-based recogniser backed by the `openredaction` library.
   * Always runs regardless of configuration.
   */
  private readonly regexRecognizer: RegexRecognizer;

  /**
   * Tier 2: NLP pre-filter using the `compromise` library.
   * Catches person names, locations, and organisations that regex misses.
   * Returns low-confidence candidates (0.3–0.6) for higher-tier confirmation.
   */
  private readonly nlpPrefilter: NlpPrefilterRecognizer;

  /**
   * Tier 3: HuggingFace BERT NER model for high-accuracy named-entity
   * recognition.  Only runs when Tier 2 found at least one NER-class
   * candidate (PERSON, ORGANIZATION, or LOCATION).
   */
  private readonly nerRecognizer: NerModelRecognizer;

  /**
   * Tier 4: LLM-powered judge that re-examines ambiguous entities.
   * Only created when {@link PiiRedactionPackOptions.llmJudge} is provided.
   */
  private readonly llmJudge: LlmJudgeRecognizer | null;

  // -----------------------------------------------------------------------
  // Configuration snapshot
  // -----------------------------------------------------------------------

  /** Resolved entity types to detect (defaults to all types). */
  private readonly entityTypes: PiiEntityType[];

  /** Allowlist passed through to {@link mergeEntities} (string values). */
  private readonly allowlist: string[];

  /** Denylist passed through to {@link mergeEntities} (string values). */
  private readonly denylist: string[];

  /**
   * Minimum confidence score for the final output.
   * @default {@link DEFAULT_CONFIDENCE_THRESHOLD}
   */
  private readonly confidenceThreshold: number;

  /**
   * Whether to load and run the NER model tier.
   * `false` means Tier 3 is unconditionally skipped.
   * @default true (when the option is absent, NER is allowed to run)
   */
  private readonly enableNerModel: boolean;

  // -----------------------------------------------------------------------
  // Constructor
  // -----------------------------------------------------------------------

  /**
   * Construct a new PiiDetectionPipeline.
   *
   * All recognisers are instantiated here but do not load their heavy
   * dependencies (NLP libraries, transformer models) until the first call
   * to {@link detect}.
   *
   * @param services   - Shared service registry for lazy-loading NLP/NER
   *                     models so they are shared across the agent.
   * @param options    - Pack-level configuration including entity type
   *                     filter, confidence threshold, allow/denylists, and
   *                     optional LLM judge config.
   * @param getSecret  - Optional function to look up credential secrets by
   *                     ID (e.g. `'openai.apiKey'`, `'pii.llm.apiKey'`).
   *                     Used to resolve the LLM judge API key when not
   *                     provided explicitly in {@link LlmJudgeConfig.apiKey}.
   */
  constructor(
    services: ISharedServiceRegistry,
    options: PiiRedactionPackOptions,
    getSecret?: (id: string) => string | undefined,
  ) {
    // ---- Resolve entity types ----
    this.entityTypes = options.entityTypes ?? [...ALL_PII_ENTITY_TYPES];

    // ---- Resolve confidence threshold ----
    this.confidenceThreshold = options.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD;

    // ---- Resolve NER model flag ----
    // `enableNerModel !== false` means "true unless explicitly disabled".
    this.enableNerModel = options.enableNerModel !== false;

    // ---- Resolve allow/denylist (normalise RegExp entries to strings) ----
    // MergeOptions only accepts string[] for allow/denylist, so we strip
    // RegExp entries here.  RegExp entries are useful for the broader pack
    // but the merger works with string exact-match lists.
    this.allowlist = (options.allowlist ?? [])
      .filter((v): v is string => typeof v === 'string');

    this.denylist = (options.denylist ?? [])
      .filter((v): v is string => typeof v === 'string');

    // ---- Instantiate recognisers ----
    this.regexRecognizer = new RegexRecognizer();
    this.nlpPrefilter = new NlpPrefilterRecognizer(services);
    this.nerRecognizer = new NerModelRecognizer(services);

    // ---- Instantiate LLM judge if configured ----
    if (options.llmJudge) {
      const resolvedConfig = this.resolveJudgeApiKey(options.llmJudge, getSecret);
      this.llmJudge = new LlmJudgeRecognizer(resolvedConfig);
    } else {
      this.llmJudge = null;
    }
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Run all applicable detection tiers over `text` and return a
   * {@link PiiDetectionResult} with the merged, threshold-filtered entity
   * list and pipeline metadata.
   *
   * ### Processing steps
   * 1. **Tier 1 (Regex)** — Always executed.  Deterministic pattern matching.
   * 2. **Context enhancement** — Scans ±{@link CONTEXT_WINDOW_CHARS} chars
   *    around each Tier 1 entity for keyword signals and boosts scores.
   * 3. **Tier 2 (NLP)** — Always attempted; degrades gracefully if `compromise`
   *    is not installed.
   * 4. **Tier 3 (NER)** — Runs only when:
   *    - `enableNerModel !== false`, AND
   *    - Tier 2 found at least one PERSON, ORGANIZATION, or LOCATION candidate.
   * 5. **Merge** — {@link mergeEntities} collapses overlapping spans and applies
   *    allow/denylists.  Threshold is NOT applied yet.
   * 6. **Tier 4 (LLM judge)** — Applied only to entities in the ambiguous score
   *    band (0.3 < score < 0.7) and only when `llmJudge` is configured.
   *    `null` results (NOT_PII) are discarded.
   * 7. **Threshold filter** — Entities with `score < confidenceThreshold` are
   *    removed from the final output.
   * 8. **Sort + summary** — Sorted by start offset; summary string built.
   *
   * @param text - The raw input text to analyse.
   * @returns A {@link PiiDetectionResult} containing detected entities and
   *          pipeline execution metadata.
   */
  public async detect(text: string): Promise<PiiDetectionResult> {
    // Track wall-clock time from the very start of detection.
    const startTime = Date.now();

    // Accumulates all raw entities from tiers 1–3 before merging.
    const rawEntities: PiiEntity[] = [];

    // Tracks which tiers were actually executed (for observability).
    const tiersExecuted: Array<'regex' | 'ner' | 'llm'> = [];

    // -----------------------------------------------------------------------
    // Tier 1: Regex recogniser — always runs.
    // -----------------------------------------------------------------------
    const tier1Entities = await this.regexRecognizer.recognize(text, {
      entityTypes: this.entityTypes,
    });

    tiersExecuted.push('regex');
    rawEntities.push(...tier1Entities);

    // -----------------------------------------------------------------------
    // Step 2: Context enhancement — boost scores based on surrounding keywords.
    // -----------------------------------------------------------------------
    const tier1Enhanced = this.applyContextEnhancement(tier1Entities, text);

    // Replace the tier1 entities in rawEntities with their enhanced versions.
    // We rebuild the slice since arrays are reference-ordered.
    rawEntities.splice(0, tier1Entities.length, ...tier1Enhanced);

    // -----------------------------------------------------------------------
    // Tier 2: NLP pre-filter — always attempted.
    // -----------------------------------------------------------------------
    const tier2Entities = await this.nlpPrefilter.recognize(text, {
      entityTypes: this.entityTypes,
    });

    // Even if compromise is unavailable (returns []), we still push nothing.
    rawEntities.push(...tier2Entities);

    // -----------------------------------------------------------------------
    // Tier 3: NER model — gated on Tier 2 finding NER-class candidates.
    // -----------------------------------------------------------------------

    /** Entity types that gate Tier 3 execution. */
    const NER_GATE_TYPES = new Set<PiiEntityType>(['PERSON', 'ORGANIZATION', 'LOCATION']);

    const tier2HasNerCandidates = tier2Entities.some((e) =>
      NER_GATE_TYPES.has(e.entityType),
    );

    if (this.enableNerModel && tier2HasNerCandidates) {
      // Tier 2 found at least one name/org/location candidate — run NER for
      // higher-accuracy confirmation.
      const tier3Entities = await this.nerRecognizer.recognize(text, {
        entityTypes: this.entityTypes,
        // Provide Tier 2 results as prior context so NER can skip confirmed spans.
        priorEntities: tier2Entities,
      });

      rawEntities.push(...tier3Entities);

      // Record 'ner' in tiersExecuted (we reuse the same label for both NLP
      // tiers since PiiDetectionResult.tiersExecuted uses 'ner' as the value
      // representing all NER-type processing).
      tiersExecuted.push('ner');
    }

    // -----------------------------------------------------------------------
    // Step 5: Merge — collapse overlapping spans; apply allow/denylist.
    //         Do NOT apply threshold yet (LLM judge needs the full list).
    // -----------------------------------------------------------------------
    const mergedEntities = mergeEntities(
      rawEntities,
      {
        allowlist: this.allowlist,
        denylist: this.denylist,
        // Intentionally no confidenceThreshold here — applied post LLM judge.
      },
      text,
    );

    // -----------------------------------------------------------------------
    // Tier 4: LLM judge — only for ambiguous-score entities.
    // -----------------------------------------------------------------------
    let judgedEntities: PiiEntity[];

    if (this.llmJudge !== null) {
      judgedEntities = await this.runLlmJudge(mergedEntities, text);
      tiersExecuted.push('llm');
    } else {
      judgedEntities = mergedEntities;
    }

    // -----------------------------------------------------------------------
    // Step 7: Final threshold filter.
    // -----------------------------------------------------------------------
    const thresholded = judgedEntities.filter(
      (e) => e.score >= this.confidenceThreshold,
    );

    // -----------------------------------------------------------------------
    // Step 8: Sort by start offset and build summary.
    // -----------------------------------------------------------------------
    const sorted = thresholded.slice().sort((a, b) => a.start - b.start);
    const summary = this.buildSummary(sorted);

    return {
      entities: sorted,
      inputLength: text.length,
      processingTimeMs: Date.now() - startTime,
      tiersExecuted,
      summary,
    };
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /**
   * Applies context enhancement to Tier 1 regex entities.
   *
   * For each entity, a window of ±{@link CONTEXT_WINDOW_CHARS} characters
   * around the entity is scanned for known context keywords.  When a
   * matching keyword is found for that entity's type, the entity's score is
   * boosted by the keyword's associated {@link CONTEXT_BOOST_STRONG} or
   * {@link CONTEXT_BOOST_WEAK} amount, capped at 1.0.
   *
   * Entities whose type has no context-keyword mapping are returned
   * unchanged.  A new array of entities is returned — the originals are not
   * mutated.
   *
   * @param entities - Raw Tier 1 entities to enhance.
   * @param text     - Full input text (used to extract context windows).
   * @returns New array of entities with potentially boosted scores.
   */
  private applyContextEnhancement(
    entities: PiiEntity[],
    text: string,
  ): PiiEntity[] {
    return entities.map((entity) => {
      const keywordGroups = CONTEXT_KEYWORDS[entity.entityType];

      // No context keywords defined for this entity type — return as-is.
      if (!keywordGroups || keywordGroups.length === 0) return entity;

      // Extract the context window around this entity.
      const ctxStart = Math.max(0, entity.start - CONTEXT_WINDOW_CHARS);
      const ctxEnd = Math.min(text.length, entity.end + CONTEXT_WINDOW_CHARS);
      const contextSlice = text.slice(ctxStart, ctxEnd).toLowerCase();

      // Accumulate the total boost from all matched keyword groups.
      let totalBoost = 0;

      for (const group of keywordGroups) {
        // Check if any keyword in this group appears in the context window.
        const matched = group.keywords.some((kw) => contextSlice.includes(kw));

        if (matched) {
          // Only apply the group's boost once even if multiple keywords match.
          totalBoost += group.boost;
          // Once we've found a strong-boost match there is no point continuing
          // to look for weaker matches; break early to avoid double-boosting.
          if (group.boost >= CONTEXT_BOOST_STRONG) break;
        }
      }

      if (totalBoost === 0) return entity;

      // Cap the final score at 1.0 to stay within the valid range.
      const boostedScore = Math.min(1.0, entity.score + totalBoost);

      return { ...entity, score: boostedScore };
    });
  }

  /**
   * Runs the LLM judge over entities in the ambiguous score band
   * (LLM_JUDGE_SCORE_LOW < score < LLM_JUDGE_SCORE_HIGH).
   *
   * Entities outside the ambiguous band are passed through as-is.
   * For ambiguous entities, `judge()` is awaited in parallel (up to the
   * semaphore limit configured in LlmJudgeRecognizer).  Entities judged to
   * be NOT_PII (null return) are discarded.
   *
   * @param entities - Merged entity list from Steps 5.
   * @param text     - Full input text passed to the judge for context.
   * @returns Updated entity list after LLM judgement.
   */
  private async runLlmJudge(
    entities: PiiEntity[],
    text: string,
  ): Promise<PiiEntity[]> {
    // The judge is guaranteed non-null at call sites — assert for TS.
    const judge = this.llmJudge!;

    // Partition entities into clear (pass-through) and ambiguous (judge) groups.
    const clearEntities: PiiEntity[] = [];
    const ambiguousEntities: PiiEntity[] = [];

    for (const entity of entities) {
      if (entity.score > LLM_JUDGE_SCORE_LOW && entity.score < LLM_JUDGE_SCORE_HIGH) {
        ambiguousEntities.push(entity);
      } else {
        clearEntities.push(entity);
      }
    }

    // Short-circuit if no entities need judging.
    if (ambiguousEntities.length === 0) return clearEntities;

    // Fire all judge calls concurrently — the semaphore inside LlmJudgeRecognizer
    // throttles actual concurrency to the configured maxConcurrency.
    const judgeResults = await Promise.all(
      ambiguousEntities.map((entity) => judge.judge(entity, text)),
    );

    // Collect non-null results (null = judge determined NOT_PII → discard).
    const confirmedEntities: PiiEntity[] = judgeResults.filter(
      (r): r is PiiEntity => r !== null,
    );

    // Combine confirmed ambiguous entities with the clear (non-ambiguous) ones.
    return [...clearEntities, ...confirmedEntities];
  }

  /**
   * Resolves the API key for the LLM judge using a three-level fallback:
   *
   * 1. Explicit `config.apiKey` (highest priority — caller-supplied).
   * 2. Provider-specific secret via `getSecret('<provider>.apiKey')`.
   * 3. Pack-specific generic secret via `getSecret('pii.llm.apiKey')`.
   *
   * Returns a new {@link LlmJudgeConfig} with `apiKey` set to the resolved
   * value (or the original value if a key was already present).
   *
   * @param config    - Original LLM judge configuration.
   * @param getSecret - Optional secret resolver function.
   * @returns Config with `apiKey` resolved to the best available value.
   */
  private resolveJudgeApiKey(
    config: LlmJudgeConfig,
    getSecret?: (id: string) => string | undefined,
  ): LlmJudgeConfig {
    // 1. If an explicit apiKey is already present, use it directly.
    if (config.apiKey) return config;

    if (!getSecret) return config;

    // 2. Provider-specific secret: e.g. 'openai.apiKey' or 'anthropic.apiKey'.
    const providerKey = getSecret(`${config.provider}.apiKey`);
    if (providerKey) return { ...config, apiKey: providerKey };

    // 3. Pack-specific generic secret.
    const packKey = getSecret('pii.llm.apiKey');
    if (packKey) return { ...config, apiKey: packKey };

    // No key found via any path — return config unchanged (LlmJudgeRecognizer
    // will fail open when it cannot authenticate, returning original entities).
    return config;
  }

  /**
   * Builds a human-readable summary string from the final entity list.
   *
   * Format: `"<n> entities found: <count>×<TYPE>, ..."` or
   * `"No PII detected"` when the list is empty.
   *
   * Entity types are sorted alphabetically for deterministic output, and
   * only types that are actually present appear in the summary.
   *
   * @example
   * ```
   * "3 entities found: 1×EMAIL, 1×PERSON, 1×PHONE"
   * "No PII detected"
   * ```
   *
   * @param entities - Final threshold-filtered, sorted entity list.
   * @returns Human-readable summary string.
   */
  private buildSummary(entities: PiiEntity[]): string {
    if (entities.length === 0) return 'No PII detected';

    // Count occurrences of each entity type.
    const typeCounts = new Map<PiiEntityType, number>();
    for (const entity of entities) {
      typeCounts.set(entity.entityType, (typeCounts.get(entity.entityType) ?? 0) + 1);
    }

    // Build sorted count strings for stable output.
    const countParts = Array.from(typeCounts.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([type, count]) => `${count}×${type}`);

    const noun = entities.length === 1 ? 'entity' : 'entities';
    return `${entities.length} ${noun} found: ${countParts.join(', ')}`;
  }
}
