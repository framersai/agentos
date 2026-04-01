export class SpeechProviderRegistry {
    constructor() {
        this.sttProviders = new Map();
        this.ttsProviders = new Map();
        this.vadProviders = new Map();
        this.wakeWordProviders = new Map();
    }
    registerSttProvider(provider) {
        this.sttProviders.set(provider.id, provider);
    }
    registerTtsProvider(provider) {
        this.ttsProviders.set(provider.id, provider);
    }
    registerVadProvider(provider) {
        this.vadProviders.set(provider.id, provider);
    }
    registerWakeWordProvider(provider) {
        this.wakeWordProviders.set(provider.id, provider);
    }
    getSttProvider(id) {
        return this.sttProviders.get(id);
    }
    getTtsProvider(id) {
        return this.ttsProviders.get(id);
    }
    getVadProvider(id) {
        return this.vadProviders.get(id);
    }
    getWakeWordProvider(id) {
        return this.wakeWordProviders.get(id);
    }
    list(kind) {
        switch (kind) {
            case 'stt':
                return [...this.sttProviders.values()];
            case 'tts':
                return [...this.ttsProviders.values()];
            case 'vad':
                return [...this.vadProviders.values()];
            case 'wake-word':
                return [...this.wakeWordProviders.values()];
            default:
                return [];
        }
    }
}
//# sourceMappingURL=SpeechProviderRegistry.js.map