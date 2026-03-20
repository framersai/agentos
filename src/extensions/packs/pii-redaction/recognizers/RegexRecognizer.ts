/**
 * @file RegexRecognizer.ts
 * @description Tier 1 PII recogniser that delegates pattern matching to the
 * `openredaction` library.
 *
 * OpenRedaction ships with 500+ curated regex patterns covering emails, SSNs,
 * credit cards, phone numbers, IP addresses, IBANs, passports, API keys, and
 * many more.  This recogniser wraps its `OpenRedaction.detect()` method,
 * normalises the results into the pipeline's {@link PiiEntity} shape, and
 * applies entity-type filtering so only the categories requested by the caller
 * are evaluated.
 *
 * @module pii-redaction/recognizers
 */

import type { PiiEntity, PiiEntityType } from '../types';
import type { IEntityRecognizer, RecognizeOptions } from './IEntityRecognizer';

// ---------------------------------------------------------------------------
// Mapping from openredaction pattern type strings to PiiEntityType
// ---------------------------------------------------------------------------

/**
 * Maps openredaction's built-in pattern `type` strings to our canonical
 * {@link PiiEntityType} values.
 *
 * Only types that have a direct or near-direct counterpart are listed.
 * Unmapped openredaction types are silently dropped so that we don't pollute
 * downstream consumers with categories they can't act on.
 */
const OPENREDACTION_TYPE_MAP: Record<string, PiiEntityType> = {
  EMAIL: 'EMAIL',
  SSN: 'SSN',
  CREDIT_CARD: 'CREDIT_CARD',
  PHONE_US: 'PHONE',
  PHONE_UK: 'PHONE',
  PHONE_UK_MOBILE: 'PHONE',
  PHONE_INTERNATIONAL: 'PHONE',
  IPV4: 'IP_ADDRESS',
  IPV6: 'IP_ADDRESS',
  IBAN: 'IBAN',
  PASSPORT_US: 'PASSPORT',
  PASSPORT_UK: 'PASSPORT',
  PASSPORT_MRZ_TD3: 'PASSPORT',
  PASSPORT_MRZ_TD1: 'PASSPORT',
  DRIVING_LICENSE_US: 'DRIVERS_LICENSE',
  DRIVING_LICENSE_UK: 'DRIVERS_LICENSE',
  DATE_OF_BIRTH: 'DATE_OF_BIRTH',
  GENERIC_API_KEY: 'API_KEY',
  OPENAI_API_KEY: 'API_KEY',
  GOOGLE_API_KEY: 'API_KEY',
  STRIPE_API_KEY: 'API_KEY',
  GITHUB_TOKEN: 'API_KEY',
  BEARER_TOKEN: 'API_KEY',
  AWS_ACCESS_KEY: 'AWS_KEY',
  AWS_SECRET_KEY: 'AWS_KEY',
  BITCOIN_ADDRESS: 'CRYPTO_ADDRESS',
  ETHEREUM_ADDRESS: 'CRYPTO_ADDRESS',
  LITECOIN_ADDRESS: 'CRYPTO_ADDRESS',
  MONERO_ADDRESS: 'CRYPTO_ADDRESS',
  RIPPLE_ADDRESS: 'CRYPTO_ADDRESS',
  CARDANO_ADDRESS: 'CRYPTO_ADDRESS',
  SOLANA_ADDRESS: 'CRYPTO_ADDRESS',
  NAME: 'PERSON',
  TAX_ID: 'GOV_ID',
  NATIONAL_INSURANCE_UK: 'GOV_ID',
  NHS_NUMBER: 'GOV_ID',
  ITIN: 'GOV_ID',
  SIN_CA: 'GOV_ID',
};

/**
 * Inverse map: for a given {@link PiiEntityType}, lists all openredaction
 * pattern type strings that map to it.  Built lazily on first access.
 */
let piiTypeToPatternNames: Map<PiiEntityType, string[]> | null = null;

/**
 * Builds (or returns the cached) inverse mapping from {@link PiiEntityType}
 * to openredaction pattern names.
 */
function getPiiTypeToPatternNames(): Map<PiiEntityType, string[]> {
  if (piiTypeToPatternNames) return piiTypeToPatternNames;

  piiTypeToPatternNames = new Map<PiiEntityType, string[]>();
  for (const [patternName, piiType] of Object.entries(OPENREDACTION_TYPE_MAP)) {
    const existing = piiTypeToPatternNames.get(piiType) ?? [];
    existing.push(patternName);
    piiTypeToPatternNames.set(piiType, existing);
  }
  return piiTypeToPatternNames;
}

