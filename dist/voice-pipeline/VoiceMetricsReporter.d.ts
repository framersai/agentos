/**
 * @module voice-pipeline/VoiceMetricsReporter
 *
 * Typed pub/sub bus for voice-pipeline lifecycle events. Chains and
 * circuit breakers emit structured events here; host applications
 * subscribe to forward them to clients (WebSocket frames), metrics
 * systems (Prometheus, Datadog), or logs.
 *
 * Listener errors are swallowed — one bad subscriber must not poison the
 * fan-out path for others.
 */
import type { HealthErrorClass } from './VoicePipelineError.js';
export type VoiceMetricEvent = {
    type: 'provider_selected';
    kind: 'stt' | 'tts';
    providerId: string;
    attempt: number;
} | {
    type: 'provider_failed';
    kind: 'stt' | 'tts';
    providerId: string;
    errorClass: HealthErrorClass;
    message: string;
} | {
    type: 'provider_failover';
    kind: 'stt' | 'tts';
    from: string;
    to: string;
    reason: HealthErrorClass;
    lostMs: number;
} | {
    type: 'provider_degraded';
    kind: 'stt' | 'tts';
    providerId: string;
    latencyMs: number;
    thresholdMs: number;
} | {
    type: 'provider_unavailable';
    kind: 'stt' | 'tts';
    checkedProviders: string[];
};
export type VoiceMetricListener = (event: VoiceMetricEvent) => void;
export declare class VoiceMetricsReporter {
    private readonly listeners;
    subscribe(fn: VoiceMetricListener): () => void;
    emit(event: VoiceMetricEvent): void;
}
//# sourceMappingURL=VoiceMetricsReporter.d.ts.map