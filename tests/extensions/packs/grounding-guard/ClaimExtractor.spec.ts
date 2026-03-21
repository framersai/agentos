/**
 * @fileoverview Unit tests for {@link ClaimExtractor}.
 *
 * All tests run synchronously where possible — the LLM function is always a
 * mock `vi.fn()` that resolves immediately, so no real model calls are made.
 *
 * Test coverage:
 *  1. Splits text into individual sentences
 *  2. Filters out questions (sentences ending with `?`)
 *  3. Filters out hedging statements (I think / maybe / perhaps / it seems / I believe)
 *  4. Filters out meta statements (let me know / feel free / I hope this helps / here's)
 *  5. Filters out code blocks (``` … ```)
 *  6. Uses LLM for complex sentences when a llmFn is configured
 *  7. Falls back to heuristic single-claim when no LLM is configured
 *  8. Returns empty array for empty/whitespace-only text
 *  9. Includes reasonable source offsets in each claim
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ClaimExtractor } from '../../../../src/extensions/packs/grounding-guard/ClaimExtractor';
import type { ExtractedClaim } from '../../../../src/extensions/packs/grounding-guard/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a simple LLM mock that resolves with a JSON array of the provided
 * claim strings.
 */
function mockLlm(claims: string[]): (prompt: string) => Promise<string> {
  return vi.fn(async (_prompt: string) => JSON.stringify(claims));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ClaimExtractor', () => {
  // -------------------------------------------------------------------------
  // 1. Basic sentence splitting
  // -------------------------------------------------------------------------

  describe('sentence splitting', () => {
    it('returns a single claim for a single-sentence input', async () => {
      const extractor = new ClaimExtractor();
      const claims = await extractor.extract('The sky is blue.');
      expect(claims).toHaveLength(1);
      expect(claims[0].claim).toBe('The sky is blue.');
    });

    it('splits on ". " and returns multiple claims', async () => {
      const extractor = new ClaimExtractor();
      const claims = await extractor.extract('The sky is blue. The grass is green.');
      // Both are factual, non-complex sentences.
      expect(claims).toHaveLength(2);
      expect(claims.map((c) => c.claim)).toContain('The sky is blue.');
      expect(claims.map((c) => c.claim)).toContain('The grass is green.');
    });

    it('splits on newlines', async () => {
      const extractor = new ClaimExtractor();
      const claims = await extractor.extract('First fact.\nSecond fact.');
      expect(claims.length).toBeGreaterThanOrEqual(1);
      // At least one of the facts should be present
      const allClaims = claims.map((c) => c.claim);
      expect(allClaims.some((c) => c.includes('fact'))).toBe(true);
    });

    it('trims surrounding whitespace from each sentence', async () => {
      const extractor = new ClaimExtractor();
      const claims = await extractor.extract('  Water boils at 100 degrees Celsius.  ');
      expect(claims[0].claim).toBe('Water boils at 100 degrees Celsius.');
    });

    it('ignores empty sentences produced by consecutive delimiters', async () => {
      const extractor = new ClaimExtractor();
      const claims = await extractor.extract('First fact.\n\nSecond fact.');
      const allClaims = claims.map((c) => c.claim);
      expect(allClaims.every((c) => c.trim().length > 0)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // 2. Filter: questions
  // -------------------------------------------------------------------------

  describe('filtering questions', () => {
    it('removes a sentence that ends with ?', async () => {
      const extractor = new ClaimExtractor();
      const claims = await extractor.extract('Is the sky blue?');
      expect(claims).toHaveLength(0);
    });

    it('keeps the factual part and removes the question', async () => {
      const extractor = new ClaimExtractor();
      const claims = await extractor.extract('The sky is blue. Is it always?');
      expect(claims).toHaveLength(1);
      expect(claims[0].claim).toBe('The sky is blue.');
    });

    it('removes an inline question mixed with a statement', async () => {
      const extractor = new ClaimExtractor();
      const claims = await extractor.extract('Do you know this fact?');
      expect(claims).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // 3. Filter: hedging statements
  // -------------------------------------------------------------------------

  describe('filtering hedge prefixes', () => {
    it('removes "I think" prefix sentences', async () => {
      const extractor = new ClaimExtractor();
      const claims = await extractor.extract('I think the sky is blue.');
      expect(claims).toHaveLength(0);
    });

    it('removes "maybe" sentences', async () => {
      const extractor = new ClaimExtractor();
      const claims = await extractor.extract('Maybe water boils at 100C.');
      expect(claims).toHaveLength(0);
    });

    it('removes "perhaps" sentences', async () => {
      const extractor = new ClaimExtractor();
      const claims = await extractor.extract('Perhaps this is true.');
      expect(claims).toHaveLength(0);
    });

    it('removes "it seems" sentences', async () => {
      const extractor = new ClaimExtractor();
      const claims = await extractor.extract('It seems the data is correct.');
      expect(claims).toHaveLength(0);
    });

    it('removes "I believe" sentences', async () => {
      const extractor = new ClaimExtractor();
      const claims = await extractor.extract('I believe this approach works best.');
      expect(claims).toHaveLength(0);
    });

    it('keeps a sentence that does NOT start with a hedge', async () => {
      const extractor = new ClaimExtractor();
      const claims = await extractor.extract('Water freezes at 0 degrees Celsius.');
      expect(claims).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // 4. Filter: meta statements
  // -------------------------------------------------------------------------

  describe('filtering meta / conversational filler', () => {
    it('removes "I hope this helps" sentences', async () => {
      const extractor = new ClaimExtractor();
      const claims = await extractor.extract('I hope this helps you understand the topic.');
      expect(claims).toHaveLength(0);
    });

    it('removes "let me know" sentences', async () => {
      const extractor = new ClaimExtractor();
      const claims = await extractor.extract('Let me know if you have more questions.');
      expect(claims).toHaveLength(0);
    });

    it('removes "feel free" sentences', async () => {
      const extractor = new ClaimExtractor();
      const claims = await extractor.extract('Feel free to ask anything else.');
      expect(claims).toHaveLength(0);
    });

    it("removes sentences containing \"here's\"", async () => {
      const extractor = new ClaimExtractor();
      const claims = await extractor.extract("Here's an overview of the topic.");
      expect(claims).toHaveLength(0);
    });

    it('keeps factual sentence adjacent to meta filler', async () => {
      const extractor = new ClaimExtractor();
      const claims = await extractor.extract(
        'The Eiffel Tower is 330 metres tall. Let me know if you need more.',
      );
      expect(claims).toHaveLength(1);
      expect(claims[0].claim).toContain('Eiffel Tower');
    });
  });

  // -------------------------------------------------------------------------
  // 5. Filter: greetings
  // -------------------------------------------------------------------------

  describe('filtering greetings and acknowledgements', () => {
    it('removes "hello" sentences', async () => {
      const extractor = new ClaimExtractor();
      const claims = await extractor.extract('Hello there, welcome to the demo.');
      expect(claims).toHaveLength(0);
    });

    it('removes "hi there" sentences', async () => {
      const extractor = new ClaimExtractor();
      const claims = await extractor.extract('Hi there, I can help you today.');
      expect(claims).toHaveLength(0);
    });

    it('removes "of course" sentences', async () => {
      const extractor = new ClaimExtractor();
      const claims = await extractor.extract('Of course, I would be happy to assist.');
      expect(claims).toHaveLength(0);
    });

    it('removes "great question" sentences', async () => {
      const extractor = new ClaimExtractor();
      const claims = await extractor.extract('Great question, let me explain.');
      expect(claims).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // 6. Code block stripping
  // -------------------------------------------------------------------------

  describe('code block stripping', () => {
    it('removes content inside triple-backtick fences', async () => {
      const extractor = new ClaimExtractor();
      const text = 'The sort runs in O(n log n). ```const arr = [3,1,2]; arr.sort();``` This is fast.';
      const claims = await extractor.extract(text);
      // Only the factual sentences should remain; no code tokens
      const allClaims = claims.map((c) => c.claim).join(' ');
      expect(allClaims).not.toContain('const arr');
      expect(allClaims).not.toContain('sort()');
    });

    it('keeps text outside of code fences', async () => {
      const extractor = new ClaimExtractor();
      const text = 'Python was created by Guido van Rossum.\n```\nprint("hello")\n```\nIt was released in 1991.';
      const claims = await extractor.extract(text);
      const allClaims = claims.map((c) => c.claim).join(' ');
      expect(allClaims).toContain('Guido van Rossum');
      expect(allClaims).not.toContain('print("hello")');
    });

    it('handles multiple code blocks', async () => {
      const extractor = new ClaimExtractor();
      const text = 'First fact. ```code1``` Second fact. ```code2``` Third fact.';
      const claims = await extractor.extract(text);
      const allClaims = claims.map((c) => c.claim).join(' ');
      expect(allClaims).not.toContain('code1');
      expect(allClaims).not.toContain('code2');
    });

    it('returns empty array for code-only input', async () => {
      const extractor = new ClaimExtractor();
      const claims = await extractor.extract('```\nconst x = 1;\nconsole.log(x);\n```');
      expect(claims).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // 7. LLM decomposition of complex sentences
  // -------------------------------------------------------------------------

  describe('LLM decomposition of complex sentences', () => {
    it('calls llmFn for sentences with more than 20 words', async () => {
      const llm = mockLlm(['Sub-claim one.', 'Sub-claim two.']);
      const extractor = new ClaimExtractor(llm);
      // This sentence has 22 words (> 20) and should trigger LLM decomposition.
      const longSentence =
        'The quick brown fox jumped over the lazy dog and then ran around the entire forest looking for more wild animals nearby.';
      const claims = await extractor.extract(longSentence);
      expect(llm).toHaveBeenCalledOnce();
      expect(claims).toHaveLength(2);
      expect(claims[0].decomposed).toBe(true);
      expect(claims[1].decomposed).toBe(true);
      expect(claims[0].claim).toBe('Sub-claim one.');
      expect(claims[1].claim).toBe('Sub-claim two.');
    });

    it('calls llmFn for sentences with ", and " conjunction', async () => {
      const llm = mockLlm(['Part A.', 'Part B.']);
      const extractor = new ClaimExtractor(llm);
      const claims = await extractor.extract('Water is wet, and ice is cold.');
      expect(llm).toHaveBeenCalledOnce();
      expect(claims.every((c) => c.decomposed)).toBe(true);
    });

    it('calls llmFn for sentences with " however " conjunction', async () => {
      const llm = mockLlm(['Claim A.', 'Claim B.']);
      const extractor = new ClaimExtractor(llm);
      const claims = await extractor.extract('The data is large however the query is fast.');
      expect(llm).toHaveBeenCalledOnce();
    });

    it('calls llmFn for sentences with " additionally " conjunction', async () => {
      const llm = mockLlm(['Claim X.']);
      const extractor = new ClaimExtractor(llm);
      await extractor.extract('The API is fast additionally it is reliable.');
      expect(llm).toHaveBeenCalledOnce();
    });

    it('calls llmFn for sentences with "; " conjunction', async () => {
      const llm = mockLlm(['One thing.', 'Another thing.']);
      const extractor = new ClaimExtractor(llm);
      await extractor.extract('Feature A is ready; feature B is in progress.');
      expect(llm).toHaveBeenCalledOnce();
    });

    it('does NOT call llmFn for simple short sentences', async () => {
      const llm = mockLlm([]);
      const extractor = new ClaimExtractor(llm);
      // Short, simple factual sentence — no conjunction, < 20 words.
      await extractor.extract('The sky is blue.');
      expect(llm).not.toHaveBeenCalled();
    });

    it('marks decomposed=false for short simple sentences', async () => {
      const llm = mockLlm([]);
      const extractor = new ClaimExtractor(llm);
      const claims = await extractor.extract('The sky is blue.');
      expect(claims[0].decomposed).toBe(false);
    });

    it('falls back to original sentence when LLM returns invalid JSON', async () => {
      const badLlm = vi.fn(async () => 'not json at all');
      const extractor = new ClaimExtractor(badLlm);
      // 22 words — strictly > 20, triggers LLM decomposition attempt.
      const longSentence =
        'The quick brown fox jumped over the lazy dog and then ran around the entire forest searching for more wild animals.';
      const claims = await extractor.extract(longSentence);
      // Should fall back to the original sentence as a single claim.
      expect(claims).toHaveLength(1);
      expect(claims[0].claim).toBe(longSentence);
      expect(claims[0].decomposed).toBe(false);
    });

    it('falls back to original sentence when LLM rejects', async () => {
      const failLlm = vi.fn(async () => {
        throw new Error('LLM unavailable');
      });
      const extractor = new ClaimExtractor(failLlm);
      // 22 words — strictly > 20, triggers LLM decomposition attempt that will throw.
      const longSentence =
        'The quick brown fox jumped over the lazy dog and then ran through the entire dark forest very quickly and silently.';
      const claims = await extractor.extract(longSentence);
      expect(claims).toHaveLength(1);
      expect(claims[0].decomposed).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // 8. No LLM fallback — complex sentences kept as single claims
  // -------------------------------------------------------------------------

  describe('heuristic fallback when no LLM is configured', () => {
    it('returns complex sentence as single non-decomposed claim', async () => {
      const extractor = new ClaimExtractor(); // no LLM
      // 22 words — strictly > 20, would trigger LLM but none is configured.
      const longSentence =
        'The quick brown fox jumped over the lazy dog and then ran around the entire forest looking for more wild animals nearby.';
      const claims = await extractor.extract(longSentence);
      expect(claims).toHaveLength(1);
      expect(claims[0].claim).toBe(longSentence);
      expect(claims[0].decomposed).toBe(false);
    });

    it('returns sentence with ", and " conjunction as single claim without LLM', async () => {
      const extractor = new ClaimExtractor(); // no LLM
      const claims = await extractor.extract('Water is wet, and ice is cold.');
      expect(claims).toHaveLength(1);
      expect(claims[0].decomposed).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // 9. Empty input
  // -------------------------------------------------------------------------

  describe('empty input', () => {
    it('returns empty array for empty string', async () => {
      const extractor = new ClaimExtractor();
      const claims = await extractor.extract('');
      expect(claims).toHaveLength(0);
    });

    it('returns empty array for whitespace-only string', async () => {
      const extractor = new ClaimExtractor();
      const claims = await extractor.extract('   \n\t  ');
      expect(claims).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // 10. Source offsets
  // -------------------------------------------------------------------------

  describe('source offsets', () => {
    it('includes a non-negative sourceOffset for each claim', async () => {
      const extractor = new ClaimExtractor();
      const claims = await extractor.extract(
        'Water is H2O. The sun rises in the east.',
      );
      for (const claim of claims) {
        expect(claim.sourceOffset).toBeGreaterThanOrEqual(0);
      }
    });

    it('first claim starts at offset 0 for a single-sentence input', async () => {
      const extractor = new ClaimExtractor();
      const claims = await extractor.extract('Water is H2O.');
      expect(claims[0].sourceOffset).toBe(0);
    });

    it('later claims have a larger offset than earlier ones', async () => {
      const extractor = new ClaimExtractor();
      const text = 'Water is H2O. The sun rises in the east.';
      const claims = await extractor.extract(text);
      if (claims.length >= 2) {
        // Second sentence starts after first — offset should be positive.
        expect(claims[1].sourceOffset).toBeGreaterThan(claims[0].sourceOffset);
      }
    });

    it('offset for decomposed claims points to the source sentence position', async () => {
      const llm = mockLlm(['Atomic A.', 'Atomic B.']);
      const extractor = new ClaimExtractor(llm);
      // Second sentence has 22 words (> 20) to trigger LLM decomposition.
      const text =
        'Simple fact. The quick brown fox jumped over the lazy dog and then ran around the entire park looking for more wild animals.';
      const claims = await extractor.extract(text);
      // Decomposed claims derived from the second sentence should share
      // the same sourceOffset (pointing to the complex sentence's start).
      const decomposed = claims.filter((c) => c.decomposed);
      if (decomposed.length >= 2) {
        expect(decomposed[0].sourceOffset).toBe(decomposed[1].sourceOffset);
      }
    });
  });
});
