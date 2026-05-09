import { describe, expect, it } from 'vitest';
import { TextProcessingPipeline } from '../TextProcessingPipeline';
import { StandardTokenizer } from '../tokenizers/StandardTokenizer';
import { LowercaseNormalizer } from '../normalizers/LowercaseNormalizer';
import { AccentStripper } from '../normalizers/AccentStripper';
import { StopWordFilter, ENGLISH_STOP_WORDS } from '../filters/StopWordFilter';
import { NoOpStemmer } from '../stemmers/NoOpStemmer';

describe('TextProcessingPipeline', () => {
  it('chains tokenizer + processors in order', () => {
    const pipeline = new TextProcessingPipeline(new StandardTokenizer())
      .add(new LowercaseNormalizer())
      .add(new NoOpStemmer());

    const tokens = pipeline.process('Hello World');
    expect(tokens).toHaveLength(2);
    expect(tokens[0].text).toBe('hello');
    expect(tokens[0].original).toBe('Hello');
    expect(tokens[1].text).toBe('world');
  });

  it('processToStrings returns just the text values', () => {
    const pipeline = new TextProcessingPipeline(new StandardTokenizer())
      .add(new LowercaseNormalizer());

    const strings = pipeline.processToStrings('Hello World');
    expect(strings).toEqual(['hello', 'world']);
  });

  it('full prose pipeline: tokenize + lowercase + accents + stop words', () => {
    const pipeline = new TextProcessingPipeline(new StandardTokenizer())
      .add(new LowercaseNormalizer())
      .add(new AccentStripper())
      .add(new StopWordFilter(ENGLISH_STOP_WORDS));

    const tokens = pipeline.processToStrings('The quick brown café is über cool');
    expect(tokens).not.toContain('the');
    expect(tokens).not.toContain('is');
    expect(tokens).toContain('quick');
    expect(tokens).toContain('brown');
    expect(tokens).toContain('cafe');  // accent stripped
    expect(tokens).toContain('uber');  // accent stripped
    expect(tokens).toContain('cool');
  });

  it('handles empty string', () => {
    const pipeline = new TextProcessingPipeline(new StandardTokenizer())
      .add(new LowercaseNormalizer());

    expect(pipeline.process('')).toEqual([]);
  });

  it('handles string with only stop words', () => {
    const pipeline = new TextProcessingPipeline(new StandardTokenizer())
      .add(new LowercaseNormalizer())
      .add(new StopWordFilter(ENGLISH_STOP_WORDS));

    expect(pipeline.processToStrings('the a an is are')).toEqual([]);
  });

  it('getStageNames returns all stage names', () => {
    const pipeline = new TextProcessingPipeline(new StandardTokenizer())
      .add(new LowercaseNormalizer())
      .add(new StopWordFilter())
      .add(new NoOpStemmer());

    expect(pipeline.getStageNames()).toEqual([
      'StandardTokenizer',
      'LowercaseNormalizer',
      'StopWordFilter',
      'NoOpStemmer',
    ]);
  });

  it('preserves position offsets through the pipeline', () => {
    const pipeline = new TextProcessingPipeline(new StandardTokenizer())
      .add(new LowercaseNormalizer())
      .add(new StopWordFilter(ENGLISH_STOP_WORDS));

    const tokens = pipeline.process('The quick brown fox');
    // 'The' is at 0 but filtered. 'quick' is at 4.
    const quick = tokens.find(t => t.text === 'quick');
    expect(quick?.position).toBe(4);
    const fox = tokens.find(t => t.text === 'fox');
    expect(fox?.position).toBe(16);
  });
});
