/**
 * @module voice-pipeline/HealthyProvider
 *
 * Provider-health trait adopted by every STT/TTS implementation so chains
 * can prune, route, and circuit-break without peering into each provider's
 * private state.
 */
import type { HealthErrorClass } from './VoicePipelineError.js';
export interface ProviderCapabilities {
    /** ISO language tags supported; ['*'] for any language. */
    languages: string[];
    /** True if this provider streams; false for batch-only. */
    streaming: boolean;
    /** Known max concurrent sessions the provider allows; Infinity if unlimited. */
    maxConcurrent: number;
    /** Relative cost bucket. 'cheap' < 'standard' < 'premium'. */
    costTier: 'cheap' | 'standard' | 'premium';
    /** Expected latency class for real-time viability. */
    latencyClass: 'realtime' | 'near-realtime' | 'batch';
}
export interface HealthCheckResult {
    ok: boolean;
    latencyMs?: number;
    error?: {
        class: HealthErrorClass;
        message: string;
    };
}
export interface HealthyProvider {
    /** Unique, stable provider id; same value used in VoicePipelineError.provider. */
    readonly providerId: string;
    /** Lower = tried first. Apps may override via constructor option. */
    readonly priority: number;
    readonly capabilities: ProviderCapabilities;
    /**
     * Lightweight probe (should complete in under 1 second). Must NOT consume
     * billable audio or synthesis during a health check — it exists to verify
     * authentication and reachability, not to measure quality.
     */
    healthCheck(): Promise<HealthCheckResult>;
}
export declare function defaultCapabilities(overrides?: Partial<ProviderCapabilities>): ProviderCapabilities;
export declare function supportsLanguage(caps: ProviderCapabilities, lang: string): boolean;
//# sourceMappingURL=HealthyProvider.d.ts.map