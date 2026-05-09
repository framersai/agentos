import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SpeechProviderResolver } from '../SpeechProviderResolver.js';
import type { ProviderRegistration, SpeechProviderCatalogEntry } from '../types.js';

/**
 * Builds a mock STT provider registration with configurable catalog metadata.
 * Returns only the fields that vary between tests — callers must spread in
 * the remaining required ProviderRegistration fields (id, kind, etc.).
 */
function mockSTT(
  id: string,
  opts?: { streaming?: boolean; local?: boolean; features?: string[] },
): Pick<ProviderRegistration, 'provider' | 'catalogEntry'> {
  return {
    provider: {
      id,
      transcribe: vi.fn(),
      getProviderName: () => id,
      supportsStreaming: opts?.streaming ?? false,
    },
    catalogEntry: {
      id,
      kind: 'stt' as const,
      label: id,
      envVars: [],
      local: opts?.local ?? false,
      streaming: opts?.streaming ?? false,
      description: '',
      features: opts?.features ?? [],
    },
  };
}

/**
 * Builds a mock TTS provider registration with minimal defaults.
 * TTS tests don't need configurable catalog options since the resolver
 * shares the same filtering logic with STT.
 */
function mockTTS(
  id: string,
): Pick<ProviderRegistration, 'provider' | 'catalogEntry'> {
  return {
    provider: {
      id,
      synthesize: vi.fn(),
      getProviderName: () => id,
      supportsStreaming: false,
    },
    catalogEntry: {
      id,
      kind: 'tts' as const,
      label: id,
      envVars: [],
      local: false,
      description: '',
    },
  };
}

/**
 * Builds a mock VAD provider registration.
 * VAD providers are always local and don't need catalog feature metadata.
 */
function mockVAD(
  id: string,
): Pick<ProviderRegistration, 'provider' | 'catalogEntry'> {
  return {
    provider: { id, processFrame: vi.fn(), reset: vi.fn() },
    catalogEntry: {
      id,
      kind: 'vad' as const,
      label: id,
      envVars: [],
      local: true,
      description: '',
    },
  };
}

/**
 * Tests for {@link SpeechProviderResolver} — the central mechanism for
 * registering, filtering, and resolving speech providers by kind, priority,
 * requirements, and fallback configuration.
 */
