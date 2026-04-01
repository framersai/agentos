/**
 * @fileoverview Code-aware tokenizer that splits camelCase, snake_case,
 * SCREAMING_SNAKE, and dot-separated identifiers into individual words.
 *
 * @module agentos/nlp/tokenizers/CodeTokenizer
 */
import type { Token } from '../types';
import type { ITokenizer } from '../ITextProcessor';
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
export declare class CodeTokenizer implements ITokenizer {
    readonly name = "CodeTokenizer";
    private minLength;
    constructor(minLength?: number);
    tokenize(text: string): Token[];
}
//# sourceMappingURL=CodeTokenizer.d.ts.map