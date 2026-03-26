import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'events';
import { FallbackSTTProxy, FallbackTTSProxy } from '../FallbackProxy.js';
import type {
  SpeechToTextProvider,
  TextToSpeechProvider,
  SpeechTranscriptionResult,
  SpeechSynthesisResult,
  SpeechVoice,
} from '../types.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Creates a mock STT provider that either resolves with a result or rejects
 * with the given error. All methods are vi.fn() for call tracking.
 */
function mockSTT(
  id: string,
  result?: Partial<SpeechTranscriptionResult>,
  error?: Error,
): SpeechToTextProvider {
  return {
    id,
    displayName: id,
    supportsStreaming: false,
    transcribe: error
      ? vi.fn().mockRejectedValue(error)
      : vi.fn().mockResolvedValue({ text: 'hello', cost: 0, ...result }),
    getProviderName: () => id,
  };
}

/**
 * Creates a mock TTS provider with optional voice listing support.
 * Pass `voices` to enable `listAvailableVoices()` on the mock.
 */
function mockTTS(
  id: string,
  result?: Partial<SpeechSynthesisResult>,
  error?: Error,
  voices?: SpeechVoice[],
): TextToSpeechProvider {
  const provider: TextToSpeechProvider = {
    id,
    displayName: id,
    supportsStreaming: false,
    synthesize: error
      ? vi.fn().mockRejectedValue(error)
      : vi.fn().mockResolvedValue({
          audioBuffer: Buffer.from([]),
          mimeType: 'audio/mp3',
          cost: 0,
          ...result,
        }),
    getProviderName: () => id,
  };

  // Only attach listAvailableVoices when voices are explicitly provided,
  // so tests can verify the "no provider supports it" path.
  if (voices !== undefined) {
    (provider as TextToSpeechProvider).listAvailableVoices = vi
      .fn()
      .mockResolvedValue(voices);
  }

  return provider;
}

// ---------------------------------------------------------------------------
// FallbackSTTProxy tests
// ---------------------------------------------------------------------------

/**
 * Tests for {@link FallbackSTTProxy} — verifies the left-to-right retry chain
 * behaviour, provider_fallback event emission, and edge cases (empty chain,
 * all-fail, options passthrough).
 */
