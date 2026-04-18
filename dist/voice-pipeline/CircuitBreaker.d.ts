/**
 * @module voice-pipeline/CircuitBreaker
 *
 * Per-provider state machine: tracks failures within a sliding window, trips
 * when the failure count crosses a threshold, and auto-recovers after a
 * cooldown. Auth failures trip permanently (cooldown = Infinity) because a
 * bad API key won't fix itself without operator intervention.
 */
import type { HealthErrorClass } from './VoicePipelineError.js';
export type BreakerState = 'healthy' | 'tripped';
export interface CircuitBreakerOptions {
    failureThreshold: number;
    windowMs: number;
    cooldownMs: number;
    now?: () => number;
}
export interface StateChangeEvent {
    providerId: string;
    from: BreakerState;
    to: BreakerState;
    reason?: HealthErrorClass | 'recover';
}
export declare class CircuitBreaker {
    private readonly failureThreshold;
    private readonly windowMs;
    private readonly cooldownMs;
    private readonly nowFn;
    private readonly records;
    private readonly listeners;
    constructor(opts: CircuitBreakerOptions);
    state(providerId: string): BreakerState;
    isAvailable(providerId: string): boolean;
    recordFailure(providerId: string, reason: HealthErrorClass): void;
    recordSuccess(providerId: string): void;
    /** Force a state-transition pass for all tracked providers. Useful when
     *  the caller wants to drive recoveries on a timer. */
    tick(_nowHint?: number): void;
    onStateChange(fn: (event: StateChangeEvent) => void): () => void;
    private getOrCreate;
    private transition;
}
//# sourceMappingURL=CircuitBreaker.d.ts.map