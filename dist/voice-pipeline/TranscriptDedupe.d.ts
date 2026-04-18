/**
 * @module voice-pipeline/TranscriptDedupe
 *
 * Duplicate-transcript detector used by StreamingSTTChain after a mid-
 * utterance failover. The backup provider replays the ring buffer and
 * re-transcribes audio the primary already saw; without dedupe the session
 * sees "hello world" twice.
 *
 * Dedupe signal: audio-clock overlap (primary fact) + fuzzy string match
 * (tie-breaker). Two transcripts overlap if their [audioStartMs, audioEndMs]
 * ranges intersect; when they do, we compare normalized text.
 *
 * Same-provider observations are never considered duplicates — interim
 * transcripts from a single streaming provider are part of its protocol.
 */
export interface TranscriptObservation {
    provider: string;
    text: string;
    audioStartMs: number;
    audioEndMs: number;
    isFinal: boolean;
}
export interface DedupeResult {
    isDuplicate: boolean;
    reason?: 'exact' | 'fuzzy' | 'superset';
    against?: {
        provider: string;
        text: string;
    };
}
export declare class TranscriptDedupe {
    private recent;
    private readonly fuzzyThreshold;
    private readonly retainMs;
    constructor(opts?: {
        fuzzyThreshold?: number;
        retainMs?: number;
    });
    evaluate(obs: TranscriptObservation): DedupeResult;
    reset(): void;
    private prune;
}
//# sourceMappingURL=TranscriptDedupe.d.ts.map