/**
 * @module voice-pipeline/AudioRingBuffer
 *
 * Fixed-capacity PCM ring buffer keyed by wall-clock timestamp. Used by
 * StreamingSTTChain to replay the last ~capacityMs of audio into a backup
 * provider when the primary fails mid-utterance.
 *
 * The buffer treats each AudioFrame as atomic — it never splits frames —
 * so durationMs() may exceed capacityMs by up to one frame's worth of
 * audio until the next push. For a 20 ms frame size and a 3000 ms
 * capacity this overshoot is negligible.
 */
import type { AudioFrame } from './types.js';
export interface AudioRingBufferOptions {
    capacityMs: number;
    sampleRate: number;
}
export declare class AudioRingBuffer {
    private readonly capacityMs;
    private frames;
    constructor(opts: AudioRingBufferOptions);
    push(frame: AudioFrame): void;
    snapshot(): AudioFrame[];
    durationMs(): number;
    clear(): void;
    private frameDurationMs;
}
//# sourceMappingURL=AudioRingBuffer.d.ts.map