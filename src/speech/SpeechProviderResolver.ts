import { EventEmitter } from 'events';
import type {
  SpeechProviderKind,
  SpeechToTextProvider,
  TextToSpeechProvider,
  SpeechVadProvider,
  WakeWordProvider,
  SpeechProviderCatalogEntry,
  SpeechResolverConfig,
  ProviderRequirements,
  ProviderRegistration,
} from './types.js';
import { FallbackSTTProxy, FallbackTTSProxy } from './FallbackProxy.js';
import { findSpeechProviderCatalogEntry } from './providerCatalog.js';

/**
 * Central resolver for speech providers (STT, TTS, VAD, wake-word).
 *
 * Providers are registered with a kind, priority, and catalog metadata.
 * Resolution filters by `isConfigured`, applies {@link ProviderRequirements},
 * and optionally wraps multiple candidates in a {@link FallbackSTTProxy} or
 * {@link FallbackTTSProxy} when fallback mode is enabled in the config.
 *
 * Emits:
 * - `provider_registered` — when a new provider is registered via {@link register}.
 */
export class SpeechProviderResolver extends EventEmitter {
  /** All registered providers keyed by id. */
  private registrations = new Map<string, ProviderRegistration>();

  /**
   * @param config Optional resolver configuration (preferred providers, fallback mode).
   * @param env    Environment variable map used to check provider availability.
   */
  constructor(
    private readonly config?: SpeechResolverConfig,
    private readonly env: Record<string, string | undefined> = process.env,
  ) {
    super();
  }

  /**
   * Register a provider.  Overwrites any existing registration with the same id.
   * Emits a `provider_registered` event with `{ id, kind, source }`.
   */
  register(reg: ProviderRegistration): void {
    this.registrations.set(reg.id, reg);
    this.emit('provider_registered', { id: reg.id, kind: reg.kind, source: reg.source });
  }

  /**
   * List all registrations for a given kind, sorted ascending by priority
   * (lower number = higher priority).
   */
  listProviders(kind: SpeechProviderKind): ProviderRegistration[] {
    return [...this.registrations.values()]
      .filter((r) => r.kind === kind)
      .sort((a, b) => a.priority - b.priority);
  }

  /**
   * Resolve the best STT provider matching optional {@link ProviderRequirements}.
   *
   * When `config.stt.fallback` is true and multiple candidates exist, wraps them
   * in a {@link FallbackSTTProxy}.  Otherwise returns the single best match.
   *
   * @throws When no configured STT provider matches requirements.
   */
  resolveSTT(requirements?: ProviderRequirements): SpeechToTextProvider {
    const candidates = this.resolveByKind('stt', requirements);
    if (candidates.length === 0) {
      throw new Error('No configured STT provider matches requirements');
    }

    if (this.config?.stt?.fallback && candidates.length > 1) {
      return new FallbackSTTProxy(
        candidates.map((r) => r.provider as SpeechToTextProvider),
        this,
      );
    }
    return candidates[0].provider as SpeechToTextProvider;
  }

  /**
   * Resolve the best TTS provider matching optional {@link ProviderRequirements}.
   *
   * When `config.tts.fallback` is true and multiple candidates exist, wraps them
   * in a {@link FallbackTTSProxy}.  Otherwise returns the single best match.
   *
   * @throws When no configured TTS provider matches requirements.
   */
  resolveTTS(requirements?: ProviderRequirements): TextToSpeechProvider {
    const candidates = this.resolveByKind('tts', requirements);
    if (candidates.length === 0) {
      throw new Error('No configured TTS provider matches requirements');
    }

    if (this.config?.tts?.fallback && candidates.length > 1) {
      return new FallbackTTSProxy(
        candidates.map((r) => r.provider as TextToSpeechProvider),
        this,
      );
    }
    return candidates[0].provider as TextToSpeechProvider;
  }

  /**
   * Resolve the highest-priority configured VAD provider.
   *
   * @throws When no VAD provider is registered and configured.
   */
  resolveVAD(): SpeechVadProvider {
    const vads = this.listProviders('vad').filter((r) => r.isConfigured);
    if (vads.length === 0) {
      throw new Error('No VAD provider registered');
    }
    return vads[0].provider as SpeechVadProvider;
  }

  /**
   * Resolve the highest-priority configured wake-word provider, or `null`
   * when none is registered.
   */
  resolveWakeWord(): WakeWordProvider | null {
    const wakeWords = this.listProviders('wake-word').filter((r) => r.isConfigured);
    return wakeWords.length > 0 ? (wakeWords[0].provider as WakeWordProvider) : null;
  }

  // ---------------------------------------------------------------------------
  // Bulk registration helpers
  // ---------------------------------------------------------------------------

