/**
 * @fileoverview Strips diacritics/accents from token text.
 * `café` → `cafe`, `naïve` → `naive`.
 *
 * @module agentos/nlp/normalizers/AccentStripper
 */
/**
 * Removes combining diacritical marks after Unicode NFD decomposition.
 * This makes accent-insensitive search possible.
 */
export class AccentStripper {
    constructor() {
        this.name = 'AccentStripper';
    }
    process(tokens) {
        return tokens.map(t => ({
            ...t,
            text: t.text.normalize('NFD').replace(/[\u0300-\u036f]/g, ''),
        }));
    }
}
//# sourceMappingURL=AccentStripper.js.map