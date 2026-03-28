export * from './types.js';
export * from './audio.js';
export * from './providerCatalog.js';
export * from './SpeechProviderRegistry.js';
export * from './SpeechProviderResolver.js';
export * from './FallbackProxy.js';
export * from './SpeechSession.js';
export * from './SpeechRuntime.js';
export * from './providers/OpenAITextToSpeechProvider.js';
export * from './providers/ElevenLabsTextToSpeechProvider.js';
export * from './providers/AzureSpeechTTSProvider.js';
// STT/VAD providers have moved to the hearing/ module
export * from '../hearing/providers/OpenAIWhisperSpeechToTextProvider.js';
export * from '../hearing/providers/BuiltInAdaptiveVadProvider.js';
export * from '../hearing/providers/DeepgramBatchSTTProvider.js';
export * from '../hearing/providers/AssemblyAISTTProvider.js';
export * from '../hearing/providers/AzureSpeechSTTProvider.js';
