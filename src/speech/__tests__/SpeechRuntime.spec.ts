import { describe, expect, it } from 'vitest';
import { ExtensionManager } from '../../extensions/ExtensionManager.js';
import { EXTENSION_KIND_TTS_PROVIDER } from '../../extensions/types.js';
import { SpeechRuntime } from '../SpeechRuntime.js';

describe('SpeechRuntime', () => {
  it('auto-registers built-in and env-backed providers', () => {
    const runtime = new SpeechRuntime({
      env: {
        OPENAI_API_KEY: 'sk-openai',
        ELEVENLABS_API_KEY: 'sk-elevenlabs',
      },
    });

    expect(runtime.getProvider('agentos-adaptive-vad')).toBeDefined();
    expect(runtime.getProvider('openai-whisper')).toBeDefined();
    expect(runtime.getProvider('openai-tts')).toBeDefined();
    expect(runtime.getProvider('elevenlabs')).toBeDefined();
  });

  it('hydrates speech providers from the extension manager', async () => {
    const manager = new ExtensionManager();
    await manager.getRegistry(EXTENSION_KIND_TTS_PROVIDER).register(
      {
        id: 'test-tts-descriptor',
        kind: EXTENSION_KIND_TTS_PROVIDER,
        payload: {
          id: 'test-tts',
          getProviderName: () => 'Test TTS',
          synthesize: async () => ({
            audioBuffer: Buffer.from('ok'),
            mimeType: 'audio/mpeg',
            cost: 0,
          }),
        },
      },
    );

    const runtime = new SpeechRuntime({ autoRegisterFromEnv: false });
    runtime.hydrateFromExtensionManager(manager);

    expect(runtime.getProvider('test-tts')).toBeDefined();
  });

  it('prefers configured provider ids before hardcoded defaults', async () => {
    const calls: string[] = [];
    const runtime = new SpeechRuntime({
      autoRegisterFromEnv: false,
      preferredSttProviderId: 'deepgram',
      preferredTtsProviderId: 'elevenlabs',
    });

    runtime.registerSttProvider({
      id: 'openai-whisper',
      getProviderName: () => 'OpenAI Whisper',
      transcribe: async () => {
        calls.push('openai-whisper');
        return { text: 'openai', cost: 0 };
      },
    });
    runtime.registerSttProvider({
      id: 'deepgram',
      getProviderName: () => 'Deepgram',
      transcribe: async () => {
        calls.push('deepgram');
        return { text: 'deepgram', cost: 0 };
      },
    });
    runtime.registerTtsProvider({
      id: 'openai-tts',
      getProviderName: () => 'OpenAI TTS',
      synthesize: async () => {
        calls.push('openai-tts');
        return { audioBuffer: Buffer.from('openai'), mimeType: 'audio/mpeg', cost: 0 };
      },
    });
    runtime.registerTtsProvider({
      id: 'elevenlabs',
      getProviderName: () => 'ElevenLabs',
      synthesize: async () => {
        calls.push('elevenlabs');
        return { audioBuffer: Buffer.from('elevenlabs'), mimeType: 'audio/mpeg', cost: 0 };
      },
    });

    const session = runtime.createSession();
    await session.speak('hello');
    await session.transcribeAudio(Buffer.from('wav'));

    expect(calls).toEqual(['elevenlabs', 'deepgram']);
  });
});
