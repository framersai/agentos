import type { ExtensionManager } from '../extensions/ExtensionManager.js';
import { SpeechProviderRegistry } from './SpeechProviderRegistry.js';
import { SpeechProviderResolver } from './SpeechProviderResolver.js';
import { SpeechSession } from './SpeechSession.js';
import type { ProviderRequirements, SpeechProviderCatalogEntry, SpeechRuntimeConfig, SpeechRuntimeSessionConfig, SpeechToTextProvider, SpeechVadProvider, TextToSpeechProvider, WakeWordProvider } from './types.js';
export declare class SpeechRuntime {
    private readonly registry;
    private readonly preferredSttProviderId;
    private readonly preferredTtsProviderId;
    /** Prefer resolver-based provider resolution over direct registry lookups. */
    readonly resolver: SpeechProviderResolver;
    constructor(config?: SpeechRuntimeConfig);
    getProviderRegistry(): SpeechProviderRegistry;
    registerSttProvider(provider: SpeechToTextProvider): void;
    registerTtsProvider(provider: TextToSpeechProvider): void;
    registerVadProvider(provider: SpeechVadProvider): void;
    registerWakeWordProvider(provider: WakeWordProvider): void;
    hydrateFromExtensionManager(manager: ExtensionManager): void;
    /**
     * Resolve an STT provider via the new {@link SpeechProviderResolver}.
     * Returns `undefined` instead of throwing when no provider matches.
     */
    getSTT(requirements?: ProviderRequirements): SpeechToTextProvider | undefined;
    /**
     * Resolve a TTS provider via the new {@link SpeechProviderResolver}.
     * Returns `undefined` instead of throwing when no provider matches.
     */
    getTTS(requirements?: ProviderRequirements): TextToSpeechProvider | undefined;
    createSession(config?: SpeechRuntimeSessionConfig): SpeechSession;
    listProviders(): Array<SpeechProviderCatalogEntry & {
        registered: boolean;
    }>;
    getProvider(id: string): SpeechToTextProvider | TextToSpeechProvider | SpeechVadProvider | WakeWordProvider | undefined;
    private isProviderRegistered;
    /**
     * Bridge helper — registers a provider instance into the resolver with
     * sensible defaults derived from the static catalog.
     */
    private registerProviderInResolver;
    private resolveDefaultSttProvider;
    private resolveDefaultTtsProvider;
    private resolveDefaultVadProvider;
    private resolveDefaultWakeWordProvider;
}
export declare function createSpeechRuntime(config?: SpeechRuntimeConfig): SpeechRuntime;
export declare function createSpeechRuntimeFromEnv(env?: Record<string, string | undefined>, config?: Omit<SpeechRuntimeConfig, 'env'>): SpeechRuntime;
export declare function getDefaultSpeechProviderId(kind: 'stt' | 'tts'): string | undefined;
//# sourceMappingURL=SpeechRuntime.d.ts.map