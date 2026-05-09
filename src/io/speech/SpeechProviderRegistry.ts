import type {
  SpeechProviderKind,
  SpeechToTextProvider,
  SpeechVadProvider,
  TextToSpeechProvider,
  WakeWordProvider,
} from './types.js';

export class SpeechProviderRegistry {
  private readonly sttProviders = new Map<string, SpeechToTextProvider>();
  private readonly ttsProviders = new Map<string, TextToSpeechProvider>();
  private readonly vadProviders = new Map<string, SpeechVadProvider>();
  private readonly wakeWordProviders = new Map<string, WakeWordProvider>();

  registerSttProvider(provider: SpeechToTextProvider): void {
    this.sttProviders.set(provider.id, provider);
  }

  registerTtsProvider(provider: TextToSpeechProvider): void {
    this.ttsProviders.set(provider.id, provider);
  }

  registerVadProvider(provider: SpeechVadProvider): void {
    this.vadProviders.set(provider.id, provider);
  }

  registerWakeWordProvider(provider: WakeWordProvider): void {
    this.wakeWordProviders.set(provider.id, provider);
  }

  getSttProvider(id: string): SpeechToTextProvider | undefined {
    return this.sttProviders.get(id);
  }

  getTtsProvider(id: string): TextToSpeechProvider | undefined {
    return this.ttsProviders.get(id);
  }

  getVadProvider(id: string): SpeechVadProvider | undefined {
    return this.vadProviders.get(id);
  }

  getWakeWordProvider(id: string): WakeWordProvider | undefined {
    return this.wakeWordProviders.get(id);
  }

  list(kind: SpeechProviderKind): Array<
    SpeechToTextProvider | TextToSpeechProvider | SpeechVadProvider | WakeWordProvider
  > {
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
