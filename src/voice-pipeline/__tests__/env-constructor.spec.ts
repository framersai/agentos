import { describe, it, expect } from 'vitest';
import {
  createVoiceProvidersFromEnv,
  NoVoiceProvidersAvailableError,
} from '../env-constructor.js';

describe('createVoiceProvidersFromEnv', () => {
  it('builds chains with only ELEVENLABS_API_KEY', () => {
    const { stt, tts } = createVoiceProvidersFromEnv({
      env: { ELEVENLABS_API_KEY: 'el' },
    });
    expect(stt.providers.map((p) => p.providerId)).toContain(
      'elevenlabs-streaming-stt'
    );
    expect(tts.providers.map((p) => p.providerId)).toContain(
      'elevenlabs-streaming'
    );
  });

  it('prefers Deepgram for STT when both keys present', () => {
    const { stt } = createVoiceProvidersFromEnv({
      env: { DEEPGRAM_API_KEY: 'dg', ELEVENLABS_API_KEY: 'el' },
    });
    const ids = stt.providers.map((p) => p.providerId);
    expect(ids.indexOf('deepgram-streaming')).toBeLessThan(
      ids.indexOf('elevenlabs-streaming-stt')
    );
  });

  it('throws when no viable keys', () => {
    expect(() => createVoiceProvidersFromEnv({ env: {} })).toThrow(
      NoVoiceProvidersAvailableError
    );
  });

  it('NoVoiceProvidersAvailableError names every checked env var', () => {
    try {
      createVoiceProvidersFromEnv({ env: {} });
      expect.fail('should have thrown');
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).toContain('DEEPGRAM_API_KEY');
      expect(msg).toContain('ELEVENLABS_API_KEY');
      expect(msg).toContain('OPENAI_API_KEY');
    }
  });

  it('shared breaker across STT + TTS chains', () => {
    const { stt, tts, breaker } = createVoiceProvidersFromEnv({
      env: { ELEVENLABS_API_KEY: 'el' },
    });
    expect(breaker).toBeDefined();
    // Internal assertion: both chains reference the same breaker instance.
    expect((stt as unknown as { opts: { breaker: unknown } }).opts.breaker).toBe(
      breaker
    );
    expect((tts as unknown as { opts: { breaker: unknown } }).opts.breaker).toBe(
      breaker
    );
  });

  it('includes OpenAI Realtime TTS + batch fallback when OPENAI_API_KEY is set', () => {
    const { tts } = createVoiceProvidersFromEnv({
      env: { OPENAI_API_KEY: 'op', ELEVENLABS_API_KEY: 'el' },
    });
    const ids = tts.providers.map((p) => p.providerId);
    expect(ids).toContain('openai-realtime');
    expect(ids.some((id) => id.startsWith('openai-tts'))).toBe(true);
  });

  it('enables failover modes by default', () => {
    const { stt, tts } = createVoiceProvidersFromEnv({
      env: { ELEVENLABS_API_KEY: 'el' },
    });
    expect(
      (stt as unknown as { opts: { enableMidUtteranceFailover?: boolean } })
        .opts.enableMidUtteranceFailover
    ).toBe(true);
    expect(
      (tts as unknown as { opts: { enableMidSynthesisFailover?: boolean } })
        .opts.enableMidSynthesisFailover
    ).toBe(true);
  });
});
