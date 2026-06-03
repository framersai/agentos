import { describe, it, expect } from 'vitest';
import {
  SegmentationModeNotSupportedError,
  InvalidSegmentationPromptError,
  SegmentationProviderError,
} from '../errors.js';

describe('segmentation errors', () => {
  it('SegmentationModeNotSupportedError carries providerId and mode', () => {
    const err = new SegmentationModeNotSupportedError('replicate', 'text');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('SegmentationModeNotSupportedError');
    expect(err.providerId).toBe('replicate');
    expect(err.mode).toBe('text');
    expect(err.message).toContain('text');
    expect(err.message).toContain('replicate');
  });

  it('InvalidSegmentationPromptError sets name and message', () => {
    const err = new InvalidSegmentationPromptError('exactly one prompt mode');
    expect(err.name).toBe('InvalidSegmentationPromptError');
    expect(err.message).toBe('exactly one prompt mode');
  });

  it('SegmentationProviderError carries a code and optional cause', () => {
    const cause = new Error('boom');
    const err = new SegmentationProviderError('failed', 'timeout', cause);
    expect(err.name).toBe('SegmentationProviderError');
    expect(err.code).toBe('timeout');
    expect(err.cause).toBe(cause);
  });
});
