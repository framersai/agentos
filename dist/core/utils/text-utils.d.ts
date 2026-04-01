/**
 * @fileoverview Shared text utility functions used across AgentOS modules.
 *
 * These utilities cover common text-processing operations: numeric clamping,
 * safe JSON parsing (including markdown code-fence stripping), tokenisation,
 * text normalisation, and a lightweight token-count estimator used wherever
 * the exact subword count is not critical.
 *
 * All functions are pure (no side-effects) and operate synchronously so they
 * can be called from any context — including hot paths and web workers.
 *
 * @module agentos/core/utils/text-utils
 */
/**
 * Clamps a numeric `value` to the closed interval [`min`, `max`].
 *
 * @example
 * ```typescript
 * clamp(5, 0, 10);  // → 5
 * clamp(-3, 0, 10); // → 0
 * clamp(15, 0, 10); // → 10
 * ```
 *
 * @param value - The number to clamp.
 * @param min   - The inclusive lower bound.
 * @param max   - The inclusive upper bound.
 * @returns The clamped value, guaranteed to satisfy `min <= result <= max`.
 */
export declare function clamp(value: number, min: number, max: number): number;
/**
 * Safely parses a JSON string, stripping markdown code fences if present.
 *
 * LLMs frequently wrap JSON in triple-backtick blocks (e.g. ` ```json … ``` `
 * or ` ``` … ``` `).  This function strips those fences before attempting
 * `JSON.parse`, so callers do not need to pre-process LLM output.
 *
 * @example
 * ```typescript
 * // Plain JSON
 * parseJsonResponse<{ ok: boolean }>('{"ok":true}'); // → { ok: true }
 *
 * // Markdown-fenced JSON
 * parseJsonResponse('```json\n{"ok":true}\n```'); // → { ok: true }
 *
 * // Invalid input
 * parseJsonResponse('not json'); // → null
 * ```
 *
 * @typeParam T - Expected shape of the parsed value.
 * @param response - Raw string that may contain JSON, optionally wrapped in
 *   markdown code fences.
 * @returns The parsed value cast to `T`, or `null` if parsing fails for any
 *   reason (syntax error, empty input, etc.).
 */
export declare function parseJsonResponse<T = unknown>(response: string): T | null;
/**
 * Splits text into lowercase word tokens, stripping punctuation.
 *
 * This is an intentionally simple, dependency-free tokeniser suited for tasks
 * like keyword matching, vocabulary analysis, and lightweight NLP pipelines.
 * It is *not* a subword tokeniser and does not respect language-specific rules.
 *
 * Steps performed:
 * 1. Convert to lowercase.
 * 2. Replace non-alphanumeric characters (except spaces) with spaces.
 * 3. Split on whitespace.
 * 4. Drop empty strings that can arise from consecutive separators.
 *
 * @example
 * ```typescript
 * tokenize('Hello, World!');    // → ['hello', 'world']
 * tokenize('foo  bar\tbaz');    // → ['foo', 'bar', 'baz']
 * tokenize('');                 // → []
 * ```
 *
 * @param text - The string to tokenise.
 * @returns An array of lowercase word tokens with punctuation removed.
 */
export declare function tokenize(text: string): string[];
/**
 * Normalises text by lowercasing, stripping punctuation, and collapsing
 * internal whitespace runs to a single space.
 *
 * This produces a canonical form useful for fuzzy comparisons, deduplication,
 * and pre-processing before embedding or classification.
 *
 * Steps performed:
 * 1. Convert to lowercase.
 * 2. Replace non-alphanumeric characters (except spaces) with spaces.
 * 3. Collapse consecutive whitespace to a single space.
 * 4. Trim leading and trailing whitespace.
 *
 * @example
 * ```typescript
 * normalizeText('Hello, World!');       // → 'hello world'
 * normalizeText('  foo   bar  ');       // → 'foo bar'
 * normalizeText("it's a test!");        // → 'it s a test'
 * ```
 *
 * @param text - The string to normalise.
 * @returns A normalised string.
 */
export declare function normalizeText(text: string): string;
/**
 * Estimates the number of LLM tokens in a string using the rough heuristic
 * of **1 token ≈ 4 characters** (the widely-cited GPT-family average).
 *
 * This is intentionally approximate. It is suitable for budget checks,
 * sliding-window sizing, and other cost-control logic where precision is not
 * required.  For exact subword counts, use the model's native tokeniser.
 *
 * @example
 * ```typescript
 * estimateTokens('Hello!');     // → 2  (6 chars / 4 → ceil(1.5) = 2)
 * estimateTokens('');           // → 0
 * estimateTokens('a'.repeat(8)); // → 2
 * ```
 *
 * @param text - The string whose token count should be estimated.
 * @returns A non-negative integer estimate of the token count.
 *   Returns `0` for empty or non-string input.
 */
export declare function estimateTokens(text: string): number;
/**
 * Computes the cosine similarity between two numeric vectors.
 *
 * Cosine similarity measures the cosine of the angle between two vectors in
 * an inner-product space.  It ranges from **-1.0** (perfectly opposite
 * directions) to **1.0** (perfectly identical directions), with **0** meaning
 * the vectors are orthogonal (no linear similarity).
 *
 * This single implementation consolidates 6+ duplicate `cosineSimilarity`
 * helpers that previously existed across the AgentOS codebase (discovery,
 * social-posting, rag, etc.), providing a single well-tested source of truth.
 *
 * ### Edge-case behaviour
 * | Condition | Return value | Reason |
 * |---|---|---|
 * | Empty arrays | `0` | Division by zero is undefined; 0 is the safe neutral value. |
 * | Mismatched dimensions | `0` | Meaningless to compare vectors in different spaces. |
 * | Either vector is the zero vector | `0` | Magnitude is 0, denominator would be 0. |
 *
 * @example
 * ```typescript
 * // Identical unit vectors → 1
 * cosineSimilarity([1, 0], [1, 0]);  // → 1.0
 *
 * // Orthogonal vectors → 0
 * cosineSimilarity([1, 0], [0, 1]);  // → 0
 *
 * // Opposite unit vectors → -1
 * cosineSimilarity([1, 0], [-1, 0]); // → -1.0
 *
 * // Non-unit but parallel vectors → 1
 * cosineSimilarity([2, 4], [1, 2]);  // → 1.0
 * ```
 *
 * @param a - First numeric vector (any dimension ≥ 1).
 * @param b - Second numeric vector — must have the same length as `a`.
 * @returns Cosine similarity in the range `[-1, 1]`.
 *   Returns `0` for mismatched dimensions, empty arrays, or zero-magnitude vectors.
 */
export declare function cosineSimilarity(a: number[], b: number[]): number;
//# sourceMappingURL=text-utils.d.ts.map