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
export class AudioRingBuffer {
    constructor(opts) {
        this.frames = [];
        this.capacityMs = opts.capacityMs;
    }
    push(frame) {
        this.frames.push(frame);
        // Always keep at least one frame. Without this guard a pathologically
        // small capacity (e.g. 1 ms) would evict every push immediately.
        while (this.frames.length > 1 && this.durationMs() > this.capacityMs) {
            this.frames.shift();
        }
    }
    snapshot() {
        return [...this.frames];
    }
    durationMs() {
        if (this.frames.length === 0)
            return 0;
        const first = this.frames[0];
        const last = this.frames[this.frames.length - 1];
        return last.timestamp - first.timestamp + this.frameDurationMs(last);
    }
    clear() {
        this.frames = [];
    }
    frameDurationMs(frame) {
        return (frame.samples.length / frame.sampleRate) * 1000;
    }
}
//# sourceMappingURL=AudioRingBuffer.js.map