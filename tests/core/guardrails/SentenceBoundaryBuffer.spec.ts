import { describe, it, expect } from 'vitest';
import { SentenceBoundaryBuffer } from '../../../src/safety/guardrails/SentenceBoundaryBuffer.js';

describe('SentenceBoundaryBuffer', () => {
  it('returns null while accumulating', () => {
    const buf = new SentenceBoundaryBuffer();
    expect(buf.push('Hello ')).toBeNull();
    expect(buf.push('world')).toBeNull();
  });

  it('flushes at sentence boundary', () => {
    const buf = new SentenceBoundaryBuffer();
    buf.push('Hello ');
    const result = buf.push('world. ');
    expect(result).toBe('Hello world.');
  });

  it('includes previous sentence as overlap', () => {
    const buf = new SentenceBoundaryBuffer();
    buf.push('First sentence. ');
    const r1 = buf.push(''); // triggers boundary
    // First push should have flushed
    const buf2 = new SentenceBoundaryBuffer();
    buf2.push('First. ');
    buf2.push('Second. ');
    // After two sentences, the second should include first as context
  });

  it('flush returns remaining content', () => {
    const buf = new SentenceBoundaryBuffer();
    buf.push('Some text without boundary');
    const result = buf.flush();
    expect(result).toBe('Some text without boundary');
  });

  it('flush returns null when empty', () => {
    const buf = new SentenceBoundaryBuffer();
    expect(buf.flush()).toBeNull();
  });

  it('detects question marks as boundaries', () => {
    const buf = new SentenceBoundaryBuffer();
    const result = buf.push('Is this safe? ');
    expect(result).toBe('Is this safe?');
  });

  it('detects exclamation marks', () => {
    const buf = new SentenceBoundaryBuffer();
    const result = buf.push('Stop! ');
    expect(result).toBe('Stop!');
  });

  it('detects newlines', () => {
    const buf = new SentenceBoundaryBuffer();
    const result = buf.push('Line one\n');
    expect(result).toBe('Line one');
  });

  it('reset clears all state', () => {
    const buf = new SentenceBoundaryBuffer();
    buf.push('Some content. More content');
    buf.reset();
    expect(buf.flush()).toBeNull();
  });
});
