/**
 * @file NerModelRecognizer.ts
 * @description Tier 3 NER-model recogniser that uses a HuggingFace
 * Transformers pipeline for high-accuracy named-entity recognition.
 *
 * This recogniser loads a pre-trained BERT-style NER model via the
 * `@huggingface/transformers` library and maps BIO-tagged outputs
 * (B-PER, I-PER, B-LOC, I-LOC, B-ORG, I-ORG, B-MISC, I-MISC) to the
 * pipeline's {@link PiiEntityType} values.
 *
 * The model is lazily loaded through the {@link ISharedServiceRegistry} so
 * that only one instance exists per agent, and it is shared across any
 * extensions that need NER capabilities.
 *
 * @module pii-redaction/recognizers
 */

import type { PiiEntity, PiiEntityType } from '../types';
import type { IEntityRecognizer, RecognizeOptions } from './IEntityRecognizer';
import type { ISharedServiceRegistry } from '../../../ISharedServiceRegistry';

// ---------------------------------------------------------------------------
// Service identity for the shared NER pipeline
// ---------------------------------------------------------------------------

/**
 * Stable service ID for the HuggingFace NER pipeline stored in the shared
 * service registry.
 */
const NER_PIPELINE_SERVICE_ID = 'agentos:nlp:ner-pipeline';

// ---------------------------------------------------------------------------
// BIO label → PiiEntityType mapping
// ---------------------------------------------------------------------------

/**
 * Maps BERT NER BIO-tag prefixes (without the B-/I- prefix) to our
 * canonical {@link PiiEntityType} values.
 *
 * | NER label | PiiEntityType   |
 * |-----------|-----------------|
 * | PER       | PERSON          |
 * | LOC       | LOCATION        |
 * | ORG       | ORGANIZATION    |
 * | MISC      | UNKNOWN_PII     |
 */
const NER_LABEL_MAP: Record<string, PiiEntityType> = {
  PER: 'PERSON',
  LOC: 'LOCATION',
  ORG: 'ORGANIZATION',
  MISC: 'UNKNOWN_PII',
};

// ---------------------------------------------------------------------------
// Types for the NER pipeline output
// ---------------------------------------------------------------------------

/**
 * Shape of a single token-level NER result from the HuggingFace
 * transformers pipeline.
 */
export interface NerToken {
  /** BIO-tagged entity label, e.g. `'B-PER'`, `'I-LOC'`, `'O'`. */
  entity: string;
  /** The sub-word or word text for this token. */
  word: string;
  /** Confidence score from the model (0–1). */
  score: number;
  /** Character start offset in the original input. */
  start: number;
  /** Character end offset in the original input. */
  end: number;
}

/**
 * The callable pipeline function returned by `@huggingface/transformers`.
 * Takes an input string and returns an array of {@link NerToken} results.
 */
type NerPipelineFn = (text: string) => Promise<NerToken[]>;

// ---------------------------------------------------------------------------
// NerModelRecognizer
// ---------------------------------------------------------------------------

/**
 * Tier 3 entity recogniser that runs a HuggingFace BERT NER model for
 * high-accuracy named-entity recognition.
 *
 * ### How it works
 * 1. On first `recognize()` call, the `@huggingface/transformers` library is
 *    loaded and a `token-classification` pipeline is created via the shared
 *    service registry.
 * 2. The pipeline tokenises the input and runs it through the NER model,
 *    returning BIO-tagged token predictions.
 * 3. Contiguous BIO tokens are merged: a `B-PER` followed by `I-PER` tokens
 *    becomes a single PERSON entity.  The final score is the average of the
 *    constituent token scores.
 * 4. Merged entities are mapped to {@link PiiEntity} objects.
 *
 * ### Graceful degradation
 * If `@huggingface/transformers` is not installed or the model fails to load,
 * the recogniser sets `unavailable = true` and returns empty arrays on all
 * subsequent calls, ensuring the pipeline degrades without crashing.
 *
 * @example
 * ```ts
 * const registry = new SharedServiceRegistry();
 * const recognizer = new NerModelRecognizer(registry);
 * const entities = await recognizer.recognize('John Smith lives in London');
 * // entities: [{ entityType: 'PERSON', text: 'John Smith', ... },
 * //            { entityType: 'LOCATION', text: 'London', ... }]
 * ```
 */
