/**
 * @module voice-pipeline/providers/StreamingTTSChain
 *
 * Priority-ordered fallback wrapper around multiple `IStreamingTTS`
 * providers. Mirrors `StreamingSTTChain` semantics for outbound synthesis.
 *
 * Mid-synthesis failover is simpler than mid-utterance STT failover
 * because TTS is one-way (text in, audio out). The chain accumulates
 * tokens pushed to the primary and, on primary failure, re-sends them
 * to the backup. Clients may use the first backup audio chunk's
 * `fadeInMs` hint to crossfade between timbres.
 */
import type { IStreamingTTS, StreamingTTSSession, StreamingTTSConfig } from '../types.js';
import type { HealthyProvider } from '../HealthyProvider.js';
import { type HealthErrorClass } from '../VoicePipelineError.js';
import type { CircuitBreaker } from '../CircuitBreaker.js';
import type { VoiceMetricsReporter } from '../VoiceMetricsReporter.js';
export interface TTSProviderSelectedEvent {
    kind: 'tts';
    providerId: string;
    attempt: number;
}
export interface TTSProviderFailedEvent {
    kind: 'tts';
    providerId: string;
    errorClass: HealthErrorClass;
    message: string;
}
export interface TTSProviderFailoverEvent {
    kind: 'tts';
    from: string;
    to: string;
    reason: HealthErrorClass;
    lostMs: number;
}
export interface StreamingTTSChainOptions {
    breaker?: CircuitBreaker;
    metrics?: VoiceMetricsReporter;
    onProviderSelected?: (event: TTSProviderSelectedEvent) => void;
    onProviderFailed?: (event: TTSProviderFailedEvent) => void;
    onProviderFailover?: (event: TTSProviderFailoverEvent) => void;
    /** When true, the chain tracks accumulated tokens and re-submits them
     *  to the next backup if the primary errors mid-synthesis. */
    enableMidSynthesisFailover?: boolean;
}
type TTSProvider = IStreamingTTS & HealthyProvider;
export declare class StreamingTTSChain implements IStreamingTTS {
    readonly providerId = "chain";
    private readonly _providers;
    private readonly opts;
    private activeProviderId?;
    constructor(providers: TTSProvider[], opts?: StreamingTTSChainOptions);
    get providers(): readonly TTSProvider[];
    get currentProviderId(): string | undefined;
    startSession(config?: StreamingTTSConfig): Promise<StreamingTTSSession>;
    private filterCandidates;
    /**
     * Wraps a session for mid-synthesis failover. The facade tees pushTokens
     * calls into an accumulator and, when the primary emits 'error',
     * opens a new session on the next backup and replays the accumulator
     * before returning control.
     */
    private wrapSession;
    private emitMetric;
}
export {};
//# sourceMappingURL=StreamingTTSChain.d.ts.map