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

// ---------------------------------------------------------------------------
// Numeric helpers
// ---------------------------------------------------------------------------

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
export function clamp(value: number, min: number, max: number): number {
  // Guard: if min > max the range is degenerate; return min as a safe fallback.
  if (min > max) {
    return min;
  }
  return Math.min(Math.max(value, min), max);
}

// ---------------------------------------------------------------------------
// JSON parsing
// ---------------------------------------------------------------------------

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
export function parseJsonResponse<T = unknown>(response: string): T | null {
  if (!response || typeof response !== 'string') {
    return null;
  }

  // Strip leading/trailing whitespace first.
  let raw = response.trim();

  // Remove markdown code fences.  Handles both:
  //   ```json\n…\n```  and  ```\n…\n```
  const fencePattern = /^```(?:json|javascript|js|ts|typescript)?\s*\n?([\s\S]*?)\n?```$/i;
  const fenceMatch = fencePattern.exec(raw);
  if (fenceMatch) {
    // fenceMatch[1] is the content between the fences.
    raw = fenceMatch[1].trim();
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    // Parsing failed — return null rather than throwing so callers can handle
    // gracefully without a try/catch at every call site.
    return null;
  }
}

// ---------------------------------------------------------------------------
// Tokenisation & normalisation
// ---------------------------------------------------------------------------

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
export function tokenize(text: string): string[] {
  if (!text || typeof text !== 'string') {
    return [];
  }

  return (
    text
      .toLowerCase()
      // Replace every run of non-alphanumeric, non-space chars with a space.
      .replace(/[^a-z0-9\s]/g, ' ')
      // Split on any run of whitespace.
      .split(/\s+/)
      // Remove empty strings produced by leading/trailing whitespace or
      // consecutive separators.
      .filter((token) => token.length > 0)
  );
}

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
export function normalizeText(text: string): string {
  if (!text || typeof text !== 'string') {
    return '';
  }

  return (
    text
      .toLowerCase()
      // Replace punctuation/symbols with spaces.
      .replace(/[^a-z0-9\s]/g, ' ')
      // Collapse runs of whitespace to a single space.
      .replace(/\s+/g, ' ')
      .trim()
  );
}

// ---------------------------------------------------------------------------
// Token estimation
// ---------------------------------------------------------------------------

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
export function estimateTokens(text: string): number {
  if (!text || typeof text !== 'string') {
    return 0;
  }
  return Math.ceil(text.length / 4);
}