export class NerModelRecognizer implements IEntityRecognizer {
  /** @inheritdoc */
  public readonly name = 'NerModelRecognizer';

  /** @inheritdoc */
  public readonly supportedEntities: PiiEntityType[] = [
    'PERSON',
    'LOCATION',
    'ORGANIZATION',
    'UNKNOWN_PII', // Mapped from MISC entities
  ];

  /**
   * When `true`, the transformers library or model failed to load and all
   * future calls will return empty arrays.
   */
  private unavailable = false;

  /**
   * Reference to the shared service registry for lazy-loading the NER
   * pipeline.
   */
  private readonly services: ISharedServiceRegistry;

  /**
   * Construct a new NerModelRecognizer.
   *
   * @param services - Shared service registry for lazy-loading the
   *   HuggingFace NER pipeline.
   */
  constructor(services: ISharedServiceRegistry) {
    this.services = services;
  }

  /**
   * Scan the input text for named entities using a BERT NER model.
   *
   * BIO-tagged tokens are merged into contiguous entity spans and mapped
   * to {@link PiiEntity} objects.
   *
   * @param input   - Raw text to analyse.
   * @param options - Optional filtering and context hints.
   * @returns Array of detected {@link PiiEntity} objects.
   */
  public async recognize(input: string, options?: RecognizeOptions): Promise<PiiEntity[]> {
    // If the model previously failed to load, bail out immediately.
    if (this.unavailable) return [];

    // Determine which entity types the caller wants.
    const wantedTypes = this.resolveWantedTypes(options?.entityTypes);
    if (wantedTypes.size === 0) return [];

    // Lazily load the NER pipeline via the shared service registry.
    let pipeline: NerPipelineFn;
    try {
      pipeline = await this.services.getOrCreate<NerPipelineFn>(
        NER_PIPELINE_SERVICE_ID,
        async () => {
          // Dynamic import so @huggingface/transformers is optional.
          const transformers = await import('@huggingface/transformers');
          // Create a token-classification pipeline with a small NER model.
          const pipe = await (transformers as Record<string, unknown> & {
            pipeline: (task: string, model?: string) => Promise<NerPipelineFn>;
          }).pipeline(
            'token-classification',
            'Xenova/bert-base-NER',
          );
          return pipe;
        },
      );
    } catch {
      // Transformers not installed or model download failed.
      this.unavailable = true;
      return [];
    }

    // Run the NER pipeline on the input text.
    let tokens: NerToken[];
    try {
      tokens = await pipeline(input);
    } catch {
      // Runtime inference error — degrade gracefully for this call.
      return [];
    }

    // Merge BIO tokens into contiguous entity spans.
    const merged = this.mergeBioTokens(tokens);

    // Map merged spans to PiiEntity objects, filtering by wanted types.
    return this.mapToEntities(merged, wantedTypes);
  }

