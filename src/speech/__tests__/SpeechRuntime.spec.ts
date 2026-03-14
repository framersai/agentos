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
});
