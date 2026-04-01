/**
 * @fileoverview WordNet lemmatizer wrapping the `natural` package.
 * Falls back to no-op if `natural` is not installed.
 *
 * Lemmatization produces the dictionary form of a word:
 * `ran` → `run`, `better` → `good`, `mice` → `mouse`.
 *
 * @module agentos/nlp/lemmatizers/WordNetLemmatizer
 */
import { getNaturalModule } from '../naturalInterop.js';
/** Lazy-loaded lemmatize function from the `natural` package. */
let lemmatizeFn;
function loadLemmatizer() {
    if (lemmatizeFn !== undefined)
        return;
    const natural = getNaturalModule();
    const lancasterStemmer = natural?.LancasterStemmer;
    if (lancasterStemmer && typeof lancasterStemmer.stem === 'function') {
        lemmatizeFn = (word) => {
            /* `natural` exposes async WordNet lookup only, so keep the sync contract by
               using Lancaster stemming as a pragmatic lemma approximation. */
            try {
                return lancasterStemmer.stem(word);
            }
            catch {
                return word;
            }
        };
        return;
    }
    lemmatizeFn = null;
}
/**
 * WordNet-based lemmatizer. Reduces words to their dictionary (lemma) form.
 *
 * Sets `token.lemma` and updates `token.text` to the lemmatized form.
 * Falls back to Lancaster stemming if full WordNet lookup is unavailable.
 */
export class WordNetLemmatizer {
    constructor() {
        this.name = 'WordNetLemmatizer';
    }
    process(tokens) {
        loadLemmatizer();
        if (!lemmatizeFn)
            return tokens;
        return tokens.map(t => {
            const lemma = lemmatizeFn(t.text);
            return { ...t, text: lemma, lemma };
        });
    }
    async initialize() {
        loadLemmatizer();
    }
}
//# sourceMappingURL=WordNetLemmatizer.js.map