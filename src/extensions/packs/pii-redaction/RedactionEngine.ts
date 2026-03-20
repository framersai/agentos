/**
 * @file RedactionEngine.ts
 * @description Applies configurable redaction transformations to PII entity
 * spans detected in a text string.
 *
 * The engine processes entity spans in **reverse order** (highest start offset
 * first) so that replacing a span never invalidates the offsets of earlier
 * spans that have not yet been processed.  This is the standard slice-and-join
 * pattern for in-place text replacement with absolute positions.
 *
 * ## Supported redaction styles
 *
 * | Style | Example input | Example output |
 * |---|---|---|
 * | `placeholder` | `John Smith` (PERSON) | `[PERSON]` |
 * | `mask` | `John Smith` | `J*** S****` |
 * | `hash` | `John Smith` (PERSON) | `[PERSON:a1b2c3d4e5]` |
 * | `category-tag` | `John Smith` (PERSON) | `<PII type="PERSON">REDACTED</PII>` |
 *
 * @module pii-redaction/RedactionEngine
 */

import { createHash } from 'crypto';
import type { PiiEntity, RedactionStyle } from './types';

// ---------------------------------------------------------------------------
// Style implementation helpers
// ---------------------------------------------------------------------------

/**
 * Produces a `[TYPE]` placeholder token for the given entity.
 *
 * This is the most compact style — the original value is fully discarded and
 * only the entity category is preserved.  Useful when downstream consumers
 * only need to know that a PII span existed, not even its rough shape.
 *
 * @example `[PERSON]`, `[EMAIL]`, `[SSN]`
 *
 * @param entity - The detected PII entity to redact.
 * @returns Replacement string.
 */
function applyPlaceholder(entity: PiiEntity): string {
  return `[${entity.entityType}]`;
}

/**
 * Produces a word-masked version of the original text.
 *
 * Each word in the matched text is masked by keeping its first character and
 * replacing every subsequent character with `*`.  Word boundaries are defined
 * by one or more whitespace characters (`\s+`).
 *
 * Non-alphabetic first characters (digits, punctuation) are preserved as-is;
 * only the trailing characters of each word are replaced.
 *
 * @example
 * - `'John Smith'` → `'J*** S****'`
 * - `'john@example.com'` → `'j***@*****.***'`  (no spaces → single word)
 *
 * @param entity - The detected PII entity to redact.
 * @returns Replacement string with per-word masking applied.
 */
function applyMask(entity: PiiEntity): string {
  // Split on whitespace boundaries.  Each segment is treated as one "word".
  return entity.text
    .split(/(\s+)/)
    .map((segment) => {
      // Preserve whitespace segments as-is so spacing is maintained.
      if (/^\s+$/.test(segment)) {
        return segment;
      }

      if (segment.length <= 1) {
        // Single-character word — nothing to mask.
        return segment;
      }

      // Keep the first character; replace the rest with '*'.
      return segment[0] + '*'.repeat(segment.length - 1);
    })
    .join('');
}

/**
 * Produces a deterministic content-based hash token for the given entity.
 *
 * The replacement token embeds the entity type and a truncated SHA-256 digest
 * (10 lowercase hex characters) of the **original text**.  This preserves
 * de-duplication semantics: the same input text always produces the same token,
 * so consumers can detect when the same PII value appeared multiple times
 * without being able to recover the original value.
 *
 * @example `[PERSON:a1b2c3d4e5]` (exact hash depends on input text)
 *
 * @param entity - The detected PII entity to redact.
 * @returns Replacement string of the form `[TYPE:xxxxxxxxxx]`.
 */
function applyHash(entity: PiiEntity): string {
  // Compute a SHA-256 digest of the original matched text.
  const digest = createHash('sha256').update(entity.text, 'utf8').digest('hex');

  // Truncate to 10 hex characters — enough entropy to identify duplicates
  // while keeping the token compact.
  const shortHash = digest.slice(0, 10);

  return `[${entity.entityType}:${shortHash}]`;
}

