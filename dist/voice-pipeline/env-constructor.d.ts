/**
 * @module voice-pipeline/env-constructor
 *
 * Batteries-included constructor for `StreamingSTTChain` +
 * `StreamingTTSChain`. Reads provider keys from an env-like object and
 * builds priority-ordered chains with shared circuit breaker and metrics
 * reporter. Host apps can skip the manual wiring and use this factory as
 * the default integration point.
 */
import { StreamingSTTChain } from './providers/StreamingSTTChain.js';
import { StreamingTTSChain } from './providers/StreamingTTSChain.js';
import { CircuitBreaker } from './CircuitBreaker.js';
import { VoiceMetricsReporter } from './VoiceMetricsReporter.js';
export declare class NoVoiceProvidersAvailableError extends Error {
    readonly checkedEnvVars: string[];
    constructor(checked: string[]);
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
export declare function createVoiceProvidersFromEnv(config?: VoiceProviderEnvConfig): VoiceProviderBundle;
//# sourceMappingURL=env-constructor.d.ts.map