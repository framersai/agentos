import { describe, it, expect } from 'vitest';
import { SpeechProviderResolver } from '../SpeechProviderResolver.js';

describe('SpeechProviderResolver — Deepgram Aura TTS registration', () => {
  it('registers deepgram-aura as a configured TTS provider when DEEPGRAM_API_KEY is set', async () => {
    const resolver = new SpeechProviderResolver(undefined, { DEEPGRAM_API_KEY: 'x' });
    await resolver.refresh();
    const configuredTts = resolver
      .listProviders('tts')
      .filter((r) => r.isConfigured)
      .map((r) => r.id);
    expect(configuredTts).toContain('deepgram-aura');
  });

  it('does not configure deepgram-aura without a key', async () => {
    const resolver = new SpeechProviderResolver(undefined, {});
    await resolver.refresh();
    const aura = resolver.listProviders('tts').find((r) => r.id === 'deepgram-aura');
    expect(aura?.isConfigured).toBe(false);
  });
});
