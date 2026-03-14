import type { ExtensionManager } from '../extensions/ExtensionManager.js';
import {
  EXTENSION_KIND_STT_PROVIDER,
  EXTENSION_KIND_TTS_PROVIDER,
  EXTENSION_KIND_VAD_PROVIDER,
  EXTENSION_KIND_WAKE_WORD_PROVIDER,
} from '../extensions/types.js';
import { findSpeechProviderCatalogEntry, getSpeechProviderCatalog } from './providerCatalog.js';
import { SpeechProviderRegistry } from './SpeechProviderRegistry.js';
import { SpeechSession } from './SpeechSession.js';
import { BuiltInAdaptiveVadProvider } from './providers/BuiltInAdaptiveVadProvider.js';
import { ElevenLabsTextToSpeechProvider } from './providers/ElevenLabsTextToSpeechProvider.js';
import { OpenAITextToSpeechProvider } from './providers/OpenAITextToSpeechProvider.js';
import { OpenAIWhisperSpeechToTextProvider } from './providers/OpenAIWhisperSpeechToTextProvider.js';
import type {
  SpeechProviderCatalogEntry,
  SpeechRuntimeConfig,
  SpeechRuntimeSessionConfig,
  SpeechToTextProvider,
  SpeechVadProvider,
  TextToSpeechProvider,
  WakeWordProvider,
} from './types.js';

export class SpeechRuntime {
  private readonly registry: SpeechProviderRegistry;

  constructor(config: SpeechRuntimeConfig = {}) {
    this.registry = new SpeechProviderRegistry();
    this.registry.registerVadProvider(new BuiltInAdaptiveVadProvider());
    if (config.autoRegisterFromEnv !== false) {
      const env = config.env ?? process.env;
      const openaiApiKey = env['OPENAI_API_KEY'];
      if (openaiApiKey) {
        this.registry.registerSttProvider(
          new OpenAIWhisperSpeechToTextProvider({
            apiKey: openaiApiKey,
            model: env['WHISPER_MODEL_DEFAULT'] ?? 'whisper-1',
          })
        );
        this.registry.registerTtsProvider(
          new OpenAITextToSpeechProvider({
            apiKey: openaiApiKey,
            model: env['OPENAI_TTS_DEFAULT_MODEL'] ?? 'tts-1',
            voice: env['OPENAI_TTS_DEFAULT_VOICE'] ?? 'nova',
          })
        );
      }

      const elevenLabsApiKey = env['ELEVENLABS_API_KEY'];
      if (elevenLabsApiKey) {
        this.registry.registerTtsProvider(
          new ElevenLabsTextToSpeechProvider({
            apiKey: elevenLabsApiKey,
            model: env['ELEVENLABS_TTS_MODEL'] ?? 'eleven_multilingual_v2',
            voiceId: env['ELEVENLABS_VOICE_ID'],
          })
        );
      }
    }
  }

  getProviderRegistry(): SpeechProviderRegistry {
    return this.registry;
  }

  registerSttProvider(provider: SpeechToTextProvider): void {
    this.registry.registerSttProvider(provider);
  }

  registerTtsProvider(provider: TextToSpeechProvider): void {
    this.registry.registerTtsProvider(provider);
  }

  registerVadProvider(provider: SpeechVadProvider): void {
    this.registry.registerVadProvider(provider);
  }

  registerWakeWordProvider(provider: WakeWordProvider): void {
    this.registry.registerWakeWordProvider(provider);
  }

  hydrateFromExtensionManager(manager: ExtensionManager): void {
    for (const descriptor of manager.getRegistry<SpeechToTextProvider>(EXTENSION_KIND_STT_PROVIDER).listActive()) {
      this.registry.registerSttProvider(descriptor.payload);
    }
    for (const descriptor of manager.getRegistry<TextToSpeechProvider>(EXTENSION_KIND_TTS_PROVIDER).listActive()) {
      this.registry.registerTtsProvider(descriptor.payload);
    }
    for (const descriptor of manager.getRegistry<SpeechVadProvider>(EXTENSION_KIND_VAD_PROVIDER).listActive()) {
      this.registry.registerVadProvider(descriptor.payload);
    }
    for (const descriptor of manager.getRegistry<WakeWordProvider>(EXTENSION_KIND_WAKE_WORD_PROVIDER).listActive()) {
      this.registry.registerWakeWordProvider(descriptor.payload);
    }
  }

  createSession(config: SpeechRuntimeSessionConfig = {}): SpeechSession {
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

  listProviders(): Array<SpeechProviderCatalogEntry & { registered: boolean }> {
    return getSpeechProviderCatalog().map((entry) => ({
      ...entry,
      registered: this.isProviderRegistered(entry),
    }));
  }

  getProvider(id: string):
    | SpeechToTextProvider
    | TextToSpeechProvider
    | SpeechVadProvider
    | WakeWordProvider
    | undefined {
    return (
      this.registry.getSttProvider(id) ??
      this.registry.getTtsProvider(id) ??
      this.registry.getVadProvider(id) ??
      this.registry.getWakeWordProvider(id)
    );
  }

  private isProviderRegistered(entry: SpeechProviderCatalogEntry): boolean {
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

  private resolveDefaultSttProvider(): SpeechToTextProvider | undefined {
    return (
      this.registry.getSttProvider('openai-whisper') ??
      (this.registry.list('stt')[0] as SpeechToTextProvider | undefined)
    );
  }

  private resolveDefaultTtsProvider(): TextToSpeechProvider | undefined {
    return (
      this.registry.getTtsProvider('openai-tts') ??
      this.registry.getTtsProvider('elevenlabs') ??
      (this.registry.list('tts')[0] as TextToSpeechProvider | undefined)
    );
  }

  private resolveDefaultVadProvider(): SpeechVadProvider | undefined {
    return (
      this.registry.getVadProvider('agentos-adaptive-vad') ??
      (this.registry.list('vad')[0] as SpeechVadProvider | undefined)
    );
  }

  private resolveDefaultWakeWordProvider(): WakeWordProvider | undefined {
    return this.registry.list('wake-word')[0] as WakeWordProvider | undefined;
  }
}

export function createSpeechRuntime(config: SpeechRuntimeConfig = {}): SpeechRuntime {
  return new SpeechRuntime(config);
}

export function createSpeechRuntimeFromEnv(
  env: Record<string, string | undefined> = process.env
): SpeechRuntime {
  return new SpeechRuntime({ autoRegisterFromEnv: true, env });
}

export function getDefaultSpeechProviderId(kind: 'stt' | 'tts'): string | undefined {
  if (kind === 'stt') {
    return findSpeechProviderCatalogEntry('openai-whisper')?.id;
  }
  return findSpeechProviderCatalogEntry('openai-tts')?.id;
}
