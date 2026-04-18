/**
 * @module voice-pipeline/providers/StreamingSTTChain
 *
 * Priority-ordered fallback wrapper around multiple `IStreamingSTT`
 * providers. On `startSession()` the chain tries providers in priority
 * order; the first one whose `startSession()` resolves wins.
 * Init-failure classification records to the circuit breaker so future
 * sessions skip recently-tripped providers without the retry-latency
 * penalty.
 *
 * This file implements Layer 2 of the resilience plan (init-time
 * fallback). Layer 3 (mid-utterance failover via ring buffer) is added
 * in a later task and plugs into the `wrapSession` seam exposed here.
 */
import type { IStreamingSTT, StreamingSTTSession, StreamingSTTConfig } from '../types.js';
import type { HealthyProvider } from '../HealthyProvider.js';
import { type HealthErrorClass } from '../VoicePipelineError.js';
import type { CircuitBreaker } from '../CircuitBreaker.js';
import type { VoiceMetricsReporter } from '../VoiceMetricsReporter.js';
export interface ProviderSelectedEvent {
    kind: 'stt' | 'tts';
    providerId: string;
    attempt: number;
}
export interface ProviderFailedEvent {
    kind: 'stt' | 'tts';
    providerId: string;
    errorClass: HealthErrorClass;
    message: string;
}
export interface ProviderFailoverEvent {
    kind: 'stt' | 'tts';
    from: string;
    to: string;
    reason: HealthErrorClass;
    lostMs: number;
}
export interface StreamingSTTChainOptions {
    breaker?: CircuitBreaker;
    metrics?: VoiceMetricsReporter;
    onProviderSelected?: (event: ProviderSelectedEvent) => void;
    onProviderFailed?: (event: ProviderFailedEvent) => void;
    onProviderFailover?: (event: ProviderFailoverEvent) => void;
    /** When true, the chain tracks audio via a ring buffer and re-routes to
     *  the next backup on mid-session failure. Default: false. */
    enableMidUtteranceFailover?: boolean;
    /** Ring buffer capacity in ms for mid-utterance replay. Default 3000. */
    ringBufferCapacityMs?: number;
    /** Don't replay audio fragments shorter than this — just advance the
     *  next utterance to the backup. Default 400. */
    minReplayMs?: number;
}
type STTProvider = IStreamingSTT & HealthyProvider;
export declare class StreamingSTTChain implements IStreamingSTT {
    readonly providerId = "chain";
    readonly isStreaming = false;
    private readonly _providers;
    private readonly opts;
    private activeProviderId?;
    constructor(providers: STTProvider[], opts?: StreamingSTTChainOptions);
    /** Providers in priority order (primary first). Exposed for
     *  introspection by host apps and tests. */
    get providers(): readonly STTProvider[];
    get currentProviderId(): string | undefined;
    startSession(config?: StreamingSTTConfig): Promise<StreamingSTTSession>;
    private filterCandidates;
    /**
     * Wraps the session returned by a healthy provider. In init-time-only
     * mode (enableMidUtteranceFailover=false) this is a pass-through. In
     * failover mode the session is replaced with a facade that tees audio
     * into a ring buffer, dedupes transcripts across providers, and on
     * session error re-routes to the next candidate.
     */
    private wrapSession;
    private emitMetric;
}
export {};
//# sourceMappingURL=StreamingSTTChain.d.ts.map