/**
 * @module voice-pipeline/providers/BatchTTSFallback
 *
 * Wraps multiple {@link IBatchTTS} providers in priority order.
 * Tries each in sequence; returns the first successful result.
 * Throws an aggregate error if all providers fail.
 */
import type { IBatchTTS, BatchTTSConfig, BatchTTSResult } from '../types.js';
export declare class BatchTTSFallback implements IBatchTTS {
    readonly providerId = "fallback";
    private readonly providers;
    constructor(providers: IBatchTTS[]);
    synthesize(text: string, config?: BatchTTSConfig): Promise<BatchTTSResult>;
}
//# sourceMappingURL=BatchTTSFallback.d.ts.map