/**
 * @file ClaimExtractor.ts
 * @description Extracts and optionally decomposes atomic factual claims from
 * free-form agent output text.
 *
 * The extraction pipeline runs in two phases:
 *
 * **Phase 1 — Heuristic split & filter**
 * 1. Strip fenced code blocks (content between ``` fences is code, not claims).
 * 2. Split on sentence boundaries (`. `, `? `, `! `, newlines).
 * 3. Trim whitespace and drop empty sentences.
 * 4. Filter out non-factual sentences:
 *    - Questions (end with `?`)
 *    - Hedging statements (`"I think"`, `"maybe"`, `"perhaps"`, `"it seems"`,
 *      `"I believe"`)
 *    - Meta / conversational filler (`"I hope this helps"`, `"let me know"`,
 *      `"feel free"`, `"here's"`)
 *    - Greetings / acknowledgements (`"hello"`, `"hi there"`, `"sure!"`,
 *      `"great question"`, `"of course"`)
 *
 * **Phase 2 — Complexity check & LLM decomposition**
 * For each surviving sentence, detect "complexity":
 * - Word count > 20, OR
 * - Contains conjunctive signals: `", and "`, `"; "`, `" while "`,
 *   `" however "`, `" additionally "`.
 *
 * If the sentence is complex and an LLM function was provided, send a
 * decomposition prompt and parse the returned JSON array of atomic claim
 * strings.  Otherwise keep the sentence as a single claim.
 *
 * @module agentos/extensions/packs/grounding-guard/ClaimExtractor
 */

import type { ExtractedClaim } from './types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Prefix strings (lower-cased) that identify hedging / uncertain statements
 * that should not be treated as verifiable factual claims.
 */
const HEDGE_PREFIXES: readonly string[] = [
  'i think',
  'maybe',
  'perhaps',
  'it seems',
  'i believe',
];

/**
 * Substrings (lower-cased) that indicate meta / conversational filler content
 * rather than factual claims.
 */
const META_SUBSTRINGS: readonly string[] = [
  'i hope this helps',
  'let me know',
  'feel free',
  "here's",
  'heres',
];

/**
 * Prefixes (lower-cased) that identify greetings and conversational
 * acknowledgements which carry no factual content.
 */
const GREETING_PREFIXES: readonly string[] = [
  'hello',
  'hi there',
  'sure!',
  'great question',
  'of course',
];

/**
 * Conjunctive substrings that suggest a sentence contains multiple atomic
 * assertions and should be decomposed.
 */
const CONJUNCTION_SIGNALS: readonly string[] = [
  ', and ',
  '; ',
  ' while ',
  ' however ',
  ' additionally ',
];

/**
 * Word count above which a sentence is considered "complex" regardless of
 * whether it contains conjunction signals.
 */
const COMPLEX_WORD_COUNT = 20;

// ---------------------------------------------------------------------------
// ClaimExtractor
// ---------------------------------------------------------------------------

/**
 * Extracts verifiable factual claims from free-form agent output text.
 *
 * Uses a two-phase pipeline:
 * 1. Heuristic split + filter (always runs, no external dependencies).
 * 2. Optional LLM-based sentence decomposition for complex, multi-assertion
 *    sentences.
 *
 * @example
 * ```typescript
 * // Without LLM decomposition:
 * const extractor = new ClaimExtractor();
 * const claims = await extractor.extract("The sky is blue. Is it though?");
 * // → [{ claim: 'The sky is blue.', sourceOffset: 0, decomposed: false }]
 *
 * // With LLM decomposition:
 * const extractor = new ClaimExtractor(myLlmFn);
 * const claims = await extractor.extract(longComplexText);
 * ```
 */
export class ClaimExtractor {
  // -------------------------------------------------------------------------
  // Private state
  // -------------------------------------------------------------------------

  /**
   * Optional LLM callable used for complex sentence decomposition.
   * When `undefined`, complex sentences are passed through as single claims.
   *
   * @param prompt - Full prompt string including instruction and sentence text.
   * @returns Raw LLM response text (expected to contain a JSON array).
   */
  private readonly llmFn: ((prompt: string) => Promise<string>) | undefined;

  // -------------------------------------------------------------------------
  // Constructor
  // -------------------------------------------------------------------------

