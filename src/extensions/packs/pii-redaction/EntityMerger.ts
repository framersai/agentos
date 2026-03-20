/**
 * @file EntityMerger.ts
 * @description Post-processing step that de-duplicates, filters, and merges
 * {@link PiiEntity} spans emitted by the multi-tier detection pipeline.
 *
 * When multiple recognisers (regex, NER, LLM judge) run over the same text
 * they frequently emit overlapping or duplicate spans.  This module resolves
 * those conflicts deterministically so that downstream redaction always
 * receives a clean, non-overlapping, sorted list of entities.
 *
 * ## Processing pipeline
 * 1. **Denylist boost** — entities whose text matches a denylist entry are
 *    promoted to score `1.0`, guaranteeing they survive threshold filtering.
 * 2. **Allowlist filter** — entities whose text matches an allowlist entry are
 *    unconditionally removed before any other processing.
 * 3. **Sort** — remaining entities are sorted by start offset; ties are broken
 *    by span length descending so that longer (more specific) spans are
 *    processed first in the overlap-resolution pass.
 * 4. **Overlap resolution** — a single-pass scan collapses overlapping and
 *    adjacent spans into the best representative entity (details below).
 * 5. **Threshold filter** — entities whose final score is below
 *    `confidenceThreshold` are removed.
 * 6. **Final sort** — output is sorted by start offset for stable iteration.
 *
 * @module pii-redaction/EntityMerger
 */

import type { PiiEntity } from './types';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Options controlling how {@link mergeEntities} filters and merges a raw list
 * of {@link PiiEntity} detections.
 *
 * All properties are optional; omitting them applies neutral defaults (no
 * allow/denylist, no threshold filtering).
 */
export interface MergeOptions {
  /**
   * Case-insensitive list of literal text values to **exclude** from the
   * output.  Any entity whose `.text` matches one of these strings (after
   * lowercasing) is silently dropped, even if it would otherwise pass all
   * other filters.
   *
   * Typical use-case: whitelisting known-safe values such as
   * `'support@company.com'` that appear in boilerplate and should never be
   * redacted.
   *
   * @example `['support@example.com', '127.0.0.1']`
   */
  allowlist?: string[];

  /**
   * Case-insensitive list of literal text values that should **always** be
   * redacted.  Any entity whose `.text` matches one of these strings (after
   * lowercasing) has its score boosted to `1.0`, ensuring it survives
   * threshold filtering regardless of the original confidence score.
   *
   * Typical use-case: internal project codenames or employee IDs that the
   * organisation treats as sensitive.
   *
   * @example `['PROJ-SECRET', 'acme-internal']`
   */
  denylist?: string[];

