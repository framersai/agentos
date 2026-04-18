/**
 * @module voice-pipeline/VoicePipelineError
 *
 * Structured error class for voice pipeline failures. Carries enough shape
 * for chains and circuit breakers to classify and react without stringly
 * matching error.message.
 */
export type HealthErrorClass = 'auth' | 'quota' | 'network' | 'service' | 'unknown';
export interface VoicePipelineErrorInit {
    kind: 'stt' | 'tts' | 'transport';
    provider: string;
    errorClass: HealthErrorClass;
    message: string;
    cause?: unknown;
    retryable: boolean;
}
export declare class VoicePipelineError extends Error {
    readonly kind: VoicePipelineErrorInit['kind'];
    readonly provider: string;
    readonly errorClass: HealthErrorClass;
    readonly retryable: boolean;
    readonly cause?: unknown;
    constructor(init: VoicePipelineErrorInit);
    /**
     * Best-effort classification of an arbitrary error into a voice-pipeline
     * error with a well-known errorClass. Preserves the original error as
     * `cause` so upstream inspection can still recover provider-specific
     * detail.
     */
    static classifyError(err: unknown, meta: {
        kind: VoicePipelineErrorInit['kind'];
        provider: string;
    }): VoicePipelineError;
}
/**
 * Aggregate thrown by `StreamingSTTChain` / `StreamingTTSChain` when every
 * candidate provider fails. Carries the per-provider error list so callers
 * can display a breakdown rather than a single confusing message.
 */
export declare class AggregateVoiceError extends Error {
    readonly attempts: VoicePipelineError[];
    constructor(attempts: VoicePipelineError[]);
}
//# sourceMappingURL=VoicePipelineError.d.ts.map