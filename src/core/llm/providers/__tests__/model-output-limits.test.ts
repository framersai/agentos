/**
 * @fileoverview Tests for the per-model output-token clamp that keeps a
 * large request (sized for Claude Opus at 32000) from being rejected when
 * the fallback chain routes to a lower-ceiling OpenAI model such as
 * gpt-4o (16384 completion tokens).
 *
 * Reproduces the prod failure observed on the wilds-ai codegen worker
 * after the primary Anthropic provider went unavailable and traffic fell
 * back to OpenAI / OpenRouter:
 *
 *   max_tokens is too large: 32000. This model supports at most 16384
 *   completion tokens, whereas you provided 32000.
 */
import { describe, it, expect } from 'vitest';
import {
  openAiFamilyMaxOutputTokens,
  clampMaxOutputTokens,
} from '../model-output-limits.js';

describe('openAiFamilyMaxOutputTokens', () => {
  it('caps the gpt-4o family at 16384', () => {
    expect(openAiFamilyMaxOutputTokens('gpt-4o')).toBe(16384);
    expect(openAiFamilyMaxOutputTokens('gpt-4o-mini')).toBe(16384);
    expect(openAiFamilyMaxOutputTokens('gpt-4o-2024-08-06')).toBe(16384);
    expect(openAiFamilyMaxOutputTokens('chatgpt-4o-latest')).toBe(16384);
  });

  it('strips the OpenRouter provider prefix before matching', () => {
    expect(openAiFamilyMaxOutputTokens('openai/gpt-4o')).toBe(16384);
    expect(openAiFamilyMaxOutputTokens('openai/gpt-4o-mini')).toBe(16384);
  });

  it('caps gpt-4-turbo and gpt-3.5 at 4096', () => {
    expect(openAiFamilyMaxOutputTokens('gpt-4-turbo')).toBe(4096);
    expect(openAiFamilyMaxOutputTokens('gpt-4-turbo-2024-04-09')).toBe(4096);
    expect(openAiFamilyMaxOutputTokens('gpt-3.5-turbo')).toBe(4096);
  });

  it('is case-insensitive', () => {
    expect(openAiFamilyMaxOutputTokens('GPT-4O')).toBe(16384);
    expect(openAiFamilyMaxOutputTokens('OpenAI/GPT-4o-Mini')).toBe(16384);
  });

  it('does NOT clamp OpenAI models whose ceiling is at or above large requests', () => {
    // gpt-4.1 supports 32768; the o-series and gpt-5 support far more.
    // Clamping these would truncate output a capable model can produce.
    expect(openAiFamilyMaxOutputTokens('gpt-4.1')).toBeUndefined();
    expect(openAiFamilyMaxOutputTokens('gpt-4.1-mini')).toBeUndefined();
    expect(openAiFamilyMaxOutputTokens('o1')).toBeUndefined();
    expect(openAiFamilyMaxOutputTokens('o3-mini')).toBeUndefined();
    expect(openAiFamilyMaxOutputTokens('gpt-5.4')).toBeUndefined();
  });

  it('returns undefined for non-OpenAI / unknown models (never truncates them)', () => {
    expect(openAiFamilyMaxOutputTokens('anthropic/claude-sonnet-4-6')).toBeUndefined();
    expect(openAiFamilyMaxOutputTokens('claude-opus-4-7')).toBeUndefined();
    expect(openAiFamilyMaxOutputTokens('gemini-2.5-pro')).toBeUndefined();
    expect(openAiFamilyMaxOutputTokens('mystery-model')).toBeUndefined();
  });
});

describe('clampMaxOutputTokens', () => {
  it('clamps a 32000 request down to 16384 for gpt-4o (the prod failure)', () => {
    expect(clampMaxOutputTokens('gpt-4o', 32000)).toBe(16384);
    expect(clampMaxOutputTokens('openai/gpt-4o', 32000)).toBe(16384);
    expect(clampMaxOutputTokens('gpt-4o-mini', 32000)).toBe(16384);
  });

  it('leaves a request already under the ceiling untouched', () => {
    expect(clampMaxOutputTokens('gpt-4o', 8000)).toBe(8000);
  });

  it('leaves requests for high-ceiling / unknown models untouched', () => {
    expect(clampMaxOutputTokens('gpt-4.1', 32000)).toBe(32000);
    expect(clampMaxOutputTokens('claude-opus-4-7', 32000)).toBe(32000);
    expect(clampMaxOutputTokens('mystery-model', 32000)).toBe(32000);
  });

  it('passes through undefined so callers can apply their own default', () => {
    expect(clampMaxOutputTokens('gpt-4o', undefined)).toBeUndefined();
  });
});
