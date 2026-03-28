/**
 * @fileoverview Integration tests verifying the TextProcessingPipeline
 * works correctly with BM25Index and preset pipelines end-to-end.
 */
import { describe, expect, it, vi } from 'vitest';
import { createRagPipeline, createCodePipeline, createProsePipeline } from '../presets';
import { TextProcessingPipeline } from '../TextProcessingPipeline';
import { StandardTokenizer } from '../tokenizers/StandardTokenizer';
import { LowercaseNormalizer } from '../normalizers/LowercaseNormalizer';
import { PorterStemmer } from '../stemmers/PorterStemmer';
import { StopWordFilter } from '../filters/StopWordFilter';

describe('Pipeline presets integration', () => {
  /**
   * Optional eager warm-up helper for tests that want to preload `natural`
   * before exercising the pipeline.
   */
  const initStemmer = async () => {
    const stemmer = new PorterStemmer();
    await stemmer.initialize();
  };

  describe('createRagPipeline()', () => {
    it('stems without manual warm-up', async () => {
      vi.resetModules();
      const { createRagPipeline } = await import('../presets');

      const pipeline = createRagPipeline();
      const result = pipeline.processToStrings('running runs');

      expect(result).toEqual(['run', 'run']);
    });

    it('tokenizes, lowercases, removes stop words, and stems', async () => {
      await initStemmer();
      const pipeline = createRagPipeline();
      const result = pipeline.processToStrings('The Quick Brown Foxes Are Running Fast');

      /* 'the', 'are' should be filtered as stop words */
      expect(result).not.toContain('the');
      expect(result).not.toContain('are');

      /* remaining words should be lowercased and stemmed */
      expect(result).not.toContain('Quick');
      expect(result).not.toContain('Brown');

      /* should have at least 3 terms after filtering */
      expect(result.length).toBeGreaterThanOrEqual(3);
    });

    it('stems morphological variants to the same root', async () => {
      await initStemmer();
      const pipeline = createRagPipeline();
      const result1 = pipeline.processToStrings('running');
      const result2 = pipeline.processToStrings('runs');

      /* Porter stemmer: running->run, runs->run */
      expect(result1[0]).toBe(result2[0]); /* both → 'run' */
    });
  });

  describe('createCodePipeline()', () => {
    it('splits camelCase and snake_case identifiers', () => {
      const pipeline = createCodePipeline();
      const result = pipeline.processToStrings('getUserName get_user_name');

      expect(result).toContain('get');
      expect(result).toContain('user');
      expect(result).toContain('name');
    });

    it('does NOT stem code identifiers', () => {
      const pipeline = createCodePipeline();
      const result = pipeline.processToStrings('kubernetes');

      /* NoOpStemmer — should not change the word */
      expect(result).toContain('kubernetes');
    });

    it('preserves programming keywords', () => {
      const pipeline = createCodePipeline();
      const result = pipeline.processToStrings('the function returns class import');

      /* code stop words filter 'the' but preserve 'function', 'returns', 'class', 'import' */
      expect(result).not.toContain('the');
      expect(result).toContain('function');
      expect(result).toContain('class');
      expect(result).toContain('import');
    });
  });

  describe('createProsePipeline()', () => {
    it('strips accents and stems text', async () => {
      await initStemmer();
      const pipeline = createProsePipeline();
      const result = pipeline.processToStrings('The café serves naïve résumé writers');

      /* café → cafe (accent stripped, then not stemmed further) */
      expect(result).toContain('cafe');
      /* naïve → naive → naiv (accent stripped, then stemmed) */
      expect(result).toContain('naiv');
      /* résumé → resume → resum (accent stripped, then stemmed) */
      expect(result).toContain('resum');
      /* 'the' should be filtered as stop word */
      expect(result).not.toContain('the');
    });
  });

  describe('BM25Index with pipeline', () => {
    it('uses pipeline for tokenization when configured', async () => {
      /* Dynamically import BM25Index to avoid circular dependency issues */
      const { BM25Index } = await import('../../../rag/search/BM25Index');

      const pipeline = createRagPipeline();
      /* Initialize the PorterStemmer inside the pipeline */
      const stemmer = new PorterStemmer();
      await stemmer.initialize();

      const index = new BM25Index({ pipeline });
      index.addDocuments([
        { id: 'doc-1', text: 'TypeScript compiler error handling' },
        { id: 'doc-2', text: 'JavaScript runtime errors and debugging' },
        { id: 'doc-3', text: 'Fix compilation errors in your TypeScript code' },
      ]);

      const results = index.search('error', 3);
      expect(results.length).toBeGreaterThan(0);

      /* All results should have positive BM25 scores */
      for (const r of results) {
        expect(r.score).toBeGreaterThan(0);
      }
    });

    it('falls back to regex tokenizer when no pipeline configured', async () => {
      const { BM25Index } = await import('../../../rag/search/BM25Index');

      /* No pipeline — uses built-in regex tokenizer + getNaturalStopWords */
      const index = new BM25Index();
      index.addDocuments([
        { id: 'a', text: 'the quick brown fox' },
        { id: 'b', text: 'a lazy dog sleeps' },
      ]);

      const results = index.search('fox', 2);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].id).toBe('a');
    });

    it('pipeline stemming improves recall for morphological variants', async () => {
      const { BM25Index } = await import('../../../rag/search/BM25Index');

      const pipeline = createRagPipeline();
      const stemmer = new PorterStemmer();
      await stemmer.initialize();

      const index = new BM25Index({ pipeline });
      index.addDocuments([
        { id: 'doc-1', text: 'The developers are running integration tests' },
        { id: 'doc-2', text: 'She runs the application every morning' },
      ]);

      /* Search for 'run' should match both 'running' and 'runs' after stemming */
      const results = index.search('run', 5);
      expect(results.length).toBe(2);
    });
  });
});