/**
 * Produces an XML-style PII category tag wrapping a generic `REDACTED`
 * placeholder.
 *
 * The tag makes the redaction visible to any downstream parser that understands
 * the `<PII>` schema, enabling programmatic unredaction if the original values
 * are stored separately with an audit trail.
 *
 * @example `<PII type="PERSON">REDACTED</PII>`
 *
 * @param entity - The detected PII entity to redact.
 * @returns Replacement string.
 */
function applyCategoryTag(entity: PiiEntity): string {
  return `<PII type="${entity.entityType}">REDACTED</PII>`;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

/**
 * Returns the replacement string for a single entity according to the chosen
 * {@link RedactionStyle}.
 *
 * @param entity - The entity span to redact.
 * @param style  - How the PII value should be replaced.
 * @returns The replacement text to splice into the output string.
 *
 * @throws {Error} When an unrecognised style value is passed (compile-time
 *                 exhaustiveness check via the `never` branch).
 */
function getReplacementText(entity: PiiEntity, style: RedactionStyle): string {
  switch (style) {
    case 'placeholder':
      return applyPlaceholder(entity);

    case 'mask':
      return applyMask(entity);

    case 'hash':
      return applyHash(entity);

    case 'category-tag':
      return applyCategoryTag(entity);

    default: {
      // TypeScript exhaustiveness guard — should never be reached at runtime
      // if the type system is intact.
      const _exhaustive: never = style;
      throw new Error(`Unknown redaction style: ${String(_exhaustive)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Applies PII redaction to `text` by replacing each entity span with a token
 * generated according to the specified {@link RedactionStyle}.
 *
 * ### Algorithm
 *
 * 1. If `entities` is empty, return `text` unchanged.
 * 2. Sort entities by `start` offset in **descending** order (right to left).
 * 3. Iteratively replace each span via `String.prototype.slice` — because
 *    processing proceeds right-to-left, earlier spans retain their original
 *    offsets and can be replaced without adjustment.
 * 4. Return the final redacted string.
 *
 * The function assumes that the provided `entities` are **non-overlapping**.
 * Overlapping spans must be resolved by {@link mergeEntities} before calling
 * this function.  Overlapping spans produce undefined output.
 *
 * @param text     - The original input string to redact.
 * @param entities - Non-overlapping PII entities to redact.  May be unsorted;
 *                   the function sorts internally.
 * @param style    - How each PII span should be replaced.
 * @returns The redacted string with all PII spans replaced according to
 *          `style`.
 *
 * @example
 * ```ts
 * const redacted = redactText(
 *   'Contact John Smith at john@example.com please',
 *   [
 *     { entityType: 'PERSON', text: 'John Smith', start: 8, end: 18, score: 0.95, source: 'ner-model' },
 *     { entityType: 'EMAIL',  text: 'john@example.com', start: 22, end: 38, score: 1.0, source: 'regex' },
 *   ],
 *   'placeholder',
 * );
 * // → 'Contact [PERSON] at [EMAIL] please'
 * ```
 */
export function redactText(
  text: string,
  entities: PiiEntity[],
  style: RedactionStyle,
): string {
  // Fast path: nothing to redact.
  if (entities.length === 0) {
    return text;
  }

  // Sort by start offset descending so that right-most spans are replaced
  // first, preserving the validity of earlier offsets.
  const sorted = entities.slice().sort((a, b) => b.start - a.start);

  // Apply replacements left-fold over the string, processing right-to-left.
  let result = text;
  for (const entity of sorted) {
    const replacement = getReplacementText(entity, style);

    // Splice: keep everything before the span, insert replacement, keep
    // everything after the span.
    result =
      result.slice(0, entity.start) +
      replacement +
      result.slice(entity.end);
  }

  return result;
}
