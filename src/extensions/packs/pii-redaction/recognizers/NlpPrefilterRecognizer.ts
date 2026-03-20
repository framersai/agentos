/**
 * @file NlpPrefilterRecognizer.ts
 * @description Tier 2 NLP-based pre-filter recogniser that uses the
 * `compromise` library for lightweight named-entity extraction.
 *
 * This recogniser is designed as a low-confidence pre-filter: it catches
 * person names, places, and organisations that regex patterns typically miss,
 * then flags them at a low score (0.3–0.6) so that higher tiers (NER model,
 * LLM judge) can confirm or discard them.
 *
 * The `compromise` library is loaded lazily via the {@link ISharedServiceRegistry}
 * so that the heavyweight module is only initialised once and shared across
 * any extensions that need it.
 *
 * @module pii-redaction/recognizers
 */

import type { PiiEntity, PiiEntityType } from '../types';
import type { IEntityRecognizer, RecognizeOptions } from './IEntityRecognizer';
import type { ISharedServiceRegistry } from '../../../ISharedServiceRegistry';

// ---------------------------------------------------------------------------
// Service identity constant for the shared compromise instance
// ---------------------------------------------------------------------------

/**
 * Stable service ID used to store the compromise module in the shared
 * service registry.  Other extensions that need compromise can reuse the
 * same cached instance.
 */
const COMPROMISE_SERVICE_ID = 'agentos:nlp:compromise';

// ---------------------------------------------------------------------------
// Compromise type declarations (minimal subset we use)
// ---------------------------------------------------------------------------

/**
 * Minimal type for the compromise module's default export.
 * We only use `nlp(text)` to create a document, then call entity extraction
 * methods on the result.
 */
interface CompromiseModule {
  (text: string): CompromiseDocument;
}

/**
 * Minimal type for a compromise document instance.
 */
interface CompromiseDocument {
  /** Extract person name spans. */
  people(): CompromiseView;
  /** Extract place/location spans. */
  places(): CompromiseView;
  /** Extract organisation name spans. */
  organizations(): CompromiseView;
}

/**
 * Minimal type for a compromise view (subset of matched terms).
 */
interface CompromiseView {
  /**
   * Serialise matches to the requested format.
   * When called with `'offset'`, returns an array of
   * `{ text, terms: [{ text, offset: { start, length } }] }` objects.
   */
  out(format: 'offset'): CompromiseOffsetResult[];
}

/**
 * Shape of a single offset result from `compromise.out('offset')`.
 */
interface CompromiseOffsetResult {
  /** The full matched text span (may include multiple terms). */
  text: string;
  /** Individual terms with their character offsets. */
  terms: Array<{
    text: string;
    offset: {
      /** Character offset from start of input. */
      start: number;
      /** Character length of the term. */
      length: number;
    };
  }>;
}

// ---------------------------------------------------------------------------
// Score constants
// ---------------------------------------------------------------------------

/**
 * Score assigned to person name detections.  Higher than places/orgs because
 * compromise's person-name heuristics tend to be slightly more reliable.
 */
const PERSON_SCORE = 0.55;

/** Score assigned to location/place detections. */
const LOCATION_SCORE = 0.45;

/** Score assigned to organisation detections. */
const ORG_SCORE = 0.4;

// ---------------------------------------------------------------------------
// NlpPrefilterRecognizer
// ---------------------------------------------------------------------------

/**
 * Tier 2 NLP pre-filter recogniser that uses the `compromise` library to
 * detect person names, places, and organisations.
 *
 * ### Design rationale
 * Compromise is a rule-based NLP library (~200 KB) that is much lighter than
 * a full transformer model.  It provides reasonable recall for English-language
 * named entities at the cost of lower precision.  This recogniser intentionally
 * assigns low confidence scores (0.3–0.6) so that its results serve as
 * *candidates* for higher-tier confirmation rather than final detections.
 *
 * ### Graceful degradation
 * If the compromise module fails to load (e.g. not installed, wrong platform),
 * the recogniser sets an internal `unavailable` flag and returns empty results
 * on every subsequent call without throwing.  This ensures the pipeline
 * continues to function with just the regex and/or LLM tiers.
 *
 * ### Shared service pattern
 * The compromise module is loaded via the {@link ISharedServiceRegistry} so
 * that multiple extensions in the same agent can share a single instance.
 *
 * @example
 * ```ts
 * const registry = new SharedServiceRegistry();
 * const recognizer = new NlpPrefilterRecognizer(registry);
 * const entities = await recognizer.recognize('John Smith lives in London');
 * // entities might include PERSON "John Smith" and LOCATION "London"
 * ```
 */
export class NlpPrefilterRecognizer implements IEntityRecognizer {
  /** @inheritdoc */
  public readonly name = 'NlpPrefilterRecognizer';

  /** @inheritdoc */
  public readonly supportedEntities: PiiEntityType[] = [
    'PERSON',
    'LOCATION',
    'ORGANIZATION',
  ];

