import { describe, it, expect, vi } from 'vitest';

// Integration test — requires OPENAI_API_KEY
const hasOpenAI = !!process.env.OPENAI_API_KEY;

describe.skipIf(!hasOpenAI)('generateText (integration)', () => {
  it('generates text from openai', async () => {
    const { generateText } = await import('../../src/api/generateText.js');
    const result = await generateText({
      model: 'openai:gpt-4o-mini',
      prompt: 'Say "hello" and nothing else.',
      maxTokens: 10,
    });
    expect(result.text.toLowerCase()).toContain('hello');
    expect(result.usage.totalTokens).toBeGreaterThan(0);
    expect(result.finishReason).toBe('stop');
  });
});

describe('generateText (unit)', () => {
  it('throws on invalid model string', async () => {
    const { generateText } = await import('../../src/api/generateText.js');
    await expect(generateText({ model: 'invalid', prompt: 'test' })).rejects.toThrow('Invalid model');
  });
});
