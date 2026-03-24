import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SpeechProviderResolver } from '../SpeechProviderResolver.js';

describe('SpeechProviderResolver Integration', () => {
  it('refresh registers core providers based on env vars', async () => {
    const resolver = new SpeechProviderResolver(undefined, { OPENAI_API_KEY: 'test-key' });
    await resolver.refresh();
    const stts = resolver.listProviders('stt');
    expect(stts.some(p => p.id === 'openai-whisper' && p.isConfigured)).toBe(true);
    expect(stts.some(p => p.id === 'deepgram-batch' && !p.isConfigured)).toBe(true);
  });

  it('resolveSTT returns first configured provider', async () => {
    const resolver = new SpeechProviderResolver(undefined, { OPENAI_API_KEY: 'key' });
    await resolver.refresh();
    // Need to register actual mock providers since refresh registers with null providers
    // Register a real mock
    const mockProvider = { id: 'openai-whisper', transcribe: vi.fn(), getProviderName: () => 'openai', supportsStreaming: false };
    // Update the existing registration's provider
    const regs = resolver.listProviders('stt');
    const whisperReg = regs.find(r => r.id === 'openai-whisper');
    if (whisperReg) (whisperReg as any).provider = mockProvider;

    const result = resolver.resolveSTT();
    expect(result).toBeDefined();
  });

  it('resolveSTT with preferredIds overrides priority', async () => {
    const resolver = new SpeechProviderResolver(undefined, { OPENAI_API_KEY: 'k', DEEPGRAM_API_KEY: 'k' });
    await resolver.refresh();
    // Patch providers
    for (const reg of resolver.listProviders('stt')) {
      (reg as any).provider = { id: reg.id, transcribe: vi.fn(), getProviderName: () => reg.id, supportsStreaming: false };
    }
    const result = resolver.resolveSTT({ preferredIds: ['deepgram-batch'] });
    expect(result.id).toBe('deepgram-batch');
  });

  it('resolveSTT filters by streaming requirement', async () => {
    const resolver = new SpeechProviderResolver(undefined, { OPENAI_API_KEY: 'k' });
    await resolver.refresh();
    // openai-whisper has streaming: false in catalog
    expect(() => resolver.resolveSTT({ streaming: true })).toThrow();
  });

  it('resolveVAD always returns AdaptiveVAD', async () => {
    const resolver = new SpeechProviderResolver(undefined, {});
    await resolver.refresh();
    // Patch the VAD provider
    const vads = resolver.listProviders('vad');
    expect(vads.length).toBeGreaterThan(0);
    (vads[0] as any).provider = { id: 'agentos-adaptive-vad', processFrame: vi.fn(), reset: vi.fn() };
    const vad = resolver.resolveVAD();
    expect(vad.id).toBe('agentos-adaptive-vad');
  });

  it('resolveWakeWord returns null when none configured', async () => {
    const resolver = new SpeechProviderResolver(undefined, {});
    await resolver.refresh();
    expect(resolver.resolveWakeWord()).toBeNull();
  });

  it('fallback: first provider fails, second succeeds', async () => {
    const resolver = new SpeechProviderResolver({ stt: { fallback: true } }, { OPENAI_API_KEY: 'k', DEEPGRAM_API_KEY: 'k' });
    await resolver.refresh();
    // Patch: first throws, second succeeds
    const stts = resolver.listProviders('stt');
    for (const reg of stts) {
      if (reg.id === 'openai-whisper') {
        (reg as any).provider = { id: 'openai-whisper', transcribe: vi.fn().mockRejectedValue(new Error('fail')), getProviderName: () => 'openai', supportsStreaming: false };
      } else if (reg.id === 'deepgram-batch') {
        (reg as any).provider = { id: 'deepgram-batch', transcribe: vi.fn().mockResolvedValue({ text: 'hello', cost: 0 }), getProviderName: () => 'deepgram', supportsStreaming: false };
      }
    }
    const fallbackHandler = vi.fn();
    resolver.on('provider_fallback', fallbackHandler);
    const stt = resolver.resolveSTT();
    const result = await stt.transcribe({ data: Buffer.from([]) });
    expect(result.text).toBe('hello');
    expect(fallbackHandler).toHaveBeenCalled();
  });

  it('refresh discovers extension providers from ExtensionManager', async () => {
    const mockEM = {
      getDescriptorsByKind: vi.fn((kind: string) => {
        if (kind === 'stt-provider') return [{ id: 'ext-custom-stt', payload: { id: 'ext-custom-stt', transcribe: vi.fn(), getProviderName: () => 'custom' } }];
        return [];
      }),
    };
    const resolver = new SpeechProviderResolver(undefined, {});
    await resolver.refresh(mockEM);
    const stts = resolver.listProviders('stt');
    const ext = stts.find(r => r.id === 'ext-custom-stt');
    expect(ext).toBeDefined();
    expect(ext!.source).toBe('extension');
    expect(ext!.priority).toBe(200);
  });

  it('refresh applies preferred priority overrides', async () => {
    const resolver = new SpeechProviderResolver(
      { stt: { preferred: ['assemblyai', 'openai-whisper'] } },
      { OPENAI_API_KEY: 'k', ASSEMBLYAI_API_KEY: 'k' }
    );
    await resolver.refresh();
    const stts = resolver.listProviders('stt');
    const aai = stts.find(r => r.id === 'assemblyai');
    const whisper = stts.find(r => r.id === 'openai-whisper');
    expect(aai!.priority).toBe(50);
    expect(whisper!.priority).toBe(51);
  });
});