  /**
   * Minimum confidence score (inclusive) an entity must have after all
   * other transformations to be included in the output.
   *
   * Entities with `score < confidenceThreshold` are discarded.  When omitted
   * (or `undefined`) no threshold filtering is applied and all entities with
   * any score are retained.
   *
   * Must be in the range `[0, 1]` when provided.
   *
   * @default undefined (no threshold applied)
   */
  confidenceThreshold?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns `true` when the two entities overlap or one is fully contained
 * within the other.
 *
 * Two spans overlap when `a.start < b.end && b.start < a.end` (the standard
 * half-open interval overlap test).
 *
 * @param a - First entity.
 * @param b - Second entity (must have `start >= a.start` after sorting).
 */
function overlaps(a: PiiEntity, b: PiiEntity): boolean {
  return a.start < b.end && b.start < a.end;
}

/**
 * Returns `true` when entity `b` is fully contained within entity `a`
 * (i.e. `a` is a superset span of `b`).
 *
 * @param a - The candidate superset entity.
 * @param b - The candidate subset entity.
 */
function isSubset(a: PiiEntity, b: PiiEntity): boolean {
  return a.start <= b.start && a.end >= b.end;
}

/**
 * Returns the length in UTF-16 code units of an entity span.
 *
 * @param entity - Entity whose span length to compute.
 */
function spanLength(entity: PiiEntity): number {
  return entity.end - entity.start;
}

/**
 * Creates a merged entity from two adjacent (or near-adjacent) entities of
 * the same type, bridging any gap between them with the corresponding
 * characters from the original text.
 *
 * The merged entity inherits the **maximum** score of the two inputs and the
 * `source` from the higher-scoring input (first one wins on a tie).
 *
 * @param a    - The earlier (lower start offset) entity.
 * @param b    - The later entity.
 * @param text - The original full input text used to fill the gap chars.
 * @returns A new {@link PiiEntity} spanning from `a.start` to `b.end`.
 */
function mergeAdjacent(a: PiiEntity, b: PiiEntity, text: string): PiiEntity {
  // The merged text is the contiguous slice of the original string that covers
  // both spans, including any gap characters between them.
  const mergedText = text.slice(a.start, b.end);
  const mergedScore = Math.max(a.score, b.score);
  // Preserve the source of the higher-confidence detector; tie goes to `a`.
  const mergedSource = a.score >= b.score ? a.source : b.source;

  return {
    entityType: a.entityType,
    text: mergedText,
    start: a.start,
    end: b.end,
    score: mergedScore,
    source: mergedSource,
    // Merge metadata objects shallowly; later keys overwrite earlier ones.
    metadata:
      a.metadata || b.metadata
        ? { ...(a.metadata ?? {}), ...(b.metadata ?? {}) }
        : undefined,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Merges a raw list of {@link PiiEntity} detections produced by one or more
 * recognisers into a clean, non-overlapping, threshold-filtered output list.
 *
 * The function is **pure** — it does not mutate any of its inputs.
 *
 * ### Merge rules (applied in order)
 *
 * 1. **Denylist boost**: If an entity's `.text` (lowercased) appears in
 *    `options.denylist` (lowercased), its `score` is set to `1.0`.
 *
 * 2. **Allowlist filter**: If an entity's `.text` (lowercased) appears in
 *    `options.allowlist` (lowercased), the entity is removed entirely.
 *
 * 3. **Sort**: Entities are sorted by `start` offset ascending; ties broken
 *    by span length descending so longer spans are preferred in step 4.
 *
 * 4. **Overlap resolution** (single-pass, left-to-right):
 *    - *Exact or subset overlap* (current span is fully inside last span, or
 *      they share the same offsets): keep whichever has the higher score.
 *    - *Current is longer AND score ≥ last*: the current span replaces the
 *      last accumulated span (it provides more context at equal or better
 *      confidence).
 *    - *Adjacent spans* (gap between end of last and start of current is ≤ 2
 *      characters **and** both have the same `entityType`): the two spans are
 *      merged into a single entity whose text bridges the gap.
 *    - *Otherwise*: both spans are kept as separate entities.
 *
 * 5. **Confidence threshold filter**: Entities with `score <
 *    options.confidenceThreshold` are removed.
 *
 * 6. **Final sort**: Output is sorted by `start` offset ascending.
 *
 * @param entities - Raw (possibly overlapping, unsorted) entity list from the
 *                   detection pipeline.
 * @param options  - Optional filtering / merging knobs.  Safe to omit.
 * @param text     - The original input string.  Required only when adjacent
 *                   merging may occur (needed to fill gap characters).
 *                   Defaults to `''` which produces a gap of spaces.
 * @returns A new array of non-overlapping {@link PiiEntity} objects sorted by
 *          `start` offset.
 *
 * @example
 * ```ts
 * const clean = mergeEntities(rawEntities, {
 *   allowlist: ['support@example.com'],
 *   denylist: ['secret-project'],
 *   confidenceThreshold: 0.6,
 * }, originalText);
 * ```
 */
export function mergeEntities(
  entities: PiiEntity[],
  options: MergeOptions = {},
  text = '',
): PiiEntity[] {
  const { allowlist = [], denylist = [], confidenceThreshold } = options;

  // Normalise allow/denylist values once for O(1) lookup per entity.
  const allowSet = new Set(allowlist.map((s) => s.toLowerCase()));
  const denySet = new Set(denylist.map((s) => s.toLowerCase()));

  // -------------------------------------------------------------------------
  // Step 1 & 2: Apply denylist boost and allowlist filter in a single pass.
  // -------------------------------------------------------------------------

  let working: PiiEntity[] = [];
  for (const entity of entities) {
    const lower = entity.text.toLowerCase();

    // Step 1 — denylist boost: entities in the denylist always score 1.0.
    if (denySet.has(lower)) {
      working.push({ ...entity, score: 1.0 });
      continue;
    }

    // Step 2 — allowlist filter: entities in the allowlist are dropped.
    if (allowSet.has(lower)) {
      continue;
    }

    // Neither boosted nor filtered — keep as-is.
    working.push({ ...entity });
  }

  // -------------------------------------------------------------------------
  // Step 3: Sort by start offset ascending; break ties by span length desc
  //         so that wider (more informative) spans come first.
  // -------------------------------------------------------------------------

  working.sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    // Longer span first on a tie.
    return spanLength(b) - spanLength(a);
  });

  // -------------------------------------------------------------------------
  // Step 4: Overlap resolution — single left-to-right pass.
  // -------------------------------------------------------------------------

  const resolved: PiiEntity[] = [];

  for (const current of working) {
    if (resolved.length === 0) {
      // First entity — nothing to compare against yet.
      resolved.push(current);
      continue;
    }

    // Always compare against the most recently accumulated entity.
    const last = resolved[resolved.length - 1];

    if (overlaps(last, current)) {
      // The two spans overlap.

      if (isSubset(current, last)) {
        // `last` fully contains `current` — `last` is the wider (superset)
        // span.  Prefer the wider span when it scores at least as well.
        // Replace only if `current` has a strictly higher confidence score.
        if (current.score > last.score) {
          resolved[resolved.length - 1] = current;
        }
        // Otherwise keep `last` (wider span with equal or better confidence).
      } else if (isSubset(last, current)) {
        // `current` fully contains `last` — `current` is the wider span.
        // For equal-confidence spans we prefer the wider span (`current`),
        // but only replace when `current` is genuinely wider than `last`
        // (same offsets = identical span; identical score = prefer last to
        // avoid a no-op swap).
        //
        // Concrete rules:
        //   • current strictly longer → replace if current.score >= last.score
        //   • same length (identical span) → keep higher score (last wins tie)
        const currentIsWider = (current.end - current.start) > (last.end - last.start);
        if (currentIsWider ? current.score >= last.score : current.score > last.score) {
          resolved[resolved.length - 1] = current;
        }
        // Otherwise `last` had equal/better confidence for the same span, or
        // `last` is already the wider span — keep it.
      } else {
        // Partial overlap — neither is a strict subset of the other.
        // Prefer the longer span when its score is at least as high.
        if (
          spanLength(current) > spanLength(last) &&
          current.score >= last.score
        ) {
          // Current is longer with equal or better confidence — replace.
          resolved[resolved.length - 1] = current;
        }
        // Otherwise keep `last`.
      }
    } else {
      // No overlap.  Check whether the two spans are adjacent (gap ≤ 2 chars)
      // and share the same entity type, in which case merging makes sense
      // (e.g. a name split across a hyphen: "O'-Brien" → two PERSON spans).
      const gap = current.start - last.end;

      if (
        gap >= 0 &&
        gap <= 2 &&
        current.entityType === last.entityType
      ) {
        // Merge the two adjacent spans into one, bridging the gap with the
        // original text characters.
        const merged = mergeAdjacent(last, current, text);
        resolved[resolved.length - 1] = merged;
      } else {
        // Genuinely separate entities — keep both.
        resolved.push(current);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Step 5: Confidence threshold filter.
  // -------------------------------------------------------------------------

  const thresholded =
    confidenceThreshold === undefined
      ? resolved
      : resolved.filter((e) => e.score >= confidenceThreshold);

  // -------------------------------------------------------------------------
  // Step 6: Final sort by start offset (the overlap pass may have produced
  //         out-of-order entries in edge cases involving replacements).
  // -------------------------------------------------------------------------

  return thresholded.slice().sort((a, b) => a.start - b.start);
}
