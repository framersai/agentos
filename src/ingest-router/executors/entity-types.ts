/**
 * @file entity-types.ts
 * @description Types for the Mem0-v3-style entity-linking ingest
 * executor (Stage I).
 *
 * Mem0 v3 dropped its graph store in favor of single-pass ADD-only
 * fact extraction with multi-signal hybrid search. Entity extraction
 * powers the entity-overlap re-rank signal at recall time. See spec
 * §3.2 + STAGE_L_PHASE_A_FINDINGS for why this is the next-priority
 * accuracy push.
 *
 * Reference: docs.mem0.ai/migration/oss-v2-to-v3.
 *
 * @module @framers/agentos/ingest-router/executors/entity-types
 */

/**
 * Three entity kinds extracted at ingest. Mem0 v3 spec.
 */
export type EntityKind = 'proper-noun' | 'quoted-text' | 'compound-noun-phrase';

/**
 * One extracted entity with its kind + character offsets.
 */
export interface ExtractedEntity {
  /** The literal entity string as it appears in the source text. */
  text: string;
  /** Classification of how the entity was identified. */
  kind: EntityKind;
  /** Character offsets in the source where this entity was matched. */
  positions: number[];
}

/**
 * Result of running EntityExtractor on a piece of text.
 */
export interface EntityExtractionResult {
  /** Every entity found, in detection order. */
  entities: ExtractedEntity[];
  /** The raw text the extractor ran against. */
  rawText: string;
}

/**
 * Tunable parameters for entity extraction.
 */
export interface EntityLinkingOptions {
  /**
   * Minimum length for a token to count as a proper noun. Default 2.
   * Filters out single-letter capitals (e.g., "I", "A").
   */
  properNounMinLength?: number;
  /**
   * Maximum number of consecutive capitalized tokens to count as one
   * compound noun phrase. Default 5.
   */
  compoundNounMaxLength?: number;
}