  /** @inheritdoc */
  public async dispose(): Promise<void> {
    // The pipeline is owned by the shared service registry and will be
    // cleaned up when the registry is released.
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
   * Merges BIO-tagged tokens into contiguous entity spans.
   *
   * The BIO tagging scheme works as follows:
   * - `B-XXX` — Beginning of a new entity of type XXX.
   * - `I-XXX` — Inside/continuation of the current entity of type XXX.
   * - `O`     — Outside any entity (ignored).
   *
   * A `B-PER` followed by one or more `I-PER` tokens produces a single
   * merged span.  When a `B-XXX` appears while another entity is open,
   * the previous entity is flushed and a new one begins.
   *
   * @param tokens - Raw BIO-tagged token array from the NER pipeline.
   * @returns Array of merged entity spans with aggregated metadata.
   */
  private mergeBioTokens(tokens: NerToken[]): MergedEntity[] {
    const result: MergedEntity[] = [];
    let current: MergedEntity | null = null;

    for (const token of tokens) {
      const { tag, label } = this.parseBioLabel(token.entity);

      // Skip 'O' (outside) tokens.
      if (tag === 'O' || !label) {
        // Flush any in-progress entity.
        if (current) {
          result.push(current);
          current = null;
        }
        continue;
      }

      if (tag === 'B') {
        // Beginning of a new entity — flush the previous one if any.
        if (current) result.push(current);

        current = {
          label,
          text: token.word,
          start: token.start,
          end: token.end,
          scores: [token.score],
        };
      } else if (tag === 'I' && current && current.label === label) {
        // Continuation of the current entity — extend the span.
        current.text += token.word.startsWith('##')
          ? token.word.slice(2)  // WordPiece sub-token: strip '##' prefix
          : ` ${token.word}`;    // Regular token: add space separator
        current.end = token.end;
        current.scores.push(token.score);
      } else {
        // I-tag without a matching B-tag or different label: treat as
        // a new entity beginning (common with imperfect models).
        if (current) result.push(current);
        current = {
          label,
          text: token.word,
          start: token.start,
          end: token.end,
          scores: [token.score],
        };
      }
    }

    // Flush the last entity if still open.
    if (current) result.push(current);

    return result;
  }

  /**
   * Parses a BIO label string like `'B-PER'` or `'I-LOC'` into its
   * tag component (`'B'`, `'I'`, `'O'`) and entity label (`'PER'`, `'LOC'`).
   *
   * @param bioLabel - The raw BIO label from the NER model.
   * @returns Parsed tag and label.
   */
  private parseBioLabel(bioLabel: string): { tag: string; label: string | null } {
    if (bioLabel === 'O') return { tag: 'O', label: null };

    const dashIdx = bioLabel.indexOf('-');
    if (dashIdx === -1) {
      // Non-standard label without B-/I- prefix — treat as beginning.
      return { tag: 'B', label: bioLabel };
    }

    return {
      tag: bioLabel.slice(0, dashIdx),
      label: bioLabel.slice(dashIdx + 1),
    };
  }

  /**
   * Maps merged entity spans to {@link PiiEntity} objects, filtering by
   * the set of wanted entity types.
   *
   * The score for each entity is the arithmetic mean of its constituent
   * token scores, reflecting the model's average confidence across the
   * full span.
   *
   * @param merged     - Array of merged BIO entity spans.
   * @param wantedTypes - Set of entity types the caller is interested in.
   * @returns Filtered array of {@link PiiEntity} objects.
   */
  private mapToEntities(
    merged: MergedEntity[],
    wantedTypes: Set<PiiEntityType>,
  ): PiiEntity[] {
    const entities: PiiEntity[] = [];

    for (const span of merged) {
      // Map the NER label to our PiiEntityType.
      const entityType = NER_LABEL_MAP[span.label];
      if (!entityType) continue; // Unknown NER label — skip.

      // Apply entity-type filter.
      if (!wantedTypes.has(entityType)) continue;

      // Compute average score across all constituent tokens.
      const avgScore =
        span.scores.reduce((sum, s) => sum + s, 0) / span.scores.length;

      entities.push({
        entityType,
        text: span.text,
        start: span.start,
        end: span.end,
        score: avgScore,
        source: 'ner-model',
        metadata: {
          nerLabel: span.label,
          nerModel: 'Xenova/bert-base-NER',
          tokenCount: span.scores.length,
        },
      });
    }

    return entities;
  }
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/**
 * Intermediate representation of a merged BIO entity span, used during
 * the token-merging phase before final mapping to {@link PiiEntity}.
 */
interface MergedEntity {
  /** The NER label without B-/I- prefix (e.g. `'PER'`, `'LOC'`). */
  label: string;
  /** Accumulated text spanning all merged tokens. */
  text: string;
  /** Character start offset of the first token. */
  start: number;
  /** Character end offset of the last token. */
  end: number;
  /** Individual token scores for average computation. */
  scores: number[];
}
