/**
 * @module voice-pipeline/env-constructor
 *
 * Batteries-included constructor for `StreamingSTTChain` +
 * `StreamingTTSChain`. Reads provider keys from an env-like object and
 * builds priority-ordered chains with shared circuit breaker and metrics
 * reporter. Host apps can skip the manual wiring and use this factory as
 * the default integration point.
 */

import { DeepgramStreamingSTT } from './providers/DeepgramStreamingSTT.js';
import { ElevenLabsStreamingSTT } from './providers/ElevenLabsStreamingSTT.js';
import { ElevenLabsStreamingTTS } from './providers/ElevenLabsStreamingTTS.js';
import { OpenAIRealtimeTTS } from './providers/OpenAIRealtimeTTS.js';
import { ElevenLabsBatchTTS } from './providers/ElevenLabsBatchTTS.js';
import { OpenAIBatchTTS } from './providers/OpenAIBatchTTS.js';
import { StreamingSTTChain } from './providers/StreamingSTTChain.js';
import { StreamingTTSChain } from './providers/StreamingTTSChain.js';
import { CircuitBreaker } from './CircuitBreaker.js';
import { VoiceMetricsReporter } from './VoiceMetricsReporter.js';
import type { IStreamingSTT, IStreamingTTS } from './types.js';
import type { HealthyProvider } from './HealthyProvider.js';

export class NoVoiceProvidersAvailableError extends Error {
  readonly checkedEnvVars: string[];

  constructor(checked: string[]) {
    super(
      `No voice providers available. Set any of: ${checked.join(', ')} in the server env.`
    );
    this.name = 'NoVoiceProvidersAvailableError';
    this.checkedEnvVars = checked;
  }
}

export interface VoiceProviderEnvConfig {
  /** Environment source. Defaults to process.env. */
  env?: Record<string, string | undefined>;
  /** Prefer streaming-class providers for first-try. Default true. */
  preferStreaming?: boolean;
  /** Language hint — providers whose capabilities don't match are still
   *  included (capability filtering is host-app policy), but this value
   *  is passed through to StreamingTTSConfig / StreamingSTTConfig via
   *  startSession consumers. */
  languageHint?: string;
  /** Target cost tier. Reserved for future per-session routing; not used yet. */
  tier?: 'cheap' | 'standard' | 'premium';
  /** Whether the STT chain keeps a ring buffer + re-routes mid-utterance.
   *  Default true — this is the whole point of the resilience work. */
  enableMidUtteranceFailover?: boolean;
  /** Whether the TTS chain re-sends accumulated tokens on primary
   *  failure. Default true. */
  enableMidSynthesisFailover?: boolean;
}

export interface VoiceProviderBundle {
  stt: StreamingSTTChain;
  tts: StreamingTTSChain;
  metrics: VoiceMetricsReporter;
  breaker: CircuitBreaker;
  /** Release any global resources the bundle owns. Currently a no-op
   *  because sessions clean up themselves; exposed now so host apps can
   *  depend on the shape. */
  dispose(): Promise<void>;
}

export function createVoiceProvidersFromEnv(
  config: VoiceProviderEnvConfig = {}
): VoiceProviderBundle {
  const env = config.env ?? (globalThis.process?.env as Record<string, string | undefined>) ?? {};
  const checkedKeys = [
    'DEEPGRAM_API_KEY',
    'ELEVENLABS_API_KEY',
    'OPENAI_API_KEY',
  ];

  const deepgramKey = env['DEEPGRAM_API_KEY'];
  const elevenLabsKey = env['ELEVENLABS_API_KEY'];
  const openaiKey = env['OPENAI_API_KEY'];

  const metrics = new VoiceMetricsReporter();
  const breaker = new CircuitBreaker({
    failureThreshold: 3,
    windowMs: 60_000,
    cooldownMs: 60_000,
  });

  const sttProviders: Array<IStreamingSTT & HealthyProvider> = [];
  if (deepgramKey) {
    sttProviders.push(
      new DeepgramStreamingSTT({ apiKey: deepgramKey, priority: 10 })
    );
  }
  if (elevenLabsKey) {
    sttProviders.push(
      new ElevenLabsStreamingSTT({ apiKey: elevenLabsKey, priority: 20 })
    );
  }

  const ttsProviders: Array<IStreamingTTS & HealthyProvider> = [];
  if (elevenLabsKey) {
    ttsProviders.push(
      new ElevenLabsStreamingTTS({ apiKey: elevenLabsKey, priority: 10 })
    );
  }
  if (openaiKey) {
    ttsProviders.push(
      new OpenAIRealtimeTTS({ apiKey: openaiKey, priority: 20 })
    );
    ttsProviders.push(
      new OpenAIBatchTTS({ apiKey: openaiKey, priority: 90 }) as unknown as
        IStreamingTTS & HealthyProvider
    );
  }
  if (elevenLabsKey) {
    ttsProviders.push(
      new ElevenLabsBatchTTS({ apiKey: elevenLabsKey, priority: 80 }) as unknown as
        IStreamingTTS & HealthyProvider
    );
  }

  if (sttProviders.length === 0 || ttsProviders.length === 0) {
    throw new NoVoiceProvidersAvailableError(checkedKeys);
  }

  const stt = new StreamingSTTChain(sttProviders, {
    breaker,
    metrics,
    enableMidUtteranceFailover: config.enableMidUtteranceFailover ?? true,
    ringBufferCapacityMs: 3000,
  });
  const tts = new StreamingTTSChain(ttsProviders, {
    breaker,
    metrics,
    enableMidSynthesisFailover: config.enableMidSynthesisFailover ?? true,
  });

  return {
    stt,
    tts,
    metrics,
    breaker,
    async dispose() {
      /* Sessions clean themselves up; nothing global to release today. */
    },
  };
}