  /**
   * Register core providers from the static catalog and optionally discover
   * extension providers from an ExtensionManager-like object.  Also applies
   * user-configured preferred priorities afterwards.
   *
   * @param extensionManager Optional object exposing `getDescriptorsByKind(kind)`.
   */
  async refresh(extensionManager?: any): Promise<void> {
    this.registerCoreProviders();

    if (extensionManager) {
      this.discoverExtensionProviders(extensionManager);
    }

    this.applyPreferredPriorities();
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Core resolution algorithm shared by {@link resolveSTT} and {@link resolveTTS}.
   *
   * When `requirements.preferredIds` is provided, returns matches in that order.
   * Otherwise returns all configured providers matching requirements, sorted by
   * priority (ascending).
   */
  private resolveByKind(
    kind: SpeechProviderKind,
    requirements?: ProviderRequirements,
  ): ProviderRegistration[] {
    if (requirements?.preferredIds?.length) {
      const results: ProviderRegistration[] = [];
      for (const id of requirements.preferredIds) {
        const reg = this.registrations.get(id);
        if (reg && reg.kind === kind && reg.isConfigured && this.matchesRequirements(reg, requirements)) {
          results.push(reg);
        }
      }
      return results;
    }

    return this.listProviders(kind)
      .filter((r) => r.isConfigured)
      .filter((r) => this.matchesRequirements(r, requirements));
  }

  /**
   * Check whether a registration satisfies the given requirements
   * (streaming, local, features).
   */
  private matchesRequirements(reg: ProviderRegistration, req?: ProviderRequirements): boolean {
    if (!req) return true;
    if (req.streaming !== undefined && reg.catalogEntry.streaming !== req.streaming) return false;
    if (req.local !== undefined && reg.catalogEntry.local !== req.local) return false;
    if (req.features?.length) {
      const providerFeatures = reg.catalogEntry.features ?? [];
      if (!req.features.every((f) => providerFeatures.includes(f))) return false;
    }
    return true;
  }

  /**
   * Register providers from the static core list.  Each provider is marked
   * `isConfigured` based on whether the required environment variables are set.
   * Providers with `available === false` in the catalog are skipped.
   */
  private registerCoreProviders(): void {
    const coreProviders = [
      { id: 'openai-whisper', kind: 'stt' as const, envVars: ['OPENAI_API_KEY'] },
      { id: 'deepgram-batch', kind: 'stt' as const, envVars: ['DEEPGRAM_API_KEY'] },
      { id: 'assemblyai', kind: 'stt' as const, envVars: ['ASSEMBLYAI_API_KEY'] },
      { id: 'azure-speech-stt', kind: 'stt' as const, envVars: ['AZURE_SPEECH_KEY', 'AZURE_SPEECH_REGION'] },
      { id: 'openai-tts', kind: 'tts' as const, envVars: ['OPENAI_API_KEY'] },
      { id: 'elevenlabs', kind: 'tts' as const, envVars: ['ELEVENLABS_API_KEY'] },
      { id: 'azure-speech-tts', kind: 'tts' as const, envVars: ['AZURE_SPEECH_KEY', 'AZURE_SPEECH_REGION'] },
      { id: 'agentos-adaptive-vad', kind: 'vad' as const, envVars: [] as string[] },
    ];

    for (const def of coreProviders) {
      const catalogEntry = findSpeechProviderCatalogEntry(def.id);
      if (!catalogEntry) continue;
      if (catalogEntry.available === false) continue;

      const isConfigured =
        def.envVars.length === 0 || def.envVars.every((v) => Boolean(this.env[v]));

      this.register({
        id: def.id,
        kind: def.kind,
        provider: null as any, // Lazy — actual provider instance created on first use.
        catalogEntry,
        isConfigured,
        priority: 100,
        source: 'core',
      });
    }
  }

  /**
   * Discover speech providers exposed by an ExtensionManager via
   * `getDescriptorsByKind()`.  Extension providers default to priority 200
   * (lower than core's 100) unless the user overrides via preferred config.
   */
  private discoverExtensionProviders(extensionManager: any): void {
    /** Maps extension descriptor kinds to {@link SpeechProviderKind}. */
    const kindMap: Record<string, SpeechProviderKind> = {
      'stt-provider': 'stt',
      'tts-provider': 'tts',
      'vad-provider': 'vad',
      'wake-word-provider': 'wake-word',
    };

    for (const descriptorKind of Object.keys(kindMap)) {
      const descriptors: any[] = extensionManager.getDescriptorsByKind?.(descriptorKind) ?? [];

      for (const desc of descriptors) {
        const catalogEntry = findSpeechProviderCatalogEntry(desc.id);
        const isConfigured = catalogEntry
          ? catalogEntry.envVars.length === 0 ||
            catalogEntry.envVars.every((v: string) => Boolean(this.env[v]))
          : true;

        this.register({
          id: desc.id,
          kind: kindMap[descriptorKind] ?? 'stt',
          provider: desc.payload,
          catalogEntry: catalogEntry ?? {
            id: desc.id,
            kind: kindMap[descriptorKind] ?? 'stt',
            label: desc.id,
            envVars: [],
            local: false,
            description: '',
          },
          isConfigured,
          priority: 200,
          source: 'extension',
        });
      }
    }
  }

  /**
   * Boost priority for providers listed in `config.stt.preferred` /
   * `config.tts.preferred`.  Earlier entries get lower (= higher priority)
   * numbers starting at 50.
   */
  private applyPreferredPriorities(): void {
    if (this.config?.stt?.preferred) {
      for (let i = 0; i < this.config.stt.preferred.length; i++) {
        const reg = this.registrations.get(this.config.stt.preferred[i]);
        if (reg) reg.priority = 50 + i;
      }
    }
    if (this.config?.tts?.preferred) {
      for (let i = 0; i < this.config.tts.preferred.length; i++) {
        const reg = this.registrations.get(this.config.tts.preferred[i]);
        if (reg) reg.priority = 50 + i;
      }
    }
  }
}
