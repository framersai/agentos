import { describe, expect, it } from 'vitest';
import { StandardTokenizer } from '../tokenizers/StandardTokenizer';
import { CodeTokenizer } from '../tokenizers/CodeTokenizer';

describe('StandardTokenizer', () => {
  const tokenizer = new StandardTokenizer();

  it('splits on whitespace and punctuation', () => {
    const tokens = tokenizer.tokenize('hello, world! how are you?');
    const texts = tokens.map(t => t.text);
    expect(texts).toEqual(['hello', 'world', 'how', 'are', 'you']);
  });

  it('preserves position offsets', () => {
    const tokens = tokenizer.tokenize('hello world');
    expect(tokens[0].position).toBe(0);
    expect(tokens[1].position).toBe(6);
  });

  it('filters tokens shorter than minLength', () => {
    const t = new StandardTokenizer(3);
    const tokens = t.tokenize('I am a big dog');
    const texts = tokens.map(t => t.text);
    expect(texts).toEqual(['big', 'dog']);
  });

  it('handles Unicode characters', () => {
    const tokens = tokenizer.tokenize('café naïve über');
    expect(tokens.map(t => t.text)).toEqual(['café', 'naïve', 'über']);
  });

  it('handles numbers and underscores', () => {
    const tokens = tokenizer.tokenize('user_id 42 max_retry_3');
    expect(tokens.map(t => t.text)).toEqual(['user_id', '42', 'max_retry_3']);
  });

  it('returns empty array for empty string', () => {
    expect(tokenizer.tokenize('')).toEqual([]);
  });

  it('returns empty array for only punctuation', () => {
    expect(tokenizer.tokenize('.,!?;:')).toEqual([]);
  });
});

describe('CodeTokenizer', () => {
  const tokenizer = new CodeTokenizer();

  it('splits camelCase', () => {
    const tokens = tokenizer.tokenize('getUserName');
    const texts = tokens.map(t => t.text);
    expect(texts).toEqual(['get', 'User', 'Name']);
  });

  it('splits snake_case', () => {
    const tokens = tokenizer.tokenize('get_user_name');
    const texts = tokens.map(t => t.text);
    expect(texts).toEqual(['get', 'user', 'name']);
  });

  it('splits SCREAMING_SNAKE', () => {
    const tokens = tokenizer.tokenize('MAX_RETRY_COUNT');
    const texts = tokens.map(t => t.text);
    expect(texts).toEqual(['MAX', 'RETRY', 'COUNT']);
  });

  it('splits XMLParser-style caps', () => {
    const tokens = tokenizer.tokenize('XMLParser');
    const texts = tokens.map(t => t.text);
    expect(texts).toEqual(['XML', 'Parser']);
  });

  it('splits dot-separated paths', () => {
    const tokens = tokenizer.tokenize('path.to.module');
    const texts = tokens.map(t => t.text);
    expect(texts).toEqual(['path', 'to', 'module']);
  });

  it('handles mixed patterns', () => {
    const tokens = tokenizer.tokenize('myApp.getUserName_v2');
    const texts = tokens.map(t => t.text);
    expect(texts).toContain('my');
    expect(texts).toContain('App');
    expect(texts).toContain('get');
    expect(texts).toContain('User');
    expect(texts).toContain('Name');
    expect(texts).toContain('v2');
  });

  it('preserves original in all split tokens', () => {
    const tokens = tokenizer.tokenize('getUserName');
    expect(tokens.every(t => t.original === 'getUserName')).toBe(true);
  });

  it('returns empty for empty string', () => {
    expect(tokenizer.tokenize('')).toEqual([]);
  });
});
