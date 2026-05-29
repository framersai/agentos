/**
 * @fileoverview Tests for the model-id sniff that decides whether to
 * send `max_tokens` (legacy) or `max_completion_tokens` (newer
 * reasoning + GPT-5 families) to the OpenAI API.
 */
import { describe, it, expect } from 'vitest';
import { modelRequiresMaxCompletionTokens } from '../implementations/OpenAIProvider.js';

describe('modelRequiresMaxCompletionTokens', () => {
  it('returns true for the GPT-5 family', () => {
    expect(modelRequiresMaxCompletionTokens('gpt-5')).toBe(true);
    expect(modelRequiresMaxCompletionTokens('gpt-5.4')).toBe(true);
    expect(modelRequiresMaxCompletionTokens('gpt-5.4-mini')).toBe(true);
    expect(modelRequiresMaxCompletionTokens('gpt-5.4-nano')).toBe(true);
  });

  it('returns true for o-series reasoning models', () => {
    expect(modelRequiresMaxCompletionTokens('o1')).toBe(true);
    expect(modelRequiresMaxCompletionTokens('o1-mini')).toBe(true);
    expect(modelRequiresMaxCompletionTokens('o3')).toBe(true);
    expect(modelRequiresMaxCompletionTokens('o3-mini')).toBe(true);
    expect(modelRequiresMaxCompletionTokens('o4-mini')).toBe(true);
  });

  it('returns false for legacy gpt-4 family models that still accept max_tokens', () => {
    expect(modelRequiresMaxCompletionTokens('gpt-4o')).toBe(false);
    expect(modelRequiresMaxCompletionTokens('gpt-4o-mini')).toBe(false);
    expect(modelRequiresMaxCompletionTokens('gpt-4-turbo')).toBe(false);
    expect(modelRequiresMaxCompletionTokens('gpt-4.1')).toBe(false);
    expect(modelRequiresMaxCompletionTokens('gpt-4.1-mini')).toBe(false);
  });

  it('returns false for gpt-3.5 + chat completions models', () => {
    expect(modelRequiresMaxCompletionTokens('gpt-3.5-turbo')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(modelRequiresMaxCompletionTokens('GPT-5')).toBe(true);
    expect(modelRequiresMaxCompletionTokens('O1-Mini')).toBe(true);
  });

  it('errs conservative for unknown model ids — uses legacy max_tokens', () => {
    expect(modelRequiresMaxCompletionTokens('claude-sonnet-4-6')).toBe(false);
    expect(modelRequiresMaxCompletionTokens('llama3:8b')).toBe(false);
    expect(modelRequiresMaxCompletionTokens('mystery-model')).toBe(false);
  });
});