  /**
   * When `true`, the compromise module failed to load and all future
   * `recognize()` calls will return empty arrays silently.
   */
  private unavailable = false;

  /**
   * Reference to the shared service registry used for lazy-loading the
   * compromise NLP module.
   */
  private readonly services: ISharedServiceRegistry;

  /**
   * Construct a new NlpPrefilterRecognizer.
   *
   * @param services - Shared service registry for lazy-loading compromise.
   */
  constructor(services: ISharedServiceRegistry) {
    this.services = services;
  }

  /**
   * Scan the input text for person names, places, and organisations using
   * the compromise NLP library.
   *
   * Results are returned with low confidence scores (0.3–0.6) to indicate
   * they are pre-filter candidates requiring higher-tier confirmation.
   *
   * @param input   - Raw text to analyse.
   * @param options - Optional filtering and context hints.
   * @returns Array of low-confidence {@link PiiEntity} candidates.
   */
  public async recognize(input: string, options?: RecognizeOptions): Promise<PiiEntity[]> {
    // If compromise failed to load previously, bail out silently.
    if (this.unavailable) return [];

    // Determine which entity types the caller wants from us.
    const wantedTypes = this.resolveWantedTypes(options?.entityTypes);
    if (wantedTypes.size === 0) return [];

    // Lazily load compromise via the shared service registry.
    let nlp: CompromiseModule;
    try {
      nlp = await this.services.getOrCreate<CompromiseModule>(
        COMPROMISE_SERVICE_ID,
        async () => {
          // Dynamic import so compromise is optional at the module level.
          const mod = await import('compromise');
          // compromise's default export may be the function directly or
          // wrapped in { default: ... } depending on the bundler.
          return (mod as Record<string, unknown>).default as CompromiseModule ?? mod as unknown as CompromiseModule;
        },
      );
    } catch {
      // compromise is not installed or failed to load — degrade gracefully.
      this.unavailable = true;
      return [];
    }

    // Parse the input text with compromise.
    const doc = nlp(input);

    const entities: PiiEntity[] = [];

    // Extract people (PERSON entities).
    if (wantedTypes.has('PERSON')) {
      const people = doc.people().out('offset');
      for (const match of people) {
        const span = this.computeSpan(match);
        if (span) {
          entities.push({
            entityType: 'PERSON',
            text: match.text,
            start: span.start,
            end: span.end,
            score: PERSON_SCORE,
            source: 'nlp-prefilter',
            metadata: { recognizer: 'compromise', method: 'people' },
          });
        }
      }
    }

    // Extract places (LOCATION entities).
    if (wantedTypes.has('LOCATION')) {
      const places = doc.places().out('offset');
      for (const match of places) {
        const span = this.computeSpan(match);
        if (span) {
          entities.push({
            entityType: 'LOCATION',
            text: match.text,
            start: span.start,
            end: span.end,
            score: LOCATION_SCORE,
            source: 'nlp-prefilter',
            metadata: { recognizer: 'compromise', method: 'places' },
          });
        }
      }
    }

    // Extract organisations (ORGANIZATION entities).
    if (wantedTypes.has('ORGANIZATION')) {
      const orgs = doc.organizations().out('offset');
      for (const match of orgs) {
        const span = this.computeSpan(match);
        if (span) {
          entities.push({
            entityType: 'ORGANIZATION',
            text: match.text,
            start: span.start,
            end: span.end,
            score: ORG_SCORE,
            source: 'nlp-prefilter',
            metadata: { recognizer: 'compromise', method: 'organizations' },
          });
        }
      }
    }

    return entities;
  }

  /** @inheritdoc */
  public async dispose(): Promise<void> {
    // The compromise instance is owned by the shared service registry and
    // will be cleaned up when the registry is released.  Nothing to do here.
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /**
   * Determines which of our supported entity types the caller wants.
   *
   * @param entityTypes - Optional entity-type filter from the caller.
   * @returns Set of wanted types intersected with our supported types.
   */
  private resolveWantedTypes(entityTypes?: PiiEntityType[]): Set<PiiEntityType> {
    if (!entityTypes || entityTypes.length === 0) {
      return new Set(this.supportedEntities);
    }
    const supported = new Set(this.supportedEntities);
    return new Set(entityTypes.filter((t) => supported.has(t)));
  }

  /**
   * Computes a contiguous [start, end) span from a compromise offset result.
   *
   * Compromise returns individual term offsets; this method merges them into
   * a single span covering the full match text.
   *
   * @param match - A compromise offset result with term-level positions.
   * @returns Object with `start` and `end` offsets, or `null` if no terms.
   */
  private computeSpan(
    match: CompromiseOffsetResult,
  ): { start: number; end: number } | null {
    if (!match.terms || match.terms.length === 0) return null;

    // Start is the offset of the first term.
    const firstTerm = match.terms[0];
    const start = firstTerm.offset.start;

    // End is the offset + length of the last term.
    const lastTerm = match.terms[match.terms.length - 1];
    const end = lastTerm.offset.start + lastTerm.offset.length;

    return { start, end };
  }
}
