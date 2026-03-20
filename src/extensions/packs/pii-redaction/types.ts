/**
 * @file types.ts
 * @description Core type definitions for the PII Redaction extension pack.
 *
 * This module defines all shared types used across the PII detection pipeline:
 * entity types, detection results, redaction styles, configuration interfaces,
 * and stable service identity constants.
 *
 * @module pii-redaction/types
 */

// ---------------------------------------------------------------------------
// Entity type union
// ---------------------------------------------------------------------------

/**
 * Enumeration of all PII (Personally Identifiable Information) entity categories
 * that the detection pipeline can recognise.
 *
 * The union is intentionally a string-literal type rather than a TypeScript
 * `enum` so that values can be used directly as JSON without serialisation
 * gymnastics and tree-shaken away when not referenced.
 *
 * @example
 * ```ts
 * const myType: PiiEntityType = 'EMAIL';
 * ```
 */
export type PiiEntityType =
  /** US Social Security Number (format: NNN-NN-NNNN). */
  | 'SSN'
  /** Payment card numbers (Luhn-validated, 13–19 digits). */
  | 'CREDIT_CARD'
  /** RFC 5321 email addresses. */
  | 'EMAIL'
  /** International or domestic telephone numbers (E.164 and local variants). */
  | 'PHONE'
  /** IPv4 and IPv6 addresses. */
  | 'IP_ADDRESS'
  /** International Bank Account Number (ISO 13616). */
  | 'IBAN'
  /** Passport document numbers (multi-country patterns). */
  | 'PASSPORT'
  /** Driver's licence numbers (US state patterns and common international formats). */
  | 'DRIVERS_LICENSE'
  /** Generic government-issued ID numbers not covered by the above. */
  | 'GOV_ID'
  /** Date of birth — detected when contextual signals confirm a birthday. */
  | 'DATE_OF_BIRTH'
  /** Generic API tokens and secret keys (Bearer, sk-…, gh…, etc.). */
  | 'API_KEY'
  /** AWS Access Key IDs (AKIA…) and Secret Access Keys. */
  | 'AWS_KEY'
  /** Blockchain wallet addresses (Bitcoin, Ethereum, etc.). */
  | 'CRYPTO_ADDRESS'
  /** Full or partial personal names identified by NER. */
  | 'PERSON'
  /** Company, agency, or institution names identified by NER. */
  | 'ORGANIZATION'
  /** Geographical locations (city, country, address) identified by NER. */
  | 'LOCATION'
  /** Clinical terminology, diagnoses, medications, or health conditions. */
  | 'MEDICAL_TERM'
  /**
   * Catch-all bucket for spans flagged by the LLM judge or custom denylist
   * rules that do not map to a more specific type.
   */
  | 'UNKNOWN_PII';

// ---------------------------------------------------------------------------
// Canonical array of all entity types
// ---------------------------------------------------------------------------

/**
 * Immutable array listing every {@link PiiEntityType} value in declaration
 * order.  Useful for iterating all types, building UI checkboxes, or asserting
 * total coverage in tests.
 *
 * @example
 * ```ts
 * const allEnabled: PiiEntityType[] = [...ALL_PII_ENTITY_TYPES];
 * ```
 */
export const ALL_PII_ENTITY_TYPES: readonly PiiEntityType[] = [
  'SSN',
  'CREDIT_CARD',
  'EMAIL',
  'PHONE',
  'IP_ADDRESS',
  'IBAN',
  'PASSPORT',
  'DRIVERS_LICENSE',
  'GOV_ID',
  'DATE_OF_BIRTH',
  'API_KEY',
  'AWS_KEY',
  'CRYPTO_ADDRESS',
  'PERSON',
  'ORGANIZATION',
  'LOCATION',
  'MEDICAL_TERM',
  'UNKNOWN_PII',
] as const;

// ---------------------------------------------------------------------------
// PiiEntity interface
// ---------------------------------------------------------------------------

/**
 * A single detected PII entity span within a text.
 *
 * Coordinates (`start`, `end`) are UTF-16 code-unit offsets (i.e. the same
 * unit used by `String.prototype.slice`) so they can be applied directly to
 * the original input string without any conversion.
 */
export interface PiiEntity {
  /** The semantic category of the detected PII. */
  entityType: PiiEntityType;

  /**
   * The exact matched substring from the input text.
   * Preserves original casing and surrounding punctuation that was part of
   * the match (e.g. the angle-brackets in `<user@example.com>`).
   */
  text: string;

  /**
   * Zero-based start offset (inclusive) of the match in the original string,
   * measured in UTF-16 code units.
   */
  start: number;

