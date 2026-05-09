/**
 * @file EntityExtractor.ts
 * @description Mem0-v3-style entity extractor. Three classes:
 *   - proper nouns (standalone capitalized tokens)
 *   - quoted text (within "..." or '...')
 *   - compound noun phrases (consecutive capitalized tokens)
 *
 * Order of detection: quoted text first (preserves verbatim spans),
 * then compound noun phrases (greedy, longest match), then proper
 * nouns (whatever capitalized tokens are not already inside a compound).
 *
 * Reference: docs.mem0.ai/migration/oss-v2-to-v3 §"Entity Extraction".
 *
 * @module @framers/agentos/ingest-router/executors/EntityExtractor
 */

import type {
  ExtractedEntity,
  EntityExtractionResult,
  EntityLinkingOptions,
} from './entity-types.js';

export class EntityExtractor {
  private readonly properNounMinLength: number;
  private readonly compoundNounMaxLength: number;

  constructor(opts: EntityLinkingOptions = {}) {
    this.properNounMinLength = opts.properNounMinLength ?? 2;
    this.compoundNounMaxLength = opts.compoundNounMaxLength ?? 5;
  }

  extract(text: string): EntityExtractionResult {
    const entities: ExtractedEntity[] = [];

    // 1. Quoted text — `"..."` or `'...'`. Captures verbatim spans
    //    that authors wrap in quotes (config values, paths, etc.).
    const quotedRegex = /["']([^"'\n]{1,200}?)["']/g;
    let match: RegExpExecArray | null;
    while ((match = quotedRegex.exec(text)) !== null) {
      entities.push({
        text: match[1],
        kind: 'quoted-text',
        positions: [match.index + 1],
      });
    }

    // 2. Compound noun phrases — N consecutive capitalized tokens
    //    where N >= 2 and N <= compoundNounMaxLength. Greedy: the
    //    longest match wins.
    const maxCompoundTokens = Math.max(2, this.compoundNounMaxLength);
    const compoundPattern = new RegExp(
      `\\b[A-Z][a-zA-Z]+(?:\\s+[A-Z][a-zA-Z]+){1,${maxCompoundTokens - 1}}\\b`,
      'g',
    );
    const compoundRanges: Array<{ start: number; end: number }> = [];
    while ((match = compoundPattern.exec(text)) !== null) {
      const start = match.index;
      const end = start + match[0].length;
      compoundRanges.push({ start, end });
      entities.push({
        text: match[0],
        kind: 'compound-noun-phrase',
        positions: [start],
      });
    }

    // 3. Proper nouns — single capitalized tokens NOT already covered
    //    by a compound noun phrase.
    const properPattern = /\b[A-Z][a-zA-Z]+\b/g;
    while ((match = properPattern.exec(text)) !== null) {
      if (match[0].length < this.properNounMinLength) continue;
      const start = match.index;
      const inCompound = compoundRanges.some(
        (range) => start >= range.start && start < range.end,
      );
      if (inCompound) continue;
      entities.push({
        text: match[0],
        kind: 'proper-noun',
        positions: [start],
      });
    }

    return { entities, rawText: text };
  }
}