describe('FallbackSTTProxy', () => {
  it('should return the result from the first provider when it succeeds', async () => {
    const p1 = mockSTT('p1', { text: 'result', cost: 0 });
    const proxy = new FallbackSTTProxy([p1], new EventEmitter());

    const result = await proxy.transcribe({ data: Buffer.from([]) });

    expect(result.text).toBe('result');
    expect(p1.transcribe).toHaveBeenCalledOnce();
  });

  it('should not call the second provider when the first succeeds', async () => {
    const p1 = mockSTT('p1', { text: 'ok' });
    const p2 = mockSTT('p2', { text: 'should not be used' });
    const proxy = new FallbackSTTProxy([p1, p2], new EventEmitter());

    await proxy.transcribe({ data: Buffer.from([]) });

    // The second provider should never be invoked on a successful first call
    expect(p2.transcribe).not.toHaveBeenCalled();
  });

  it('should fall back to the second provider and emit provider_fallback event when the first fails', async () => {
    const emitter = new EventEmitter();
    const handler = vi.fn();
    emitter.on('provider_fallback', handler);

    const p1 = mockSTT('p1', undefined, new Error('fail'));
    const p2 = mockSTT('p2', { text: 'from p2', cost: 0 });
    const proxy = new FallbackSTTProxy([p1, p2], emitter);

    const result = await proxy.transcribe({ data: Buffer.from([]) });

    expect(result.text).toBe('from p2');
    expect(handler).toHaveBeenCalledOnce();

    // Verify the event payload contains the correct provider IDs and kind
    const event = handler.mock.calls[0][0];
    expect(event.from).toBe('p1');
    expect(event.to).toBe('p2');
    expect(event.kind).toBe('stt');
    expect(event.error).toBeInstanceOf(Error);
  });

  it('should skip through multiple failing providers and emit one fallback event per skip', async () => {
    const emitter = new EventEmitter();
    const handler = vi.fn();
    emitter.on('provider_fallback', handler);

    const p1 = mockSTT('p1', undefined, new Error('fail1'));
    const p2 = mockSTT('p2', undefined, new Error('fail2'));
    const p3 = mockSTT('p3', { text: 'from p3' });
    const proxy = new FallbackSTTProxy([p1, p2, p3], emitter);

    const result = await proxy.transcribe({ data: Buffer.from([]) });

    expect(result.text).toBe('from p3');
    // Two failures = two fallback events (p1->p2 and p2->p3)
    expect(handler).toHaveBeenCalledTimes(2);
    expect(handler.mock.calls[0][0].from).toBe('p1');
    expect(handler.mock.calls[1][0].from).toBe('p2');
  });

  it('should throw the last provider error when all providers in the chain fail', async () => {
    const p1 = mockSTT('p1', undefined, new Error('fail1'));
    const p2 = mockSTT('p2', undefined, new Error('fail2'));
    const proxy = new FallbackSTTProxy([p1, p2], new EventEmitter());

    // Should throw the LAST provider's error, not the first
    await expect(proxy.transcribe({ data: Buffer.from([]) })).rejects.toThrow('fail2');
  });

  it('should not emit a fallback event when the only provider fails', async () => {
    const emitter = new EventEmitter();
    const handler = vi.fn();
    emitter.on('provider_fallback', handler);

    const p1 = mockSTT('p1', undefined, new Error('only provider'));
    const proxy = new FallbackSTTProxy([p1], emitter);

    await expect(proxy.transcribe({ data: Buffer.from([]) })).rejects.toThrow('only provider');
    // No fallback event because there's no next provider to fall back TO
    expect(handler).not.toHaveBeenCalled();
  });

  it('should throw immediately when the chain is empty', async () => {
    const proxy = new FallbackSTTProxy([], new EventEmitter());
    await expect(proxy.transcribe({ data: Buffer.from([]) })).rejects.toThrow(
      'No providers in fallback chain',
    );
  });

  it('should derive id and displayName from the chain providers', () => {
    const p1 = mockSTT('alpha');
    const p2 = mockSTT('beta');
    const proxy = new FallbackSTTProxy([p1, p2], new EventEmitter());

    // id comes from the first provider (the primary)
    expect(proxy.id).toBe('alpha');
    // displayName shows the full chain with arrow separators
    expect(proxy.displayName).toBe('Fallback STT (alpha \u2192 beta)');
  });

  it('should use fallback-stt as the id for an empty chain', () => {
    const proxy = new FallbackSTTProxy([], new EventEmitter());
    expect(proxy.id).toBe('fallback-stt');
  });

  it('should delegate getProviderName to the first provider in the chain', () => {
    const p1 = mockSTT('p1');
    const proxy = new FallbackSTTProxy([p1], new EventEmitter());
    expect(proxy.getProviderName()).toBe('p1');
  });

  it('should return "fallback" from getProviderName when the chain is empty', () => {
    const proxy = new FallbackSTTProxy([], new EventEmitter());
    expect(proxy.getProviderName()).toBe('fallback');
  });

  it('should pass transcription options through to the chosen provider', async () => {
    const p1 = mockSTT('p1');
    const proxy = new FallbackSTTProxy([p1], new EventEmitter());
    const options = { language: 'fr', model: 'large' };

    await proxy.transcribe({ data: Buffer.from([]) }, options);

    // Verify both audio and options were forwarded exactly
    expect(p1.transcribe).toHaveBeenCalledWith({ data: Buffer.from([]) }, options);
  });
});

// ---------------------------------------------------------------------------
// FallbackTTSProxy tests
// ---------------------------------------------------------------------------

/**
 * Tests for {@link FallbackTTSProxy} — verifies the same retry chain logic
 * as FallbackSTTProxy, plus the voice listing delegation behaviour.
 */
