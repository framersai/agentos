/**
 * @fileoverview Code-aware tokenizer that splits camelCase, snake_case,
 * SCREAMING_SNAKE, and dot-separated identifiers into individual words.
 *
 * @module agentos/core/text-processing/tokenizers/CodeTokenizer
 */

import type { Token } from '../types';
import type { ITokenizer } from '../ITextProcessor';

/** Matches word-like sequences including dots for qualified names. */
const CODE_WORD_REGEX = /[\p{L}\p{N}_.]+/gu;

/** Split camelCase: insert boundary before uppercase letters that follow lowercase. */
const CAMEL_SPLIT = /([a-z\d])([A-Z])/g;

/** Split ALLCAPS followed by lowercase: XMLParser → XML + Parser. */
const CAPS_SPLIT = /([A-Z]+)([A-Z][a-z])/g;

/**
 * Code-aware tokenizer.
 *
 * Splits identifiers that programmers write:
 * - `getUserName` → `get`, `user`, `name`
 * - `get_user_name` → `get`, `user`, `name`
 * - `MAX_RETRY_COUNT` → `max`, `retry`, `count`
 * - `XMLParser` → `xml`, `parser`
 * - `path.to.module` → `path`, `to`, `module`
 */
export class CodeTokenizer implements ITokenizer {
  readonly name = 'CodeTokenizer';

  private minLength: number;

  constructor(minLength: number = 2) {
    this.minLength = minLength;
  }

  tokenize(text: string): Token[] {
    const tokens: Token[] = [];
    let match: RegExpExecArray | null;

    CODE_WORD_REGEX.lastIndex = 0;
    while ((match = CODE_WORD_REGEX.exec(text)) !== null) {
      const word = match[0];
      const position = match.index;

      /* Split on dots first (path.to.module) */
      const dotParts = word.split('.');

      let offset = 0;
      for (const part of dotParts) {
        if (part.length === 0) { offset += 1; continue; }

        /* Split on underscores (snake_case) */
        const underscoreParts = part.split('_');

        let subOffset = 0;
        for (const sub of underscoreParts) {
          if (sub.length === 0) { subOffset += 1; continue; }

          /* Split camelCase */
          const camelSplit = sub
            .replace(CAMEL_SPLIT, '$1\0$2')
            .replace(CAPS_SPLIT, '$1\0$2')
            .split('\0');

          let camelOffset = 0;
          for (const fragment of camelSplit) {
            if (fragment.length >= this.minLength) {
              tokens.push({
                text: fragment,
                original: word,
                position: position + offset + subOffset + camelOffset,
              });
            }
            camelOffset += fragment.length;
          }
          subOffset += sub.length + 1; /* +1 for the underscore */
        }
        offset += part.length + 1; /* +1 for the dot */
      }
    }

    return tokens;
  }
}
