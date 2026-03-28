/**
 * @module rag/multimodal/__tests__/LLMVisionAdapter.spec
 *
 * Unit tests for the {@link LLMVisionAdapter} re-export.
 *
 * The LLMVisionAdapter is a convenience re-export of `LLMVisionProvider`
 * from `media/vision/providers/`. These tests verify that:
 *
 * - The re-export resolves to the correct class
 * - The adapter implements IVisionProvider
 * - Constructor validates required config
 *
 * More thorough LLMVisionProvider tests live in
 * `media/vision/__tests__/LLMVisionProvider.spec.ts`. This file only
 * validates the re-export wiring and basic contract.
 */

import { describe, it, expect } from 'vitest';
import { LLMVisionAdapter, type LLMVisionAdapterConfig } from '../LLMVisionAdapter.js';
import { LLMVisionProvider } from '../../../media/vision/providers/LLMVisionProvider.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LLMVisionAdapter', () => {
  it('should be the same class as LLMVisionProvider', () => {
    // The re-export should resolve to the exact same constructor
    expect(LLMVisionAdapter).toBe(LLMVisionProvider);
  });

  it('should throw if provider name is missing', () => {
    expect(() => new LLMVisionAdapter({ provider: '' })).toThrow(
      /provider name is required/,
    );
  });

  it('should construct with valid config', () => {
    const config: LLMVisionAdapterConfig = {
      provider: 'openai',
      model: 'gpt-4o',
    };

    const adapter = new LLMVisionAdapter(config);
    expect(adapter).toBeInstanceOf(LLMVisionProvider);
  });

  it('should have a describeImage method (implements IVisionProvider)', () => {
    const adapter = new LLMVisionAdapter({ provider: 'openai' });
    expect(typeof adapter.describeImage).toBe('function');
  });

  it('should accept custom prompt in config', () => {
    // Should not throw — just verifying the config shape is accepted
    expect(
      () =>
        new LLMVisionAdapter({
          provider: 'anthropic',
          model: 'claude-sonnet-4-20250514',
          prompt: 'Describe this image for a search index.',
          apiKey: 'test-key',
          baseUrl: 'https://custom.endpoint.com',
        }),
    ).not.toThrow();
  });
});