describe('FallbackTTSProxy', () => {
  it('should return the result from the first provider when it succeeds', async () => {
    const p1 = mockTTS('p1', { cost: 5 });
    const proxy = new FallbackTTSProxy([p1], new EventEmitter());

    const result = await proxy.synthesize('hello');

    expect(result.cost).toBe(5);
    expect(p1.synthesize).toHaveBeenCalledOnce();
  });

  it('should not call the second provider when the first succeeds', async () => {
    const p1 = mockTTS('p1');
    const p2 = mockTTS('p2');
    const proxy = new FallbackTTSProxy([p1, p2], new EventEmitter());

    await proxy.synthesize('hi');

    expect(p2.synthesize).not.toHaveBeenCalled();
  });

  it('should fall back to the second provider and emit provider_fallback event when the first fails', async () => {
    const emitter = new EventEmitter();
    const handler = vi.fn();
    emitter.on('provider_fallback', handler);

    const p1 = mockTTS('p1', undefined, new Error('tts fail'));
    const p2 = mockTTS('p2', { cost: 1 });
    const proxy = new FallbackTTSProxy([p1, p2], emitter);

    const result = await proxy.synthesize('hello');

    expect(result.cost).toBe(1);
    expect(handler).toHaveBeenCalledOnce();

    const event = handler.mock.calls[0][0];
    expect(event.from).toBe('p1');
    expect(event.to).toBe('p2');
    // TTS fallback events should have kind 'tts'
    expect(event.kind).toBe('tts');
    expect(event.error).toBeInstanceOf(Error);
  });

  it('should throw the last provider error when all providers fail', async () => {
    const p1 = mockTTS('p1', undefined, new Error('fail1'));
    const p2 = mockTTS('p2', undefined, new Error('fail2'));
    const proxy = new FallbackTTSProxy([p1, p2], new EventEmitter());

    await expect(proxy.synthesize('hi')).rejects.toThrow('fail2');
  });

  it('should throw immediately when the chain is empty', async () => {
    const proxy = new FallbackTTSProxy([], new EventEmitter());
    await expect(proxy.synthesize('hi')).rejects.toThrow('No providers in fallback chain');
  });

  it('should derive id and displayName from the chain providers', () => {
    const p1 = mockTTS('gamma');
    const p2 = mockTTS('delta');
    const proxy = new FallbackTTSProxy([p1, p2], new EventEmitter());

    expect(proxy.id).toBe('gamma');
    expect(proxy.displayName).toBe('Fallback TTS (gamma \u2192 delta)');
  });

  it('should use fallback-tts as the id for an empty chain', () => {
    const proxy = new FallbackTTSProxy([], new EventEmitter());
    expect(proxy.id).toBe('fallback-tts');
  });

  it('should delegate getProviderName to the first provider in the chain', () => {
    const p1 = mockTTS('p1');
    const proxy = new FallbackTTSProxy([p1], new EventEmitter());
    expect(proxy.getProviderName()).toBe('p1');
  });

  it('should return "fallback" from getProviderName when the chain is empty', () => {
    const proxy = new FallbackTTSProxy([], new EventEmitter());
    expect(proxy.getProviderName()).toBe('fallback');
  });

  it('should pass synthesis options through to the chosen provider', async () => {
    const p1 = mockTTS('p1');
    const proxy = new FallbackTTSProxy([p1], new EventEmitter());
    const options = { voice: 'alloy', speed: 1.2 };

    await proxy.synthesize('hello world', options);

    expect(p1.synthesize).toHaveBeenCalledWith('hello world', options);
  });

  // --- listAvailableVoices delegation ---

  it('should delegate listAvailableVoices to the first provider that supports it', async () => {
    const voices: SpeechVoice[] = [
      { id: 'v1', name: 'Voice 1', lang: 'en', provider: 'p2' },
    ];
    const p1 = mockTTS('p1'); // No listAvailableVoices method
    const p2 = mockTTS('p2', undefined, undefined, voices);
    const proxy = new FallbackTTSProxy([p1, p2], new EventEmitter());

    const result = await proxy.listAvailableVoices();
    // p1 doesn't have the method, so p2's voices should be returned
    expect(result).toEqual(voices);
  });

  it('should return the first provider voices when multiple providers support listing', async () => {
    const voices: SpeechVoice[] = [
      { id: 'v1', name: 'Voice 1', lang: 'en', provider: 'p1' },
    ];
    const p1 = mockTTS('p1', undefined, undefined, voices);
    const p2 = mockTTS('p2', undefined, undefined, [
      { id: 'v2', name: 'Voice 2', lang: 'en', provider: 'p2' },
    ]);
    const proxy = new FallbackTTSProxy([p1, p2], new EventEmitter());

    const result = await proxy.listAvailableVoices();
    // Should return p1's voices since it's checked first
    expect(result).toEqual(voices);
  });

  it('should return an empty array when no providers support listAvailableVoices', async () => {
    const p1 = mockTTS('p1');
    const p2 = mockTTS('p2');
    const proxy = new FallbackTTSProxy([p1, p2], new EventEmitter());

    const result = await proxy.listAvailableVoices();
    expect(result).toEqual([]);
  });

  it('should return an empty array for listAvailableVoices on an empty chain', async () => {
    const proxy = new FallbackTTSProxy([], new EventEmitter());
    const result = await proxy.listAvailableVoices();
    expect(result).toEqual([]);
  });
});