  /**
   * Zero-based end offset (exclusive) of the match in the original string,
   * measured in UTF-16 code units.
   * Equivalent to `start + text.length` for BMP characters.
   */
  end: number;

  /**
   * Confidence score in the range [0, 1].
   * - `1.0` — deterministic (e.g. regex + checksum validation)
   * - `0.7–0.99` — high-confidence NER or heuristic match
   * - `< 0.5` — speculative; may be a false positive
   */
  score: number;

  /**
   * The detection tier that produced this entity.
   * - `'regex'` — Tier 0 pattern matcher
   * - `'ner'` — Tier 1 named-entity recognition model
   * - `'llm'` — Tier 2 LLM judge
   * - `'denylist'` — explicit denylist rule
   */
  source: 'regex' | 'nlp-prefilter' | 'ner-model' | 'ner' | 'llm' | 'denylist';

  /**
   * Arbitrary key-value metadata attached by the recogniser that produced
   * this entity.  Examples: `{ "pattern": "US_SSN_DASHES" }` or
   * `{ "nerLabel": "PER", "nerModel": "en_core_web_sm" }`.
   */
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Redaction style
// ---------------------------------------------------------------------------

/**
 * Controls how detected PII spans are replaced in the redacted output.
 *
 * | Style | Example output |
 * |---|---|
 * | `'placeholder'` | `[EMAIL]` |
 * | `'mask'` | `***` |
 * | `'hash'` | `a3f2c1d…` (SHA-256 truncated to 8 hex chars) |
 * | `'category-tag'` | `<PII type="EMAIL"/>` |
 */
export type RedactionStyle = 'placeholder' | 'mask' | 'hash' | 'category-tag';

// ---------------------------------------------------------------------------
// Detection result
// ---------------------------------------------------------------------------

/**
 * The full output of a PII detection pass over a single input string.
 */
export interface PiiDetectionResult {
  /**
   * All PII entities detected in the input, sorted by `start` offset in
   * ascending order.  Non-overlapping spans are guaranteed; if two recognisers
   * emit overlapping matches the one with the higher `score` is kept.
   */
  entities: PiiEntity[];

  /**
   * Length of the original input string in UTF-16 code units.
   * Stored for downstream metrics and to avoid re-measuring.
   */
  inputLength: number;

  /**
   * Wall-clock time in milliseconds spent running all detection tiers for
   * this particular input.
   */
  processingTimeMs: number;

  /**
   * Which detection tiers were actually executed, in execution order.
   * Possible values: `'regex'`, `'ner'`, `'llm'`.
   * A tier is omitted when it is disabled in {@link PiiRedactionPackOptions}
   * or when early-exit conditions prevent it from running.
   */
  tiersExecuted: Array<'regex' | 'ner' | 'llm'>;

  /**
   * Human-readable summary of detection results, e.g.:
   * `"3 entities found: 1×EMAIL, 1×PHONE, 1×PERSON"`.
   * Intended for logging and observability dashboards.
   */
  summary: string;
}

// ---------------------------------------------------------------------------
// LLM judge configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for the optional Tier-2 LLM judge that re-examines candidate
 * spans flagged by earlier tiers and catches context-dependent PII that
 * regex/NER cannot reliably detect.
 *
 * Using a small, cheap model (e.g. `gpt-4o-mini`) is strongly recommended
 * because the judge is called once per input chunk and latency matters.
 */
export interface LlmJudgeConfig {
  /**
   * LLM provider identifier.  Must match a key registered in the
   * AgentOS `ProviderRegistry` (e.g. `'openai'`, `'anthropic'`,
   * `'mistral'`).
   */
  provider: string;

  /**
   * Specific model to use for PII judgement.
   * @example `'gpt-4o-mini'`, `'claude-haiku-3-5'`
   */
  model: string;

  /**
   * API key for the chosen provider.  If omitted, the pack will attempt to
   * read the key from the environment using the provider's conventional
   * variable name (e.g. `OPENAI_API_KEY`).
   */
  apiKey?: string;

  /**
   * Custom base URL for self-hosted or proxy deployments
   * (e.g. an OpenAI-compatible local server).
   */
  baseUrl?: string;

  /**
   * Maximum number of LLM requests that may be in-flight simultaneously.
   * Prevents rate-limit exhaustion on high-throughput agents.
   * @default 4
   */
  maxConcurrency?: number;

