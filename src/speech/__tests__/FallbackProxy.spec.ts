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
// Helpers
// ---------------------------------------------------------------------------

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

  if (voices !== undefined) {
    (provider as TextToSpeechProvider).listAvailableVoices = vi
      .fn()
      .mockResolvedValue(voices);
  }

  return provider;
}

// ---------------------------------------------------------------------------
// FallbackSTTProxy
// ---------------------------------------------------------------------------

describe('FallbackSTTProxy', () => {
  it('returns result from first provider on success', async () => {
    const p1 = mockSTT('p1', { text: 'result', cost: 0 });
    const proxy = new FallbackSTTProxy([p1], new EventEmitter());

    const result = await proxy.transcribe({ data: Buffer.from([]) });

    expect(result.text).toBe('result');
    expect(p1.transcribe).toHaveBeenCalledOnce();
  });

  it('does not call second provider when first succeeds', async () => {
    const p1 = mockSTT('p1', { text: 'ok' });
    const p2 = mockSTT('p2', { text: 'should not be used' });
    const proxy = new FallbackSTTProxy([p1, p2], new EventEmitter());

    await proxy.transcribe({ data: Buffer.from([]) });

    expect(p2.transcribe).not.toHaveBeenCalled();
  });

  it('falls back to second provider and emits provider_fallback event', async () => {
    const emitter = new EventEmitter();
    const handler = vi.fn();
    emitter.on('provider_fallback', handler);

    const p1 = mockSTT('p1', undefined, new Error('fail'));
    const p2 = mockSTT('p2', { text: 'from p2', cost: 0 });
    const proxy = new FallbackSTTProxy([p1, p2], emitter);

    const result = await proxy.transcribe({ data: Buffer.from([]) });

    expect(result.text).toBe('from p2');
    expect(handler).toHaveBeenCalledOnce();

    const event = handler.mock.calls[0][0];
    expect(event.from).toBe('p1');
    expect(event.to).toBe('p2');
    expect(event.kind).toBe('stt');
    expect(event.error).toBeInstanceOf(Error);
  });

  it('skips through three providers and emits two fallback events', async () => {
    const emitter = new EventEmitter();
    const handler = vi.fn();
    emitter.on('provider_fallback', handler);

    const p1 = mockSTT('p1', undefined, new Error('fail1'));
    const p2 = mockSTT('p2', undefined, new Error('fail2'));
    const p3 = mockSTT('p3', { text: 'from p3' });
    const proxy = new FallbackSTTProxy([p1, p2, p3], emitter);

    const result = await proxy.transcribe({ data: Buffer.from([]) });

    expect(result.text).toBe('from p3');
    expect(handler).toHaveBeenCalledTimes(2);
    expect(handler.mock.calls[0][0].from).toBe('p1');
    expect(handler.mock.calls[1][0].from).toBe('p2');
  });

  it('throws last error when all providers fail', async () => {
    const p1 = mockSTT('p1', undefined, new Error('fail1'));
    const p2 = mockSTT('p2', undefined, new Error('fail2'));
    const proxy = new FallbackSTTProxy([p1, p2], new EventEmitter());

    await expect(proxy.transcribe({ data: Buffer.from([]) })).rejects.toThrow('fail2');
  });

  it('does not emit fallback event for the last failing provider', async () => {
    const emitter = new EventEmitter();
    const handler = vi.fn();
    emitter.on('provider_fallback', handler);

    const p1 = mockSTT('p1', undefined, new Error('only provider'));
    const proxy = new FallbackSTTProxy([p1], emitter);

    await expect(proxy.transcribe({ data: Buffer.from([]) })).rejects.toThrow('only provider');
    expect(handler).not.toHaveBeenCalled();
  });

  it('throws on empty chain', async () => {
    const proxy = new FallbackSTTProxy([], new EventEmitter());
    await expect(proxy.transcribe({ data: Buffer.from([]) })).rejects.toThrow(
      'No providers in fallback chain',
    );
  });

  it('derives id and displayName from chain', () => {
    const p1 = mockSTT('alpha');
    const p2 = mockSTT('beta');
    const proxy = new FallbackSTTProxy([p1, p2], new EventEmitter());

    expect(proxy.id).toBe('alpha');
    expect(proxy.displayName).toBe('Fallback STT (alpha → beta)');
  });

  it('uses fallback-stt id for empty chain', () => {
    const proxy = new FallbackSTTProxy([], new EventEmitter());
    expect(proxy.id).toBe('fallback-stt');
  });

  it('delegates getProviderName to first provider', () => {
    const p1 = mockSTT('p1');
    const proxy = new FallbackSTTProxy([p1], new EventEmitter());
    expect(proxy.getProviderName()).toBe('p1');
  });

  it('returns fallback for getProviderName on empty chain', () => {
    const proxy = new FallbackSTTProxy([], new EventEmitter());
    expect(proxy.getProviderName()).toBe('fallback');
  });

  it('passes options through to the chosen provider', async () => {
    const p1 = mockSTT('p1');
    const proxy = new FallbackSTTProxy([p1], new EventEmitter());
    const options = { language: 'fr', model: 'large' };

    await proxy.transcribe({ data: Buffer.from([]) }, options);

    expect(p1.transcribe).toHaveBeenCalledWith({ data: Buffer.from([]) }, options);
  });
});

