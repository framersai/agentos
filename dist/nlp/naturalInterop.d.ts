/**
 * @fileoverview Synchronous interop helpers for the CommonJS `natural` package
 * from AgentOS's ESM runtime.
 * @module agentos/nlp/naturalInterop
 */
type NaturalModule = {
    stopwords?: string[];
    PorterStemmer?: {
        stem(word: string): string;
    };
    LancasterStemmer?: {
        stem(word: string): string;
    };
};
/**
 * Load the `natural` module synchronously from Node ESM.
 *
 * Returns `null` when the package is unavailable in the current runtime so
 * callers can degrade gracefully.
 */
export declare function getNaturalModule(): NaturalModule | null;
export {};
//# sourceMappingURL=naturalInterop.d.ts.map