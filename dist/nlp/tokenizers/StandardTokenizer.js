/**
 * @fileoverview Unicode-aware word tokenizer.
 * Splits on whitespace, punctuation, and special characters.
 * Produces tokens with position tracking.
 *
 * @module agentos/nlp/tokenizers/StandardTokenizer
 */
/** Matches word-like sequences: letters, digits, underscores. */
const WORD_REGEX = /[\p{L}\p{N}_]+/gu;
/**
 * Standard tokenizer that splits text on Unicode word boundaries.
 * Handles punctuation, whitespace, hyphens, and special characters.
 * Preserves position offsets for each token.
 */
export class StandardTokenizer {
    constructor(minLength = 2) {
        this.name = 'StandardTokenizer';
        this.minLength = minLength;
    }
    tokenize(text) {
        const tokens = [];
        let match;
        WORD_REGEX.lastIndex = 0;
        while ((match = WORD_REGEX.exec(text)) !== null) {
            const word = match[0];
            if (word.length >= this.minLength) {
                tokens.push({
                    text: word,
                    original: word,
                    position: match.index,
                });
            }
        }
        return tokens;
    }
}
//# sourceMappingURL=StandardTokenizer.js.map