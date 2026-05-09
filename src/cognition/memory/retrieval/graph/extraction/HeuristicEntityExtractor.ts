/**
 * @fileoverview Heuristic entity extraction over free-form text.
 *
 * Zero-LLM, deterministic regex-based extraction of five high-IDF entity
 * families: proper nouns, ISO dates, named dates, currency amounts, and
 * numeric amounts with common units. Intended for populating
 * `MemoryTrace.entities` at encode time and seeding Anderson spreading
 * activation at retrieve time.
 *
 * Design notes:
 * - Sentence-start caps are filtered (common false positive: "The",
 *   "A", "I" start sentences without being proper nouns). The filter
 *   is a fixed lowercase-stopword list.
 * - Case is preserved in output (entity labels are case-sensitive downstream).
 * - Output is deduplicated by exact-match and capped at 50 entries.
 * - `slugifyEntityId` produces deterministic slug IDs so upsert at
 *   ingest and lookup at retrieve resolve to the same entity.
 *
 * @module agentos/memory/retrieval/graph/extraction/HeuristicEntityExtractor
 */

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

const PROPER_NOUN_RE =
  /\b[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,3}\b/g;

const ISO_DATE_RE = /\b\d{4}-\d{2}-\d{2}\b/g;

const NAMED_DATE_RE =
  /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)(?:uary|ruary|ch|il|e|y|ust|tember|ober|ember)?\s+\d{1,2}(?:,?\s+\d{4})?\b/gi;

const CURRENCY_RE =
  /(?:\$|£|€|¥|USD\s|EUR\s|GBP\s|JPY\s)\s?\d{1,3}(?:,\d{3})*(?:\.\d+)?(?:\s?[KMBkmb])?/g;

const NUMERIC_UNIT_RE =
  /\b\d+(?:\.\d+)?\s?(?:kg|g|lb|lbs|oz|km|m|cm|mm|ft|in|days?|weeks?|months?|years?|hours?|hrs?|minutes?|mins?|seconds?|secs?|%)\b/gi;

/** Sentence-start caps words that are almost never entities. */
const SENTENCE_START_STOPWORDS = new Set<string>([
  'A', 'An', 'The', 'This', 'That', 'These', 'Those',
  'I', 'We', 'You', 'They', 'He', 'She', 'It',
  'My', 'Our', 'Your', 'Their', 'His', 'Her', 'Its',
  'And', 'But', 'Or', 'So', 'Yet',
  'If', 'When', 'While', 'After', 'Before', 'During',
  'Here', 'There', 'Now', 'Then',
  'Yes', 'No',
]);

const MAX_ENTITIES_PER_TEXT = 50;

/**
 * Extract entity labels from free-form text.
 *
 * Applies five regex pattern families, filters single-word sentence-start
 * stopwords, normalizes whitespace, dedupes by exact match, and caps at
 * {@link MAX_ENTITIES_PER_TEXT}.
 *
 * @param text - Free-form text (chunk content, query, etc.).
 * @returns Deduplicated array of entity labels in document order.
 */
export function extractEntities(text: string): string[] {
  if (!text || !text.trim()) return [];

  const raw: string[] = [];

  for (const match of text.matchAll(PROPER_NOUN_RE)) {
    const label = match[0].trim();
    if (!label) continue;
    const firstWord = label.split(/\s+/)[0];
    if (SENTENCE_START_STOPWORDS.has(firstWord) && !label.includes(' ')) {
      continue;
    }
    raw.push(label);
  }

  for (const match of text.matchAll(ISO_DATE_RE)) {
    raw.push(match[0]);
  }

  for (const match of text.matchAll(NAMED_DATE_RE)) {
    raw.push(match[0].replace(/\s+/g, ' ').trim());
  }

  for (const match of text.matchAll(CURRENCY_RE)) {
    raw.push(match[0].replace(/\s+/g, ' ').trim());
  }

  for (const match of text.matchAll(NUMERIC_UNIT_RE)) {
    raw.push(match[0].replace(/\s+/g, ' ').trim());
  }

  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const label of raw) {
    if (seen.has(label)) continue;
    seen.add(label);
    deduped.push(label);
    if (deduped.length >= MAX_ENTITIES_PER_TEXT) break;
  }

  return deduped;
}

/**
 * Derive a deterministic entity ID from a label. Lowercases, strips
 * non-alphanumeric characters except spaces, replaces whitespace with
 * dashes, collapses runs of dashes.
 *
 * Idempotent: `slugifyEntityId(slugifyEntityId(x))` === `slugifyEntityId(x)`.
 *
 * @param label - Entity label from {@link extractEntities}.
 * @returns Slug suitable for use as a stable entity-node id.
 */
export function slugifyEntityId(label: string): string {
  if (!label) return '';
  return label
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}