  /**
   * Construct a new ClaimExtractor.
   *
   * @param llmFn - Optional LLM function to invoke for decomposing complex
   *   sentences into multiple atomic claims.  When omitted, complex sentences
   *   are kept as single claims with `decomposed: false`.
   */
  constructor(llmFn?: (prompt: string) => Promise<string>) {
    this.llmFn = llmFn;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Extract verifiable factual claims from `text`.
   *
   * The pipeline:
   * 1. Strip fenced code blocks.
   * 2. Split on sentence boundaries.
   * 3. Filter non-factual sentences.
   * 4. Decompose complex sentences via LLM (if configured).
   *
   * @param text - The raw agent output to extract claims from.
   * @returns A promise resolving to the array of extracted claims.
   *   Returns an empty array for empty or code-only input.
   */
  async extract(text: string): Promise<ExtractedClaim[]> {
    // Guard against empty input early.
    if (!text || text.trim().length === 0) {
      return [];
    }

    // Phase 1a: strip fenced code blocks so code examples are not analysed.
    const stripped = this.stripCodeBlocks(text);

    // Phase 1b: split on sentence boundaries and record offsets.
    const sentences = this.splitIntoSentences(stripped, text);

    // Phase 1c: filter out non-factual sentences.
    const factual = sentences.filter((s) => this.isFactual(s.sentence));

    // Phase 2: for each remaining sentence, check complexity and decompose.
    const results: ExtractedClaim[] = [];

    for (const { sentence, offset } of factual) {
      const complex = this.isComplex(sentence);

      if (complex && this.llmFn) {
        // Attempt LLM-based decomposition into atomic claims.
        const { claims: decomposedClaims, wasDecomposed } = await this.tryDecompose(sentence);
        for (const claim of decomposedClaims) {
          // Mark `decomposed: true` only when the LLM actually produced a
          // distinct decomposition (not the fallback path that returns the
          // original sentence verbatim).
          results.push({ claim, sourceOffset: offset, decomposed: wasDecomposed });
        }
      } else {
        // Keep the sentence as a single (possibly complex) claim.
        results.push({ claim: sentence, sourceOffset: offset, decomposed: false });
      }
    }

    return results;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Remove fenced code blocks (content between ``` markers) from `text`.
   *
   * Code is never a factual claim, so stripping it before splitting prevents
   * spurious sentences from code examples (e.g. code comments) being
   * treated as claims.
   *
   * Handles both single-line and multi-line fences.  Non-matching text is
   * preserved verbatim, including the positions of all other characters.
   *
   * @param text - Raw text that may contain one or more ``` fences.
   * @returns Text with all code blocks replaced by empty strings.
   */
  private stripCodeBlocks(text: string): string {
    // Replace everything between ``` ... ``` (including the delimiters)
    // with an empty string.  The `s` flag allows `.` to match newlines.
    return text.replace(/```[\s\S]*?```/g, '');
  }

  /**
   * Split `stripped` text into individual sentences and record each
   * sentence's offset in the *original* (pre-strip) text.
   *
   * Splitting is performed on common sentence-ending punctuation followed
   * by whitespace (`". "`, `"? "`, `"! "`), and on newlines.
   *
   * Offset tracking uses the original `text` so that `sourceOffset` values
   * in {@link ExtractedClaim} are always valid positions in the caller's
   * input string.
   *
   * @param stripped - Text after code block removal.
   * @param original - The original unmodified text (used for offset lookup).
   * @returns Array of `{ sentence, offset }` objects, trimmed and non-empty.
   */
  private splitIntoSentences(
    stripped: string,
    original: string,
  ): Array<{ sentence: string; offset: number }> {
    // Split on sentence-ending punctuation followed by whitespace, or newlines.
    const rawParts = stripped.split(/(?<=[.?!])\s+|\n/);

    const results: Array<{ sentence: string; offset: number }> = [];
    // Track a search position in the original text to derive offsets.
    let searchFrom = 0;

    for (const part of rawParts) {
      const trimmed = part.trim();
      if (trimmed.length === 0) {
        // Advance searchFrom past the whitespace-only gap.
        searchFrom += part.length + 1; // +1 for the split delimiter
        continue;
      }

      // Find the trimmed sentence in the original text starting from searchFrom.
      const offset = original.indexOf(trimmed, searchFrom);
      if (offset !== -1) {
        searchFrom = offset + trimmed.length;
      }

      results.push({ sentence: trimmed, offset: offset === -1 ? 0 : offset });
    }

    return results;
  }

  /**
   * Determine whether a sentence should be treated as a verifiable factual
   * claim.
   *
   * A sentence is **not** factual if it:
   * - Ends with `?` (it is a question)
   * - Starts with a hedge prefix (uncertainty marker)
   * - Contains a meta / conversational filler substring
   * - Starts with a greeting or acknowledgement
   *
   * @param sentence - Trimmed sentence text.
   * @returns `true` if the sentence should be verified as a factual claim.
   */
  private isFactual(sentence: string): boolean {
    const lower = sentence.toLowerCase();

    // Questions are not factual claims.
    if (sentence.endsWith('?')) {
      return false;
    }

    // Hedging statements express uncertainty — not verifiable claims.
    for (const hedge of HEDGE_PREFIXES) {
      if (lower.startsWith(hedge)) {
        return false;
      }
    }

    // Meta / conversational filler.
    for (const meta of META_SUBSTRINGS) {
      if (lower.includes(meta)) {
        return false;
      }
    }

    // Greetings and acknowledgements.
    for (const greeting of GREETING_PREFIXES) {
      if (lower.startsWith(greeting)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Attempt LLM decomposition and return a structured result indicating
   * whether the decomposition succeeded or fell back to the original sentence.
   *
   * Wraps {@link decompose} so the calling code in {@link extract} can
   * correctly set `decomposed: true` only when the LLM produced a real
   * decomposition, not when it fell back to the original sentence.
   *
   * @param sentence - The complex sentence to decompose.
   * @returns `{ claims, wasDecomposed }` — `wasDecomposed` is `true` only
   *   when the LLM produced a non-trivial result distinct from the original
   *   sentence.
   */
  private async tryDecompose(
    sentence: string,
  ): Promise<{ claims: string[]; wasDecomposed: boolean }> {
    const result = await this.decompose(sentence);
    // Decomposition is considered successful when the LLM returned more
    // than one claim, OR returned a single claim that differs from the
    // input (i.e. a genuine reformulation).  Returning the original sentence
    // verbatim is the fallback path, not a real decomposition.
    const wasDecomposed =
      result.length > 1 || (result.length === 1 && result[0] !== sentence);
    return { claims: result, wasDecomposed };
  }

  /**
   * Determine whether a sentence is "complex" — i.e., likely to contain
   * multiple distinct atomic assertions that should be decomposed.
   *
   * Complexity is signalled by either:
   * - Word count exceeding {@link COMPLEX_WORD_COUNT}, or
   * - Presence of a conjunction signal substring from {@link CONJUNCTION_SIGNALS}.
   *
   * @param sentence - Trimmed sentence text.
   * @returns `true` when the sentence should be decomposed.
   */
  private isComplex(sentence: string): boolean {
    // Count whitespace-separated tokens as a proxy for word count.
    const wordCount = sentence.split(/\s+/).length;
    if (wordCount > COMPLEX_WORD_COUNT) {
      return true;
    }

    // Check for conjunction signals that suggest multiple assertions.
    const lower = sentence.toLowerCase();
    for (const signal of CONJUNCTION_SIGNALS) {
      if (lower.includes(signal)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Use the configured LLM to decompose a complex sentence into an array of
   * atomic factual claim strings.
   *
   * Sends a structured decomposition prompt to the LLM and expects a JSON
   * array of strings as the response body.  If the LLM response cannot be
   * parsed as a JSON array the original sentence is returned as a single-item
   * array as a safe fallback.
   *
   * @param sentence - The complex sentence to decompose.
   * @returns Array of atomic claim strings derived from the sentence.
   */
  private async decompose(sentence: string): Promise<string[]> {
    if (!this.llmFn) {
      // Should not be reached in normal flow (caller checks this), but guard
      // defensively so the method is safe to call directly.
      return [sentence];
    }

    const prompt = [
      'You are a claim decomposition assistant.',
      'Break the following sentence into a list of independent, atomic factual claims.',
      'Each claim must be a complete, self-contained statement that can be verified on its own.',
      'Return ONLY a JSON array of strings, with no surrounding text, markdown, or explanation.',
      '',
      `Sentence: "${sentence}"`,
      '',
      'Example output: ["Claim one.", "Claim two.", "Claim three."]',
    ].join('\n');

    let raw: string;
    try {
      raw = await this.llmFn(prompt);
    } catch {
      // LLM call failed — fall back to the whole sentence.
      return [sentence];
    }

    // Extract the first JSON array from the response.
    const arrayMatch = raw.match(/\[[\s\S]*]/);
    if (!arrayMatch) {
      // Response did not contain a parseable array — use original sentence.
      return [sentence];
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(arrayMatch[0]);
    } catch {
      // JSON parse error — use original sentence.
      return [sentence];
    }

    // Validate that we got an array of strings.
    if (
      !Array.isArray(parsed) ||
      parsed.length === 0 ||
      !parsed.every((item) => typeof item === 'string')
    ) {
      return [sentence];
    }

    // Filter out empty strings that might sneak in from the LLM.
    const claims = (parsed as string[]).map((s) => s.trim()).filter((s) => s.length > 0);
    return claims.length > 0 ? claims : [sentence];
  }
}
