/**
 * @fileoverview Pass-through lemmatizer that does nothing.
 * @module agentos/nlp/lemmatizers/NoOpLemmatizer
 */
export class NoOpLemmatizer {
    constructor() {
        this.name = 'NoOpLemmatizer';
    }
    process(tokens) {
        return tokens;
    }
}
//# sourceMappingURL=NoOpLemmatizer.js.map