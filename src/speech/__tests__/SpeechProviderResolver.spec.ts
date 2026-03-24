import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SpeechProviderResolver } from '../SpeechProviderResolver.js';
import type { ProviderRegistration, SpeechProviderCatalogEntry } from '../types.js';

/** Helper: build a mock STT registration. */
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

/** Helper: build a mock TTS registration. */
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

/** Helper: build a mock VAD registration. */
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

describe('SpeechProviderResolver', () => {
  let resolver: SpeechProviderResolver;

  beforeEach(() => {
    resolver = new SpeechProviderResolver();
  });

  // ── resolveSTT ────────────────────────────────────────────────────────────

  it('resolveSTT returns first configured provider by priority', () => {
    const m1 = mockSTT('a');
    const m2 = mockSTT('b');
    resolver.register({ ...m1, id: 'a', kind: 'stt', isConfigured: true, priority: 100, source: 'core' });
    resolver.register({ ...m2, id: 'b', kind: 'stt', isConfigured: true, priority: 200, source: 'extension' });
    expect((resolver.resolveSTT() as any).id).toBe('a');
  });

  it('resolveSTT with preferredIds returns first match', () => {
    const m1 = mockSTT('a');
    const m2 = mockSTT('b');
    resolver.register({ ...m1, id: 'a', kind: 'stt', isConfigured: true, priority: 100, source: 'core' });
    resolver.register({ ...m2, id: 'b', kind: 'stt', isConfigured: true, priority: 200, source: 'core' });
    expect((resolver.resolveSTT({ preferredIds: ['b', 'a'] }) as any).id).toBe('b');
  });

  it('resolveSTT filters by streaming', () => {
    const m1 = mockSTT('a', { streaming: false });
    const m2 = mockSTT('b', { streaming: true });
    resolver.register({ ...m1, id: 'a', kind: 'stt', isConfigured: true, priority: 100, source: 'core' });
    resolver.register({ ...m2, id: 'b', kind: 'stt', isConfigured: true, priority: 200, source: 'core' });
    expect((resolver.resolveSTT({ streaming: true }) as any).id).toBe('b');
  });

  it('resolveSTT filters by local', () => {
    const m1 = mockSTT('cloud', { local: false });
    const m2 = mockSTT('local', { local: true });
    resolver.register({ ...m1, id: 'cloud', kind: 'stt', isConfigured: true, priority: 100, source: 'core' });
    resolver.register({ ...m2, id: 'local', kind: 'stt', isConfigured: true, priority: 200, source: 'core' });
    expect((resolver.resolveSTT({ local: true }) as any).id).toBe('local');
  });

  it('resolveSTT filters by features', () => {
    const m1 = mockSTT('a', { features: ['cloud'] });
    const m2 = mockSTT('b', { features: ['cloud', 'diarization'] });
    resolver.register({ ...m1, id: 'a', kind: 'stt', isConfigured: true, priority: 100, source: 'core' });
    resolver.register({ ...m2, id: 'b', kind: 'stt', isConfigured: true, priority: 200, source: 'core' });
    expect((resolver.resolveSTT({ features: ['diarization'] }) as any).id).toBe('b');
  });

  it('resolveSTT throws when no match', () => {
    expect(() => resolver.resolveSTT()).toThrow('No configured STT');
  });

  it('resolveSTT with fallback wraps in FallbackSTTProxy', () => {
    const r = new SpeechProviderResolver({ stt: { fallback: true } });
    const m1 = mockSTT('a');
    const m2 = mockSTT('b');
    r.register({ ...m1, id: 'a', kind: 'stt', isConfigured: true, priority: 100, source: 'core' });
    r.register({ ...m2, id: 'b', kind: 'stt', isConfigured: true, priority: 200, source: 'core' });
    const result = r.resolveSTT();
    expect((result as any).id).toBe('a');
    expect(result.displayName).toContain('Fallback');
  });

  // ── resolveTTS ────────────────────────────────────────────────────────────

  it('resolveTTS throws when no match', () => {
    expect(() => resolver.resolveTTS()).toThrow('No configured TTS');
  });

  // ── resolveVAD ────────────────────────────────────────────────────────────

  it('resolveVAD returns registered VAD', () => {
    const v = mockVAD('vad');
    resolver.register({ ...v, id: 'vad', kind: 'vad', isConfigured: true, priority: 100, source: 'core' });
    expect((resolver.resolveVAD() as any).id).toBe('vad');
  });

  // ── resolveWakeWord ───────────────────────────────────────────────────────

  it('resolveWakeWord returns null when none registered', () => {
    expect(resolver.resolveWakeWord()).toBeNull();
  });

  // ── register / listProviders ──────────────────────────────────────────────

  it('register emits provider_registered', () => {
    const handler = vi.fn();
    resolver.on('provider_registered', handler);
    const m = mockSTT('a');
    resolver.register({ ...m, id: 'a', kind: 'stt', isConfigured: true, priority: 100, source: 'core' });
    expect(handler).toHaveBeenCalledWith({ id: 'a', kind: 'stt', source: 'core' });
  });

  it('listProviders returns sorted by priority', () => {
    const m1 = mockSTT('a');
    const m2 = mockSTT('b');
    resolver.register({ ...m1, id: 'a', kind: 'stt', isConfigured: true, priority: 200, source: 'core' });
    resolver.register({ ...m2, id: 'b', kind: 'stt', isConfigured: true, priority: 100, source: 'core' });
    const list = resolver.listProviders('stt');
    expect(list[0].id).toBe('b');
    expect(list[1].id).toBe('a');
  });

  // ── refresh ───────────────────────────────────────────────────────────────

  it('refresh registers core providers based on env', async () => {
    const r = new SpeechProviderResolver(undefined, { OPENAI_API_KEY: 'test' });
    await r.refresh();
    const stts = r.listProviders('stt');
    expect(stts.some((p) => p.id === 'openai-whisper' && p.isConfigured)).toBe(true);
  });

  it('refresh marks unconfigured providers', async () => {
    const r = new SpeechProviderResolver(undefined, {});
    await r.refresh();
    const stts = r.listProviders('stt');
    const deepgram = stts.find((p) => p.id === 'deepgram-batch');
    expect(deepgram?.isConfigured).toBe(false);
  });

  it('refresh discovers extension providers from ExtensionManager', async () => {
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
    expect(ext!.source).toBe('extension');
    expect(ext!.priority).toBe(200);
  });

  it('refresh applies preferred priorities', async () => {
    const r = new SpeechProviderResolver(
      { stt: { preferred: ['assemblyai', 'openai-whisper'] } },
      { OPENAI_API_KEY: 'test', ASSEMBLYAI_API_KEY: 'test' },
    );
    await r.refresh();
    const stts = r.listProviders('stt');
    const aai = stts.find((p) => p.id === 'assemblyai');
    const whisper = stts.find((p) => p.id === 'openai-whisper');
    expect(aai!.priority).toBe(50);
    expect(whisper!.priority).toBe(51);
  });
});
