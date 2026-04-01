/**
 * @module voice-pipeline/AcousticEndpointDetector
 *
 * Acoustic-only endpoint detector that wraps {@link SilenceDetector} to convert
 * VAD events into turn-completion decisions. It ignores transcript content entirely
 * and relies solely on the duration of post-speech silence to decide when the user
 * has finished speaking.
 *
 * ## How it works
 *
 * This detector delegates all silence timing to a {@link SilenceDetector} instance
 * (from `media/audio/`). The SilenceDetector maintains an internal timer that
 * starts when `handleSpeechEnd()` is called and fires `'utterance_end_detected'`
 * when silence exceeds the configured `utteranceEndThresholdMs`. A
 * `handleSpeechStart()` call cancels the timer.
 *
 * ## Energy threshold adaptation
 *
 * The SilenceDetector internally uses adaptive energy thresholds from the
 * {@link AdaptiveVAD}. The VAD continuously recalibrates its speech/silence
 * boundary based on ambient noise levels, so the effective silence threshold
 * adapts to the environment (e.g. coffee shop vs quiet room). This detector
 * does not perform its own energy analysis -- it trusts the upstream VAD's
 * speech_start/speech_end decisions.
 *
 * ## When to use
 *
 * Use this detector when:
 * - The STT provider does not produce reliable punctuation.
 * - You want the simplest possible endpoint detection with no linguistic analysis.
 * - Latency tolerance is higher (the full `utteranceEndThresholdMs` is always
 *   consumed, unlike the {@link HeuristicEndpointDetector} which can fire
 *   immediately on terminal punctuation).
 *
 * @see {@link HeuristicEndpointDetector} for the rule-based alternative with
 *   punctuation-triggered fast path.
 * @see {@link IEndpointDetector} for the interface contract.
 * @see {@link SilenceDetector} for the underlying silence timing logic.
 *
 * ## Events emitted
 *
 * | Event             | Payload                  | Description                                 |
 * |-------------------|--------------------------|---------------------------------------------|
 * | `'turn_complete'` | {@link TurnCompleteEvent} | Silence exceeded `utteranceEndThresholdMs`. |
 * | `'speech_start'`  | *(none)*                 | Re-emitted from incoming VAD event.         |
 */
import { EventEmitter } from 'node:events';
import type { IEndpointDetector, VadEvent, TranscriptEvent } from './types.js';
/**
 * Constructor options for {@link AcousticEndpointDetector}.
 *
 * @example
 * ```typescript
 * const detector = new AcousticEndpointDetector({
 *   significantPauseThresholdMs: 1000,
 *   utteranceEndThresholdMs: 2000,
 * });
 * ```
 */
export interface AcousticEndpointDetectorConfig {
    /**
     * Silence duration after speech (ms) that triggers a "significant pause"
     * notification on the underlying {@link SilenceDetector}. Does not directly
     * cause `turn_complete` to fire, but can be used by other pipeline components
     * to show a "thinking" indicator.
     * @defaultValue 1500
     */
    significantPauseThresholdMs?: number;
    /**
     * Silence duration after speech (ms) that triggers `turn_complete` with
     * `reason: 'silence_timeout'`. This is the primary tuning knob for how
     * long the pipeline waits after the user stops speaking.
     *
     * - Lower values (1000-2000 ms): Faster response, but may fire during natural pauses.
     * - Higher values (3000-5000 ms): More tolerant of pauses, but feels sluggish.
     *
     * @defaultValue 3000
     */
    utteranceEndThresholdMs?: number;
}
/**
 * Purely acoustic endpoint detector.
 *
 * Delegates silence timing to a {@link SilenceDetector} instance. VAD
 * `speech_end` events start the silence clock; `speech_start` events cancel
 * any pending turn-complete emission. Transcript content is completely ignored.
 *
 * @see {@link IEndpointDetector} for the interface contract.
 * @see {@link HeuristicEndpointDetector} for the heuristic alternative.
 *
 * @example
 * ```typescript
 * const detector = new AcousticEndpointDetector({ utteranceEndThresholdMs: 2000 });
 * detector.on('turn_complete', (event) => {
 *   console.log(`Turn done after ${event.durationMs}ms of speech`);
 * });
 * detector.pushVadEvent({ type: 'speech_start', timestamp: Date.now() });
 * detector.pushVadEvent({ type: 'speech_end', timestamp: Date.now() + 500 });
 * // -> After 2000ms of silence, 'turn_complete' fires with reason 'silence_timeout'
 * ```
 */
export declare class AcousticEndpointDetector extends EventEmitter implements IEndpointDetector {
    /**
     * Detection mode identifier. Always `'acoustic'` for this implementation.
     * See `IEndpointDetector.mode`.
     */
    readonly mode: "acoustic";
    /**
     * Underlying silence-duration tracker from `media/audio/`.
     * Handles the actual timer management and threshold comparison.
     */
    private readonly silenceDetector;
    /**
     * Timestamp (ms) when the current speech segment began. Used to compute
     * `durationMs` in the emitted {@link TurnCompleteEvent} as:
     * `speechEndTimeMs - speechStartTimeMs`.
     *
     * Reset to `null` on each `reset` call.
     */
    private speechStartTimeMs;
    /**
     * Timestamp (ms) when the most recent `speech_end` VAD event was received.
     * Used together with `speechStartTimeMs` to calculate `durationMs`
     * for the turn-complete event.
     *
     * Reset to `null` on each `reset` call.
     */
    private speechEndTimeMs;
    /**
     * Creates a new AcousticEndpointDetector.
     *
     * @param config - Optional silence-threshold overrides.
     */
    constructor(config?: AcousticEndpointDetectorConfig);
    /**
     * Converts a {@link VadEvent} into the SilenceDetector's expected API calls.
     *
     * - **`speech_start`**: Resets silence state (cancels pending timers) and
     *   re-emits `'speech_start'` on this detector for pipeline consumption.
     * - **`speech_end`**: Records the timestamp and starts the silence clock.
     * - **`silence`**: Treated as ongoing non-speech frames, advancing the
     *   SilenceDetector's internal timer.
     *
     * @param event - Incoming VAD event from the upstream voice activity detector.
     */
    pushVadEvent(event: VadEvent): void;
    /**
     * No-op -- this detector is purely acoustic and does not use transcript content.
     *
     * The method exists solely to satisfy the {@link IEndpointDetector} interface.
     * Calling it has no effect and does not throw.
     *
     * @param _event - Ignored transcript event.
     */
    pushTranscript(_event: TranscriptEvent): void;
    /**
     * Resets all internal state and cancels pending timers.
     *
     * Should be called at the start of each new turn to ensure clean state.
     * This also resets the underlying SilenceDetector, cancelling any pending
     * utterance_end_detected timer.
     */
    reset(): void;
}
//# sourceMappingURL=AcousticEndpointDetector.d.ts.map