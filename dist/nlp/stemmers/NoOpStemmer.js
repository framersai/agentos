/**
 * @fileoverview Pass-through stemmer that does nothing.
 * Use for code identifiers where stemming would be harmful
 * (e.g. `kubernetes` → `kubernet` is wrong).
 *
 * @module agentos/nlp/stemmers/NoOpStemmer
 */
export class NoOpStemmer {
    constructor() {
        this.name = 'NoOpStemmer';
    }
    process(tokens) {
        return tokens;
    }
}
//# sourceMappingURL=NoOpStemmer.js.map