// ---------------------------------------------------------------------------
// Default patterns to load when no entity-type filter is applied
// ---------------------------------------------------------------------------

/**
 * The full list of openredaction pattern names we want available by default.
 * This is the union of all values in {@link OPENREDACTION_TYPE_MAP}.
 */
const DEFAULT_PATTERN_NAMES: string[] = Object.keys(OPENREDACTION_TYPE_MAP);

// ---------------------------------------------------------------------------
// RegexRecognizer
// ---------------------------------------------------------------------------

/**
 * Tier 1 entity recogniser backed by the `openredaction` library.
 *
 * ### How it works
 * 1. On construction an {@link OpenRedaction} instance is created with the
 *    full set of mapped patterns pre-loaded and pre-compiled.
 * 2. When {@link recognize} is called, pattern names are optionally filtered
 *    to the requested {@link PiiEntityType} subset.
 * 3. `OpenRedaction.detect()` runs all active patterns against the input and
 *    returns raw detections with position offsets.
 * 4. Results are mapped to {@link PiiEntity} objects with a fixed high score
 *    (>= 0.85) because regex matches are deterministic.
 *
 * ### Thread safety
 * Each call to `recognize` creates a fresh `OpenRedaction` instance with
 * only the needed patterns so there is no shared mutable state between
 * concurrent invocations.
 *
 * @example
 * ```ts
 * const recognizer = new RegexRecognizer();
 * const entities = await recognizer.recognize(
 *   'Email me at alice@example.com',
 *   { entityTypes: ['EMAIL'] },
 * );
 * // entities[0].entityType === 'EMAIL'
 * // entities[0].score >= 0.85
 * ```
 */
export class RegexRecognizer implements IEntityRecognizer {
  /** @inheritdoc */
  public readonly name = 'RegexRecognizer';

  /** @inheritdoc */
  public readonly supportedEntities: PiiEntityType[] = [
    'SSN',
    'CREDIT_CARD',
    'EMAIL',
    'PHONE',
    'IP_ADDRESS',
    'IBAN',
    'PASSPORT',
    'DRIVERS_LICENSE',
    'DATE_OF_BIRTH',
    'API_KEY',
    'AWS_KEY',
    'CRYPTO_ADDRESS',
    'PERSON',
    'GOV_ID',
  ];

  /**
   * Minimum confidence score assigned to regex-based detections.
   * Regex matches are deterministic so they receive a high baseline; the
   * openredaction library may report its own `confidence` which we bump
   * to at least this floor value.
   */
  private static readonly MIN_SCORE = 0.85;

  /**
   * Lazily-resolved reference to the `OpenRedaction` constructor from the
   * `openredaction` package.  Stored after first successful dynamic import
   * to avoid repeated module resolution on subsequent calls.
   */
  private OpenRedactionCtor: (new (opts: Record<string, unknown>) => OpenRedactionInstance) | null = null;

  /**
   * Scan the input text for PII entities using openredaction regex patterns.
   *
   * @param input   - Raw text to analyse.
   * @param options - Optional filtering and context hints.
   * @returns Array of detected {@link PiiEntity} objects, possibly empty.
   */
  public async recognize(input: string, options?: RecognizeOptions): Promise<PiiEntity[]> {
    // Determine which openredaction patterns to activate based on the
    // caller's entity-type filter.
    const patternNames = this.resolvePatternNames(options?.entityTypes);

    // Nothing to do if no patterns map to the requested entity types.
    if (patternNames.length === 0) return [];

    // Lazily import openredaction (avoids top-level side effects and keeps
    // the module optional for environments that don't need regex detection).
    const Ctor = await this.ensureOpenRedaction();

    // Create a scoped instance with only the relevant patterns loaded.
    const instance = new Ctor({ patterns: patternNames });

    // Run detection — openredaction returns a promise.
    const result = await instance.detect(input);

    // Map openredaction detections to our PiiEntity shape.
    return this.mapDetections(result.detections, input, options?.entityTypes);
  }

