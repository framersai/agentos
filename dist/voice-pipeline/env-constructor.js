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
export class NoVoiceProvidersAvailableError extends Error {
    constructor(checked) {
        super(`No voice providers available. Set any of: ${checked.join(', ')} in the server env.`);
        this.name = 'NoVoiceProvidersAvailableError';
        this.checkedEnvVars = checked;
    }
}
export function createVoiceProvidersFromEnv(config = {}) {
    const env = config.env ?? globalThis.process?.env ?? {};
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
        windowMs: 60000,
        cooldownMs: 60000,
    });
    const sttProviders = [];
    if (deepgramKey) {
        sttProviders.push(new DeepgramStreamingSTT({ apiKey: deepgramKey, priority: 10 }));
    }
    if (elevenLabsKey) {
        sttProviders.push(new ElevenLabsStreamingSTT({ apiKey: elevenLabsKey, priority: 20 }));
    }
    const ttsProviders = [];
    if (elevenLabsKey) {
        ttsProviders.push(new ElevenLabsStreamingTTS({ apiKey: elevenLabsKey, priority: 10 }));
    }
    if (openaiKey) {
        ttsProviders.push(new OpenAIRealtimeTTS({ apiKey: openaiKey, priority: 20 }));
        ttsProviders.push(new OpenAIBatchTTS({ apiKey: openaiKey, priority: 90 }));
    }
    if (elevenLabsKey) {
        ttsProviders.push(new ElevenLabsBatchTTS({ apiKey: elevenLabsKey, priority: 80 }));
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
//# sourceMappingURL=env-constructor.js.map