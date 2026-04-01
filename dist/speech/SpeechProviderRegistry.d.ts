import type { SpeechProviderKind, SpeechToTextProvider, SpeechVadProvider, TextToSpeechProvider, WakeWordProvider } from './types.js';
export declare class SpeechProviderRegistry {
    private readonly sttProviders;
    private readonly ttsProviders;
    private readonly vadProviders;
    private readonly wakeWordProviders;
    registerSttProvider(provider: SpeechToTextProvider): void;
    registerTtsProvider(provider: TextToSpeechProvider): void;
    registerVadProvider(provider: SpeechVadProvider): void;
    registerWakeWordProvider(provider: WakeWordProvider): void;
    getSttProvider(id: string): SpeechToTextProvider | undefined;
    getTtsProvider(id: string): TextToSpeechProvider | undefined;
    getVadProvider(id: string): SpeechVadProvider | undefined;
    getWakeWordProvider(id: string): WakeWordProvider | undefined;
    list(kind: SpeechProviderKind): Array<SpeechToTextProvider | TextToSpeechProvider | SpeechVadProvider | WakeWordProvider>;
}
//# sourceMappingURL=SpeechProviderRegistry.d.ts.map