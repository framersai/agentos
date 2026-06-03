import { describe, it, expect } from 'vitest';
import { resolveSegmentationMode } from '../resolveMode.js';
import { InvalidSegmentationPromptError } from '../errors.js';

const img = Buffer.from('x');

describe('resolveSegmentationMode', () => {
  it('resolves text from a non-empty prompt', () => {
    expect(resolveSegmentationMode({ image: img, prompt: 'the chair' })).toBe('text');
  });
  it('resolves points', () => {
    expect(resolveSegmentationMode({ image: img, points: [{ x: 1, y: 2 }] })).toBe('points');
  });
  it('resolves box', () => {
    expect(resolveSegmentationMode({ image: img, box: { x: 0, y: 0, width: 4, height: 4 } })).toBe('box');
  });
  it('resolves automatic only when true', () => {
    expect(resolveSegmentationMode({ image: img, automatic: true })).toBe('automatic');
  });
  it('treats automatic:false as no mode', () => {
    expect(() => resolveSegmentationMode({ image: img, automatic: false })).toThrow(InvalidSegmentationPromptError);
  });
  it('treats an empty prompt string as no mode', () => {
    expect(() => resolveSegmentationMode({ image: img, prompt: '   ' })).toThrow(InvalidSegmentationPromptError);
  });
  it('throws when nothing is set', () => {
    expect(() => resolveSegmentationMode({ image: img })).toThrow(InvalidSegmentationPromptError);
  });
  it('throws when more than one mode is set', () => {
    expect(() => resolveSegmentationMode({ image: img, prompt: 'a', box: { x: 0, y: 0, width: 1, height: 1 } }))
      .toThrow(/exactly one/);
  });
});