// ---------------------------------------------------------------------------
// FallbackTTSProxy
// ---------------------------------------------------------------------------

describe('FallbackTTSProxy', () => {
  it('returns result from first provider on success', async () => {
    const p1 = mockTTS('p1', { cost: 5 });
    const proxy = new FallbackTTSProxy([p1], new EventEmitter());

    const result = await proxy.synthesize('hello');

    expect(result.cost).toBe(5);
    expect(p1.synthesize).toHaveBeenCalledOnce();
  });

  it('does not call second provider when first succeeds', async () => {
    const p1 = mockTTS('p1');
    const p2 = mockTTS('p2');
    const proxy = new FallbackTTSProxy([p1, p2], new EventEmitter());

    await proxy.synthesize('hi');

    expect(p2.synthesize).not.toHaveBeenCalled();
  });

  it('falls back to second provider and emits provider_fallback event', async () => {
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
    expect(event.kind).toBe('tts');
    expect(event.error).toBeInstanceOf(Error);
  });

  it('throws last error when all providers fail', async () => {
    const p1 = mockTTS('p1', undefined, new Error('fail1'));
    const p2 = mockTTS('p2', undefined, new Error('fail2'));
    const proxy = new FallbackTTSProxy([p1, p2], new EventEmitter());

    await expect(proxy.synthesize('hi')).rejects.toThrow('fail2');
  });

  it('throws on empty chain', async () => {
    const proxy = new FallbackTTSProxy([], new EventEmitter());
    await expect(proxy.synthesize('hi')).rejects.toThrow('No providers in fallback chain');
  });

  it('derives id and displayName from chain', () => {
    const p1 = mockTTS('gamma');
    const p2 = mockTTS('delta');
    const proxy = new FallbackTTSProxy([p1, p2], new EventEmitter());

    expect(proxy.id).toBe('gamma');
    expect(proxy.displayName).toBe('Fallback TTS (gamma → delta)');
  });

  it('uses fallback-tts id for empty chain', () => {
    const proxy = new FallbackTTSProxy([], new EventEmitter());
    expect(proxy.id).toBe('fallback-tts');
  });

  it('delegates getProviderName to first provider', () => {
    const p1 = mockTTS('p1');
    const proxy = new FallbackTTSProxy([p1], new EventEmitter());
    expect(proxy.getProviderName()).toBe('p1');
  });

  it('returns fallback for getProviderName on empty chain', () => {
    const proxy = new FallbackTTSProxy([], new EventEmitter());
    expect(proxy.getProviderName()).toBe('fallback');
  });

  it('passes options through to the chosen provider', async () => {
    const p1 = mockTTS('p1');
    const proxy = new FallbackTTSProxy([p1], new EventEmitter());
    const options = { voice: 'alloy', speed: 1.2 };

    await proxy.synthesize('hello world', options);

    expect(p1.synthesize).toHaveBeenCalledWith('hello world', options);
  });

  // --- listAvailableVoices delegation ---

  it('delegates listAvailableVoices to first provider that supports it', async () => {
    const voices: SpeechVoice[] = [
      { id: 'v1', name: 'Voice 1', lang: 'en', provider: 'p2' },
    ];
    const p1 = mockTTS('p1'); // no listAvailableVoices
    const p2 = mockTTS('p2', undefined, undefined, voices);
    const proxy = new FallbackTTSProxy([p1, p2], new EventEmitter());

    const result = await proxy.listAvailableVoices();
    expect(result).toEqual(voices);
  });

  it('returns voices from first provider when it supports listAvailableVoices', async () => {
    const voices: SpeechVoice[] = [
      { id: 'v1', name: 'Voice 1', lang: 'en', provider: 'p1' },
    ];
    const p1 = mockTTS('p1', undefined, undefined, voices);
    const p2 = mockTTS('p2', undefined, undefined, [
      { id: 'v2', name: 'Voice 2', lang: 'en', provider: 'p2' },
    ]);
    const proxy = new FallbackTTSProxy([p1, p2], new EventEmitter());

    const result = await proxy.listAvailableVoices();
    expect(result).toEqual(voices);
  });

  it('returns empty array when no providers support listAvailableVoices', async () => {
    const p1 = mockTTS('p1');
    const p2 = mockTTS('p2');
    const proxy = new FallbackTTSProxy([p1, p2], new EventEmitter());

    const result = await proxy.listAvailableVoices();
    expect(result).toEqual([]);
  });

  it('returns empty array for listAvailableVoices on empty chain', async () => {
    const proxy = new FallbackTTSProxy([], new EventEmitter());
    const result = await proxy.listAvailableVoices();
    expect(result).toEqual([]);
  });
});
