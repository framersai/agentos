import { EXTENSION_KIND_STT_PROVIDER, EXTENSION_KIND_TTS_PROVIDER, EXTENSION_KIND_VAD_PROVIDER, EXTENSION_KIND_WAKE_WORD_PROVIDER, } from '../extensions/types.js';
import { findSpeechProviderCatalogEntry, getSpeechProviderCatalog } from './providerCatalog.js';
import { SpeechProviderRegistry } from './SpeechProviderRegistry.js';
import { SpeechProviderResolver } from './SpeechProviderResolver.js';
import { SpeechSession } from './SpeechSession.js';
import { BuiltInAdaptiveVadProvider } from '../hearing/providers/BuiltInAdaptiveVadProvider.js';
import { ElevenLabsTextToSpeechProvider } from './providers/ElevenLabsTextToSpeechProvider.js';
import { OpenAITextToSpeechProvider } from './providers/OpenAITextToSpeechProvider.js';
import { OpenAIWhisperSpeechToTextProvider } from '../hearing/providers/OpenAIWhisperSpeechToTextProvider.js';
export class SpeechRuntime {
    constructor(config = {}) {
        const env = config.env ?? process.env;
        /* Build resolver config from legacy preferred-provider fields. */
        const resolverConfig = {};
        if (config.preferredSttProviderId) {
            resolverConfig.stt = { preferred: [config.preferredSttProviderId] };
        }
        if (config.preferredTtsProviderId) {
            resolverConfig.tts = { preferred: [config.preferredTtsProviderId] };
        }
        this.resolver = new SpeechProviderResolver(resolverConfig, env);
        this.registry = new SpeechProviderRegistry();
        this.preferredSttProviderId =
            typeof config.preferredSttProviderId === 'string' && config.preferredSttProviderId.trim()
                ? config.preferredSttProviderId.trim()
                : undefined;
        this.preferredTtsProviderId =
            typeof config.preferredTtsProviderId === 'string' && config.preferredTtsProviderId.trim()
                ? config.preferredTtsProviderId.trim()
                : undefined;
        /* VAD — always registered. */
        const vadProvider = new BuiltInAdaptiveVadProvider();
        this.registry.registerVadProvider(vadProvider);
        this.registerProviderInResolver(vadProvider, 'vad');
        if (config.autoRegisterFromEnv !== false) {
            const openaiApiKey = env['OPENAI_API_KEY'];
            if (openaiApiKey) {
                const stt = new OpenAIWhisperSpeechToTextProvider({
                    apiKey: openaiApiKey,
                    model: env['WHISPER_MODEL_DEFAULT'] ?? 'whisper-1',
                });
                this.registry.registerSttProvider(stt);
                this.registerProviderInResolver(stt, 'stt');
                const tts = new OpenAITextToSpeechProvider({
                    apiKey: openaiApiKey,
                    model: env['OPENAI_TTS_DEFAULT_MODEL'] ?? 'tts-1',
                    voice: env['OPENAI_TTS_DEFAULT_VOICE'] ?? 'nova',
                });
                this.registry.registerTtsProvider(tts);
                this.registerProviderInResolver(tts, 'tts');
            }
            const elevenLabsApiKey = env['ELEVENLABS_API_KEY'];
            if (elevenLabsApiKey) {
                const tts = new ElevenLabsTextToSpeechProvider({
                    apiKey: elevenLabsApiKey,
                    model: env['ELEVENLABS_TTS_MODEL'] ?? 'eleven_multilingual_v2',
                    voiceId: env['ELEVENLABS_VOICE_ID'],
                });
                this.registry.registerTtsProvider(tts);
                this.registerProviderInResolver(tts, 'tts');
            }
        }
    }
    getProviderRegistry() {
        return this.registry;
    }
    registerSttProvider(provider) {
        this.registry.registerSttProvider(provider);
    }
    registerTtsProvider(provider) {
        this.registry.registerTtsProvider(provider);
    }
    registerVadProvider(provider) {
        this.registry.registerVadProvider(provider);
    }
    registerWakeWordProvider(provider) {
        this.registry.registerWakeWordProvider(provider);
    }
    hydrateFromExtensionManager(manager) {
        for (const descriptor of manager
            .getRegistry(EXTENSION_KIND_STT_PROVIDER)
            .listActive()) {
            this.registry.registerSttProvider(descriptor.payload);
            this.registerProviderInResolver(descriptor.payload, 'stt', 'extension');
        }
        for (const descriptor of manager
            .getRegistry(EXTENSION_KIND_TTS_PROVIDER)
            .listActive()) {
            this.registry.registerTtsProvider(descriptor.payload);
            this.registerProviderInResolver(descriptor.payload, 'tts', 'extension');
        }
        for (const descriptor of manager
            .getRegistry(EXTENSION_KIND_VAD_PROVIDER)
            .listActive()) {
            this.registry.registerVadProvider(descriptor.payload);
            this.registerProviderInResolver(descriptor.payload, 'vad', 'extension');
        }
        for (const descriptor of manager
            .getRegistry(EXTENSION_KIND_WAKE_WORD_PROVIDER)
            .listActive()) {
            this.registry.registerWakeWordProvider(descriptor.payload);
            this.registerProviderInResolver(descriptor.payload, 'wake-word', 'extension');
        }
    }
    /**
     * Resolve an STT provider via the new {@link SpeechProviderResolver}.
     * Returns `undefined` instead of throwing when no provider matches.
     */
    getSTT(requirements) {
        try {
            return this.resolver.resolveSTT(requirements);
        }
        catch {
            return undefined;
        }
    }
    /**
     * Resolve a TTS provider via the new {@link SpeechProviderResolver}.
     * Returns `undefined` instead of throwing when no provider matches.
     */
    getTTS(requirements) {
        try {
            return this.resolver.resolveTTS(requirements);
        }
        catch {
            return undefined;
        }
    }
    createSession(config = {}) {
        const providers = {
            stt: config.sttProviderId
                ? this.registry.getSttProvider(config.sttProviderId)
                : this.resolveDefaultSttProvider(),
            tts: config.ttsProviderId
                ? this.registry.getTtsProvider(config.ttsProviderId)
                : this.resolveDefaultTtsProvider(),
            vad: config.vadProviderId
                ? this.registry.getVadProvider(config.vadProviderId)
                : this.resolveDefaultVadProvider(),
            wakeWord: config.wakeWordProviderId
                ? this.registry.getWakeWordProvider(config.wakeWordProviderId)
                : this.resolveDefaultWakeWordProvider(),
        };
        return new SpeechSession(config, providers);
    }
    listProviders() {
        return getSpeechProviderCatalog().map((entry) => ({
            ...entry,
            registered: this.isProviderRegistered(entry),
        }));
    }
    getProvider(id) {
        return (this.registry.getSttProvider(id) ??
            this.registry.getTtsProvider(id) ??
            this.registry.getVadProvider(id) ??
            this.registry.getWakeWordProvider(id));
    }
    isProviderRegistered(entry) {
        switch (entry.kind) {
            case 'stt':
                return Boolean(this.registry.getSttProvider(entry.id));
            case 'tts':
                return Boolean(this.registry.getTtsProvider(entry.id));
            case 'vad':
                return Boolean(this.registry.getVadProvider(entry.id));
            case 'wake-word':
                return Boolean(this.registry.getWakeWordProvider(entry.id));
            default:
                return false;
        }
    }
    /**
     * Bridge helper — registers a provider instance into the resolver with
     * sensible defaults derived from the static catalog.
     */
    registerProviderInResolver(provider, kind, source = 'core') {
        const catalogEntry = findSpeechProviderCatalogEntry(provider.id) ?? {
            id: provider.id,
            kind,
            label: provider.getProviderName?.() ?? provider.id,
            envVars: [],
            local: false,
            description: '',
        };
        this.resolver.register({
            id: provider.id,
            kind,
            provider: provider,
            catalogEntry,
            isConfigured: true,
            priority: source === 'extension' ? 200 : 100,
            source,
        });
    }
    resolveDefaultSttProvider() {
        if (this.preferredSttProviderId) {
            const preferred = this.registry.getSttProvider(this.preferredSttProviderId);
            if (preferred)
                return preferred;
        }
        return (this.registry.getSttProvider('openai-whisper') ??
            this.registry.list('stt')[0]);
    }
    resolveDefaultTtsProvider() {
        if (this.preferredTtsProviderId) {
            const preferred = this.registry.getTtsProvider(this.preferredTtsProviderId);
            if (preferred)
                return preferred;
        }
        return (this.registry.getTtsProvider('openai-tts') ??
            this.registry.getTtsProvider('elevenlabs') ??
            this.registry.list('tts')[0]);
    }
    resolveDefaultVadProvider() {
        return (this.registry.getVadProvider('agentos-adaptive-vad') ??
            this.registry.list('vad')[0]);
    }
    resolveDefaultWakeWordProvider() {
        return this.registry.list('wake-word')[0];
    }
}
export function createSpeechRuntime(config = {}) {
    return new SpeechRuntime(config);
}
export function createSpeechRuntimeFromEnv(env = process.env, config = {}) {
    return new SpeechRuntime({
        ...config,
        autoRegisterFromEnv: config.autoRegisterFromEnv ?? true,
        env,
    });
}
export function getDefaultSpeechProviderId(kind) {
    if (kind === 'stt') {
        return findSpeechProviderCatalogEntry('openai-whisper')?.id;
    }
    return findSpeechProviderCatalogEntry('openai-tts')?.id;
}
//# sourceMappingURL=SpeechRuntime.js.map