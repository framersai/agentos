/**
 * @fileoverview Lowercases all token text. Preserves original.
 * @module agentos/nlp/normalizers/LowercaseNormalizer
 */
export class LowercaseNormalizer {
    constructor() {
        this.name = 'LowercaseNormalizer';
    }
    process(tokens) {
        return tokens.map(t => ({ ...t, text: t.text.toLowerCase() }));
    }
}
//# sourceMappingURL=LowercaseNormalizer.js.map