  /** @inheritdoc */
  public async dispose(): Promise<void> {
    // No long-lived resources to release; each `recognize` call creates its
    // own scoped OpenRedaction instance.
    this.OpenRedactionCtor = null;
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /**
   * Lazily imports the `openredaction` module and caches its constructor.
   *
   * @returns The `OpenRedaction` class constructor.
   * @throws If the `openredaction` package is not installed.
   */
  private async ensureOpenRedaction(): Promise<
    new (opts: Record<string, unknown>) => OpenRedactionInstance
  > {
    if (this.OpenRedactionCtor) return this.OpenRedactionCtor;

    // Dynamic import so the dependency is optional at the module level.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = await import('openredaction');
    this.OpenRedactionCtor = (mod as Record<string, unknown>).OpenRedaction as
      new (opts: Record<string, unknown>) => OpenRedactionInstance;
    return this.OpenRedactionCtor;
  }

  /**
   * Resolves the list of openredaction pattern names to activate for the
   * given entity-type filter.
   *
   * When no filter is provided, all mapped patterns are returned.
   *
   * @param entityTypes - Optional subset of {@link PiiEntityType} to detect.
   * @returns Array of openredaction pattern name strings.
   */
  private resolvePatternNames(entityTypes?: PiiEntityType[]): string[] {
    // No filter → use everything we have mapped.
    if (!entityTypes || entityTypes.length === 0) return DEFAULT_PATTERN_NAMES;

    const inverse = getPiiTypeToPatternNames();
    const names: string[] = [];

    for (const piiType of entityTypes) {
      const mapped = inverse.get(piiType);
      if (mapped) names.push(...mapped);
    }

    return names;
  }

  /**
   * Converts raw openredaction detection objects into {@link PiiEntity}
   * instances, filtering out any that don't map to a requested entity type.
   *
   * @param detections  - Raw detections from `OpenRedaction.detect()`.
   * @param input       - The original input text (used to extract `text`
   *                      from positional offsets when needed).
   * @param entityTypes - Optional entity-type filter for post-filtering.
   * @returns Mapped and filtered array of {@link PiiEntity}.
   */
  private mapDetections(
    detections: OpenRedactionDetection[],
    input: string,
    entityTypes?: PiiEntityType[],
  ): PiiEntity[] {
    const entities: PiiEntity[] = [];
    const allowedTypes = entityTypes ? new Set(entityTypes) : null;

    for (const det of detections) {
      const mappedType = OPENREDACTION_TYPE_MAP[det.type];

      // Skip detections whose openredaction type has no mapping.
      if (!mappedType) continue;

      // Skip if the mapped type isn't in the caller's requested set.
      if (allowedTypes && !allowedTypes.has(mappedType)) continue;

      // Compute start/end offsets from the position tuple.
      const [start, end] = det.position;

      // Extract the matched text span from the input for consistency.
      const text = det.value ?? input.slice(start, end);

      // Confidence: take the higher of openredaction's score and our floor.
      const score = Math.max(det.confidence ?? RegexRecognizer.MIN_SCORE, RegexRecognizer.MIN_SCORE);

      entities.push({
        entityType: mappedType,
        text,
        start,
        end,
        score,
        source: 'regex',
        metadata: {
          openredactionType: det.type,
          placeholder: det.placeholder,
          severity: det.severity,
        },
      });
    }

    return entities;
  }
}

// ---------------------------------------------------------------------------
// Minimal type declarations for the openredaction API surface we use
// ---------------------------------------------------------------------------

/**
 * Shape of a single detection returned by `OpenRedaction.detect()`.
 * Declared locally to avoid depending on openredaction's type exports
 * (which may not exist for all versions).
 */
interface OpenRedactionDetection {
  /** The openredaction pattern type name (e.g. `'EMAIL'`, `'SSN'`). */
  type: string;
  /** The matched value string. */
  value: string;
  /** Placeholder string used in the redacted output. */
  placeholder: string;
  /** [start, end] character offsets in the original input. */
  position: [number, number];
  /** Severity classification from openredaction. */
  severity: string;
  /** Confidence score assigned by openredaction (0–1). */
  confidence?: number;
}

/**
 * Minimal interface for an instantiated `OpenRedaction` object.
 * Only the `detect` method is used by this recogniser.
 */
interface OpenRedactionInstance {
  detect(text: string): Promise<{
    original: string;
    redacted: string;
    detections: OpenRedactionDetection[];
    redactionMap: Record<string, string>;
    stats: { processingTime: number; piiCount: number };
  }>;
}