  /**
   * Maximum number of (input → judgement) results to keep in the in-memory
   * LRU cache.  Set to `0` to disable caching.
   * @default 256
   */
  cacheSize?: number;
}

// ---------------------------------------------------------------------------
// Pack options
// ---------------------------------------------------------------------------

/**
 * Top-level configuration object passed to `createPiiRedactionPack()`.
 *
 * All properties are optional; sensible defaults are applied by the pack
 * factory so that a zero-config setup works out of the box.
 */
export interface PiiRedactionPackOptions {
  /**
   * Subset of {@link PiiEntityType} values to detect.
   * Defaults to {@link ALL_PII_ENTITY_TYPES} when omitted.
   *
   * Narrowing this list improves performance by skipping irrelevant regex
   * patterns and NER labels.
   */
  entityTypes?: PiiEntityType[];

  /**
   * Minimum confidence score (inclusive) required for an entity to be
   * included in {@link PiiDetectionResult.entities}.
   * Must be in the range [0, 1].
   * @default 0.6
   */
  confidenceThreshold?: number;

  /**
   * Redaction style applied when replacing detected PII in output text.
   * @default 'placeholder'
   */
  redactionStyle?: RedactionStyle;

  /**
   * Exact strings or RegExp patterns that should be unconditionally excluded
   * from redaction even when they match a PII pattern.
   *
   * @example `['support@example.com', /\b192\.168\.\d+\.\d+\b/]`
   */
  allowlist?: Array<string | RegExp>;

  /**
   * Exact strings or RegExp patterns that should always be redacted as
   * {@link PiiEntityType | `UNKNOWN_PII`} regardless of other detection
   * results.
   *
   * @example `['ACME-SECRET', /employee_id:\s*\d{6}/]`
   */
  denylist?: Array<string | RegExp>;

  /**
   * Whether to load and run a local NER model (Tier 1) in addition to
   * regex patterns (Tier 0).  Enabling this improves recall for `PERSON`,
   * `ORGANIZATION`, and `LOCATION` at the cost of higher memory usage.
   * @default false
   */
  enableNerModel?: boolean;

  /**
   * When provided, enables the LLM-powered Tier-2 judge for context-aware
   * PII detection.  When omitted, Tier 2 is disabled.
   */
  llmJudge?: LlmJudgeConfig;

  /**
   * Determines which agent messages are evaluated by the guardrail hook.
   * - `'input'` — only inbound user messages
   * - `'output'` — only outbound assistant messages
   * - `'both'` — evaluate and redact in both directions
   * @default 'both'
   */
  guardrailScope?: 'input' | 'output' | 'both';

  /**
   * When `true`, the guardrail hook will also evaluate individual streaming
   * chunks (SSE deltas) as they arrive, not just the fully-assembled message.
   * This reduces the window during which PII could be leaked but increases
   * CPU overhead.
   * @default false
   */
  evaluateStreamingChunks?: boolean;

  /**
   * Maximum number of streaming chunks evaluated per request when
   * {@link evaluateStreamingChunks} is `true`.  Older chunks are dropped
   * once the limit is reached to bound memory growth on long streams.
   * @default 50
   */
  maxStreamingEvaluations?: number;
}

// ---------------------------------------------------------------------------
// Service identity constants
// ---------------------------------------------------------------------------

/**
 * Stable string identifiers for every injectable service provided by the PII
 * redaction pack.  Values follow the AgentOS convention:
 * `agentos:<domain>:<service-name>`.
 *
 * These constants are used as keys in the {@link ISharedServiceRegistry} so
 * that other extensions and tools can look up pack services without importing
 * concrete implementations.
 *
 * @example
 * ```ts
 * const detector = registry.get<IPiiDetectionService>(PII_SERVICE_IDS.DETECTION_SERVICE);
 * ```
 */
export const PII_SERVICE_IDS = {
  /**
   * Main detection service that orchestrates all tiers and returns
   * {@link PiiDetectionResult}.
   */
  DETECTION_SERVICE: 'agentos:pii:detection-service',

  /**
   * Redaction service that applies the configured {@link RedactionStyle}
   * to a raw string given a {@link PiiDetectionResult}.
   */
  REDACTION_SERVICE: 'agentos:pii:redaction-service',

  /**
   * Guardrail hook factory that integrates with the AgentOS hook pipeline
   * to intercept and sanitise agent messages automatically.
   */
  GUARDRAIL_HOOK: 'agentos:pii:guardrail-hook',

  /**
   * Audit logger that records redaction events for compliance reporting.
   * Implementations may write to stdout, a file, or a remote SIEM sink.
   */
  AUDIT_LOGGER: 'agentos:pii:audit-logger',
} as const;

/**
 * Union of all {@link PII_SERVICE_IDS} values — useful for type-narrowing in
 * registry look-ups.
 */
export type PiiServiceId = (typeof PII_SERVICE_IDS)[keyof typeof PII_SERVICE_IDS];