describe('SpeechProviderResolver', () => {
  let resolver: SpeechProviderResolver;

  beforeEach(() => {
    resolver = new SpeechProviderResolver();
  });

  // ── resolveSTT ──────────────────────────────────────────────────────────

  it('should return the first configured provider by priority when resolving STT', () => {
    const m1 = mockSTT('a');
    const m2 = mockSTT('b');
    resolver.register({ ...m1, id: 'a', kind: 'stt', isConfigured: true, priority: 100, source: 'core' });
    resolver.register({ ...m2, id: 'b', kind: 'stt', isConfigured: true, priority: 200, source: 'extension' });
    // Priority 100 < 200, so 'a' should be selected first
    expect((resolver.resolveSTT() as any).id).toBe('a');
  });

  it('should respect preferredIds ordering over priority when resolving STT', () => {
    const m1 = mockSTT('a');
    const m2 = mockSTT('b');
    resolver.register({ ...m1, id: 'a', kind: 'stt', isConfigured: true, priority: 100, source: 'core' });
    resolver.register({ ...m2, id: 'b', kind: 'stt', isConfigured: true, priority: 200, source: 'core' });
    // Explicit preferredIds should override the priority-based ordering
    expect((resolver.resolveSTT({ preferredIds: ['b', 'a'] }) as any).id).toBe('b');
  });

  it('should filter providers by streaming capability when required', () => {
    const m1 = mockSTT('a', { streaming: false });
    const m2 = mockSTT('b', { streaming: true });
    resolver.register({ ...m1, id: 'a', kind: 'stt', isConfigured: true, priority: 100, source: 'core' });
    resolver.register({ ...m2, id: 'b', kind: 'stt', isConfigured: true, priority: 200, source: 'core' });
    // Only 'b' has streaming=true in its catalog entry
    expect((resolver.resolveSTT({ streaming: true }) as any).id).toBe('b');
  });

  it('should filter providers by local deployment requirement', () => {
    const m1 = mockSTT('cloud', { local: false });
    const m2 = mockSTT('local', { local: true });
    resolver.register({ ...m1, id: 'cloud', kind: 'stt', isConfigured: true, priority: 100, source: 'core' });
    resolver.register({ ...m2, id: 'local', kind: 'stt', isConfigured: true, priority: 200, source: 'core' });
    // Only 'local' has local=true in its catalog entry
    expect((resolver.resolveSTT({ local: true }) as any).id).toBe('local');
  });

  it('should filter providers by required features using AND semantics', () => {
    const m1 = mockSTT('a', { features: ['cloud'] });
    const m2 = mockSTT('b', { features: ['cloud', 'diarization'] });
    resolver.register({ ...m1, id: 'a', kind: 'stt', isConfigured: true, priority: 100, source: 'core' });
    resolver.register({ ...m2, id: 'b', kind: 'stt', isConfigured: true, priority: 200, source: 'core' });
    // 'a' only has 'cloud', not 'diarization' — should be filtered out
    expect((resolver.resolveSTT({ features: ['diarization'] }) as any).id).toBe('b');
  });

  it('should throw when no configured STT provider matches requirements', () => {
    expect(() => resolver.resolveSTT()).toThrow('No configured STT');
  });

  it('should wrap multiple candidates in FallbackSTTProxy when fallback is enabled', () => {
    const r = new SpeechProviderResolver({ stt: { fallback: true } });
    const m1 = mockSTT('a');
    const m2 = mockSTT('b');
    r.register({ ...m1, id: 'a', kind: 'stt', isConfigured: true, priority: 100, source: 'core' });
    r.register({ ...m2, id: 'b', kind: 'stt', isConfigured: true, priority: 200, source: 'core' });
    const result = r.resolveSTT();
    // The proxy derives its id from the first provider in the chain
    expect((result as any).id).toBe('a');
    // The displayName contains "Fallback" to indicate it's a proxy
    expect(result.displayName).toContain('Fallback');
  });

  // ── resolveTTS ──────────────────────────────────────────────────────────

  it('should throw when no configured TTS provider matches requirements', () => {
    expect(() => resolver.resolveTTS()).toThrow('No configured TTS');
  });

  // ── resolveVAD ──────────────────────────────────────────────────────────

  it('should return the registered VAD provider when available', () => {
    const v = mockVAD('vad');
    resolver.register({ ...v, id: 'vad', kind: 'vad', isConfigured: true, priority: 100, source: 'core' });
    expect((resolver.resolveVAD() as any).id).toBe('vad');
  });

  // ── resolveWakeWord ─────────────────────────────────────────────────────

  it('should return null when no wake-word provider is registered', () => {
    expect(resolver.resolveWakeWord()).toBeNull();
  });

  // ── register / listProviders ────────────────────────────────────────────

  it('should emit provider_registered event when a provider is registered', () => {
    const handler = vi.fn();
    resolver.on('provider_registered', handler);
    const m = mockSTT('a');
    resolver.register({ ...m, id: 'a', kind: 'stt', isConfigured: true, priority: 100, source: 'core' });
    expect(handler).toHaveBeenCalledWith({ id: 'a', kind: 'stt', source: 'core' });
  });

  it('should return providers sorted by ascending priority from listProviders', () => {
    const m1 = mockSTT('a');
    const m2 = mockSTT('b');
    // Register 'a' with higher priority number (=lower priority) first
    resolver.register({ ...m1, id: 'a', kind: 'stt', isConfigured: true, priority: 200, source: 'core' });
    resolver.register({ ...m2, id: 'b', kind: 'stt', isConfigured: true, priority: 100, source: 'core' });
    const list = resolver.listProviders('stt');
    // Lower priority number should come first
    expect(list[0].id).toBe('b');
    expect(list[1].id).toBe('a');
  });

  // ── refresh ─────────────────────────────────────────────────────────────

  it('should register core providers based on environment variables during refresh', async () => {
    const r = new SpeechProviderResolver(undefined, { OPENAI_API_KEY: 'test' });
    await r.refresh();
    const stts = r.listProviders('stt');
    // OpenAI Whisper requires OPENAI_API_KEY, which is set
    expect(stts.some((p) => p.id === 'openai-whisper' && p.isConfigured)).toBe(true);
  });

  it('should mark providers as unconfigured when env vars are missing', async () => {
    const r = new SpeechProviderResolver(undefined, {});
    await r.refresh();
    const stts = r.listProviders('stt');
    // Deepgram requires DEEPGRAM_API_KEY which is not in the empty env
    const deepgram = stts.find((p) => p.id === 'deepgram-batch');
    expect(deepgram?.isConfigured).toBe(false);
  });

  it('should discover extension providers from an ExtensionManager during refresh', async () => {
    const mockEM = {
      getDescriptorsByKind: vi.fn((kind: string) => {
        if (kind === 'stt-provider') {
          return [
            {
              id: 'ext-stt',
              payload: {
                id: 'ext-stt',
                transcribe: vi.fn(),
                getProviderName: () => 'ext',
              },
            },
          ];
        }
        return [];
      }),
    };
    const r = new SpeechProviderResolver(undefined, {});
    await r.refresh(mockEM);
    const stts = r.listProviders('stt');
    const ext = stts.find((p) => p.id === 'ext-stt');
    expect(ext).toBeDefined();
    // Extensions should be marked with source 'extension'
    expect(ext!.source).toBe('extension');
    // Extensions default to priority 200 (below core's 100)
    expect(ext!.priority).toBe(200);
  });

  it('should apply preferred priority overrides during refresh', async () => {
    const r = new SpeechProviderResolver(
      { stt: { preferred: ['assemblyai', 'openai-whisper'] } },
      { OPENAI_API_KEY: 'test', ASSEMBLYAI_API_KEY: 'test' },
    );
    await r.refresh();
    const stts = r.listProviders('stt');
    const aai = stts.find((p) => p.id === 'assemblyai');
    const whisper = stts.find((p) => p.id === 'openai-whisper');
    // First preferred gets 50, second gets 51
    expect(aai!.priority).toBe(50);
    expect(whisper!.priority).toBe(51);
  });
});
