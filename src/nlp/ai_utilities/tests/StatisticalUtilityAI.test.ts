import { describe, it, expect, beforeEach } from 'vitest';
import { StatisticalUtilityAI, StatisticalUtilityAIConfig } from '../StatisticalUtilityAI';
import { IUtilityAI, TokenizationOptions, SummarizationOptions } from '../IUtilityAI';

const defaultConfig: StatisticalUtilityAIConfig = {
  utilityId: 'test-stat-utility',
  defaultLanguage: 'en',
  // No resourcePath needed for these basic tests using default internal resources
};

describe('StatisticalUtilityAI', () => {
  let statUtility: IUtilityAI;

  beforeEach(async () => {
    statUtility = new StatisticalUtilityAI();
    await statUtility.initialize(defaultConfig);
  });

  it('should be defined and initialize without errors', () => {
    expect(statUtility).toBeDefined();
    expect(statUtility.utilityId).toContain('stat-utility');
  });

  it('should tokenize text into words', async () => {
    const text = "This is a test sentence.";
    const options: TokenizationOptions = { type: 'word', toLowerCase: true, removePunctuation: true };
    const tokens = await statUtility.tokenize(text, options);
    expect(tokens).toEqual(['this', 'is', 'a', 'test', 'sentence']);
  });

  it('should tokenize text into sentences', async () => {
    const text = "First sentence. Second sentence! Third sentence?";
    const options: TokenizationOptions = { type: 'sentence' };
    const sentences = await statUtility.tokenize(text, options);
    expect(sentences).toEqual([
      "First sentence.",
      "Second sentence!",
      "Third sentence?"
    ]);
  });
  
  it('should perform basic summarization (first_n_sentences)', async () => {
    const text = "Sentence one. Sentence two. Sentence three. Sentence four. Sentence five.";
    const options: SummarizationOptions = { method: 'first_n_sentences', desiredLength: 2 };
    const summary = await statUtility.summarize(text, options);
    expect(summary).toBe("Sentence one. Sentence two.");
  });

  it('checkHealth should report as healthy if initialized', async () => {
    const health = await statUtility.checkHealth();
    expect(health.isHealthy).toBe(true);
    expect(health.details).toHaveProperty('status', 'Initialized');
  });

  it('should allow shutdown', async () => {
    await expect(statUtility.shutdown?.()).resolves.toBeUndefined();
    // Add any assertions about state after shutdown if applicable
  });
});